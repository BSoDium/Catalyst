/**
 * `?bench=1` benchmark: scripted continuous rotation + zoom, then an idle window.
 *
 * Passes
 *  - continuous: rAF interval distribution and JS render time while the camera moves every frame;
 *  - gpu-sync:   same, plus a blocking 1px readPixels after each render so GPU time is included;
 *  - idle:       no input for a few seconds; counts rendered frames and requestAnimationFrame calls.
 *
 * The MapLibre pass patches the private `Map._render` to time it (measurement only, bench mode only).
 */
import type { GlobeRenderer, ViewState } from "./core/types";
import type { LabelLayer } from "./core/labels";

interface Pct {
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}
const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (xs: number[]): Pct => {
  if (!xs.length) return { p50: 0, p95: 0, p99: 0, max: 0, mean: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
  return { p50: r2(at(0.5)), p95: r2(at(0.95)), p99: r2(at(0.99)), max: r2(s[s.length - 1]!), mean: r2(xs.reduce((a, b) => a + b, 0) / xs.length) };
};

interface ThreeLike extends GlobeRenderer {
  renderNow(): void;
  gpuSync(): void;
}
interface MapLike extends GlobeRenderer {
  raw: {
    jumpTo(o: unknown): void;
    _render(t: number): unknown;
    painter: { context: { gl: WebGL2RenderingContext } };
  };
}

function scripted(t: number, minZoom: number): ViewState {
  const zmax = 5.2;
  const zmin = minZoom + 0.1;
  return {
    lon: 20 + 36 * t,
    lat: 20 + 30 * Math.sin((2 * Math.PI * t) / 11),
    zoom: zmin + (zmax - zmin) * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 9)),
  };
}

const nextFrame = () => new Promise<number>((res) => requestAnimationFrame(res));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface BenchOptions {
  kind: "three" | "maplibre";
  getRenderer: () => GlobeRenderer;
  duration: number;
  label: string;
}

export async function runBench(opts: BenchOptions) {
  const r = opts.getRenderer();
  const app = (window as unknown as { __app: { labels: LabelLayer | null; data: { places: unknown[] } } }).__app;
  await sleep(800); // let the worker / first frames settle
  const gl = r.canvas.getContext("webgl2") ?? r.canvas.getContext("webgl");
  const dbg = gl?.getExtension("WEBGL_debug_renderer_info");
  const glRenderer = gl && dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "unknown";

  // Time label updates separately so renderer cost excludes them.
  let labelMs: number[] = [];
  const labels = app.labels;
  const origUpdate = labels?.update.bind(labels);
  if (labels && origUpdate) {
    labels.update = (...a: Parameters<LabelLayer["update"]>) => {
      const t = performance.now();
      origUpdate(...a);
      labelMs.push(performance.now() - t);
    };
  }

  let mlRenderMs: number[] = [];
  let mlSync = false;
  let mlRenders = 0;
  let restoreMl: (() => void) | null = null;
  if (opts.kind === "maplibre") {
    const m = (r as MapLike).raw;
    const orig = m._render.bind(m);
    m._render = (t: number) => {
      const s = performance.now();
      const out = orig(t);
      if (mlSync) {
        const g = m.painter.context.gl;
        g.readPixels(0, 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, new Uint8Array(4));
      }
      mlRenderMs.push(performance.now() - s);
      mlRenders++;
      return out;
    };
    restoreMl = () => {
      m._render = orig;
    };
  }

  async function pass(name: string, sync: boolean, seconds: number) {
    labelMs = [];
    mlRenderMs = [];
    mlRenders = 0;
    mlSync = sync;
    const intervals: number[] = [];
    const jsMs: number[] = [];
    const syncMs: number[] = [];
    const warm = 1.5;
    let last = await nextFrame();
    const t0 = last;
    let measuredFrom = -1;
    let rendersAtStart = 0;
    for (;;) {
      const now = await nextFrame();
      const t = (now - t0) / 1000;
      if (t > seconds + warm) break;
      const measuring = t >= warm;
      if (measuring && measuredFrom < 0) {
        measuredFrom = now;
        rendersAtStart = mlRenders;
        labelMs = [];
        mlRenderMs = [];
      }
      const w0 = performance.now();
      const v = scripted(t, r.getMinZoom());
      if (opts.kind === "three") {
        const th = r as ThreeLike;
        th.setView(v);
        th.renderNow();
        if (measuring) jsMs.push(th.stats.lastRenderMs);
        if (sync) {
          th.gpuSync();
          if (measuring) syncMs.push(performance.now() - w0);
        }
      } else {
        (r as MapLike).raw.jumpTo({ center: [v.lon, v.lat], zoom: v.zoom });
      }
      if (measuring) intervals.push(now - last);
      last = now;
    }
    const total = intervals.reduce((a, b) => a + b, 0);
    const res: Record<string, unknown> = {
      name,
      seconds: r2(total / 1000),
      frames: intervals.length,
      fps: r2((intervals.length / total) * 1000),
      rafIntervalMs: pct(intervals),
      labelUpdateMs: pct(labelMs),
    };
    if (opts.kind === "three") {
      res.renderJsMs = pct(jsMs);
      if (sync) res.renderPlusGpuSyncMs = pct(syncMs);
    } else {
      // _render includes the 'render' event handler (the label update), so subtract it for "renderer only".
      res.maplibreRenderMsInclLabels = pct(mlRenderMs);
      res.maplibreRendersPerSecond = r2(((mlRenders - rendersAtStart) / total) * 1000);
      if (sync) res.note = "maplibreRenderMs includes a blocking 1px readPixels (GPU sync)";
    }
    return res;
  }

  const passes: unknown[] = [];
  passes.push(await pass("continuous", false, opts.duration));
  passes.push(await pass("gpu-sync", true, opts.duration));
  mlSync = false;

  // Idle: no input; count frames rendered and rAF calls made by anyone (renderer, workers' main-thread glue).
  await sleep(1500);
  const rafOrig = window.requestAnimationFrame.bind(window);
  let rafCalls = 0;
  window.requestAnimationFrame = (cb: FrameRequestCallback) => {
    rafCalls++;
    return rafOrig(cb);
  };
  const f0 = r.stats.frames;
  mlRenders = 0;
  const idleMs = 4000;
  await sleep(idleMs);
  const idle = {
    ms: idleMs,
    framesRendered: r.stats.frames - f0,
    rafCalls,
    maplibreRenders: opts.kind === "maplibre" ? mlRenders : undefined,
  };
  window.requestAnimationFrame = rafOrig;
  restoreMl?.();
  if (labels && origUpdate) labels.update = origUpdate;

  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
  return {
    renderer: opts.kind,
    env: {
      ua: navigator.userAgent,
      dpr: devicePixelRatio,
      viewport: `${innerWidth}x${innerHeight}`,
      glRenderer,
      canvasBuffer: `${r.canvas.width}x${r.canvas.height}`,
      places: app.data.places.length,
    },
    passes,
    idle,
    jsHeapMB: mem ? r2(mem / 1048576) : null,
  };
}
