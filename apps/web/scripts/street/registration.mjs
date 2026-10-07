// How well do the Three.js globe camera model (engine/geo.ts, the model of the production globe) and the live MapLibre
// globe agree once the zoom is corrected by log2(cos(lat))? (docs/street-zoom-spike.md claims 1.3 px mean, 2.1 px max.)
// For each (lat, globe zoom): project a 5x5 grid (+-8 degrees) with both and report the screen distance in CSS px,
// raw and corrected. Exit 1 if a corrected case at globe zoom >= 3.5 has a mean over 2 px.
//   BASE_URL=... node apps/web/scripts/street/registration.mjs
import { launch, open, dev, waitReady, settle } from "./_lib.mjs";

const cases = [[10.8, 2.6], [10.8, 3.5], [10.8, 4.5], [10.8, 5.5], [40, 3.0], [40, 4.0], [40, 5.5], [60, 3.0], [60, 5.5]];
const lon0 = 106;
const grid = [];
for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) grid.push([lon0 + i * 4, j * 4]);
const browser = await launch();
const out = [];
let bad = 0;
try {
  const { page } = await open(browser, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(dev("/dev/street", { source: "fallback", hud: 0, view: "106,10.8,3", projection: "globe" }));
  await waitReady(page);
  for (const [lat, z] of cases) {
    const pts = grid.map(([lo, la]) => [lo, lat + la]).filter(([, la]) => Math.abs(la) < 80);
    const res = await page.evaluate(
      ({ lat, z, pts, lon0 }) => {
        const m = window.__streetDebug.map();
        const three = window.__streetDev.threeProject({ lon: lon0, lat, zoom: z }, pts, innerWidth, innerHeight);
        const run = (zoom) => {
          m.jumpTo({ center: [lon0, lat], zoom });
          m.redraw();
          const d = pts.map(([lo, la], i) => {
            const p = m.project([lo, la]);
            return three[i].visible ? Math.hypot(three[i].x - p.x, three[i].y - p.y) : null;
          }).filter((x) => x !== null);
          return { zoomUsed: +zoom.toFixed(3), mean: +(d.reduce((a, b) => a + b, 0) / d.length).toFixed(4), max: +Math.max(...d).toFixed(4), n: d.length };
        };
        return { raw: run(z), corrected: run(z + Math.log2(Math.cos((lat * Math.PI) / 180))) };
      },
      { lat, z, pts, lon0 },
    );
    out.push({ lat, globeZoom: z, ...res });
    if (z >= 3.5 && res.corrected.mean > 2) bad++;
  }
} finally {
  await browser.close();
}
console.log("lat   zoom   raw mean/max px        corrected mean/max px");
for (const r of out) console.log(`${String(r.lat).padEnd(5)} ${String(r.globeZoom).padEnd(5)}  ${String(r.raw.mean).padStart(6)} / ${String(r.raw.max).padEnd(7)}      ${String(r.corrected.mean).padStart(6)} / ${r.corrected.max}`);
if (bad) {
  console.error(`${bad} corrected case(s) over 2 px mean`);
  process.exit(1);
}
