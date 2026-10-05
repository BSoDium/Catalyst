/** In-page benchmark helpers (run by scripts/measure.mjs through window.__app.bench). */
import type { CopyCompositor } from "./gl/compositors";
import type { Street } from "./street";

export interface Pct {
  p50: number;
  p95: number;
  max: number;
}

export function pct(xs: number[]): Pct {
  if (xs.length === 0) return { p50: 0, p95: 0, max: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
  return { p50: round(at(0.5)), p95: round(at(0.95)), max: round(s[s.length - 1]!) };
}
const round = (v: number) => Math.round(v * 100) / 100;

export interface BenchOptions {
  view: { lon: number; lat: number; zoom: number };
  durationMs: number;
  warmupMs?: number;
  motion: "pan" | "zoom" | "none";
}

export interface BenchResult {
  frames: number;
  seconds: number;
  fps: number;
  rafIntervalMs: Pct;
  /** map render + composite JS time (from Map._render start to the end of the render event handlers) */
  jsMs: Pct;
  /** the same, plus a blocking 1-pixel readPixels on the final context (GPU inclusive) */
  syncedMs: Pct;
  compositeJsMs: Pct;
  uploadJsMs: Pct;
  heapMB: number | null;
}

type MapInternals = { _render: (t: number) => void };

export async function runBench(street: Street, o: BenchOptions): Promise<BenchResult> {
  const map = street.map;
  street.setView(o.view);
  await street.whenSettled();
  const comp = street.compositor;
  const gl = map.getCanvas().getContext("webgl2") as WebGL2RenderingContext | null;
  const sync = () => {
    if (comp) comp.sync();
    else if (gl) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  };

  const internals = map as unknown as MapInternals;
  const origRender = internals._render.bind(map);
  let start = 0;
  internals._render = (t: number) => {
    start = performance.now();
    origRender(t);
  };

  const js: number[] = [];
  const synced: number[] = [];
  const raf: number[] = [];
  const comps: number[] = [];
  const uploads: number[] = [];
  let measuring = false;
  const onRender = () => {
    const end = performance.now();
    sync();
    const end2 = performance.now();
    if (measuring) {
      js.push(end - start);
      synced.push(end2 - start);
      if (comp) {
        comps.push(comp.stats.lastPassMs);
        uploads.push(comp.stats.lastUploadMs);
      }
    }
  };
  map.on("render", onRender);

  const px = (512 * Math.pow(2, o.view.zoom)) / 360; // css px per degree of longitude at the equator
  const cosLat = Math.cos((o.view.lat * Math.PI) / 180);
  const t0 = performance.now();
  const warm = o.warmupMs ?? 1500;
  let prev = t0;
  let frames = 0;
  await new Promise<void>((resolve) => {
    const step = (now: number) => {
      const t = (now - t0) / 1000;
      if (now - t0 > warm) measuring = true;
      if (measuring) {
        raf.push(now - prev);
        frames++;
      }
      prev = now;
      if (o.motion === "pan") {
        const ang = t * 0.9;
        const r = 160; // css px radius of the drift circle
        map.jumpTo({
          center: [o.view.lon + (Math.cos(ang) * r) / px / (o.view.zoom > 4 ? cosLat : 1), o.view.lat + (Math.sin(ang) * r) / px / (o.view.zoom > 4 ? 1 : 1)],
        });
      } else if (o.motion === "zoom") {
        map.jumpTo({ zoom: o.view.zoom + 0.5 * Math.sin(t * 1.2) });
      } else {
        map.triggerRepaint();
      }
      if (now - t0 < warm + o.durationMs) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
  map.off("render", onRender);
  internals._render = origRender as unknown as MapInternals["_render"];
  const seconds = o.durationMs / 1000;
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return {
    frames,
    seconds,
    fps: round(frames / seconds),
    rafIntervalMs: pct(raf),
    jsMs: pct(js),
    syncedMs: pct(synced),
    compositeJsMs: pct(comps),
    uploadJsMs: pct(uploads),
    heapMB: mem ? round(mem.usedJSHeapSize / 1048576) : null,
  };
}

/** Frames and rAF calls with no input for `ms`. */
export async function idleCheck(street: Street, ms: number): Promise<{ renders: number; rafCalls: number; passes: number }> {
  await street.whenSettled();
  await new Promise((r) => setTimeout(r, 300));
  const w = window as unknown as { __rafCount?: number };
  const r0 = street.counters.renders;
  const f0 = w.__rafCount ?? 0;
  const p0 = street.compositor?.stats.passes ?? 0;
  await new Promise((r) => setTimeout(r, ms));
  return { renders: street.counters.renders - r0, rafCalls: (w.__rafCount ?? 0) - f0, passes: (street.compositor?.stats.passes ?? 0) - p0 };
}

/** Isolated cost of the canvas copy and of the pool+present pass, GPU-synced, averaged over n repeats. */
export function isolatedCosts(street: Street, n = 30): { uploadMs: number; passMs: number } | null {
  const c = street.compositor as CopyCompositor | null;
  if (!c || c.kind !== "copy") return null;
  c.benchUpload(3);
  c.benchPass(3);
  return { uploadMs: round(c.benchUpload(n)), passMs: round(c.benchPass(n)) };
}
