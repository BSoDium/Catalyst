// Shared measurement helpers for the performance scripts (docs/performance.md is the manual).
//
// What is measured, and why it is more than "rAF intervals" (which sit at 16.7 ms whenever the machine keeps up and
// say nothing about how much of the frame budget is used):
//   - active-frame intervals: our own rAF probe records every frame; a frame counts as "active" when the app issued
//     WebGL draws since the previous one, so idle gaps are not averaged in. Reported as p50/p95/p99/max and the count
//     over 16.7 ms and 25 ms.
//   - the same intervals with the compositor's frame rate limit and vsync OFF (`uncapped`): then the interval IS the
//     per-frame cost (CPU + GPU pipeline), not the display's pace.
//   - Chrome trace (CDP Tracing: devtools.timeline, gpu, cc, v8.gc, blink.user_timing): main-thread tasks, rAF callback
//     time (FireAnimationFrame), style/layout/paint, GPUTask time in the GPU process, GC pauses, presented/dropped frames.
//   - Performance.getMetrics deltas (script, layout, style, task duration), long tasks, long animation frames,
//     JS heap, per-GL-call CPU time (texImage2D, readPixels, draws) and the app's own phase timers (window.__perf).
import { chromium } from "playwright-core";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const DEFAULT_CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
export const CHROME = process.env.CHROME_PATH ?? DEFAULT_CHROME;

