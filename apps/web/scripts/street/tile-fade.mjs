// Tile fade checks (docs/palette/ and docs/street-architecture.md, "Tile fade"). Runs on the production build with the dev
// route /dev/street (CATALYST_DEV_ROUTES=1) and the local PMTiles archive, whose tile answers are DELAYED (so tiles arrive
// after the camera has rested, as they do on a network). The street engine exposes the classified image (`readCodes`) and the
// presented one (`readPresentedLevels`):
//   1. MOTION: while the camera moves (a scripted pan and zoom, a map render per step), the presented image IS the classified
//      one on every frame: nothing eases, so nothing can ghost or smear.
//   2. FADE: tiles that arrive at a resting camera ease in: some cells are presented at an intermediate level, every cell moves
//      by at most one level per tick towards its target, and the presented image reaches the classified one within the
//      expected time.
//   3. IDLE: after the fade, zero map renders and zero rAF calls.
//   4. OFF: with `tileFade=false` and with reduced motion there is no intermediate level at all.
import { BASE_URL, FALLBACK_URL, ensureTiles, launch, open, dev } from "./_lib.mjs";

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name} ${detail}`);
  if (!ok) failures.push(name);
};

async function session(browser, { fade = true, reduced = false } = {}) {
  const { page, ctx } = await open(browser, { viewport: { width: 800, height: 560 }, deviceScaleFactor: 1 }, { reducedMotion: reduced ? "reduce" : "no-preference" });
  let delay = 0;
  await page.route("**/places.pmtiles", async (route) => {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    await route.continue();
  });
  const params = { source: "fallback", fallbackUrl: FALLBACK_URL, hud: 0, view: "106.698,10.774,13", theme: "light", ...(fade ? {} : { tileFade: 0 }), ...(reduced ? { rm: 1 } : {}) };
  await page.goto(dev("/dev/street", params));
  await page.waitForFunction(() => window.__streetDebug?.map().loaded() && document.querySelector("[data-dev-street]")?.getAttribute("data-tile-state") === "fallback", null, { timeout: 60000 });
  await page.waitForFunction(() => { const m = window.__streetDebug.map(); return !m.isMoving() && m.areTilesLoaded(); });
  await page.waitForTimeout(600);
  return { page, ctx, setDelay: (ms) => (delay = ms) };
}

const diff = (page) =>
  page.evaluate(() => {
    const d = window.__streetDebug;
    const t = d.readCodes().levels;
    const p = d.readPresentedLevels();
    let n = 0;
    for (let i = 0; i < t.length; i++) if (t[i] !== p[i]) n++;
    return n;
  });

const tiles = await ensureTiles();
const browser = await launch();
try {
  // 1. motion: no easing, ever
  {
    const { page, ctx } = await session(browser);
    const res = await page.evaluate(async () => {
      const d = window.__streetDebug;
      const m = d.map();
      let worst = 0;
      let frames = 0;
      for (let i = 0; i < 40; i++) {
        const t = i / 39;
        m.jumpTo({ center: [106.698 + 0.01 * t, 10.774 - 0.006 * t], zoom: 13 + 1.2 * Math.sin(t * Math.PI) });
        m.redraw();
        const tl = d.readCodes().levels;
        const pr = d.readPresentedLevels();
        let n = 0;
        for (let k = 0; k < tl.length; k++) if (tl[k] !== pr[k]) n++;
        worst = Math.max(worst, n);
        frames++;
        await new Promise((r) => setTimeout(r, 16));
      }
      return { worst, frames };
    });
    check("motion: presented == classified on every frame of a pan + zoom (no ghost trails)", res.worst === 0, `(${res.frames} frames, worst ${res.worst} cells differ)`);
    await ctx.close();
  }

  // 2 + 3. fade: delayed tiles arrive at a resting camera
  async function fadeRun(opts) {
    const { page, ctx, setDelay } = await session(browser, opts);
    setDelay(450);
    // a place never visited: its tiles are not cached; the camera jumps, then rests while the tiles are in flight
    await page.evaluate(() => window.__streetDebug.map().jumpTo({ center: [106.7125, 10.7905], zoom: 15.3 }));
    const samples = await page.evaluate(async () => {
      const d = window.__streetDebug;
      const out = [];
      let prev = null;
      let maxStep = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < 2500) {
        await new Promise((r) => requestAnimationFrame(r));
        const tl = d.readCodes().levels;
        const pr = d.readPresentedLevels();
        let intermediate = 0, diff = 0;
        for (let i = 0; i < tl.length; i++) {
          if (pr[i] !== tl[i]) {
            diff++;
            if (pr[i] !== 0 && pr[i] !== tl[i]) intermediate++;
          }
          if (prev && Math.abs(pr[i] - prev[i]) > maxStep && d.easing() > 0) maxStep = Math.abs(pr[i] - prev[i]);
        }
        prev = Uint8Array.from(pr);
        out.push({ t: Math.round(performance.now() - t0), diff, intermediate, easing: d.easing() });
      }
      return { out, maxStep };
    });
    const raf0 = await page.evaluate(() => ({ r: window.__streetDebug.renders(), raf: window.__raf.calls }));
    await page.waitForTimeout(1200);
    const raf1 = await page.evaluate(() => ({ r: window.__streetDebug.renders(), raf: window.__raf.calls }));
    const unsettled = await diff(page);
    await ctx.close();
    return { ...samples, idle: { renders: raf1.r - raf0.r, raf: raf1.raf - raf0.raf }, unsettled };
  }
  {
    const f = await fadeRun({ fade: true });
    const inter = f.out.filter((s) => s.intermediate > 0);
    const firstDiff = f.out.find((s) => s.diff > 0);
    const settledAt = f.out.find((s) => s.t > (firstDiff?.t ?? 0) && s.diff === 0 && s.easing === 0);
    check("fade: arriving tiles are presented at intermediate levels first", inter.length >= 2, `(${inter.length} frames with intermediate cells, peak ${Math.max(0, ...f.out.map((s) => s.intermediate))})`);
    check("fade: no cell moves more than one level per tick", f.maxStep <= 1, `(max step ${f.maxStep})`);
    check("fade: presented reaches classified", f.unsettled === 0, `(${f.unsettled} cells differ at the end; settled ${settledAt ? settledAt.t - (firstDiff?.t ?? 0) : "never"} ms after the first difference)`);
    check("fade: lasts at most 8 ticks", !!settledAt && settledAt.t - firstDiff.t <= 8 * 32 + 150);
    check("idle after the fade: no map render, no rAF call", f.idle.renders === 0 && f.idle.raf === 0, `(${f.idle.renders} renders, ${f.idle.raf} rAF)`);
  }
  // 4. off
  for (const [name, o] of [["tileFade=false", { fade: false }], ["reduced motion", { reduced: true }]]) {
    const f = await fadeRun(o);
    check(`${name}: no intermediate level, ever`, f.out.every((s) => s.intermediate === 0 && s.diff === 0), `(max differing cells ${Math.max(0, ...f.out.map((s) => s.diff))})`);
  }
} finally {
  await browser.close();
  await tiles.stop();
}
if (failures.length) {
  console.error(`\n${failures.length} FAILED: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("\ntile fade ok");
