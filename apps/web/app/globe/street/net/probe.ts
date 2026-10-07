/**
 * Source probes: one small request with its own hard timeout and real abort.
 *  - kind "tilejson" (the OpenFreeMap primary): the TileJSON document, validated into a descriptor;
 *  - kind "pmtiles" (the fallback, or a PMTiles primary): a `Range: bytes=0-126` read of the 127-byte header,
 *    which also tells the zoom and bounds the archive covers.
 * Never rejects: every failure is a `ProbeOutcome` with a reason.
 */
import { bytesToHeader } from "pmtiles";
import { descriptorFromPmtiles, descriptorFromTileJson, type SourceDescriptor } from "../core/source-descriptor";
import type { ProbeResult, SourceId } from "../core/tile-source-manager";

export interface ProbeOutcome extends ProbeResult {
  descriptor: SourceDescriptor | null;
}

export interface ProbeConfig {
  role: SourceId;
  /** "pmtiles": a range-read archive (the fallback always); "tilejson": a z/x/y source described by a TileJSON. */
  kind: "pmtiles" | "tilejson";
  url: string;
  /** Highest zoom tiles are requested at from a PMTiles archive (the fallback's `maxFallbackZoom`); null = the archive's own. */
  maxZoomCap: number | null;
  timeoutMs: number;
}

const MAX_JSON_BYTES = 256 * 1024;
const PMTILES_MAGIC = [0x50, 0x4d, 0x54, 0x69, 0x6c, 0x65, 0x73]; // "PMTiles"

export async function probeSource(cfg: ProbeConfig): Promise<ProbeOutcome> {
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, cfg.timeoutMs);
  const t0 = performance.now();
  const done = (ok: boolean, reason: ProbeResult["reason"], descriptor: SourceDescriptor | null = null): ProbeOutcome => ({
    ok,
    reason,
    ms: performance.now() - t0,
    descriptor,
  });
  try {
    if (cfg.kind === "pmtiles") {
      const res = await fetch(cfg.url, { signal: ctl.signal, headers: { Range: "bytes=0-126" } });
      if (res.status !== 206) {
        ctl.abort(); // a 200 would stream the whole archive: never read it
        return done(false, res.ok ? "invalid" : "http");
      }
      const buf = await res.arrayBuffer();
      if (buf.byteLength < 127) return done(false, "invalid");
      const bytes = new Uint8Array(buf);
      if (!PMTILES_MAGIC.every((b, i) => bytes[i] === b)) return done(false, "invalid");
      const header = bytesToHeader(buf);
      return done(true, "ok", descriptorFromPmtiles(cfg.role, cfg.url, header, cfg.maxZoomCap));
    }
    const res = await fetch(cfg.url, { signal: ctl.signal, headers: { Accept: "application/json" } });
    if (!res.ok) return done(false, "http");
    const text = await res.text();
    if (text.length > MAX_JSON_BYTES) return done(false, "invalid");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return done(false, "invalid");
    }
    const descriptor = descriptorFromTileJson(cfg.role, json, "openmaptiles");
    return descriptor ? done(true, "ok", descriptor) : done(false, "invalid");
  } catch {
    return done(false, timedOut ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
  }
}
