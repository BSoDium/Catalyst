// Level-of-detail evidence for the street style: screenshots + line density per zoom, theme and place.
//
//   BASE_URL=http://localhost:5173 node scripts/street/lod.mjs --tag=before|after [--out=../../docs/street-zoom] [--only=lisbon] [--zooms=5.5,8]
//        [--metrics=out.json] [--png=0]
//
// Places: hcmc (local PMTiles fallback, Protomaps schema) and lisbon (primary OpenFreeMap, OpenMapTiles schema; needs network); paris and
// bucharest only with --only=paris,bucharest (the half-level density tables of the city-framing pass).
// For each (place, zoom, theme): a PNG named style-<place>-<tag>-z<zoom>-<light|dark>.png (800x500 CSS px, DPR 1, so the file
// is small and one art cell is 3 px), and metrics read from the art texture with the fills hidden: line cells (ink +
// ramp dither + muted) per 1000 cells, plus the number of vector line features rendered.
import { writeFileSync, mkdirSync } from "node:fs";
import { FALLBACK_URL, ensureTiles, launch, open, dev } from "./_lib.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const t = a.replace(/^--/, ""); const i = t.indexOf("="); return i < 0 ? [t, "1"] : [t.slice(0, i), t.slice(i + 1)]; }));
const tag = args.tag ?? "after";
const out = args.out ?? new URL("../../../../docs/street-zoom", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const PLACES = {
  hcmc: { source: "fallback", lon: 106.698, lat: 10.774, zooms: [8, 10, 11, 13, 15, 16, 17] },
  lisbon: { source: "primary", lon: -9.1393, lat: 38.7223, zooms: [1.5, 3.5, 5.5, 6.5, 8, 10, 11, 13, 15, 16, 17] },
  // the density tables of the city-framing pass (docs/street-architecture.md): a zoom every half level through the framing range
  paris: { source: "primary", lon: 2.3522, lat: 48.8566, zooms: [3.5, 5.5, 6.5, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 14, 15, 16, 17], extra: true },
  bucharest: { source: "primary", lon: 26.1025, lat: 44.4268, zooms: [5.5, 7.5, 8, 9, 9.5, 10, 10.5, 11, 12, 13], extra: true },
};
const zoomFilter = args.zooms ? args.zooms.split(",").map(Number) : null;
const themes = args.themes ? args.themes.split(",") : ["light", "dark"];

const tiles = await ensureTiles();
const browser = await launch();
const rows = [];
try {
  for (const [place, P] of Object.entries(PLACES)) {
    if (args.only ? !args.only.split(",").includes(place) : P.extra) continue;
    for (const theme of themes) {
      const { page, logs } = await open(browser, { viewport: { width: 800, height: 500 }, deviceScaleFactor: 1 }, { colorScheme: theme });
      for (const zoom of P.zooms.filter((z) => !zoomFilter || zoomFilter.includes(z))) {
        const params = { hud: 0, view: `${P.lon},${P.lat},${zoom}`, theme, ...(P.source === "fallback" ? { source: "fallback", fallbackUrl: FALLBACK_URL } : { source: "primary" }) };
        await page.goto(dev("/dev/street", params));
        try {
          await page.waitForFunction(() => window.__streetDebug?.map().loaded() && ["primary", "fallback", "capped"].includes(document.querySelector("[data-dev-street]")?.getAttribute("data-tile-state") ?? ""), null, { timeout: 60000 });
          await page.waitForFunction(() => { const m = window.__streetDebug.map(); return !m.isMoving() && m.areTilesLoaded() && !window.__streetDebug.isAnimating(); }, null, { timeout: 60000 });
        } catch (e) {
          console.error(`not ready ${place} z${zoom} ${theme}`, logs.slice(-3));
          continue;
        }
        await page.waitForTimeout(700);
        if (args.png !== "0") await page.screenshot({ path: `${out}/style-${place}-${tag}-z${zoom}-${theme}.png` });
        // metrics: hide the fills so only lines are counted
        const m = await page.evaluate(async () => {
          const dbg = window.__streetDebug;
          const map = dbg.map();
          const style = map.getStyle();
          const fills = style.layers.filter((l) => l.type === "fill").map((l) => l.id);
          const lineLayers = style.layers.filter((l) => l.type === "line" && l.source === "tiles").map((l) => l.id);
          const z = map.getZoom();
          const visible = lineLayers.filter((id) => { const l = map.getLayer(id); return z >= (l.minzoom ?? 0) && z < (l.maxzoom ?? 24); });
          let feats = 0;
          try { feats = map.queryRenderedFeatures({ layers: visible }).length; } catch { feats = -1; }
          const count = () => { const { cols, rows, codes } = dbg.readCodes(); let n = 0; for (let i = 0; i < codes.length; i++) if (codes[i]) n++; return { n, total: cols * rows }; };
          const withFills = count();
          for (const id of fills) map.setLayoutProperty(id, "visibility", "none");
          await new Promise((r) => { map.once("idle", r); map.triggerRepaint(); });
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const linesOnly = count();
          for (const id of fills) map.setLayoutProperty(id, "visibility", "visible");
          return { lineCells: linesOnly.n, totalCells: linesOnly.total, allCells: withFills.n, features: feats, layers: visible.length };
        });
        const row = { place, zoom, theme, tag, ...m, linePer1000: +(1000 * m.lineCells / m.totalCells).toFixed(1), allPer1000: +(1000 * m.allCells / m.totalCells).toFixed(1) };
        rows.push(row);
        console.log(JSON.stringify(row));
      }
      await page.context().close();
    }
  }
} finally {
  await browser.close();
  await tiles.stop();
}
if (args.metrics) writeFileSync(args.metrics, JSON.stringify(rows, null, 1));
