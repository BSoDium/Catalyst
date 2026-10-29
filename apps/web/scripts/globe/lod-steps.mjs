// Frame hitches at each zoom step of the street map, under a CPU throttle (docs/performance.md, "Zoom steps").
//
//   BASE_URL=http://localhost:5173 THROTTLE=4 node apps/web/scripts/globe/lod-steps.mjs [mobile|desktop]
//
// Steps the camera from the world view into street scale, half a zoom level at a time, holds each step until the street map is idle and prints, per step,
// the longest rAF interval and the long animation frames (>= 50 ms) with their scripts: the spike a visitor feels as the next, finer level comes in.
import { DESKTOP, MOBILE, ensureTiles, launch, openApp, settleApp } from "./handover-lib.mjs";

const device = process.argv[2] ?? "mobile";
const profile = device === "mobile" ? MOBILE : DESKTOP;
const rate = Number(process.env.THROTTLE ?? 4);
const from = Number(process.env.FROM ?? 5);
const to = Number(process.env.TO ?? 16);
const step = Number(process.env.STEP ?? 0.5);
const at = { lon: 21.0122, lat: 52.2297 };

await ensureTiles();
const browser = await launch();
try {
  const { ctx, page } = await openApp(browser, profile, { path: "/" });
  await page.evaluate(() => {
    window.__loaf = [];
    window.__iv = [];
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__loaf.push({ d: Math.round(e.duration), s: (e.scripts || []).map((s) => `${s.sourceFunctionName || s.invoker || ""}@${(s.sourceURL || "").split("/").pop()}:${Math.round(s.duration)}`).slice(0, 4).join(" | ") });
      }).observe({ type: "long-animation-frame", buffered: true });
    } catch {}
    let last = 0;
    const f = (t) => {
      if (last) window.__iv.push(t - last);
      last = t;
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  const rows = [];
  for (let z = from; z <= to + 1e-9; z += step) {
    await page.evaluate(() => {
      window.__loaf.length = 0;
      window.__iv.length = 0;
    });
    await page.evaluate(([v, z]) => window.__handoverDebug.globe.setView({ ...v, zoom: z }), [at, z]);
    await page.waitForTimeout(3500);
    const r = await page.evaluate(() => ({ max: Math.round(Math.max(0, ...window.__iv)), over50: window.__iv.filter((x) => x > 50).length, loaf: window.__loaf.filter((x) => x.d >= 50) }));
    const zz = await page.evaluate(() => window.__handoverDebug.zoom());
    rows.push({ z: +z.toFixed(1), zoom: +zz.toFixed(2), ...r });
    console.log(JSON.stringify({ z: +z.toFixed(1), zoom: +zz.toFixed(2), maxMs: r.max, over50: r.over50, loaf: r.loaf }));
  }
} finally {
  await browser.close();
}
