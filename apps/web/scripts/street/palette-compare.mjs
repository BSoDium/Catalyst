// Palette comparison: the same frames with 4, 6, 8 and 10 levels, light and dark, Lisbon and Ho Chi Minh City at city-wide
// (z10.5), district (z13), street (z15.5) scale, plus a world frame (the globe, borders mid-fade). Writes small PNGs and
// contact sheets (needs python3 + Pillow for the sheets).
//
//   BASE_URL=http://localhost:5175 OUT_DIR=docs/palette node apps/web/scripts/street/palette-compare.mjs [levels=4,6,8,10] [places=hcmc,lisbon]
//
// Lisbon uses the real OpenFreeMap primary (network), Ho Chi Minh City the local PMTiles archive (serve-tiles.mjs, :5240).
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { DESKTOP, ensureTiles, launch, openApp, setCamera, settleApp, waitStreetOk } from "../globe/handover-lib.mjs";

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`${k}=`)) ?? `${k}=${d}`).split("=")[1];
const LEVELS = arg("levels", "4,6,8,10").split(",").map(Number);
const PLACES = arg("places", "hcmc,lisbon").split(",");
const OUT = `${process.env.OUT_DIR ?? "."}`;
const FRAMES_DIR = `${OUT}/frames`;
mkdirSync(FRAMES_DIR, { recursive: true });

const P = { hcmc: { lon: 106.6985, lat: 10.7745, src: "fallback" }, lisbon: { lon: -9.1393, lat: 38.7139, src: "primary" } };
const SCALES = [["city", 10.5], ["district", 13], ["street", 15.5]];
const lc = (lat) => Math.log2(Math.cos((lat * Math.PI) / 180));
const VIEW = { viewport: { width: 1000, height: 640 }, deviceScaleFactor: 1 };
const CLIP = { x: 260, y: 170, width: 480, height: 300 };

const tiles = await ensureTiles();
const browser = await launch();
const names = [];
try {
  for (const n of LEVELS) {
    for (const scheme of ["light", "dark"]) {
      for (const place of PLACES) {
        const p = P[place];
        const { page } = await openApp(browser, VIEW, { path: "/", colorScheme: scheme, street: { forceSource: p.src, tileFade: false }, levels: n });
        await setCamera(page, { lon: p.lon, lat: p.lat, zoom: 4.3 });
        await waitStreetOk(page);
        for (const [scale, zm] of SCALES) {
          await setCamera(page, { lon: p.lon, lat: p.lat, zoom: zm - lc(p.lat) });
          await settleApp(page);
          const name = `${place}-${scale}-n${n}-${scheme}`;
          await page.screenshot({ path: `${FRAMES_DIR}/${name}.png`, clip: CLIP });
          names.push(name);
        }
        if (place === PLACES[0]) {
          // the world frame: Europe on the globe with the borders half way through their fade (internal zoom 3.25)
          await setCamera(page, { lon: 8, lat: 47, zoom: 3.25 });
          await settleApp(page);
          const name = `world-n${n}-${scheme}`;
          await page.screenshot({ path: `${FRAMES_DIR}/${name}.png`, clip: CLIP });
          names.push(name);
        }
        await page.context().close();
      }
    }
  }
} finally {
  await browser.close();
  await tiles.stop();
}
console.log(`${names.length} frames in ${FRAMES_DIR}`);
try {
  execFileSync("python3", [new URL("palette-sheets.py", import.meta.url).pathname, FRAMES_DIR, OUT, LEVELS.join(","), PLACES.join(",")], { stdio: "inherit" });
} catch (e) {
  console.error("contact sheets not built:", e.message);
}