export const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
export const MOBILE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1",
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** `uncapped`: no vsync and no frame rate limit, so rAF intervals measure cost instead of the display's pace. */
export async function launch({ headed = false, uncapped = false } = {}) {
  if (!existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}; set CHROME_PATH`);
  const args = ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu", "--enable-precise-memory-info", "--enable-gpu-rasterization"];
  if (uncapped) args.push("--disable-gpu-vsync", "--disable-frame-rate-limit");
  return chromium.launch({ executablePath: CHROME, headless: !headed, args });
}

export function pct(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}
const r2 = (x) => (x === null || x === undefined ? null : +x.toFixed(2));

/**
 * The display period (the median interval: 8.3 ms on a 120 Hz ProMotion display, 16.7 on 60 Hz) and how many
 * intervals missed at least one vsync (> 1.5 periods). "Frames over 16.7 ms" says nothing on a 120 Hz screen, where a
 * 12 ms frame already drops half the frames.
 */
function period(sorted) {
  if (sorted.length < 5) return {};
  const p = pct(sorted, 0.5);
  return { period: r2(p), missed: sorted.filter((x) => x > p * 1.5).length };
}

export function stats(values) {
  const s = [...values].sort((a, b) => a - b);
  return {
    n: s.length,
    p50: r2(pct(s, 0.5)),
    p95: r2(pct(s, 0.95)),
    p99: r2(pct(s, 0.99)),
    max: r2(s[s.length - 1] ?? null),
    over16_7: s.filter((x) => x > 16.9).length,
    over25: s.filter((x) => x > 25).length,
    ...period(s),
  };
}

/** Installed before any app code: probe, GL counters / timers, observers. */
export const initProbe = () => {
  const pf = {
    t: [], // rAF timestamps
    draws: [], // cumulative draw count at each rAF
    glMs: [], // cumulative GL call CPU ms at each rAF
    running: false,
    rafCalls: 0,
    gl: {}, // name -> { n, ms }
    drawsTotal: 0,
    longtasks: [],
    loaf: [],
    contexts: 0,
  };
  window.__pf = pf;
  // GPU time per frame per context: one EXT_disjoint_timer_query_webgl2 query from the first GPU command of a frame to
  // the next probe tick (= the previous frame's end), per context, results polled later.
  pf.gpu = []; // by interval index: { total, by: {label: ms} }
  const qs = new Map(); // gl -> { ext, open, pending[] }
  const labelOf = (gl) => {
    const c = gl.canvas;
    return c?.dataset?.role ?? (c?.classList?.contains("maplibregl-canvas") ? "map" : c?.dataset?.role ?? "three");
  };
  const ensureQuery = (gl) => {
    let q = qs.get(gl);
    if (q === undefined) {
      const ext = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext ? gl.getExtension("EXT_disjoint_timer_query_webgl2") : null;
      q = { ext, open: null, pending: [] };
      qs.set(gl, q);
    }
    if (!q.ext || q.open) return;
    try {
      const h = gl.createQuery();
      gl.beginQuery(q.ext.TIME_ELAPSED_EXT, h);
      q.open = { h, idx: pf.t.length };
    } catch {
      q.ext = null;
    }
  };
  const closeQueries = () => {
    for (const [gl, q] of qs) {
      if (q.open && !gl.isContextLost()) {
        try {
          gl.endQuery(q.ext.TIME_ELAPSED_EXT);
          q.pending.push(q.open);
        } catch {}
      }
      q.open = null;
    }
  };
  const pollQueries = () => {
    for (const [gl, q] of qs) {
      if (!q.pending.length || gl.isContextLost()) continue;
      const keep = [];
      for (const p of q.pending) {
        let avail = false;
        try {
          avail = gl.getQueryParameter(p.h, gl.QUERY_RESULT_AVAILABLE);
        } catch {}
        if (!avail) {
          keep.push(p);
          continue;
        }
        const disjoint = gl.getParameter(q.ext.GPU_DISJOINT_EXT);
        const ms = disjoint ? 0 : gl.getQueryParameter(p.h, gl.QUERY_RESULT) / 1e6;
        gl.deleteQuery(p.h);
        const e = (pf.gpu[p.idx] ??= { total: 0, by: {} });
        const l = labelOf(gl);
        e.total += ms;
        e.by[l] = (e.by[l] ?? 0) + ms;
      }
      q.pending = keep;
    }
  };
  pf.flushGpu = () => {
    closeQueries();
    pollQueries();
  };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => {
    pf.rafCalls++;
    return raf(cb);
  };
  const timed = (proto, name, countDraw) => {
    const f = proto[name];
    if (!f) return;
    const gpuOp = countDraw || name === "clear" || name === "texImage2D" || name === "texSubImage2D" || name === "blitFramebuffer" || name === "copyTexSubImage2D";
    proto[name] = function (...a) {
      if (!pf.running) {
        if (countDraw) pf.drawsTotal++;
        return f.apply(this, a);
      }
      if (gpuOp) ensureQuery(this);
      const t0 = performance.now();
      const r = f.apply(this, a);
      const dt = performance.now() - t0;
      const e = (pf.gl[name] ??= { n: 0, ms: 0 });
      e.n++;
      e.ms += dt;
      if (countDraw) pf.drawsTotal++;
      return r;
    };
  };
  for (const proto of [WebGL2RenderingContext.prototype, WebGLRenderingContext.prototype]) {
    for (const n of ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced", "clear"]) timed(proto, n, n !== "clear" ? true : false);
    for (const n of ["texImage2D", "texSubImage2D", "readPixels", "bufferData", "bufferSubData", "uniformMatrix4fv", "useProgram", "flush", "finish", "copyTexSubImage2D", "blitFramebuffer", "generateMipmap", "compileShader", "linkProgram"]) timed(proto, n, false);
  }
  const origGet = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const c = origGet.call(this, type, ...rest);
    if (c && /webgl/.test(type) && !this.__counted) {
      this.__counted = true;
      pf.contexts++;
    }
    return c;
  };
  // Always-on rAF probe: records a timestamp, the draw count and the cumulative GL ms at every frame.
  const loop = (ts) => {
    if (pf.running) {
      closeQueries();
      pollQueries();
      pf.t.push(ts);
      pf.draws.push(pf.drawsTotal);
      let ms = 0;
      for (const k in pf.gl) ms += pf.gl[k].ms;
      pf.glMs.push(ms);
    }
    raf(loop);
  };
  raf(loop);
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) pf.longtasks.push({ t: e.startTime, d: e.duration });
    }).observe({ entryTypes: ["longtask"] });
  } catch {}
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries())
        pf.loaf.push({
          t: e.startTime,
          d: e.duration,
          block: e.blockingDuration,
          render: e.renderStart ? e.startTime + e.duration - e.renderStart : 0,
          style: e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0,
          scripts: (e.scripts ?? []).map((s) => ({ d: s.duration, src: (s.sourceURL || "").split("/").pop(), fn: s.sourceFunctionName, inv: s.invoker })),
        });
    }).observe({ type: "long-animation-frame", buffered: true });
  } catch {}
};

/**
 * A page with the probe installed. `flags`: sessionStorage keys set before app code runs (globe-debug, street-opts,
 * no-street, dissolve ...).
 */
export async function openPage(browser, profile, url, { colorScheme = "light", reducedMotion = "no-preference", flags = {} } = {}) {
  const ctx = await browser.newContext({ ...profile, colorScheme, reducedMotion });
  const page = await ctx.newPage();
  const logs = [];
  page.on("console", (m) => {
    if (["error", "warning"].includes(m.type())) logs.push(`${m.type()}: ${m.text().slice(0, 200)}`);
  });
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
  await page.addInitScript(initProbe);
  await page.addInitScript((f) => {
    for (const [k, v] of Object.entries(f)) sessionStorage.setItem(k, v);
  }, flags);
  await page.goto(url);
  return { ctx, page, logs };
}

/** Wait until the app stops drawing for `quietMs` (and at least `minMs` passed). */
export async function waitQuiet(page, { quietMs = 800, minMs = 300, maxMs = 60000 } = {}) {
  await page.evaluate(
    ({ quietMs, minMs, maxMs }) =>
      new Promise((resolve) => {
        const start = performance.now();
        let last = window.__pf.drawsTotal;
        let since = performance.now();
        const tick = () => {
          const now = performance.now();
          if (window.__pf.drawsTotal !== last) {
            last = window.__pf.drawsTotal;
            since = now;
          }
          if ((now - since > quietMs && now - start > minMs) || now - start > maxMs) resolve();
          else setTimeout(tick, 50);
        };
        tick();
      }),
    { quietMs, minMs, maxMs },
  );
}

const TRACE_CATEGORIES = [
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.frame",
  "gpu",
  "cc",
  "benchmark",
  "v8.gc",
  "blink.user_timing",
  "toplevel",
];

/**
 * Run `fn(page)` under measurement and return the report. `trace`: also record a Chrome trace (parsed by trace.mjs,
 * saved as `tracePath` when given: open it in chrome://tracing or ui.perfetto.dev).
 */
export async function measure(browser, page, ctx, fn, { trace = true, tracePath = null } = {}) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Performance.enable");
  const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  await page.evaluate(() => {
    const pf = window.__pf;
    pf.t.length = pf.draws.length = pf.glMs.length = 0;
    pf.gpu = [];
    pf.longtasks.length = pf.loaf.length = 0;
    pf.gl = {};
    pf.raf0 = pf.rafCalls;
    pf.draws0 = pf.drawsTotal;
    pf.running = true;
    pf.heap0 = performance.memory?.usedJSHeapSize ?? 0;
    window.__perf?.reset?.();
  });
  const m0 = await metrics();
  let traceBuf = null;
  if (trace) await browser.startTracing(page, { categories: TRACE_CATEGORIES, screenshots: false });
  const t0 = Date.now();
  let extra;
  try {
    extra = await fn(page);
  } finally {
    if (trace) traceBuf = await browser.stopTracing();
  }
  const wallMs = Date.now() - t0;
  const m1 = await metrics();
  await page.evaluate(() => window.__pf.flushGpu());
  await sleep(400);
  const raw = await page.evaluate(() => {
    const pf = window.__pf;
    pf.flushGpu();
    pf.running = false;
    return {
      gpu: pf.gpu.map((g) => g ?? null),
      t: pf.t,
      draws: pf.draws,
      glMs: pf.glMs,
      gl: pf.gl,
      longtasks: pf.longtasks,
      loaf: pf.loaf,
      rafCalls: pf.rafCalls - pf.raf0,
      drawsTotal: pf.drawsTotal - pf.draws0,
      heap0: pf.heap0,
      heap1: performance.memory?.usedJSHeapSize ?? 0,
      phases: window.__perf?.snapshot?.() ?? null,
    };
  });
  // Active frames: the app drew since the previous probe tick. Trim the idle head and tail.
  const iv = [];
  const gpuPer = [];
  const gpuBy = {};
  const glPerFrame = [];
  let first = -1;
  let last = -1;
  for (let i = 1; i < raw.t.length; i++) if (raw.draws[i] > raw.draws[i - 1]) (first < 0 && (first = i), (last = i));
  if (first > 0) {
    for (let i = first; i <= last; i++) {
      iv.push(raw.t[i] - raw.t[i - 1]);
      const g = raw.gpu[i];
      gpuPer.push(g ? g.total : 0);
      if (g) for (const [k, v] of Object.entries(g.by)) gpuBy[k] = (gpuBy[k] ?? 0) + v;
      glPerFrame.push(raw.glMs[i] - raw.glMs[i - 1]);
    }
  }
  const d = (k) => (m1[k] - m0[k]) * 1000;
  const report = {
    wallMs,
    activeFrames: iv.length,
    frameMs: stats(iv),
    gpuMs: {
      ...stats(gpuPer),
      mean: gpuPer.length ? r2(gpuPer.reduce((a, b) => a + b, 0) / gpuPer.length) : null,
      meanBy: Object.fromEntries(Object.entries(gpuBy).map(([k, v]) => [k, r2(v / Math.max(1, gpuPer.length))])),
    },
    glCpuMsPerFrame: glPerFrame.length ? r2(glPerFrame.reduce((a, b) => a + b, 0) / glPerFrame.length) : null,
    cdp: {
      scriptMs: r2(d("ScriptDuration")),
      layoutMs: r2(d("LayoutDuration")),
      styleMs: r2(d("RecalcStyleDuration")),
      taskMs: r2(d("TaskDuration")),
      layoutCount: m1.LayoutCount - m0.LayoutCount,
      styleCount: m1.RecalcStyleCount - m0.RecalcStyleCount,
    },
    longtasks: { n: raw.longtasks.length, maxMs: r2(Math.max(0, ...raw.longtasks.map((x) => x.d))) },
    loaf: {
      n: raw.loaf.length,
      maxMs: r2(Math.max(0, ...raw.loaf.map((x) => x.d))),
      top: raw.loaf
        .sort((a, b) => b.d - a.d)
        .slice(0, 3)
        .map((x) => ({ d: r2(x.d), block: r2(x.block), render: r2(x.render), style: r2(x.style), scripts: x.scripts.sort((a, b) => b.d - a.d).slice(0, 2) })),
    },
    heapMB: { before: r2(raw.heap0 / 1048576), after: r2(raw.heap1 / 1048576) },
    rafCalls: raw.rafCalls,
    draws: raw.drawsTotal,
    gl: Object.fromEntries(Object.entries(raw.gl).map(([k, v]) => [k, { n: v.n, ms: r2(v.ms) }])),
    phases: raw.phases,
    extra,
  };
  if (traceBuf) {
    const { analyseTrace } = await import("./trace.mjs");
    if (tracePath) {
      mkdirSync(dirname(tracePath), { recursive: true });
      writeFileSync(tracePath, traceBuf);
    }
    report.trace = analyseTrace(JSON.parse(traceBuf.toString()), { activeFrames: iv.length });
  }
  await cdp.detach().catch(() => {});
  return report;
}
