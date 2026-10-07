// Temporal ease checks (docs/street-architecture.md, "Temporal ease"). Runs against the dev route /dev/street and the local PMTiles archive
// (Protomaps schema), whose tile answers are DELAYED by Playwright routing, so tiles arrive when a network would deliver them. The street
// engine exposes the classified image (`readCodes().levels`, the target T) and the presented one (`readPresentedLevels()`, P).
//
//   BASE_URL=http://localhost:5481 node scripts/street/tile-fade.mjs [--only=ghost,steady,pan,zoom,first,remove,idle,off] [--json=out.json]
//
//   ghost    (ii) a pan and a zoom over tiles that are all loaded and cached: nothing arrives, so nothing may ease. P must equal T cell for
//            cell; "ghost" = cells presented louder than their target (an old line that did not follow the camera).
//   steady   (i) tiles arrive (delayed 450 ms) while the camera rests: every cell that appears with a final tone of at least 4 steps through
//            at least 3 intermediate levels, at 24 ms per level at most, then settles.
//   pan      (i) tiles requested at the start of a pan of exactly one art cell per frame arrive (900 ms) in the middle of it. The cells are
//            tracked across frames through the known translation: the arriving ones fade through >= 3 levels WHILE sliding, the old
//            content never trails (no cell presented louder than its target outside the arrival).
//   zoom     (i) the same for a zoom in at fixed centre: the pass cannot track cells, so the number of distinct intermediate levels seen and
//            the ghost count are reported.
//   first    first load, slow network: the first frames are blank, then tiles arrive late: they fade (the report names intermediate levels).
//   remove   tiles leaving: a layer is hidden at rest (as when a tile is evicted): its cells fade out through the levels, never pop.
//   idle     after all of it: zero map renders and zero rAF calls.
//   off      fade off and reduced motion: no intermediate level ever.
import { writeFileSync } from "node:fs";
import { FALLBACK_URL, ensureTiles, launch, open, dev } from "./_lib.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const t = a.replace(/^--/, ""); const i = t.indexOf("="); return i < 0 ? [t, "1"] : [t.slice(0, i), t.slice(i + 1)]; }));
const only = args.only ? new Set(args.only.split(",")) : null;
const want = (n) => !only || only.has(n);
const report = {};

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name} ${detail}`);
  if (!ok) failures.push(name);
};

async function session(browser, { fade = true, reduced = false, view = "106.698,10.774,13", delay = 0, wait = true, primary = false } = {}) {
  const { page, ctx } = await open(browser, { viewport: { width: 800, height: 560 }, deviceScaleFactor: 1 }, { reducedMotion: reduced ? "reduce" : "no-preference" });
  let ms = delay;
  await page.route("**/places.pmtiles", async (route) => {
    if (ms) await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
  const params = { ...(primary ? { source: "primary" } : { source: "fallback", fallbackUrl: FALLBACK_URL }), hud: 0, view, theme: "light", ...(fade ? {} : { tileFade: 0 }), ...(reduced ? { rm: 1 } : {}) };
  await page.goto(dev("/dev/street", params));
  if (wait) {
    await page.waitForFunction(() => window.__streetDebug?.map().loaded() && ["primary", "fallback"].includes(document.querySelector("[data-dev-street]")?.getAttribute("data-tile-state")), null, { timeout: 60000 });
    await page.waitForFunction(() => { const m = window.__streetDebug.map(); return !m.isMoving() && m.areTilesLoaded(); }, null, { timeout: 90000 });
    await page.waitForTimeout(700);
  }
  return { page, ctx, setDelay: (v) => (ms = v) };
}

/** In-page sampling toolkit: one frame = one rAF, one forced map render, then the classified and presented images are read back. */
const TOOLKIT = `
window.__fx = {
  read() { const d = window.__streetDebug; const a = d.readCodes(); const L = new Uint8Array(a.codes.length); for (let i = 0; i < L.length; i++) L[i] = a.codes[i] === 1 || a.codes[i] === 2 ? 1 : 0; return { cols: a.cols, rows: a.rows, T: Uint8Array.from(a.levels), P: d.readPresentedLevels(), L }; },
  frame: () => new Promise((r) => requestAnimationFrame(r)),
  stats(s) { // P against T over a frame
    // trail: presented where the classified image has nothing (an old line that did not follow the camera, or a fade-out); inter: on its
    // way up to its target; tone: lit cells whose tone is on its way down to a quieter target (a crossing whose top layer changed)
    let diff = 0, loud = 0, trail = 0, inter = 0, tone = 0, lit = 0;
    for (let i = 0; i < s.T.length; i++) { if (s.T[i]) lit++; if (s.P[i] !== s.T[i]) { diff++; if (s.P[i] > s.T[i]) { loud++; if (s.T[i] === 0) trail++; else tone++; } if (s.P[i] > 0 && s.P[i] < s.T[i]) inter++; } }
    return { diff, loud, trail, inter, tone, lit };
  },
};`;

async function ghostRun(page, kind, scale = 1) {
  return page.evaluate(async ([kind, scale]) => {
    const fx = window.__fx, d = window.__streetDebug, m = d.map();
    const cell = d.cellCss();
    const start = m.getCenter(), z0 = m.getZoom();
    const worldPx = (z) => 512 * 2 ** z;
    const dLon = (px, z) => (px / worldPx(z)) * 360 / Math.max(0.2, Math.cos((start.lat * Math.PI) / 180));
    const out = [];
    const N = 60;
    for (let i = 0; i <= N; i++) {
      await fx.frame();
      if (kind === "pan-int") m.jumpTo({ center: [start.lng + dLon(i * cell, z0), start.lat], zoom: z0 });
      else if (kind === "pan-frac") m.jumpTo({ center: [start.lng + dLon(i * cell * 0.37, z0), start.lat + dLon(i * cell * 0.23, z0) * 0.9], zoom: z0 });
      else if (kind === "zoom") m.jumpTo({ center: [start.lng, start.lat], zoom: z0 + i * 0.012 });
      else if (kind === "zoom-pan") m.jumpTo({ center: [start.lng + dLon(i * cell * 0.5, z0), start.lat], zoom: z0 + i * 0.008 });
      m.redraw();
      const s = fx.stats(fx.read());
      if (i > 0) out.push(s);
    }
    const lit = out.reduce((a, s) => a + s.lit, 0) / out.length;
    return { frames: out.length, maxDiff: Math.max(...out.map((s) => s.diff)), maxTrail: Math.max(...out.map((s) => s.trail)), meanTrail: out.reduce((a, s) => a + s.trail, 0) / out.length, maxTone: Math.max(...out.map((s) => s.tone)), meanTone: out.reduce((a, s) => a + s.tone, 0) / out.length, meanDiff: out.reduce((a, s) => a + s.diff, 0) / out.length, lit };
  }, [kind, scale]);
}

const tiles = await ensureTiles();
const browser = await launch();
try {
  // ---- ghost: nothing arrives ----------------------------------------------------------------------------------------------------
  if (want("ghost")) {
    const { page, ctx } = await session(browser);
    await page.evaluate(TOOLKIT);
    // warm the path (tiles for every camera of the replays are loaded and cached), then rest and replay
    for (const kind of ["pan-int", "pan-frac", "zoom", "zoom-pan"]) {
      await ghostRun(page, kind);
      await page.evaluate(() => window.__streetDebug.map().jumpTo({ center: [106.698, 10.774], zoom: 13 }));
      await page.waitForFunction(() => { const m = window.__streetDebug.map(); return !m.isMoving() && m.areTilesLoaded(); });
      await page.waitForTimeout(500);
    }
    for (const kind of ["pan-int", "pan-frac", "zoom", "zoom-pan"]) {
      const r = await ghostRun(page, kind);
      report[`ghost-${kind}`] = r;
      // ghost = a trail: cells presented where the classified image has nothing although nothing was removed (old content that did not
      // follow the camera). tone = cells still stepping down to a quieter target (a crossing whose top layer changed): not a ghost.
      check(`ghost ${kind}: no trail behind moving lines (presented where nothing is classified)`, r.maxTrail / r.lit < 0.004, `(${r.frames} frames over ${Math.round(r.lit)} lit cells: worst ${r.maxTrail} trail cells = ${((100 * r.maxTrail) / r.lit).toFixed(3)} %, mean ${r.meanTrail.toFixed(1)}; tone-lag cells worst ${r.maxTone}, mean ${r.meanTone.toFixed(1)}; cells differing at all: worst ${r.maxDiff}, mean ${r.meanDiff.toFixed(1)})`);
      await page.evaluate(() => window.__streetDebug.map().jumpTo({ center: [106.698, 10.774], zoom: 13 }));
      await page.waitForTimeout(500);
    }
    await ctx.close();
  }

  // ---- ghost at world and country scale (MapLibre's globe projection: the warp is the perspective globe's) ----------------------------
  if (want("ghostlow")) {
    for (const z0 of [4.5, 6.5, 9]) {
      const { page, ctx } = await session(browser, { primary: true, view: `2,46,${z0}` });
      await page.evaluate(TOOLKIT);
      for (const kind of ["pan-frac", "zoom", "zoom-pan"]) {
        await ghostRun(page, kind); // warm: the tiles of the path
        await page.evaluate((z) => window.__streetDebug.map().jumpTo({ center: [2, 46], zoom: z }), z0);
        await page.waitForFunction(() => { const m = window.__streetDebug.map(); return !m.isMoving() && m.areTilesLoaded(); }, null, { timeout: 60000 });
        await page.waitForTimeout(600);
        const r = await ghostRun(page, kind);
        report[`ghostlow-${z0}-${kind}`] = r;
        check(`ghost z${z0} ${kind} (globe projection): no trail behind moving lines`, r.maxTrail / Math.max(r.lit, 1) < 0.005, `(worst ${r.maxTrail} trail cells of ${Math.round(r.lit)} lit = ${((100 * r.maxTrail) / Math.max(r.lit, 1)).toFixed(3)} %, mean ${r.meanTrail.toFixed(1)}; tone-lag worst ${r.maxTone}; cells differing worst ${r.maxDiff})`);
        await page.evaluate((z) => window.__streetDebug.map().jumpTo({ center: [2, 46], zoom: z }), z0);
        await page.waitForTimeout(600);
      }
      await ctx.close();
    }
  }

  // ---- steady: tiles arrive at a resting camera ----------------------------------------------------------------------------------
  if (want("steady")) {
    const { page, ctx, setDelay } = await session(browser);
    await page.evaluate(TOOLKIT);
    setDelay(450);
    await page.evaluate(() => window.__streetDebug.map().jumpTo({ center: [106.7125, 10.7905], zoom: 15.3 }));
    const r = await page.evaluate(async () => {
      const fx = window.__fx;
      const seqs = new Map(); // cell -> levels over frames
      const t0 = performance.now();
      let prev = null, maxStep = 0, last = null, peak = 0, firstDiff = null, settled = null;
      const frames = [];
      while (performance.now() - t0 < 2600) {
        await fx.frame();
        const s = fx.read();
        const st = fx.stats(s);
        frames.push({ t: Math.round(performance.now() - t0), ...st });
        if (st.diff > 0 && firstDiff === null) firstDiff = performance.now() - t0;
        if (firstDiff !== null && st.diff === 0 && settled === null) settled = performance.now() - t0;
        if (st.diff > 0) settled = null;
        for (let i = 0; i < s.T.length; i++) { let q = seqs.get(i); if (!q) seqs.set(i, (q = [])); q.push(s.P[i]); }
        if (prev) for (let i = 0; i < s.P.length; i++) { const dd = Math.abs(s.P[i] - prev[i]); if (dd > maxStep) maxStep = dd; }
        prev = s.P; last = s; peak = Math.max(peak, st.inter);
      }
      // cells that end at >= 4 and started at 0 (never lit before): intermediates seen
      let appeared = 0, withThree = 0, hist = {};
      for (const [i, q] of seqs) {
        const fin = last.T[i];
        if (fin < 5 || q[0] !== 0) continue;
        appeared++;
        const inter = new Set(q.filter((v) => v > 0 && v < fin));
        hist[inter.size] = (hist[inter.size] ?? 0) + 1;
        if (inter.size >= 3) withThree++;
      }
      return { appeared, withThree, hist, maxStep, firstDiff, settled, peak, loud: Math.max(...frames.map((f) => f.loud)), frames: frames.length };
    });
    report.steady = r;
    check("steady: cells that appear (final tone >= 5) fade through >= 3 intermediate levels", r.appeared > 200 && r.withThree / r.appeared >= 0.9, `(${r.withThree} of ${r.appeared} cells; histogram of intermediates ${JSON.stringify(r.hist)}; peak ${r.peak} cells mid-fade)`);
    check("steady: no cell jumps more than 4 levels between two frames (the pace is 24 ms per level, a frame counts for at most 100 ms)", r.maxStep <= 4, `(max ${r.maxStep})`);
    check("steady: settles within the ease time after the tiles are in (450 ms delay)", r.settled !== null && r.settled <= 450 + 11 * 24 + 250, `(settled ${r.settled === null ? "never" : Math.round(r.settled)} ms after the jump)`);
    await ctx.close();
  }

  // ---- pan: tiles arrive in the middle of a pan -------------------------------------------------------------------------------
  if (want("pan")) {
    const { page, ctx, setDelay } = await session(browser, { view: "106.7125,10.7905,15.3" });
    await page.evaluate(TOOLKIT);
    setDelay(900);
    const r = await page.evaluate(async () => {
      const fx = window.__fx, d = window.__streetDebug, m = d.map();
      const cell = d.cellCss();
      const z = 15.3;
      const c0 = m.getCenter();
      const dLon = (px) => (px / (512 * 2 ** z)) * 360;
      const F = 150; // frames of pan: about 2.4 s
      const world = new Map(); // "X,Y" -> { T0, seq, appeared, fin, relocated }
      let prevS = null, prevK = 0, loud = 0, trail = 0;
      for (let n = 0; n <= F + 60; n++) {
        await fx.frame();
        const k = Math.min(n, F); // cells panned (x only): world X = x + k
        m.jumpTo({ center: [c0.lng + dLon(k * cell), c0.lat], zoom: z });
        m.redraw();
        const s = fx.read();
        const st = fx.stats(s);
        loud = Math.max(loud, st.loud);
        trail = Math.max(trail, st.trail);
        const { cols, rows } = s;
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
          const i = y * cols + x, key = (x + k) + "," + y;
          const lineT = s.L[i] ? s.T[i] : 0; // fills are anchored to the screen (a lattice): only lines are followed
          let w = world.get(key);
          if (!w) { world.set(key, (w = { entered: n, T0: lineT, seq: [s.P[i]], appeared: false, fin: 0, relocated: false })); continue; }
          w.seq.push(s.P[i]);
          if (w.T0 === 0 && lineT > 0 && !w.appeared) {
            w.appeared = true; w.seqFrom = w.seq.length - 1;
            // a line one or two cells from where the same tone ran a frame ago is a tile REPLACED by a sharper one (the line moved a cell), not new content
            if (prevS) { const px = x + k - prevK; for (let dy = -3; dy <= 3 && !w.relocated; dy++) for (let dx = -3; dx <= 3; dx++) { const xx = px + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= cols || yy >= rows) continue; const j = yy * cols + xx; if (prevS.L[j] && prevS.T[j] === lineT) { w.relocated = true; break; } } }
          }
          w.fin = lineT;
        }
        prevS = s; prevK = k;
      }
      let appeared = 0, withThree = 0, hist = {}, relocated = 0, whileMoving = 0;
      for (const w of world.values()) {
        if (!w.appeared || w.fin < 5) continue;
        if (w.relocated) { relocated++; continue; }
        const seq = w.seq.slice(w.seqFrom);
        appeared++;
        const inter = new Set(seq.filter((v) => v > 0 && v < w.fin));
        hist[inter.size] = (hist[inter.size] ?? 0) + 1;
        if (inter.size >= 3) withThree++;
        if (w.entered + w.seqFrom < F) whileMoving++;
      }
      return { appeared, withThree, hist, loud, trail, relocated, whileMoving, F };
    });
    report.pan = r;
    check("pan: lines that are NEW (no line of the same tone within 3 cells a frame earlier) fade through >= 3 intermediate levels while they slide", r.appeared > 100 && r.withThree / r.appeared >= 0.85, `(${r.withThree} of ${r.appeared} tracked cells, ${r.whileMoving} appeared during the pan, ${r.relocated} more were lines replaced by a sharper tile one or two cells away; histogram ${JSON.stringify(r.hist)})`);
    check("pan: no trail of old lines behind the pan (presented where nothing is classified, any frame)", r.trail <= 0.01 * 28000, `(worst frame ${r.trail} cells = ${((100 * r.trail) / 28000).toFixed(2)} % of the lit cells)`);
    await ctx.close();
  }

  // ---- zoom: tiles arrive in the middle of a zoom -----------------------------------------------------------------------------
  if (want("zoom")) {
    const { page, ctx, setDelay } = await session(browser, { view: "106.7125,10.7905,14.2" });
    await page.evaluate(TOOLKIT);
    setDelay(900);
    const r = await page.evaluate(async () => {
      const fx = window.__fx, d = window.__streetDebug, m = d.map();
      const F = 150;
      let loud = 0; const inter = new Set(); let peakInter = 0; let maxDiffAfter = 0;
      for (let n = 0; n <= F + 60; n++) {
        await fx.frame();
        const z = 14.2 + (n < F ? n : F) * 0.011; // 1.65 zoom levels in 2.4 s
        m.jumpTo({ center: [106.7125, 10.7905], zoom: z });
        m.redraw();
        const s = fx.read();
        const st = fx.stats(s);
        if (n < F) { loud = Math.max(loud, st.loud); peakInter = Math.max(peakInter, st.inter); for (let i = 0; i < s.P.length; i++) if (s.P[i] > 0 && s.P[i] < s.T[i]) inter.add(s.P[i]); }
        else maxDiffAfter = Math.max(maxDiffAfter, st.diff);
      }
      return { loud, levelsSeen: [...inter].sort((a, b) => a - b), peakInter };
    });
    report.zoom = r;
    check("zoom: tiles arriving mid-zoom are presented at >= 3 distinct intermediate levels", r.levelsSeen.length >= 3, `(levels seen mid-fade ${r.levelsSeen.join(",")}; peak ${r.peakInter} cells mid-fade)`);
    check("zoom: cells presented louder than their target stay rare (dashes that slide along a road are the limit)", r.loud < 400, `(worst frame ${r.loud} cells)`);
    await ctx.close();
  }

  // ---- first load on a slow network --------------------------------------------------------------------------------------------
  if (want("first")) {
    const { page, ctx } = await session(browser, { delay: 1200, wait: false });
    // sample from the first available frame until two seconds after the tiles are in
    await page.waitForFunction(() => window.__streetDebug && window.__streetDebug.map(), null, { timeout: 60000 });
    await page.evaluate(TOOLKIT);
    const s = await page.evaluate(async () => {
      const fx = window.__fx, d = window.__streetDebug, m = d.map();
      const t0 = performance.now();
      const seen = new Set(); let peakInter = 0, firstInk = null, full = null, loud = 0;
      const lit = [];
      while (performance.now() - t0 < 9000) {
        await fx.frame();
        let s; try { s = fx.read(); } catch { continue; }
        const st = fx.stats(s);
        if (st.lit > 0 && firstInk === null) firstInk = performance.now() - t0;
        lit.push([Math.round(performance.now() - t0), st.lit, st.diff]);
        for (let i = 0; i < s.P.length; i++) if (s.P[i] > 0 && s.P[i] < s.T[i]) seen.add(s.P[i]);
        peakInter = Math.max(peakInter, st.inter);
        loud = Math.max(loud, st.loud);
        if (m.areTilesLoaded() && st.diff === 0 && st.lit > 3000 && full === null) full = performance.now() - t0;
        if (full !== null && performance.now() - t0 > full + 600) break;
      }
      return { levels: [...seen].sort((a, b) => a - b), peakInter, firstInk, full, loud, lit: lit.filter((_, i) => i % 15 === 0) };
    });
    report.first = s;
    check("first load, slow network: late tiles fade in through >= 3 intermediate levels", s.levels.length >= 3, `(levels seen ${s.levels.join(",")}; peak ${s.peakInter} cells mid-fade; first ink at ${s.firstInk === null ? "-" : Math.round(s.firstInk)} ms, complete at ${s.full === null ? "-" : Math.round(s.full)} ms)`);
    await ctx.close();
  }

  // ---- removal -----------------------------------------------------------------------------------------------------------------
  if (want("remove")) {
    const { page, ctx } = await session(browser, { view: "106.698,10.774,14" });
    await page.evaluate(TOOLKIT);
    const r = await page.evaluate(async () => {
      const fx = window.__fx, d = window.__streetDebug, m = d.map();
      const ids = ["road-major-case", "road-secondary-case", "road-medium-case", "road-highway-case"].filter((id) => m.getLayer(id));
      const before = fx.read();
      for (const id of ids) m.setLayoutProperty(id, "visibility", "none");
      const seqs = new Map();
      const t0 = performance.now();
      let firstT = null;
      while (performance.now() - t0 < 1500) {
        await fx.frame();
        const s = fx.read();
        for (let i = 0; i < s.P.length; i++) if (before.P[i] >= 4 && s.T[i] === 0) { let q = seqs.get(i); if (!q) seqs.set(i, (q = [before.P[i]])); q.push(s.P[i]); }
      }
      let n = 0, withThree = 0, pops = 0;
      for (const q of seqs.values()) {
        n++;
        const inter = new Set(q.filter((v) => v > 0 && v < q[0]));
        if (inter.size >= 3) withThree++;
        if (q.some((v, i) => i && q[i - 1] - v > 3)) pops++;
      }
      const end = fx.read();
      return { n, withThree, pops, leftover: fx.stats(end).diff };
    });
    report.remove = r;
    check("remove: cells that leave fade out through >= 3 intermediate levels, none drops more than 3 levels at once", r.n > 200 && r.withThree / r.n >= 0.85 && r.pops / r.n < 0.05, `(${r.withThree} of ${r.n} cells; ${r.pops} dropped >3 levels in one frame; ${r.leftover} cells not at target at the end)`);
    await ctx.close();
  }

  // ---- idle ----------------------------------------------------------------------------------------------------------------------
  if (want("idle")) {
    const { page, ctx, setDelay } = await session(browser);
    setDelay(300);
    await page.evaluate(() => window.__streetDebug.map().jumpTo({ center: [106.7125, 10.7905], zoom: 15.3 }));
    await page.waitForFunction(() => { const m = window.__streetDebug.map(); return !m.isMoving() && m.areTilesLoaded(); });
    await page.waitForTimeout(900);
    const raf0 = await page.evaluate(() => ({ r: window.__streetDebug.renders(), raf: window.__raf.calls, p: window.__streetDebug.passes(), e: window.__streetDebug.easeStats().eases }));
    await page.waitForTimeout(1500);
    const raf1 = await page.evaluate(() => ({ r: window.__streetDebug.renders(), raf: window.__raf.calls, p: window.__streetDebug.passes(), e: window.__streetDebug.easeStats().eases }));
    check("idle after the fade: no map render, no pass, no ease, no rAF call", raf1.r === raf0.r && raf1.raf === raf0.raf && raf1.p === raf0.p && raf1.e === raf0.e, `(renders +${raf1.r - raf0.r}, passes +${raf1.p - raf0.p}, eases +${raf1.e - raf0.e}, rAF +${raf1.raf - raf0.raf})`);
    await ctx.close();
  }

  // ---- off -----------------------------------------------------------------------------------------------------------------------
  if (want("off")) {
    for (const [name, o] of [["tileFade=false", { fade: false }], ["reduced motion", { reduced: true }]]) {
      const { page, ctx, setDelay } = await session(browser, o);
      await page.evaluate(TOOLKIT);
      setDelay(450);
      await page.evaluate(() => window.__streetDebug.map().jumpTo({ center: [106.7125, 10.7905], zoom: 15.3 }));
      const worst = await page.evaluate(async () => {
        const fx = window.__fx; let w = 0; const t0 = performance.now();
        while (performance.now() - t0 < 2000) { await fx.frame(); const s = fx.stats(fx.read()); w = Math.max(w, s.diff); }
        return w;
      });
      check(`${name}: no intermediate level, ever`, worst === 0, `(max differing cells ${worst})`);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  await tiles.stop();
}
if (args.json) writeFileSync(args.json, JSON.stringify(report, null, 1));
if (failures.length) {
  console.error(`\n${failures.length} FAILED: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("\ntile fade ok");
