// Captures the planet for the share image: the app's own globe, at night over Europe and Africa, with the sun and its lens flare in the picture
// (1200 x 630, `scripts/brand/og-planet.png`). It is a photograph of the real renderer, not a drawing, so it is made from a running app and the
// result is committed; `build.mjs` embeds it in `og.svg` and nothing else here is needed to rebuild the share image.
//
//   pnpm --filter @catalyst/web build && pnpm --filter @catalyst/web start      (any content mode: the planet shows no data)
//   CHROME_PATH=/path/to/chrome node scripts/brand/og-planet.mjs [--base=http://localhost:3000]
//
// The camera is set through the globe's debug hooks (`?globe-debug`, the same ones the browser checks use). The sun is fixed in the sky and
// only comes into the picture when the camera is turned `DLON` degrees from the opening one (which keeps it 52 degrees to its right); the
// earth is then rotated under the camera (`setSkyEra`) so that Europe, not whichever ocean the clock leaves there, is what faces it.
// The clock still sets the sun's declination (a few degrees over the season), so a re-capture in another month moves the flare a little.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { DEFAULT_CHROME } from "../perf/lib.mjs";

const base = (process.argv.find((a) => a.startsWith("--base="))?.slice("--base=".length) ?? "http://localhost:3000").replace(/\/$/, "");
const out = fileURLToPath(new URL("./og-planet.png", import.meta.url));

/** The share image's size, and where the planet's middle is in it (px): the right two thirds, the name has the left third. */
const OG = { width: 1200, height: 630, planetX: 760, planetY: 315 };
/** The camera: turned this many degrees west of the opening one (the sun comes in at the upper right), tilted, and at this zoom (the planet is about 520 px wide). */
const DLON = -112;
const LAT = 20;
const ZOOM = 1.6;
/** The longitude the earth is turned to face the camera: Warsaw is at 21 degrees east. */
const FACING_LON = 18;
/** A viewport larger than the picture: the home screen lifts the planet by an amount that depends on the window, so the planet is found and the picture cut round it. */
const VIEWPORT = { width: 1700, height: 1000 };

const executablePath = process.env.CHROME_PATH ?? DEFAULT_CHROME;
if (!existsSync(executablePath)) throw new Error("Set CHROME_PATH to a Chrome/Chromium executable");
const browser = await chromium.launch({ executablePath, headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1, bypassCSP: true, colorScheme: "dark" });
await page.goto(`${base}/?globe-debug&sky&moon&live-sun&ring&showcase`);
await page.waitForFunction(() => window.__globeDebug?.view, null, { timeout: 90_000 });
await page.waitForTimeout(4000);
// Only the globe's canvases stay: the page, the hero, the ring of type (canvas 1) and the caption (canvas 3) are hidden.
await page.addStyleTag({ content: "body *{visibility:hidden!important} canvas{visibility:visible!important} [data-slot=landing-hero]{display:none!important} html,body{background:#0a0a0a!important}" });
await page.evaluate(() => {
  const canvases = [...document.querySelectorAll("canvas")];
  for (const i of [1, 3]) canvases[i]?.style.setProperty("visibility", "hidden", "important");
});
await page.waitForTimeout(1500);
const { view, era } = await page.evaluate(() => ({ view: __globeDebug.view(), era: __globeDebug.sky().era }));
const turned = view.lon + DLON;
await page.evaluate(
  ([lon, lat, zoom, newEra]) => {
    const g = __globeDebug;
    g.setSkyEra(newEra);
    g.setView({ lon, lat, zoom });
    g.settle?.();
  },
  [FACING_LON, LAT, ZOOM, era + (turned - FACING_LON)],
);
await page.waitForTimeout(2500);
// The planet's middle on the screen: the globe is centred in the window, then lifted by the hero's cover (measured once at this zoom: 397 px from the top in a 1000 px window).
const middle = { x: VIEWPORT.width / 2, y: 397 };
await page.screenshot({ path: out, type: "png", clip: { x: middle.x - OG.planetX, y: middle.y - OG.planetY, width: OG.width, height: OG.height } });
await browser.close();
console.log(`og-planet.png  ${OG.width}x${OG.height}`);
