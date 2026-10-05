// How well do the Three.js globe camera and MapLibre's globe camera register at the same view?
// For each (lat, zoom): project a 5x5 grid of lon/lat points (+-8 deg around the centre) with both engines and report the
// mean and max screen distance in CSS px, for the raw zoom and for the 1/cos(lat) compensated zoom.
// needs: globe prototype on :5180 (pnpm --filter @catalyst/prototype-globe dev) and street-zoom on :5190
import { launch, open } from "./lib.mjs";

const cases = [[10.8, 2.6], [10.8, 3.5], [10.8, 4.5], [40, 3.0], [40, 4.0], [60, 3.0]];
const lon0 = 106;
const pts = [];
for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) pts.push([lon0 + i * 4, 0 + j * 4]);
const { browser, page } = await launch({ w: 1440, h: 900, dpr: 1 });
const out = [];
try {
  for (const [lat, z] of cases) {
    const P = pts.map(([lo, la]) => [lo, lat + la]).filter(([, la]) => Math.abs(la) < 80);
    await page.goto(`http://localhost:5180/?renderer=three&theme=dark&view=${lon0},${lat},${z}`);
    await page.waitForTimeout(1500);
    const three = await page.evaluate((P) => P.map(([lo, la]) => { const p = window.__app.renderer.project(lo, la); return [p.x, p.y, p.visible ?? true]; }), P);
    const zc = z + Math.log2(Math.cos((lat * Math.PI) / 180));
    const res = {};
    for (const [name, zz] of [["raw", z], ["compensated", zc]]) {
      await open(page, `theme=dark&bench=1&comp=none&view=${lon0},${lat},${zz}`);
      const ours = await page.evaluate((P) => P.map(([lo, la]) => { const p = window.__app.street.map.project([lo, la]); return [p.x, p.y]; }), P);
      const d = three.map((t, i) => (t[2] ? Math.hypot(t[0] - ours[i][0], t[1] - ours[i][1]) : null)).filter((x) => x !== null);
      res[name] = { zoomUsed: +zz.toFixed(3), meanPx: +(d.reduce((a, b) => a + b, 0) / d.length).toFixed(2), maxPx: +Math.max(...d).toFixed(2), n: d.length };
    }
    out.push({ lat, zoom: z, ...res });
  }
  console.log(JSON.stringify(out, null, 1));
} finally {
  await browser.close();
}
