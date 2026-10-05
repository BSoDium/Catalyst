// Tone-ramp stability check on the real pipeline (docs/street-architecture.md, "Level of detail").
//   BASE_URL=http://localhost:5173 node scripts/street/lod-check.mjs
// Camera fixed on Ho Chi Minh City (local PMTiles). A class that fades in with zoom is ONE layer whose colour steps through the
// palette levels (1 ... its role's level). Here every live fade-in layer is forced to level k = 1 ... 7 in turn (what a slowly
// rising zoom does to its colour): the set of line cells must be IDENTICAL at every level (a fade changes the tone of the
// same cells, it never adds, removes or moves one: no noise), and the cells of the forced layers must be presented at level k.
// (Before the tone ramp the check was "the lit set at tone t is a subset of the set at the next tone"; the dither added
// about 200 to 600 cells per 1/16 step.) Exit code 1 on a violation.
import { FALLBACK_URL, ensureTiles, launch, open, dev } from "./_lib.mjs";

const tiles = await ensureTiles();
const browser = await launch();
let failed = 0;
try {
  for (const zoom of [12.6, 13.4, 15.2]) {
    const { page } = await open(browser, { viewport: { width: 800, height: 500 }, deviceScaleFactor: 1 });
    await page.goto(dev("/dev/street", { hud: 0, view: `106.698,10.774,${zoom}`, source: "fallback", fallbackUrl: FALLBACK_URL, tileFade: 0 }));
    await page.waitForFunction(() => window.__streetDebug?.map().loaded() && document.querySelector("[data-dev-street]")?.getAttribute("data-tile-state") === "fallback", null, { timeout: 60000 });
    await page.waitForFunction(() => { const m = window.__streetDebug.map(); return !m.isMoving() && m.areTilesLoaded(); });
    const r = await page.evaluate(async () => {
      const dbg = window.__streetDebug, map = dbg.map();
      const z = map.getZoom();
      // fade-in layers: their colour is a zoom `step` expression
      const live = map.getStyle().layers.filter((l) => l.type === "line" && Array.isArray(l.paint?.["line-color"]) && z >= (l.minzoom ?? 0) && z < (l.maxzoom ?? 24)).map((l) => l.id);
      for (const l of map.getStyle().layers) if (l.type === "fill") map.setLayoutProperty(l.id, "visibility", "none");
      const frame = async (k) => {
        for (const id of live) map.setPaintProperty(id, "line-color", `rgb(255,${Math.round((k / 12) * 255)},0)`);
        await new Promise((res) => { map.once("idle", res); map.triggerRepaint(); });
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
        const { codes, levels } = dbg.readCodes();
        return { codes: Uint8Array.from(codes), levels: Uint8Array.from(levels) };
      };
      const frames = [];
      for (let k = 1; k <= 7; k++) frames.push(await frame(k));
      let moved = 0;
      const atLevel = [];
      for (let k = 0; k < frames.length; k++) {
        let n = 0;
        for (let i = 0; i < frames[k].codes.length; i++) {
          if (!!frames[k].codes[i] !== !!frames[0].codes[i]) moved++;
          if (frames[k].codes[i] && frames[k].levels[i] === k + 1) n++;
        }
        atLevel.push(n);
      }
      let lines = 0;
      for (const c of frames[0].codes) if (c) lines++;
      return { live, moved, atLevel, lines };
    });
    // the forced layers' cells are at level k (a share of all line cells: the fixed layers (sea, borders) keep theirs)
    const ok = r.moved === 0 && r.live.length > 0 && r.atLevel.every((n) => n > 0.05 * r.lines);
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} z${zoom} fade-in layers ${r.live.length}: line cells added/removed/moved across levels 1..7: ${r.moved}; cells at the forced level per step: ${r.atLevel.join(" ")} of ${r.lines}`);
    await page.context().close();
  }
} finally {
  await browser.close();
  await tiles.stop();
}
process.exit(failed ? 1 : 0);
