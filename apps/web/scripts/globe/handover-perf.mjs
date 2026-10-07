// Performance and lifecycle numbers for the globe <-> street handover. Prints one JSON report.
//
//   BASE_URL=http://localhost:5175 node apps/web/scripts/globe/handover-perf.mjs [flight|frames|idle|leaks|all] [desktop|mobile]
//
// flight  scripted world -> street flight of the selected place: rAF interval p50/p95/max, frames over 25 ms, heap
// frames  GPU-synced cost of one frame around the cut (both renderers), circular pan
// idle    ticks / rAF calls / street renders over 2.5 s with no input at world, just past the cut (held, the cut fade over) and street scale
// leaks   20 open/close cycles of the mobile slide-over and 20 handover round trips: live WebGL contexts return to baseline
// Prefer a production build for numbers (the dev server adds overhead): pnpm --filter @catalyst/web build + start.
import { DESKTOP, MOBILE, ensureTiles, launch, openApp, settleApp, state, waitStreetOk } from "./handover-lib.mjs";

const [mode = "all", device = "desktop"] = process.argv.slice(2);
const profile = device === "mobile" ? MOBILE : DESKTOP;
const want = (m) => mode === "all" || mode === m;
const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? +s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))].toFixed(2) : null;
};
const report = { device, profile: `${profile.viewport.width}x${profile.viewport.height}@${profile.deviceScaleFactor}` };

