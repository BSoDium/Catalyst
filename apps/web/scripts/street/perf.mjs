// Performance and lifecycle checks of the street map on the dev route (a production build made with
// CATALYST_DEV_ROUTES=1 for the numbers in docs/street-architecture.md; the dev server works but is slower to load).
//
//   BASE_URL=http://localhost:5174 node apps/web/scripts/street/perf.mjs [desktop|mobile|lifecycle|flight|all]
//
// desktop / mobile: GPU-synced frame time (map render + upload + pass + readPixels on the overlay context) during a
//   scripted circular pan at street zoom, p50 / p95 / max; idle frames; JS heap.
// lifecycle: context loss and restore of both contexts, 20 mount / dispose cycles with the live-context count.
// flight: world -> street flight with the primary source (real OpenFreeMap tiles, one flight): rAF intervals.
import { ensureTiles, launch, open, dev, waitReady, settle, liveContexts, DESKTOP, MOBILE, FALLBACK_URL, BASE_URL } from "./_lib.mjs";

const which = process.argv[2] ?? "all";
const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
};
const stat = (a) => ({ p50: +pct(a, 0.5).toFixed(2), p95: +pct(a, 0.95).toFixed(2), max: +Math.max(...a).toFixed(2), n: a.length });
const out = {};

async function frames(browser, name, ctx, view) {
  const { page, logs } = await open(browser, ctx);
  await page.goto(dev("/dev/street", { source: "fallback", fallbackUrl: FALLBACK_URL, hud: 0, view }));
  await waitReady(page);
  await settle(page);
  const r = await page.evaluate(async () => {
    const dbg = window.__streetDebug;
    const map = dbg.map();
    const c0 = map.getCenter();
    const R = 160; // CSS px
    const synced = [];
    const intervals = [];
    const jsOnly = [];
    let last = performance.now();
    const t0 = last;
    await new Promise((resolve) => {
      const step = (ts) => {
        const t = (ts - t0) / 1000;
        const a = 0.9 * t;
        const pt = map.project(c0);
        const target = map.unproject([pt.x + R * Math.cos(a) - R, pt.y + R * Math.sin(a)]);
        const s = performance.now();
        map.jumpTo({ center: [target.lng, target.lat] });
        dbg.renderNow();
        jsOnly.push(performance.now() - s);
        dbg.gpuSync();
        synced.push(performance.now() - s);
        intervals.push(ts - last);
        last = ts;
        if (ts - t0 < 9000) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    return { synced: synced.slice(90), jsOnly: jsOnly.slice(90), intervals: intervals.slice(90) };
  });
  await settle(page);
  const idle0 = await page.evaluate(() => ({ renders: window.__streetDebug.renders(), raf: window.__raf.calls, passes: window.__streetDebug.passes() }));
  await page.waitForTimeout(3000);
  const idle1 = await page.evaluate(() => ({ renders: window.__streetDebug.renders(), raf: window.__raf.calls, passes: window.__streetDebug.passes() }));
  const heap = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
  const info = await page.evaluate(() => ({ cell: window.__streetDebug.cellCss(), dpr: devicePixelRatio, w: innerWidth, h: innerHeight }));
  out[name] = {
    info,
    syncedMs: stat(r.synced),
    jsMs: stat(r.jsOnly),
    rafIntervalMs: stat(r.intervals),
    idleOver3s: { renders: idle1.renders - idle0.renders, passes: idle1.passes - idle0.passes, rafCalls: idle1.raf - idle0.raf },
    heapMB: heap ? +(heap / 1048576).toFixed(1) : null,
    logs,
  };
  await page.context().close();
}

async function lifecycle(browser) {
  const { page, logs } = await open(browser, DESKTOP);
  await page.goto(dev("/dev/street", { source: "fallback", fallbackUrl: FALLBACK_URL, hud: 0 }));
  await waitReady(page);
  await settle(page);
  const res = {};
  const px = () => page.evaluate(() => {
    const c = window.__street.canvas;
    return { w: c.width, h: c.height };
  });
  for (const which of ["overlay", "map"]) {
    await page.evaluate((w) => window.__streetDebug.loseContext(w, true), which);
    await page.waitForTimeout(400);
    const lost = await page.evaluate(() => ({ state: document.querySelector("[data-street]").getAttribute("data-state"), p: window.__streetDebug.passes(), ctx: window.__streetDebug.contexts() }));
    await page.evaluate((w) => window.__streetDebug.loseContext(w, false), which);
    await page.waitForFunction(() => document.querySelector("[data-street]").getAttribute("data-state") === "ready", null, { timeout: 15000 });
    await settle(page);
    const before = await page.evaluate(() => window.__streetDebug.passes());
    await page.evaluate(() => window.__street.jumpTo({ lon: 106.7, lat: 10.78, zoom: 14.6 }));
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => ({ passes: window.__streetDebug.passes(), ctx: window.__streetDebug.contexts(), ink: (() => { const r = window.__streetDebug.readCodes(); return r ? r.codes.reduce((n, c) => n + (c === 1 || c === 2 ? 1 : 0), 0) : 0; })() }));
    res[which] = { stateWhileLost: lost.state, drawsWhileLost: lost.p, afterRestore: { framesDrawn: after.passes - before, inkCells: after.ink, ctx: after.ctx } };
    await page.screenshot({ path: `${process.env.OUT_DIR ?? "."}/street-context-${which}-restored.png` });
  }
  out.contextLoss = { ...res, canvas: await px(), logs };

  // 20 mount / dispose cycles by client-side navigation away from and back to the route
  const base = { created: await page.evaluate(() => window.__gl.created), live: await liveContexts(page) };
  const liveAway = [];
  const liveBack = [];
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => document.querySelector('a[href="/projects"]').click());
    await page.waitForFunction(() => location.pathname === "/projects");
    await page.waitForTimeout(150);
    liveAway.push(await liveContexts(page));
    await page.goBack();
    await waitReady(page);
    liveBack.push(await liveContexts(page));
  }
  out.cycles = {
    cycles: 20,
    baseline: base,
    liveContextsWhenAway: [...new Set(liveAway)],
    liveContextsWhenBack: [...new Set(liveBack)],
    created: await page.evaluate(() => window.__gl.created),
    lost: await page.evaluate(() => window.__gl.lost),
    mapCanvasesInDom: await page.evaluate(() => document.querySelectorAll("canvas").length),
    heapMB: +((await page.evaluate(() => performance.memory.usedJSHeapSize)) / 1048576).toFixed(1),
    logs: logs.filter((l) => !/DevTools|vite/.test(l)),
  };
  await page.context().close();
}

