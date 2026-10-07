// Parse a Chrome trace (JSON object format) into the numbers that explain a frame: who was busy, for how long.
//   node apps/web/scripts/perf/trace.mjs trace.json     (prints the summary of a saved trace)
import { readFileSync } from "node:fs";
import { pct } from "./lib.mjs";

const r2 = (x) => +x.toFixed(2);

/** @param {{ traceEvents: any[] } | any[]} json */
export function analyseTrace(json, { activeFrames = 0 } = {}) {
  const events = Array.isArray(json) ? json : json.traceEvents;
  const procName = new Map();
  const threadName = new Map();
  for (const e of events) {
    if (e.ph !== "M") continue;
    if (e.name === "process_name") procName.set(e.pid, e.args.name);
    if (e.name === "thread_name") threadName.set(`${e.pid}:${e.tid}`, e.args.name);
  }
  // The page's renderer is the one that ran animation frames.
  const rendererPids = new Set(events.filter((e) => e.name === "FireAnimationFrame").map((e) => e.pid));
  const mainKey = (e) => rendererPids.has(e.pid) && threadName.get(`${e.pid}:${e.tid}`) === "CrRendererMain";
  const gpuKey = (e) => /GPU/i.test(procName.get(e.pid) ?? "");

  // Complete events + B/E pairs -> { name, ts, dur, ... }
  const spans = [];
  const stacks = new Map();
  for (const e of events) {
    if (e.ph === "X" && e.dur !== undefined) spans.push(e);
    else if (e.ph === "B") {
      const k = `${e.pid}:${e.tid}`;
      if (!stacks.has(k)) stacks.set(k, []);
      stacks.get(k).push(e);
    } else if (e.ph === "E") {
      const b = stacks.get(`${e.pid}:${e.tid}`)?.pop();
      if (b) spans.push({ ...b, ph: "X", dur: e.ts - b.ts });
    }
  }
  const agg = (pred, names) => {
    const out = {};
    for (const s of spans) {
      if (!pred(s) || (names && !names.includes(s.name))) continue;
      (out[s.name] ??= []).push(s.dur / 1000);
    }
    return Object.fromEntries(
      Object.entries(out).map(([k, v]) => {
        const sorted = [...v].sort((a, b) => a - b);
        const total = v.reduce((a, b) => a + b, 0);
        return [k, { n: v.length, totalMs: r2(total), perFrameMs: activeFrames ? r2(total / activeFrames) : null, p95: r2(pct(sorted, 0.95)), max: r2(sorted[sorted.length - 1]) }];
      }),
    );
  };
  const main = agg(mainKey, [
    "RunTask", "FireAnimationFrame", "UpdateLayoutTree", "Layout", "PrePaint", "Paint", "Layerize", "Commit", "HitTest",
    "EventDispatch", "FunctionCall", "TimerFire", "MinorGC", "MajorGC", "V8.GCScavenger", "V8.GCCompactor", "V8.GC_MC_BACKGROUND_MARKING",
    "ParseHTML", "EvaluateScript", "v8.compile", "RunMicrotasks", "ResizeObserver", "UpdateLayer", "Decode Image", "Raster",
  ]);
  const gpu = agg(gpuKey, ["GPUTask", "DoDecoderWork", "CommandBufferStub::OnAsyncFlush", "GLES2DecoderImpl::DoCommands", "SwapBuffers", "Display::DrawAndSwap", "ProcessGpuCommands"]);
  const gc = {};
  for (const s of spans) {
    if (!mainKey(s) && !rendererPids.has(s.pid)) continue;
    if (/^(MinorGC|MajorGC|V8\.GC(Scavenger|Compactor)|V8\.GC_MC_INCREMENTAL|V8\.GC_SCAVENGER$)/.test(s.name) || /^(MinorGC|MajorGC)$/.test(s.name)) (gc[s.name] ??= []).push(s.dur / 1000);
  }
  const gcOut = Object.fromEntries(Object.entries(gc).map(([k, v]) => [k, { n: v.length, totalMs: r2(v.reduce((a, b) => a + b, 0)), max: r2(Math.max(...v)) }]));

  // Frames as the compositor saw them.
  const frames = { presented: 0, partial: 0, dropped: 0, other: 0 };
  for (const e of events) {
    if (e.name !== "PipelineReporter" || e.ph !== "b") continue;
    const st = e.args?.frame_reporter?.state;
    if (st === "STATE_PRESENTED_ALL") frames.presented++;
    else if (st === "STATE_PRESENTED_PARTIAL") frames.partial++;
    else if (st === "STATE_DROPPED") frames.dropped++;
    else frames.other++;
  }

  // Main-thread tasks longer than a frame, with what they ran.
  const tasks = spans.filter((s) => mainKey(s) && s.name === "RunTask").sort((a, b) => a.ts - b.ts);
  const longTasks = tasks.filter((t) => t.dur > 16700);
  const inside = (t, name) =>
    spans
      .filter((s) => mainKey(s) && s.name === name && s.ts >= t.ts && s.ts + s.dur <= t.ts + t.dur)
      .reduce((a, s) => a + s.dur / 1000, 0);
  const longDetail = longTasks
    .sort((a, b) => b.dur - a.dur)
    .slice(0, 5)
    .map((t) => ({ ms: r2(t.dur / 1000), raf: r2(inside(t, "FireAnimationFrame")), layout: r2(inside(t, "UpdateLayoutTree") + inside(t, "Layout")), paint: r2(inside(t, "Paint") + inside(t, "PrePaint")), gc: r2(inside(t, "MinorGC") + inside(t, "MajorGC")) }));

  // Busy ms of the main thread / GPU process per active frame.
  const sum = (o, k) => o[k]?.totalMs ?? 0;
  return {
    main,
    gpu,
    gc: gcOut,
    frames,
    longMainTasks: { n: longTasks.length, worst: longDetail },
    perFrame: activeFrames
      ? { mainBusyMs: r2((sum(main, "RunTask")) / activeFrames), rafMs: r2(sum(main, "FireAnimationFrame") / activeFrames), gpuTaskMs: r2(sum(gpu, "GPUTask") / activeFrames) }
      : null,
  };
}

if (process.argv[1]?.endsWith("trace.mjs") && process.argv[2]) {
  console.log(JSON.stringify(analyseTrace(JSON.parse(readFileSync(process.argv[2], "utf8"))), null, 2));
}
