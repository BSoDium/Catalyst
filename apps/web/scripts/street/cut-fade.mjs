// The globe <-> street cut as a tone cross-fade (docs/street-architecture.md, "The cut"). Runs the real app (the handover controller, the
// Three.js globe and the street map on OpenFreeMap) and looks at the street map's presented image around the swap:
//   seed      the presented image right after `seedFrom(globe canvas)` is the globe's image, cell for cell (the cut itself is invisible)
//   forward   the camera crosses the cut zoom going in: the first street frame equals the globe's, every changing cell then steps through
//             >= 3 intermediate levels at no more than a few levels per frame, and the map settles within the ease time
//   back      the camera crosses it going out: the street map stays on screen and eases to the globe's frames, then hides
//   slow      the same cut with the tile requests delayed by 3 s: the street map shows the globe's own lines (the world placeholder) until its
//             tiles arrive, never an empty map, and the arriving tile lines cross-fade in (>= 3 levels)
//   reduced   under reduced motion the swap is instant (no intermediate level)
//   BASE_URL=http://localhost:5481 SOURCE=primary node scripts/street/cut-fade.mjs [--only=seed,forward,back,slow,reduced]
import { DESKTOP, launch, openApp, settleApp, setCamera, waitStreetOk } from "../globe/handover-lib.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const t = a.replace(/^--/, ""); const i = t.indexOf("="); return i < 0 ? [t, "1"] : [t.slice(0, i), t.slice(i + 1)]; }));
const only = args.only ? new Set(args.only.split(",")) : null;
const want = (n) => !only || only.has(n);
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name} ${detail}`);
  if (!ok) failures.push(name);
};
const VIEW = { lon: 2, lat: 46 };
const profile = { ...DESKTOP, deviceScaleFactor: 1 };
const HIDE = "[data-globe=three] > div:nth-child(2), [data-street-overlay], header, nav, [data-attribution] { visibility: hidden !important; }";

const SAMPLER = `
window.__cf = {
  frame: () => new Promise((r) => requestAnimationFrame(r)),
  street() { const d = window.__handoverDebug; return d.street(); },
  /** presented levels of the street map + its target; null when it is not drawing */
  read() { const s = window.__handoverDebug.street(); if (!s) return null; const dbg = s.debug(); const a = dbg.readCodes(); if (!a) return null; return { cols: a.cols, rows: a.rows, T: Uint8Array.from(a.levels), P: dbg.readPresentedLevels(), easing: dbg.easing() }; },
  /** the globe's canvas as levels (nearest palette colour), on the street's grid */
  globeLevels(cols, rows) {
    const d = window.__handoverDebug;
    const canvas = document.querySelector('[data-globe="three"] canvas');
    const ramp = d.globe.ramp();
    const grid = d.street()?.canvas;
    const c2 = document.createElement("canvas"); c2.width = canvas.width; c2.height = canvas.height;
    const g = c2.getContext("2d", { willReadFrequently: true });
    g.drawImage(canvas, 0, 0);
    const data = g.getImageData(0, 0, c2.width, c2.height).data;
    return { w: c2.width, h: c2.height, levelAt(x, y) { if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0; const i = (y * this.w + x) * 4; if (data[i + 3] < 128) return 0; let best = 0, bd = 1e9; for (let k = 0; k < ramp.length; k++) { const dd = (data[i] - ramp[k][0]) ** 2 + (data[i + 1] - ramp[k][1]) ** 2 + (data[i + 2] - ramp[k][2]) ** 2; if (dd < bd) { bd = dd; best = k; } } return best; } };
  },
};`;

const tiles = null;
const browser = await launch();
try {
  // ---- seed fidelity ------------------------------------------------------------------------------------------------------------
  if (want("seed")) {
    const { page, ctx } = await openApp(browser, profile, { path: "/", street: { forceSource: "primary" } });
    await page.addStyleTag({ content: HIDE });
    await page.evaluate(SAMPLER);
    await setCamera(page, { ...VIEW, zoom: 4.2 });
    await waitStreetOk(page);
    await page.evaluate(() => window.__handoverDebug.forceBlend(0));
    await setCamera(page, { ...VIEW, zoom: 3.9 });
    await settleApp(page);
    const r = await page.evaluate(() => {
      const d = window.__handoverDebug, s = d.street(), dbg = s.debug();
      d.globe.renderNow(); // the globe draws this camera in this task: its canvas is valid now
      const canvas = document.querySelector('[data-globe="three"] canvas');
      const cell = dbg.cellCss();
      // what the street's cells (cols x rows from the corner of the container) hold in the globe's canvas
      const gl = window.__cf.globeLevels();
      s.setActive(true);
      const grid = d.globe.pixelGrid ? d.globe.pixelGrid() : null;
      // canvas offset: the globe canvas's CSS box against the container
      const cb = canvas.getBoundingClientRect(), sb = s.canvas.getBoundingClientRect();
      const left = cb.left - sb.left, top = cb.top - sb.top;
      const ok = s.seedFrom(canvas, { cell, left, top });
      s.setCamera(s.getView(), { sync: true });
      const a = dbg.readCodes();
      const P = dbg.readPresentedLevels();
      let diff = 0, lit = 0, lit2 = 0, missing = 0, extra = 0, other = 0; const sample = [];
      for (let y = 0; y < a.rows; y++) for (let x = 0; x < a.cols; x++) {
        const gx = Math.floor(x + 0.5 - left / cell), gy = Math.floor(y + 0.5 - top / cell);
        const want = gl.levelAt(gx, gy);
        const got = P[y * a.cols + x];
        if (want > 0) lit++;
        if (got > 0) lit2++;
        if (want !== got) { diff++; if (want > 0 && got === 0) missing++; else if (want === 0 && got > 0) extra++; else other++; if (sample.length < 6 && want > 0) sample.push([x, y, want, got]); }
      }
      return { ok, cols: a.cols, rows: a.rows, diff, lit, lit2, left, top, missing, extra, other, sample, canvasW: canvas.width, canvasH: canvas.height, cell, cb: [cb.left, cb.top, cb.width, cb.height], sb: [sb.left, sb.top, sb.width, sb.height] };
    });
    check("seed: the street's first presented image is the globe's, cell for cell", r.ok && r.lit > 500 && r.diff / (r.cols * r.rows) < 0.002, `(${r.diff} of ${r.cols * r.rows} cells differ, ${r.lit} lit in the globe, ${r.lit2} lit in the street; canvas offset ${r.left},${r.top}; missing ${r.missing} extra ${r.extra} other ${r.other}; canvas ${r.canvasW}x${r.canvasH} cell ${r.cell} box ${r.cb} vs ${r.sb}; ${JSON.stringify(r.sample)})`);
    await ctx.close();
  }

  // ---- forward and back -------------------------------------------------------------------------------------------------------------
  // ---- slow network ----------------------------------------------------------------------------------------------------------------
  if (want("slow")) {
    const { page, ctx } = await openApp(browser, profile, { path: "/", street: { forceSource: "primary" } });
    await page.addStyleTag({ content: HIDE });
    await page.evaluate(SAMPLER);
    let delay = 0;
    await page.route("**/*.pbf", async (route) => { if (delay) await new Promise((r) => setTimeout(r, delay)); await route.continue(); });
    await setCamera(page, { ...VIEW, zoom: 3.2 });
    await waitStreetOk(page);
    await page.waitForTimeout(800);
    await setCamera(page, { ...VIEW, zoom: 2.8 });
    await page.waitForTimeout(1500);
    delay = 3000; // tiles for a view not seen yet arrive 3 s late
    const r = await page.evaluate(async (view) => {
      const cf = window.__cf, d = window.__handoverDebug;
      d.globe.setView({ ...view, lon: 112, lat: 2, zoom: 4.0 }); // somewhere new: Borneo
      const t0 = performance.now();
      const samples = [];
      const seen = new Set();
      let prev = null, maxStep = 0, cutAt = null;
      while (performance.now() - t0 < 7000) {
        await cf.frame();
        const sh = d.blend().shown;
        if (sh >= 1 && cutAt === null) cutAt = performance.now() - t0;
        const s = cf.read();
        if (!s) continue;
        let lit = 0, mid = 0;
        for (let i = 0; i < s.T.length; i++) { if (s.T[i]) lit++; if (s.P[i] > 0 && s.P[i] !== s.T[i]) mid++; }
        if (prev) for (let i = 0; i < s.P.length; i++) { const dd = Math.abs(s.P[i] - prev[i]); if (dd > maxStep) maxStep = dd; if (s.P[i] !== prev[i] && s.P[i] > 0) seen.add(s.P[i]); }
        samples.push({ t: Math.round(performance.now() - t0), lit, mid, presentedLit: s.P.reduce((a, v) => a + (v > 0 ? 1 : 0), 0) });
        prev = s.P;
      }
      return { cutAt, samples: samples.filter((_, i) => i % 12 === 0), levels: [...seen].sort((a, b) => a - b), maxStep };
    }, VIEW);
    console.log(`slow: cut at ${Math.round(r.cutAt ?? -1)} ms; samples (t, lit target cells, mid-fade, lit presented):`, r.samples.map((x) => `${x.t}:${x.lit}/${x.mid}/${x.presentedLit}`).join("  "));
    const afterCut = r.samples.filter((x) => r.cutAt !== null && x.t >= r.cutAt);
    const minLit = Math.min(...afterCut.map((x) => x.lit));
    const maxLit = Math.max(...afterCut.map((x) => x.lit));
    check("slow: the street map is never empty while its tiles are late (the world placeholder is drawn)", afterCut.length > 3 && minLit > 1000, /* the globe's own coast, borders and graticule: about 1.7k cells here; region lines (on from map z4.2 since the layer switch) add the rest at higher zooms */ `(lit target cells between ${minLit} and ${maxLit})`);
    check("slow: the tile lines cross-fade in when they arrive (>= 3 intermediate levels, no cell jumps more than 4)", r.levels.length >= 3 && r.maxStep <= 4, `(levels seen ${r.levels.join(",")}, max step ${r.maxStep})`);
    await ctx.close();
  }

  for (const dir of ["forward", "back", "reduced"]) {
    if (!want(dir)) continue;
    const { page, ctx, logs } = await openApp(browser, profile, { path: "/", street: { forceSource: "primary" }, reducedMotion: dir === "reduced" ? "reduce" : "no-preference" });
    await page.addStyleTag({ content: HIDE });
    await page.evaluate(SAMPLER);
    const from = dir === "back" ? 4.1 : 3.3;
    const to = dir === "back" ? 3.2 : 4.1;
    await setCamera(page, { ...VIEW, zoom: 4.1 });
    await waitStreetOk(page);
    await setCamera(page, { ...VIEW, zoom: from });
    await settleApp(page);
    await page.waitForTimeout(1500);
    const r = await page.evaluate(async ([view, to]) => {
      const cf = window.__cf, d = window.__handoverDebug;
      const out = [];
      const cuts0 = d.cuts();
      d.globe.setView({ ...view, zoom: to });
      const t0 = performance.now();
      let prev = null, first = null, maxStep = 0, settledAt = null, hiddenAt = null, rootVisible = [];
      const seen = new Set();
      const root = document.querySelector("[data-street-root]")?.parentElement;
      while (performance.now() - t0 < 5000) {
        await cf.frame();
        const sh = d.blend().shown;
        const s = cf.read();
        const op = root ? getComputedStyle(root).opacity : "?";
        rootVisible.push([Math.round(performance.now() - t0), sh, op]);
        if (!s) continue;
        let diff = 0, inter = 0;
        for (let i = 0; i < s.T.length; i++) if (s.P[i] !== s.T[i]) { diff++; if (s.P[i] > 0 && s.P[i] !== s.T[i]) inter++; }
        if (prev) for (let i = 0; i < s.P.length; i++) { const dd = Math.abs(s.P[i] - prev[i]); if (dd > maxStep) maxStep = dd; for (const v of [prev[i], s.P[i]]) if (v > 0 && v < 10) seen.add(v); }
        if (first === null && sh >= 1) first = { t: Math.round(performance.now() - t0), diff, inter };
        out.push({ t: Math.round(performance.now() - t0), shown: sh, diff, inter, easing: s.easing });
        prev = s.P;
      }
      const cuts = d.cuts();
      return { cuts: { toStreet: cuts.toStreet - cuts0.toStreet, toGlobe: cuts.toGlobe - cuts0.toGlobe }, first, maxStep, levels: [...seen].sort((a, b) => a - b), frames: out.filter((_, i) => i % 3 === 0).slice(0, 40), rootVisible: rootVisible.filter((_, i) => i % 4 === 0).slice(0, 30) };
    }, [VIEW, to]);
    console.log(`${dir}: ${JSON.stringify(r.cuts)} first street frame ${JSON.stringify(r.first)}`);
    console.log("   frames (t ms, shown, cells off target, cells mid-fade, easing):", r.frames.map((f) => `${f.t}:${f.shown}/${f.diff}/${f.inter}/${f.easing}`).join("  "));
    if (dir === "forward") {
      const peak = Math.max(...r.frames.map((f) => f.inter));
      check("forward: the cut swaps to the street map once", r.cuts.toStreet === 1);
      check("forward: cells cross over through >= 3 intermediate levels, no cell moves more than 4 levels in a frame", r.levels.length >= 3 && r.maxStep <= 4, `(levels seen ${r.levels.join(",")}, max step ${r.maxStep}, peak ${peak} cells mid-fade)`);
      check("forward: settled within the ease time", r.frames.some((f) => f.t > 200 && f.diff === 0) , "");
    }
    if (dir === "back") {
      check("back: the cut swaps to the globe once", r.cuts.toGlobe === 1);
      check("back: the street map stays on screen and eases through >= 3 levels", r.levels.length >= 3 && r.maxStep <= 4, `(levels seen ${r.levels.join(",")}, max step ${r.maxStep})`);
      const last = r.rootVisible[r.rootVisible.length - 1];
      check("back: and is hidden at the end", last && Number(last[2]) === 0, `(street root opacity ${last?.[2]} at ${last?.[0]} ms)`);
    }
    if (dir === "reduced") {
      check("reduced motion: the swap is instant (no intermediate level, no cross-fade)", r.levels.length === 0 || r.first?.inter === 0, `(levels ${r.levels.join(",")}, first frame ${JSON.stringify(r.first)})`);
    }
    if (logs.length) console.error(logs.slice(-3).join("\n"));
    await ctx.close();
  }
} finally {
  await browser.close();
}
if (failures.length) {
  console.error(`\n${failures.length} FAILED: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("\ncut fade ok");
