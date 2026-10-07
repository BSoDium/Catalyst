// Border regression on the live map (real OpenFreeMap tiles): every country / region boundary the style draws is a de-facto land
// border, never a disputed claim or a maritime line, and the tile data around the checked frontiers DOES contain such lines (so the
// filter is what keeps them out). One source per zoom: the bundled Natural Earth layer ends where the tile boundary starts.
//
//   BASE_URL=http://localhost:5471 node scripts/street/border-check.mjs        exit 1 on a violation
// Companion: scripts/street/border-shots.mjs (before / after PNGs, docs/street-zoom/border-*-before-after.png).
import { ensureTiles, launch, open, dev } from "./_lib.mjs";

const CASES = [
  { name: "Western Sahara / Mauritania / Morocco / Algeria", view: [-12, 24.5, 7.2], expectDisputedInSource: true },
  { name: "Western Sahara / Morocco (wall region, wider)", view: [-11, 25, 5.8], expectDisputedInSource: true },
  { name: "Kashmir / Ladakh", view: [77.5, 34, 6.4], expectDisputedInSource: true },
  { name: "Crimea", view: [34.2, 45.2, 7], expectDisputedInSource: true },
  { name: "Israel / Palestine", view: [35.1, 31.7, 8], expectDisputedInSource: true },
  { name: "Kosovo / Serbia", view: [20.9, 42.6, 8], expectDisputedInSource: false },
  { name: "Cyprus", view: [33.3, 35, 8], expectDisputedInSource: false },
];
const browser = await launch();
const tiles = await ensureTiles();
let failed = 0;
try {
  const { page } = await open(browser, { viewport: { width: 900, height: 560 }, deviceScaleFactor: 1 }, { colorScheme: "light" });
  for (const c of CASES) {
    await page.goto(dev("/dev/street", { hud: 0, view: c.view.join(","), theme: "light", source: "primary" }));
    await page.waitForFunction(() => window.__streetDebug?.map().loaded() && document.querySelector("[data-dev-street]")?.getAttribute("data-tile-state") === "primary", null, { timeout: 60000 });
    await page.waitForFunction(() => { const m = window.__streetDebug.map(); return !m.isMoving() && m.areTilesLoaded(); }, null, { timeout: 60000 });
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const map = window.__streetDebug.map();
      const z = map.getZoom();
      const lay = (id) => { const l = map.getLayer(id); return l ? { min: l.minzoom ?? 0, max: l.maxzoom ?? 24 } : null; };
      const rendered = map.queryRenderedFeatures({ layers: ["boundary-country", "boundary-region"] }).map((f) => ({ l: f.layer.id, d: f.properties.disputed, m: f.properties.maritime, a: f.properties.admin_level }));
      const src = map.querySourceFeatures("tiles", { sourceLayer: "boundary" });
      const inSource = (pred) => src.filter((f) => f.properties.admin_level === 2 && pred(f.properties)).length;
      return { z, world: lay("world-borders"), tile: lay("boundary-country"), rendered, srcDisputed: inSource((p) => p.disputed === 1 && p.maritime !== 1), srcMaritime: inSource((p) => p.maritime === 1), srcLand: inSource((p) => p.disputed !== 1 && p.maritime !== 1) };
    });
    const bad = r.rendered.filter((f) => f.d === 1 || f.m === 1 || (f.l === "boundary-country" && f.a !== 2));
    const checks = [
      [`no disputed / maritime boundary is drawn (${r.rendered.length} drawn, ${bad.length} wrong)`, bad.length === 0],
      [`the data does hold disputed land lines here (${r.srcDisputed}) and maritime ones (${r.srcMaritime}): ${c.expectDisputedInSource ? "expected" : "informational"}`, !c.expectDisputedInSource || r.srcDisputed > 0],
      [`de-facto land borders are drawn (${r.srcLand} in the data, ${r.rendered.filter((f) => f.l === "boundary-country").length} rendered)`, r.srcLand === 0 || r.rendered.some((f) => f.l === "boundary-country")],
      [`one source per zoom: world borders stop at ${r.world?.max}, the tile boundary starts at ${r.tile?.min}`, r.world && r.tile && r.world.max === r.tile.min && r.z >= r.tile.min],
    ];
    for (const [what, ok] of checks) { if (!ok) failed++; console.log(`${ok ? "ok  " : "FAIL"} ${c.name} z${c.view[2]}: ${what}`); }
  }
} finally {
  await browser.close();
  await tiles.stop();
}
process.exit(failed ? 1 : 0);
