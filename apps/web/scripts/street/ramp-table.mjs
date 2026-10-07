// Ink density of the street style per zoom, two ways (lines only, fills hidden, light theme, 800x500 CSS px at DPR 1, 2 CSS px cells):
//   cells    lit line cells per 1000 cells (what lod.mjs reports)
//   ink      tone-weighted: the sum over lit line cells of their contrast against the page (0.55 * (level / 10)^1.15 of the way to the ink for
//            map level `level` of 12, engine/palette.ts), per 1000 cells: a faint level counts for little, the peak for 0.55
// Run once against a build of the commit before and once against the working tree and diff the two JSON files (docs/street-architecture.md).
//   BASE_URL=http://localhost:5481 node scripts/street/ramp-table.mjs --tag=after --out=after.json [--only=paris,lisbon,bucharest,hcmc] [--zooms=3.5,4.5,...]
import { writeFileSync } from "node:fs";
import { FALLBACK_URL, ensureTiles, launch, open, dev } from "./_lib.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const t = a.replace(/^--/, ""); const i = t.indexOf("="); return i < 0 ? [t, "1"] : [t.slice(0, i), t.slice(i + 1)]; }));
const PLACES = {
  paris: { source: "primary", lon: 2.3522, lat: 48.8566 },
  lisbon: { source: "primary", lon: -9.1393, lat: 38.7223 },
  bucharest: { source: "primary", lon: 26.1025, lat: 44.4268 },
  hcmc: { source: "fallback", lon: 106.698, lat: 10.774 },
  france: { source: "primary", lon: 2.5, lat: 46.6 },
  colombia: { source: "primary", lon: -74, lat: 4.6 },
};
const zooms = (args.zooms ?? "3.5,4.5,5.5,6.5,7.5,8.5,9.5,10.5,12").split(",").map(Number);
const only = (args.only ?? "paris,lisbon,bucharest").split(",");
const rows = [];
const tiles = await ensureTiles();
const browser = await launch();
try {
  const { page } = await open(browser, { viewport: { width: 800, height: 500 }, deviceScaleFactor: 1 }, { colorScheme: "light" });
  for (const place of only) for (const zoom of zooms) {
    const P = PLACES[place];
    await page.goto(dev("/dev/street", { hud: 0, view: `${P.lon},${P.lat},${zoom}`, theme: "light", ...(P.source === "fallback" ? { source: "fallback", fallbackUrl: FALLBACK_URL } : { source: "primary" }) }));
    await page.waitForFunction(() => window.__streetDebug?.map().loaded() && ["primary", "fallback"].includes(document.querySelector("[data-dev-street]")?.getAttribute("data-tile-state") ?? ""), null, { timeout: 60000 });
    await page.waitForFunction(() => { const m = window.__streetDebug.map(); return !m.isMoving() && m.areTilesLoaded() && !window.__streetDebug.isAnimating(); }, null, { timeout: 90000 });
    await page.waitForTimeout(500);
    const r = await page.evaluate(async () => {
      const dbg = window.__streetDebug, map = dbg.map();
      for (const l of map.getStyle().layers) if (l.type === "fill") map.setLayoutProperty(l.id, "visibility", "none");
      await new Promise((r) => { map.once("idle", r); map.triggerRepaint(); });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const { codes, levels } = dbg.readCodes();
      let n = 0, ink = 0, loud = 0;
      for (let i = 0; i < codes.length; i++) if (codes[i] === 1 || codes[i] === 2) { n++; ink += 0.55 * (levels[i] / 10) ** 1.15; if (levels[i] >= 8) loud++; }
      return { n, ink, loud, cells: codes.length };
    });
    const row = { place, zoom, cellsPer1000: +((1000 * r.n) / r.cells).toFixed(1), inkPer1000: +((1000 * r.ink) / r.cells).toFixed(1), loudPer1000: +((1000 * r.loud) / r.cells).toFixed(1) };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
} finally { await browser.close(); await tiles.stop(); }
if (args.out) writeFileSync(args.out, JSON.stringify(rows, null, 1));
