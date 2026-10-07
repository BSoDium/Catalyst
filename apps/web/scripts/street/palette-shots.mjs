// Evidence shots for the palette / pattern work (docs/palette/): the same views in light and dark, with a tag in the file name.
//
//   BASE_URL=http://localhost:5173 OUT_DIR=docs/palette node apps/web/scripts/street/palette-shots.mjs <tag> [views=paris-city,paris-street,lisbon-district,world,...] [schemes=light,dark]
//
// Views: <slug>-sel (the place selected as a click would, city-wide framing, panel closed), <place>-z<map zoom> (camera only), world.
import { mkdirSync } from "node:fs";
import { DESKTOP, ensureTiles, launch, openApp, setCamera, settleApp, waitStreetOk } from "../globe/handover-lib.mjs";

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`${k}=`)) ?? `${k}=${d}`).split("=").slice(1).join("=");
const tag = process.argv[2] ?? "after";
const VIEWS = arg("views", "paris-sel,paris-z10.5,lisbon-z13,lisbon-z15.5,world").split(",");
const SCHEMES = arg("schemes", "light,dark").split(",");
const OUT = process.env.OUT_DIR ?? ".";
const SIZE = { viewport: { width: 1000, height: 640 }, deviceScaleFactor: 1 };
const P = { paris: { lon: 2.3522, lat: 48.8566, src: "primary" }, lisbon: { lon: -9.1393, lat: 38.7139, src: "primary" }, hcmc: { lon: 106.6985, lat: 10.7745, src: "fallback" } };
const lc = (lat) => Math.log2(Math.cos((lat * Math.PI) / 180));
mkdirSync(OUT, { recursive: true });

const tiles = await ensureTiles();
const browser = await launch();
try {
  for (const scheme of SCHEMES) {
    for (const view of VIEWS) {
      const [place, what] = view.split("-");
      const p = P[place] ?? P.paris;
      const { page } = await openApp(browser, SIZE, { path: "/", colorScheme: scheme, street: { forceSource: p.src, tileFade: false } });
      if (view === "world") {
        await setCamera(page, { lon: 8, lat: 47, zoom: 1.6 });
        await settleApp(page);
      } else {
        await setCamera(page, { lon: p.lon, lat: p.lat, zoom: 4.3 });
        await waitStreetOk(page);
        if (what === "sel") {
          await page.evaluate((s) => window.__handoverDebug.select(s), place === "paris" ? "paris" : place);
        } else {
          await setCamera(page, { lon: p.lon, lat: p.lat, zoom: Number(what.slice(1)) - lc(p.lat) });
        }
        await settleApp(page);
        await page.waitForTimeout(600);
        await settleApp(page);
      }
      const name = `${view}-${scheme}-${tag}`;
      await page.screenshot({ path: `${OUT}/${name}.png` });
      console.log(name);
      await page.context().close();
    }
  }
} finally {
  await browser.close();
  await tiles.stop();
}