async function flight(browser) {
  const { page, logs } = await open(browser, DESKTOP);
  await page.goto(dev("/dev/street", { view: "100,14,2.4", hud: 0 }));
  await waitReady(page);
  await settle(page);
  const r = await page.evaluate(async () => {
    const intervals = [];
    let last = performance.now();
    const t0 = last;
    window.__street.flyTo({ lon: 106.698, lat: 10.774, zoom: 14.5 });
    await new Promise((resolve) => {
      const step = (ts) => {
        intervals.push(ts - last);
        last = ts;
        const moving = window.__streetDebug.map().isMoving();
        if (moving || ts - t0 < 500) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    return { intervals: intervals.slice(1), ms: performance.now() - t0 };
  });
  await settle(page);
  out.flight = { durationMs: Math.round(r.ms), frames: r.intervals.length, rafIntervalMs: stat(r.intervals), framesOver25ms: r.intervals.filter((x) => x > 25).length, tile: await page.evaluate(() => window.__street.getTileStatus().state), logs };
  await page.context().close();
}

const tiles = await ensureTiles();
const browser = await launch();
try {
  if (["desktop", "all"].includes(which)) await frames(browser, "desktop 1440x900@2", DESKTOP, "106.698,10.774,14.5");
  if (["mobile", "all"].includes(which)) await frames(browser, "mobile 390x844@3 (emulated)", MOBILE, "106.698,10.774,14.5");
  if (["lifecycle", "all"].includes(which)) await lifecycle(browser);
  if (["flight", "all"].includes(which)) await flight(browser);
} finally {
  await browser.close();
  await tiles.stop();
}
console.log(JSON.stringify(out, null, 1));
