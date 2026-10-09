// Road density per class and zoom: for each place and map zoom, whether each road class is ON (the binary switch of style/layer-switch.ts), its
// art-pixel width and palette level, and the fraction of lit art cells of the viewport (the class alone, fills hidden; and ALL lines together).
// Live OpenFreeMap tiles (needs the network), no local archive. The dev server must run: BASE_URL (default http://localhost:5340).
//   BASE_URL=http://localhost:5340 node scripts/street/lod-density.mjs [--only=paris,london,nyc] [--zooms=8,8.5,...] [--theme=light|dark]
//        [--shots=<dir>] [--tag=before|after] [--box=1] [--w=1440] [--h=900]
// --shots writes a screenshot per place and zoom (they show real places: keep them out of the repo). Read-only: no style is changed.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { CHROME, dev } from "./_lib.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const t = a.replace(/^--/, ""); const i = t.indexOf("="); return i < 0 ? [t, "1"] : [t.slice(0, i), t.slice(i + 1)]; }));
const PLACES = {
  paris: { lon: 2.3522, lat: 48.8566 },
  london: { lon: -0.1276, lat: 51.5072 },
  nyc: { lon: -73.9857, lat: 40.7484 },
};
const CLASSES = [
  ["highway", "road-highway-case"],
  ["major", "road-major-case"],
  ["secondary", "road-secondary-case"],
  ["medium", "road-medium-case"],
  ["link", "road-link-dotted"],
  ["rail", "rail"],
  ["minor", "road-minor-dotted"],
  ["minorSolid", "road-minor"],
  ["service", "road-other-dotted"],
  ["path", "path-dotted"],
];
const zooms = (args.zooms ?? "8,8.5,9,9.5,10,10.5,11,11.5,12,12.5,13,13.5,14").split(",").map(Number);
const only = (args.only ?? "paris,london,nyc").split(",");
const theme = args.theme ?? "light";
const W = Number(args.w ?? 1440), H = Number(args.h ?? 900);
const tag = args.tag ?? "run";
if (args.shots) mkdirSync(args.shots, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu"] });
try {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, colorScheme: theme });
  const page = await ctx.newPage();
  for (const name of only) {
    const P = PLACES[name];
    await page.goto(dev("/dev/street", { hud: 0, source: "primary", theme, view: `${P.lon},${P.lat},${zooms[0]}` }));
    await page.waitForFunction(() => window.__streetDebug?.map().loaded() && ["primary", "capped"].includes(document.querySelector("[data-dev-street]")?.getAttribute("data-tile-state") ?? ""), null, { timeout: 60000 });
    for (const zoom of zooms) {
      await page.evaluate((v) => window.__streetDebug.map().jumpTo({ center: [v.lon, v.lat], zoom: v.zoom }), { ...P, zoom });
      await page.waitForFunction(() => { const m = window.__streetDebug.map(); return !m.isMoving() && m.areTilesLoaded() && !window.__streetDebug.isAnimating(); }, null, { timeout: 60000 });
      await page.waitForTimeout(700);
      const rows = await page.evaluate(async ({ CLASSES }) => {
        const dbg = window.__streetDebug, map = dbg.map(), z = map.getZoom(), cell = dbg.cellCss();
        const on = new Set(dbg.layers().on);
        const lines = map.getStyle().layers.filter((l) => l.source === "tiles" || ["world-coast", "world-borders", "graticule"].includes(l.id));
        const state = new Map(lines.map((l) => [l.id, map.getLayoutProperty(l.id, "visibility") ?? "visible"]));
        const lit = async (ids) => {
          for (const l of lines) map.setLayoutProperty(l.id, "visibility", ids.includes(l.id) ? "visible" : "none");
          await new Promise((r) => { map.once("idle", r); map.triggerRepaint(); });
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const { codes } = dbg.readCodes();
          let n = 0;
          for (const c of codes) if (c) n++;
          return n / codes.length;
        };
        const widthAt = (id) => {
          const e = map.getPaintProperty(id, "line-width");
          if (typeof e === "number") return e / cell;
          const st = e.slice(3);
          let lo = [st[0], st[1]];
          if (z <= st[0]) return st[1] / cell;
          for (let i = 0; i < st.length; i += 2) {
            const hi = [st[i], st[i + 1]];
            if (z <= hi[0]) { const b = 1.5, t = (Math.pow(b, z - lo[0]) - 1) / (Math.pow(b, hi[0] - lo[0]) - 1); return (lo[1] + t * (hi[1] - lo[1])) / cell; }
            lo = hi;
          }
          return lo[1] / cell;
        };
        const levelOf = (id) => { const m = /rgb\(255,(\d+),0\)/.exec(map.getPaintProperty(id, "line-color")); return m ? Math.round((Number(m[1]) / 255) * 12) : -1; };
        const out = [];
        for (const [key, id] of CLASSES) {
          const isOn = on.has(id);
          out.push({ key, id, on: isOn, w: Math.round(widthAt(id) * 100) / 100, level: levelOf(id), frac: isOn ? await lit([id]) : 0 });
        }
        const roads = CLASSES.map(([, id]) => id).filter((id) => on.has(id));
        const allRoads = await lit(roads);
        const allLines = await lit(lines.filter((l) => on.has(l.id) || ["water-edge", "boundary-country", "waterway-major"].includes(l.id)).map((l) => l.id));
        for (const l of lines) map.setLayoutProperty(l.id, "visibility", state.get(l.id));
        await new Promise((r) => { map.once("idle", r); map.triggerRepaint(); });
        return { z, out, allRoads, allLines };
      }, { CLASSES });
      if (args.shots) {
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${args.shots}/${tag}-${name}-${theme}-z${zoom}.png` });
      }
      console.log(`${name} z${zoom} ${theme} roads ${(100 * rows.allRoads).toFixed(1)}% lines ${(100 * rows.allLines).toFixed(1)}% | ` + rows.out.filter((r) => r.on).map((r) => `${r.key} w${r.w} L${r.level} ${(100 * r.frac).toFixed(1)}%`).join(", "));
      if (args.json) console.log("JSON " + JSON.stringify({ name, zoom, theme, ...rows }));
    }
  }
} finally {
  await browser.close();
}
