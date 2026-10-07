// Evidence for the sea ease (docs/palette/): the open sea, off a coast, photographed at map zooms from the globe to city scale,
// zooming in AND out (the out run starts at the closest zoom and walks back across the globe-to-street cut). Per frame it measures
// the mean luminance of a patch of open sea and of the page colour, so the tone curve and its largest single step are numbers:
// a pop shows up as one big step, an ease as many small ones. Writes the frames, a contact sheet and a JSON (needs python3 + Pillow).
//
//   BASE_URL=http://localhost:5173 OUT_DIR=docs/palette node apps/web/scripts/street/sea-ease.mjs <tag> [scheme=dark] [place=lisbon] [step=0.25]
//
// Reduced motion is a separate run (RM=1): the same sweep with prefers-reduced-motion, which must be the same picture (the ramp is a
// function of zoom, not of time), and the tile ease must be off.
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { ensureTiles, launch, openApp, setCamera, waitStreetOk } from "../globe/handover-lib.mjs";

/** Camera at rest, tiles loaded, dissolve done (the blend target is a function of zoom while the hard cut shows 0 or 1, so it is not compared). */
async function settle(page) {
  await page.waitForFunction(
    () => {
      const d = window.__handoverDebug;
      if (d.globe.isAnimating()) return false;
      const s = d.street();
      if (!s) return true;
      const m = s.debug().map();
      return !m.isMoving() && m.loaded() && m.areTilesLoaded() && !s.debug().isAnimating();
    },
    null,
    { timeout: 60000 },
  );
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(150);
}

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`${k}=`)) ?? `${k}=${d}`).split("=").slice(1).join("=");
const tag = process.argv[2] ?? "after";
const scheme = arg("scheme", "dark");
const place = arg("place", "lisbon");
const STEP = Number(arg("step", 0.25));
const OUT = process.env.OUT_DIR ?? ".";
const RM = process.env.RM === "1";
// A point in the open sea off the coast (so a patch of sea is in the middle of the frame up to city scale).
const P = { lisbon: { lon: -9.85, lat: 38.55, src: "primary" }, hcmc: { lon: 107.55, lat: 10.2, src: "fallback" } }[place];
const lc = (lat) => Math.log2(Math.cos((lat * Math.PI) / 180));
const dir = `${OUT}/.sea-${tag}-${scheme}`;
mkdirSync(dir, { recursive: true });

const zooms = [];
for (let z = 3; z <= 11 + 1e-9; z += STEP) zooms.push(Math.round(z * 100) / 100);

const tiles = await ensureTiles();
const browser = await launch();
const runs = {};
try {
  for (const direction of ["in", "out"]) {
    const { page } = await openApp(browser, { viewport: { width: 800, height: 500 }, deviceScaleFactor: 1 }, { path: "/", colorScheme: scheme, reducedMotion: RM ? "reduce" : "no-preference", street: { forceSource: P.src } });
    await setCamera(page, { lon: P.lon, lat: P.lat, zoom: 4.3 });
    await waitStreetOk(page);
    const order = direction === "in" ? zooms : [...zooms].reverse();
    const frames = [];
    for (const mz of order) {
      await setCamera(page, { lon: P.lon, lat: P.lat, zoom: mz - lc(P.lat) });
      await settle(page);
      await page.waitForTimeout(250);
      const file = `${dir}/${direction}-${String(mz).padStart(5, "0")}.png`;
      await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 800, height: 500 } });
      // Fill tone, free of line work: the mean palette level over the central cells that are fill (code 3) or empty, lines excluded.
      const st = await page.evaluate(() => {
        const d = window.__handoverDebug;
        const out = { owner: d.owner(), fill: null, lit: null };
        const s = d.owner() === "street" ? d.street() : null;
        const c = s?.debug().readCodes();
        if (c) {
          let sum = 0, n = 0, lit = 0;
          for (let y = Math.floor(c.rows * 0.25); y < Math.floor(c.rows * 0.75); y++) {
            for (let x = Math.floor(c.cols * 0.25); x < Math.floor(c.cols * 0.75); x++) {
              const i = y * c.cols + x;
              if (c.codes[i] === 1 || c.codes[i] === 2) continue;
              n++;
              sum += c.levels[i];
              if (c.levels[i] > 0) lit++;
            }
          }
          out.fill = n ? sum / n : 0;
          out.lit = n ? lit / n : 0;
        }
        return out;
      });
      frames.push({ mapZoom: mz, file, owner: st.owner, fill: st.fill, lit: st.lit });
    }
    runs[direction] = frames;
    await page.context().close();
  }
} finally {
  await browser.close();
  await tiles.stop();
}
writeFileSync(`${dir}/runs.json`, JSON.stringify(runs));
execFileSync("python3", [new URL("./sea-ease.py", import.meta.url).pathname, `${dir}/runs.json`, `${OUT}/sea-ease-${tag}-${scheme}`], { stdio: "inherit" });
