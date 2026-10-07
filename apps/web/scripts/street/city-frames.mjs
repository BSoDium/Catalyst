// City-framing evidence: the camera the app uses when a place is clicked (framing.ts: a circle of the place's viewRadiusKm fits
// the free viewport with a 25 % margin), rendered with the street style, light and dark, detail panel closed and open.
//
//   BASE_URL=http://localhost:5471 node scripts/street/city-frames.mjs --tag=before|after [--out=../../docs/street-zoom] [--only=paris]
//        [--radius=12] [--viewports=desktop,desktop-panel,mobile] [--themes=light,dark] [--table=1]   (--table=1 only prints the zooms)
//
// Places are public geography (hard-coded coordinates): Lisbon, Paris, Bucharest (OpenFreeMap, OpenMapTiles schema, needs the
// network) and Ho Chi Minh City (the local PMTiles extract, Protomaps schema). The framing maths mirrors engine/framing.ts and
// core/registration.ts (lod.test.ts asserts that it is the same function). PNGs are 16-colour (palette-quantised) and small.
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { FALLBACK_URL, ensureTiles, launch, open, dev } from "./_lib.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const t = a.replace(/^--/, ""); const i = t.indexOf("="); return i < 0 ? [t, "1"] : [t.slice(0, i), t.slice(i + 1)]; }));
const tag = args.tag ?? "after";
const out = args.out ?? new URL("../../../../docs/street-zoom", import.meta.url).pathname;
const radiusKm = Number(args.radius ?? 12);
mkdirSync(out, { recursive: true });

const PLACES = {
  lisbon: { lon: -9.1393, lat: 38.7139, source: "primary" },
  paris: { lon: 2.3522, lat: 48.8566, source: "primary" },
  bucharest: { lon: 26.1025, lat: 44.4268, source: "primary" },
  hcmc: { lon: 106.6985, lat: 10.7745, source: "fallback" },
};
const VIEWPORTS = {
  desktop: { width: 1440, height: 900, inset: 0, dpr: 1 },
  "desktop-panel": { width: 1440, height: 900, inset: 720, dpr: 1 },
  mobile: { width: 390, height: 844, inset: 0, dpr: 1 },
};
const EARTH_R = 6371.0088, TILE = 512, MARGIN = 0.25;
/** Map (MapLibre) zoom of the framing: engine/framing.ts radiusFitZoom + registration.ts zoomCorrection. */
export function framingMapZoom(radius, lat, w, h, inset) {
  const free = w - Math.min(Math.max(inset, 0), w * 0.85);
  const circlePx = Math.max(1, Math.min(free, h)) / 2 / (1 + MARGIN);
  const unified = Math.log2(((circlePx * EARTH_R) / radius * 2 * Math.PI) / TILE);
  return unified + Math.log2(Math.cos((lat * Math.PI) / 180));
}
const vps = (args.viewports ?? "desktop,desktop-panel,mobile").split(",");
const themes = (args.themes ?? "light,dark").split(",");
const only = args.only ? args.only.split(",") : Object.keys(PLACES);

if (args.table) {
  for (const r of [10, 12, 14, 18]) for (const v of vps) console.log(`r=${r} km ${v.padEnd(14)} ${Object.entries(PLACES).map(([n, p]) => `${n} ${framingMapZoom(r, p.lat, VIEWPORTS[v].width, VIEWPORTS[v].height, VIEWPORTS[v].inset).toFixed(2)}`).join("  ")}`);
  process.exit(0);
}

const tiles = await ensureTiles();
const browser = await launch();
try {
  for (const v of vps) {
    const vp = VIEWPORTS[v];
    for (const theme of themes) {
      const { page, logs } = await open(browser, { viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dpr }, { colorScheme: theme });
      for (const name of only) {
        const P = PLACES[name];
        const zoom = framingMapZoom(radiusKm, P.lat, vp.width, vp.height, vp.inset);
        const params = { hud: 0, theme, view: `${P.lon},${P.lat},${zoom.toFixed(3)}`, inset: vp.inset, ...(P.source === "fallback" ? { source: "fallback", fallbackUrl: FALLBACK_URL } : { source: "primary" }) };
        await page.goto(dev("/dev/street", params));
        try {
          await page.waitForFunction(() => window.__streetDebug?.map().loaded() && ["primary", "fallback", "capped"].includes(document.querySelector("[data-dev-street]")?.getAttribute("data-tile-state") ?? ""), null, { timeout: 60000 });
          await page.waitForFunction(() => { const m = window.__streetDebug.map(); return !m.isMoving() && m.areTilesLoaded() && !window.__streetDebug.isAnimating(); }, null, { timeout: 60000 });
        } catch (e) {
          console.error(`not ready ${name} ${v} ${theme}`, logs.slice(-3));
          continue;
        }
        // wait until the art image has ink (the first load of a context can screenshot before the first composited frame)
        await page.waitForFunction(() => { const { codes } = window.__streetDebug.readCodes(); for (let i = 0; i < codes.length; i += 7) if (codes[i]) return true; return false; }, null, { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(900);
        const file = `${out}/city-${name}-${v}-${theme}-${tag}.png`;
        await page.screenshot({ path: file });
        // 16-colour palette PNG: the art is a handful of greys, so this loses nothing and keeps the evidence small
        try { execFileSync("python3", ["-c", "import sys;from PIL import Image;i=Image.open(sys.argv[1]).convert('RGB');i.quantize(16,dither=Image.Dither.NONE).save(sys.argv[1],optimize=True)", file]); } catch {}
        console.log(`${name} ${v} ${theme} z${zoom.toFixed(2)} ${(statSync(file).size / 1024).toFixed(0)} KB`);
      }
      await page.context().close();
    }
  }
} finally {
  await browser.close();
  await tiles.stop();
}
