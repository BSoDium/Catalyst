// Ramp stability check on the real pipeline (docs/street-architecture.md, "Level of detail").
//   BASE_URL=http://localhost:5173 node scripts/street/lod-check.mjs
// Camera fixed on Ho Chi Minh City (local PMTiles). All ramp layers are forced to a constant tone t = 0, 1/16 ... 1 (what a
// slowly rising zoom does to the opacity): the set of lit cells at tone t must be a SUBSET of the set at the next tone,
// i.e. consecutive frames differ by newly lit cells only (no swimming, no flicker), and at tone 1 the ramp must hold the
// cells of the final ink look (within staircase thinning). Exit code 1 on a violation.
import { FALLBACK_URL, ensureTiles, launch, open, dev } from "./_lib.mjs";

const tiles = await ensureTiles();
const browser = await launch();
let failed = 0;
try {
  for (const zoom of [12.6, 13.4, 15.2]) {
    const { page } = await open(browser, { viewport: { width: 800, height: 500 }, deviceScaleFactor: 1 });
    await page.goto(dev("/dev/street", { hud: 0, view: `106.698,10.774,${zoom}`, source: "fallback", fallbackUrl: FALLBACK_URL }));
    await page.waitForFunction(() => window.__streetDebug?.map().loaded() && document.querySelector("[data-dev-street]")?.getAttribute("data-tile-state") === "fallback", null, { timeout: 60000 });
    await page.waitForFunction(() => { const m = window.__streetDebug.map(); return !m.isMoving() && m.areTilesLoaded(); });
    const r = await page.evaluate(async () => {
      const dbg = window.__streetDebug, map = dbg.map();
      const ramps = map.getStyle().layers.filter((l) => l.id.endsWith("-ramp") && map.getLayer(l.id));
      const z = map.getZoom();
      const live = ramps.filter((l) => z >= (l.minzoom ?? 0) && z < (l.maxzoom ?? 24)).map((l) => l.id);
      for (const l of map.getStyle().layers) if (l.type === "fill") map.setLayoutProperty(l.id, "visibility", "none");
      const frame = async (t) => {
        for (const id of live) map.setPaintProperty(id, "line-opacity", t);
        await new Promise((res) => { map.once("idle", res); map.triggerRepaint(); });
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
        return Uint8Array.from(dbg.readCodes().codes);
      };
      const frames = [];
      for (let k = 0; k <= 16; k++) frames.push(await frame(k / 16));
      let notSubset = 0, grew = 0, added = [];
      for (let k = 0; k < 16; k++) {
        let a = 0;
        for (let i = 0; i < frames[k].length; i++) {
          if (frames[k][i] && !frames[k + 1][i]) notSubset++;
          if (!frames[k][i] && frames[k + 1][i]) a++;
        }
        added.push(a);
        grew += a;
      }
      return { live, notSubset, grew, added };
    });
    const ok = r.notSubset === 0 && r.live.length > 0 && r.grew > 0;
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} z${zoom} ramp layers ${r.live.join(",")}: cells that switch OFF while the tone rises: ${r.notSubset}; cells added per 1/16 step: ${r.added.join(" ")}`);
    await page.context().close();
  }
} finally {
  await browser.close();
  await tiles.stop();
}
process.exit(failed ? 1 : 0);
