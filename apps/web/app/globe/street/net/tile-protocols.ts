/**
 * Tile request layer. MapLibre fetches every vector tile through two custom protocols registered per street map
 * instance (`catp<N>` for the primary, `catf<N>` for the fallback; removed again on dispose). That gives the one thing
 * MapLibre itself lacks, a request timeout, and the numbers the source manager scores:
 *
 *  - every request is timed and ends as ok / empty / http-error / network-error / timeout;
 *  - a request aborted by MapLibre (the tile left the screen) is cancelled, not a failure;
 *  - HTTP 404 / 204 and tiles missing from a PMTiles archive are EMPTY tiles (valid, drawn as nothing): the fallback
 *    only covers boxes around the curated places, so a missing tile is expected and must not spam errors;
 *  - one `AbortController` per request joins MapLibre's own abort with our timeout.
 *
 * The page's `fetch` is looked up at call time, so tests can wrap it.
 */
import { addProtocol, removeProtocol, type AddProtocolAction } from "maplibre-gl";
import { FetchSource, PMTiles } from "pmtiles";
import type { RequestOutcome } from "../core/tile-health";
import type { SourceDescriptor } from "../core/source-descriptor";
import type { SourceId, TileSourceManager } from "../core/tile-source-manager";

type TileResponse = Awaited<ReturnType<AddProtocolAction>>;

class HttpError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
    this.name = "HttpError";
  }
}

export interface TileNetworkOptions {
  /** Unique per street map instance. */
  instance: number;
  manager: TileSourceManager;
  requestTimeoutMs: number;
}

export interface TileNetwork {
  scheme(role: SourceId): string;
  /** The style's tile URLs for a source: its real URLs behind this instance's protocol. */
  styleTiles(d: SourceDescriptor): string[];
  dispose(): void;
}

const ZXY = /\/(\d+)\/(\d+)\/(\d+)$/;

export function createTileNetwork(opts: TileNetworkOptions): TileNetwork {
  const schemes: Record<SourceId, string> = { primary: `catp${opts.instance}`, fallback: `catf${opts.instance}` };
  const archives = new Map<string, PMTiles>();
  /** URLs of PMTiles archives announced by `styleTiles` (tile requests for them are read by range, not fetched). */
  const archiveUrls = new Set<string>();
  let disposed = false;

  const archive = (url: string): PMTiles => {
    let a = archives.get(url);
    if (!a) {
      a = new PMTiles(new FetchSource(url));
      archives.set(url, a);
    }
    return a;
  };

  /** Run one tile request under timing, timeout and abort rules. */
  async function timed(role: SourceId, outer: AbortController, run: (signal: AbortSignal) => Promise<TileResponse & { empty?: boolean }>): Promise<TileResponse> {
    const id = opts.manager.requestStarted(role);
    const t0 = performance.now();
    const inner = new AbortController();
    let timedOut = false;
    const onAbort = () => inner.abort();
    outer.signal.addEventListener("abort", onAbort);
    const timer = setTimeout(() => {
      timedOut = true;
      inner.abort();
    }, opts.requestTimeoutMs);
    try {
      const r = await run(inner.signal);
      opts.manager.requestFinished(id, r.empty ? "empty" : "ok", performance.now() - t0);
      return r;
    } catch (e) {
      if (outer.signal.aborted && !timedOut) {
        opts.manager.requestCancelled(id);
        throw e;
      }
      const outcome: RequestOutcome = timedOut ? "timeout" : e instanceof HttpError ? "http-error" : "network-error";
      opts.manager.requestFinished(id, outcome, performance.now() - t0);
      // Not an AbortError: MapLibre treats those as "the tile was cancelled" and would leave the tile loading forever.
      throw timedOut ? new Error(`tile request timed out after ${opts.requestTimeoutMs} ms`) : e;
    } finally {
      clearTimeout(timer);
      outer.signal.removeEventListener("abort", onAbort);
    }
  }

  const handler =
    (role: SourceId): AddProtocolAction =>
    (params, outer) => {
      const url = params.url.slice(schemes[role].length + 3);
      const zxy = ZXY.exec(url);
      const isArchive = zxy !== null && archiveUrls.has(url.slice(0, url.length - zxy[0].length));
      return timed(role, outer, async (signal) => {
        if (isArchive) {
          const archiveUrl = url.slice(0, url.length - zxy[0].length);
          const resp = await archive(archiveUrl).getZxy(Number(zxy[1]), Number(zxy[2]), Number(zxy[3]), signal);
          signal.throwIfAborted();
          if (!resp) return { data: new Uint8Array(), empty: true };
          return { data: new Uint8Array(resp.data), cacheControl: resp.cacheControl, expires: resp.expires };
        }
        const res = await fetch(url, { signal });
        if (res.status === 404 || res.status === 204) return { data: new Uint8Array(), empty: true };
        if (!res.ok) throw new HttpError(res.status);
        const data = await res.arrayBuffer();
        return { data, cacheControl: res.headers.get("Cache-Control") ?? undefined, expires: res.headers.get("Expires") ?? undefined };
      });
    };

  addProtocol(schemes.primary, handler("primary"));
  addProtocol(schemes.fallback, handler("fallback"));

  return {
    scheme: (role) => schemes[role],
    styleTiles(d) {
      const prefix = `${schemes[d.role]}://`;
      if (!d.archiveUrl) return d.tiles.map((t) => `${prefix}${t}`);
      archiveUrls.add(d.archiveUrl);
      return [`${prefix}${d.archiveUrl}/{z}/{x}/{y}`];
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      removeProtocol(schemes.primary);
      removeProtocol(schemes.fallback);
      archives.clear();
      archiveUrls.clear();
    },
  };
}
