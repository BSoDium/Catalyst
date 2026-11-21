// The activity picture's neon start-up (`/software`, dark theme) under a slow phone: a Pixel 7's screen and touch, the CPU slowed `--throttle` times, the Mac's own GPU. Reads what the dev build of the picture
// reports about itself (`data-*` on its box: how many rods flicker, the cost of an update, the cost of a frame while it runs) and times the rAF frames during the start-up.
//
//   node apps/web/scripts/perf/activity-neon.mjs --base http://localhost:5173 [--device pixel7|mobile|desktop] [--throttle 6] [--lite]
//
// It needs the DEV server (the figures are development-only): `pnpm --filter @catalyst/web dev`.
import { PROFILES, launch, sleep, pct } from "./lib.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith("--") ? [...a, [x.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : a), []));
const base = args.base ?? "http://localhost:5173";
const device = args.device ?? "pixel7";
const throttle = Number(args.throttle ?? 6);
const browser = await launch({ uncapped: !!args.uncapped });
const context = await browser.newContext({ ...PROFILES[device], colorScheme: "dark" });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
if (throttle > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
await page.addInitScript(() => {
  window.__frames = [];
  let last = performance.now();
  const tick = (t) => {
    window.__frames.push(t - last);
    if (t - last > 100) (window.__long ??= []).push([Math.round(t), Math.round(t - last)]);
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
const t0 = Date.now();
await page.goto(`${base}/software${args.lite ? "?lite" : ""}`, { waitUntil: "load" });
// the picture draws when it scrolls into view; wait for the start-up to finish
const finished = await page
  .waitForFunction(() => document.querySelector("[data-neon-done]"), null, { timeout: 90000 })
  .then(() => true)
  .catch(() => false);
await sleep(500);
const report = await page.evaluate(() => {
  const el = document.querySelector("[data-neon-done]") ?? document.querySelector("[data-slot=activity] canvas")?.parentElement;
  const f = window.__frames.slice(5).sort((a, b) => a - b);
  return { long: window.__long ?? [], dataset: { ...(el?.dataset ?? {}) }, frames: f.length, canvas: [document.querySelector("[data-slot=activity] canvas")?.width, document.querySelector("[data-slot=activity] canvas")?.height], rafs: f };
});
const f = report.rafs;
console.log(JSON.stringify({ device, throttle, lite: !!args.lite, finished, seconds: (Date.now() - t0) / 1000, canvas: report.canvas, dataset: report.dataset, longFrames: report.long, rafMs: { n: f.length, p50: +pct(f, 0.5)?.toFixed(1), p95: +pct(f, 0.95)?.toFixed(1), max: +f.at(-1)?.toFixed(1) } }, null, 1));
await browser.close();
