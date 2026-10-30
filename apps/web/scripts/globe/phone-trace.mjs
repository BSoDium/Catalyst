// Records a Chrome trace on a phone, over adb, while the camera goes from the world view to a city (docs/performance.md, "Zoom steps").
//
//   adb forward tcp:9222 localabstract:chrome_devtools_remote
//   node apps/web/scripts/globe/phone-trace.mjs [--url https://v2.bsodium.fr/] [--out DIR] [--mode steps|flight]
//
// Attaches to the phone's Chrome (USB debugging on, one tab on the site), turns the debug hooks on for that tab (`sessionStorage globe-debug`), records the
// timeline, GPU and compositor categories while the camera is stepped half a zoom level at a time from the world view to city level (or flown there), and writes
// the trace (open it in DevTools' Performance panel, or at ui.perfetto.dev) and the frame intervals per step.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith("--") ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const url = args.url ?? "https://v2.bsodium.fr/";
const out = args.out ?? join(process.cwd(), "perf-out", `phone-trace-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const mode = args.mode ?? "steps";
// `--trace 0`: the same run without the trace (recording it costs frames: the numbers of the frames and the animation frames are the cleaner ones)
const tracing = args.trace !== "0";
mkdirSync(out, { recursive: true });
const at = { lon: 21.0122, lat: 52.2297 };

const browser = await chromium.connectOverCDP("http://localhost:9222");
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().startsWith(url.slice(0, 20))) ?? ctx.pages()[0];
await page.addInitScript(() => sessionStorage.setItem("globe-debug", "1"));
await page.evaluate(() => sessionStorage.setItem("globe-debug", "1"));
await page.goto(url, { waitUntil: "load" });
await page.waitForFunction(() => window.__handoverDebug && document.querySelector('[data-globe="three"][data-state="ready"]'), null, { timeout: 60000 });
await page.waitForTimeout(3000);
const info = await page.evaluate(() => ({ ua: navigator.userAgent, dpr: devicePixelRatio, w: innerWidth, h: innerHeight, min: window.__globeDebug.minZoom(), zoom: window.__handoverDebug.zoom() }));
console.log(JSON.stringify(info));

await page.evaluate(() => {
  window.__iv = [];
  window.__loaf = [];
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__loaf.push({ t: Math.round(e.startTime), d: Math.round(e.duration), s: (e.scripts || []).map((s) => `${s.sourceFunctionName || s.invoker || ""}@${(s.sourceURL || "").split("/").pop()}:${Math.round(s.duration)}`).slice(0, 3).join(" | ") });
    }).observe({ type: "long-animation-frame", buffered: true });
  } catch {}
  let last = 0;
  const f = (t) => {
    if (last) window.__iv.push([Math.round(t), +(t - last).toFixed(1), window.__handoverDebug?.zoom() ?? 0]);
    last = t;
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
});

const categories = ["devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame", "v8.execute", "blink.user_timing", "loading", "gpu", "cc", "viz", "toplevel", "disabled-by-default-gpu.service", "disabled-by-default-v8.cpu_profiler"];
if (tracing) await browser.startTracing(page, { path: join(out, "trace.json"), categories, screenshots: false });
const marks = [];
const t0 = Date.now();
const mark = (label) => marks.push({ ms: Date.now() - t0, label });
const min = info.min;
if (mode === "flight") {
  await page.evaluate((v) => window.__handoverDebug.globe.setView({ ...v, zoom: window.__globeDebug.minZoom() }), at);
  await page.waitForTimeout(2500);
  mark("flight start");
  await page.evaluate(({ lon, lat }) => window.__handoverDebug.fly({ lon, lat, zoom: 14.5 }), at);
  await page.waitForFunction(() => window.__handoverDebug.zoom() > 14, null, { timeout: 60000 });
  await page.waitForTimeout(4000);
  mark("flight end");
} else {
  await page.evaluate((v) => window.__handoverDebug.globe.setView({ ...v, zoom: window.__globeDebug.minZoom() }), at);
  await page.waitForTimeout(2500);
  for (let z = min; z <= 14.5 + 1e-9; z += 0.5) {
    mark(`zoom ${z.toFixed(1)}`);
    await page.evaluate(([v, z]) => window.__handoverDebug.globe.setView({ ...v, zoom: z }), [at, z]);
    await page.waitForTimeout(2500);
  }
}
if (tracing) await browser.stopTracing();
const iv = await page.evaluate(() => window.__iv);
const loaf = await page.evaluate(() => window.__loaf);
writeFileSync(join(out, "frames.json"), JSON.stringify({ info, marks, iv, loaf }));
console.log(JSON.stringify({ out, frames: iv.length, over50: iv.filter((x) => x[1] > 50).length, max: Math.max(...iv.map((x) => x[1])), marks: marks.length }));
await browser.close();