const tiles = await ensureTiles();
const browser = await launch();
try {
  if (want("flight")) {
    const { page, logs } = await openApp(browser, profile, { path: "/" });
    await page.evaluate(() => {
      window.__iv = [];
      window.__ivz = [];
      let last = 0;
      const f = (t) => {
        if (last) {
          window.__iv.push(t - last);
          window.__ivz.push(window.__handoverDebug?.zoom() ?? 0);
        }
        last = t;
        window.__ivRaf = requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    });
    const heap0 = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
    await page.evaluate(() => window.__handoverDebug.globe.setView({ lon: 106.7, lat: 10.8, zoom: 2.5 }));
    const t0 = Date.now();
    // select by the list, the same path as a click on a label (on phones the detail slide-over unmounts the globe, so fly directly)
    if (device === "mobile") await page.evaluate(() => window.__handoverDebug.fly({ lon: 106.7009, lat: 10.7769, zoom: 14.5259 }));
    else await page.locator('[data-place-link="ho-chi-minh-city"]').evaluate((a) => a.click());
    await page.waitForFunction(() => window.__handoverDebug.zoom() > 14, null, { timeout: 40000 });
    await settleApp(page);
    const flightMs = Date.now() - t0;
    const iv = await page.evaluate(() => window.__iv);
    const flightIv = iv.slice(0, Math.floor((flightMs / 1000) * 60));
    const zs = await page.evaluate(() => window.__ivz);
    const heap1 = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
    report.flight = {
      ms: flightMs,
      frames: iv.length,
      rafMs: { p50: pct(flightIv, 50), p95: pct(flightIv, 95), max: pct(flightIv, 100) },
      over25ms: flightIv.filter((x) => x > 25).length,
      slowFramesAtZoom: flightIv.map((x, i) => [x, i]).filter(([x]) => x > 25).map(([x, i]) => [Math.round(x), +(zs[i] ?? 0).toFixed(2)]),
      heapMB: { before: +(heap0 / 1048576).toFixed(1), after: +(heap1 / 1048576).toFixed(1) },
      final: await state(page),
      logs,
    };
    await page.context().close();
  }

  if (want("frames")) {
    const { page } = await openApp(browser, profile, { path: "/" });
    await page.evaluate(() => window.__handoverDebug.globe.setView({ lon: 106.7, lat: 10.8, zoom: 4.4 }));
    await waitStreetOk(page);
    await page.evaluate(() => window.__handoverDebug.globe.setView({ lon: 106.7, lat: 10.8, zoom: 5.0 }));
    await settleApp(page);
    const out = await page.evaluate(async () => {
      const d = window.__handoverDebug;
      const times = [];
      d.forceBlend(0.5);
      for (let i = 0; i < 300; i++) {
        const a = (i / 300) * Math.PI * 2;
        const t0 = performance.now();
        d.globe.setView({ lon: 106.7 + Math.cos(a) * 1.5, lat: 10.8 + Math.sin(a) * 1.5, zoom: 5.0 + 0.1 * Math.sin(a * 2) });
        d.globe.renderNow(); // Three.js render + registered street render + composite, all synchronous
        d.globe.gpuSync();
        d.street().debug().gpuSync();
        times.push(performance.now() - t0);
        await new Promise((r) => requestAnimationFrame(r));
      }
      d.forceBlend(null);
      return times;
    });
    report.frames = { dissolveBandMs: { p50: pct(out, 50), p95: pct(out, 95), max: pct(out, 100) }, note: "both renderers, synchronous, GPU-synced, per frame" };
    await page.context().close();
  }

  if (want("idle")) {
    const { page } = await openApp(browser, profile, { path: "/" });
    const sample = async (label) => {
      const a = await page.evaluate(() => ({ raf: window.__raf.calls, ticks: window.__handoverDebug.ticks(), s: window.__handoverDebug.street()?.debug().renders() ?? 0, p: window.__handoverDebug.street()?.debug().passes() ?? 0 }));
      await page.waitForTimeout(2500);
      const b = await page.evaluate(() => ({ raf: window.__raf.calls, ticks: window.__handoverDebug.ticks(), s: window.__handoverDebug.street()?.debug().renders() ?? 0, p: window.__handoverDebug.street()?.debug().passes() ?? 0 }));
      return [label, { rafCalls: b.raf - a.raf, ticks: b.ticks - a.ticks, streetRenders: b.s - a.s, passRuns: b.p - a.p }];
    };
    const idle = {};
    await settleApp(page);
    await page.waitForTimeout(4500); // the street chunk warm-up (idle callback 2.5 s after load) and its tile requests are not idle time
    const w = await sample("world");
    idle[w[0]] = w[1];
    await page.evaluate(() => window.__handoverDebug.globe.setView({ lon: 106.7, lat: 10.8, zoom: 3.2 }));
    await waitStreetOk(page);
    await page.evaluate(() => window.__handoverDebug.globe.setView({ lon: 106.7, lat: 10.8, zoom: 3.75 }));
    await settleApp(page);
    await page.waitForTimeout(800);
    const m = await sample("just past the cut (zoom 3.75, held)");
    idle[m[0]] = m[1];
    await page.evaluate(() => window.__handoverDebug.globe.setView({ lon: 106.7, lat: 10.8, zoom: 12 }));
    await settleApp(page);
    await page.waitForTimeout(800);
    const s = await sample("street");
    idle[s[0]] = s[1];
    report.idle = idle;
    await page.context().close();
  }

  if (want("leaks")) {
    const { page } = await openApp(browser, MOBILE, { path: "/" });
    const live = () => page.evaluate(() => ({ live: window.__gl.live.size, created: window.__gl.created, lost: window.__gl.lost }));
    const base = await live();
    const cycles = [];
    for (let i = 0; i < 20; i++) {
      await page.locator('[data-place-link="hanoi"]').evaluate((a) => a.click());
      await page.waitForFunction(() => !window.__handoverDebug, null, { timeout: 10000 });
      const open = await live();
      await page.goBack();
      await page.waitForFunction(() => window.__handoverDebug, null, { timeout: 20000 });
      cycles.push(open.live);
    }
    await page.waitForTimeout(500);
    const afterSlide = await live();
    report.slideOver = { baseline: base, whileOpen: [...new Set(cycles)], after20: afterSlide };

    // handover round trips on the desktop profile: world -> street -> world, street unmounted again at the end
    const d = await openApp(browser, DESKTOP, { path: "/" });
    const dl = () => d.page.evaluate(() => ({ live: window.__gl.live.size, created: window.__gl.created, lost: window.__gl.lost }));
    const b0 = await dl();
    const trips = [];
    for (let i = 0; i < 20; i++) {
      await d.page.evaluate(() => window.__handoverDebug.globe.setView({ lon: 106.7, lat: 10.8, zoom: 4.2 }));
      await waitStreetOk(d.page);
      await d.page.evaluate(() => window.__handoverDebug.globe.setView({ lon: 106.7, lat: 10.8, zoom: 9 }));
      await settleApp(d.page);
      const up = await dl();
      await d.page.evaluate(() => window.__handoverDebug.globe.setView({ lon: 106.7, lat: 10.8, zoom: 3 }));
      await d.page.waitForFunction(() => window.__handoverDebug.streetState() === "none", null, { timeout: 15000 });
      await d.page.waitForTimeout(100);
      trips.push(up.live);
    }
    const after = await dl();
    report.roundTrips = { baseline: b0, liveWhileStreet: [...new Set(trips)], after20: after };
  }
} finally {
  await browser.close();
  await tiles.stop();
}
console.log(JSON.stringify(report, null, 1));
