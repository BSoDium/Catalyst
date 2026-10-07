// Which classes make the line density at a zoom: the ink cells of every visible line layer ALONE (fills hidden), per place and zoom.
//   BASE_URL=http://localhost:5471 node scripts/street/lod-layers.mjs [--only=paris,hcmc] [--zooms=10.5,11,12]
import { FALLBACK_URL, ensureTiles, launch, open, dev } from "./_lib.mjs";
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const t = a.replace(/^--/, ""); const i = t.indexOf("="); return i < 0 ? [t, "1"] : [t.slice(0, i), t.slice(i + 1)]; }));
const PLACES = {
  hcmc: { source: "fallback", lon: 106.698, lat: 10.774 },
  paris: { source: "primary", lon: 2.3522, lat: 48.8566 },
  lisbon: { source: "primary", lon: -9.1393, lat: 38.7223 },
  bucharest: { source: "primary", lon: 26.1025, lat: 44.4268 },
};
const zooms = (args.zooms ?? "10.5,11,12").split(",").map(Number);
const only = (args.only ?? "paris,hcmc").split(",");
const tiles = await ensureTiles();
const browser = await launch();
try {
  const { page } = await open(browser, { viewport: { width: 800, height: 500 }, deviceScaleFactor: 1 }, { colorScheme: "light" });
  for (const place of only) for (const zoom of zooms) {
    const P = PLACES[place];
    await page.goto(dev("/dev/street", { hud: 0, view: `${P.lon},${P.lat},${zoom}`, theme: "light", ...(P.source === "fallback" ? { source: "fallback", fallbackUrl: FALLBACK_URL } : { source: "primary" }) }));
    await page.waitForFunction(() => window.__streetDebug?.map().loaded() && ["primary", "fallback"].includes(document.querySelector("[data-dev-street]")?.getAttribute("data-tile-state") ?? ""), null, { timeout: 60000 });
    await page.waitForFunction(() => { const m = window.__streetDebug.map(); return !m.isMoving() && m.areTilesLoaded() && !window.__streetDebug.isAnimating(); }, null, { timeout: 60000 });
    await page.waitForTimeout(600);
    const rows = await page.evaluate(async () => {
      const dbg = window.__streetDebug, map = dbg.map(), z = map.getZoom();
      const layers = map.getStyle().layers.filter((l) => l.source === "tiles" || ["world-coast", "world-borders", "graticule"].includes(l.id));
      const set = async (ids) => { for (const l of layers) map.setLayoutProperty(l.id, "visibility", ids.includes(l.id) ? "visible" : "none"); await new Promise((r) => { map.once("idle", r); map.triggerRepaint(); }); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); const { codes } = dbg.readCodes(); let n = 0; for (const c of codes) if (c) n++; return n; };
      const vis = layers.filter((l) => l.type === "line" && z >= (l.minzoom ?? 0) && z < (l.maxzoom ?? 24) && !/-fill$/.test(l.id));
      const out = [];
      for (const l of vis) out.push([l.id, await set([l.id])]);
      const total = await set(vis.map((l) => l.id));
      return { out, total, cells: dbg.readCodes().codes.length };
    });
    console.log(`${place} z${zoom}: total ${(1000 * rows.total / rows.cells).toFixed(1)} per 1000 cells | ` + rows.out.filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([id, n]) => `${id} ${(1000 * n / rows.cells).toFixed(1)}`).join(", "));
  }
} finally { await browser.close(); await tiles.stop(); }
