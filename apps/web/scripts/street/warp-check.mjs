// The camera-delta warp of the temporal ease (core/warp.ts), checked against MapLibre's own projection. For random pairs of cameras
// (a pan and a zoom between two frames, at map zooms from the globe to street scale) a grid of ground points is projected by the
// map at camera A and at camera B; the mesh built for (A, B) must send every point's cell at B to its cell at A. The error is in
// art cells (the unit the ease works in: a line moves by one cell, the match radius is two).
//
//   BASE_URL=http://localhost:5481 node scripts/street/warp-check.mjs          (the dev server serves the TypeScript module to the page)
import { launch, open, dev } from "./_lib.mjs";

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name} ${detail}`);
  if (!ok) failures.push(name);
};

const browser = await launch();
try {
  const { page } = await open(browser, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(dev("/dev/street", { source: "primary", hud: 0, view: "2,46,3" }));
  await page.waitForFunction(() => window.__streetDebug?.map(), null, { timeout: 60000 });
  const rows = await page.evaluate(async () => {
    const W = await import("/app/globe/street/core/warp.ts");
    const dbg = window.__streetDebug;
    const m = dbg.map();
    const box = m.getContainer();
    const cssW = box.clientWidth, cssH = box.clientHeight;
    const cell = dbg.cellCss();
    const cols = Math.ceil(cssW / cell), rows = Math.ceil(cssH / cell);
    const cam = () => { const c = m.getCenter(); const p = m.getPadding(); return { lon: c.lng, lat: c.lat, zoom: m.getZoom(), cx: (cssW + (p.left ?? 0) - (p.right ?? 0)) / 2, cy: (cssH + (p.top ?? 0) - (p.bottom ?? 0)) / 2, cell }; };
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const out = [];
    for (const z of [2.6, 3.2, 4.5, 6, 8, 10, 11, 12.5, 14, 16]) {
      for (const [dz, panCells, label] of [[0, 6, "pan 6 cells"], [0.03, 3, "zoom 0.03 + pan 3"], [0.12, 10, "zoom 0.12 + pan 10"]]) {
        let sum = 0, max = 0, n = 0, bad = 0;
        for (let t = 0; t < 12; t++) {
          const lat = (rnd() - 0.5) * 100, lon = (rnd() - 0.5) * 300;
          const A = { center: [lon, lat], zoom: z };
          const mpc = (512 * 2 ** z) / 360; // css px per degree of longitude (mercator, equator): enough to scale a pan in cells
          const B = { center: [lon + (rnd() - 0.5) * 2 * panCells * cell / (mpc * Math.max(0.2, Math.cos(lat * Math.PI / 180))), lat + (rnd() - 0.5) * 2 * panCells * cell / mpc], zoom: z + (rnd() - 0.3) * dz };
          m.jumpTo(A); m.redraw();
          const camA = cam();
          const pts = [];
          for (let j = 0; j < 7; j++) for (let i = 0; i < 9; i++) pts.push([i / 8 * cssW, j / 6 * cssH]);
          const ll = pts.map(([x, y]) => m.unproject([x, y]));
          const sa = ll.map((p) => m.project(p));
          m.jumpTo(B); m.redraw();
          const camB = cam();
          const sb = ll.map((p) => m.project(p));
          const mesh = W.buildWarpMesh(camA, camB, cols, rows);
          for (let k = 0; k < ll.length; k++) {
            // the cell of this ground point at B, and where the mesh says it was: it must be the cell at A
            const u = sb[k].x / cell, v = sb[k].y / cell;
            if (u < 0 || v < 0 || u >= cols || v >= rows) continue;
            const wp = W.warpPoint(mesh, u, v);
            if (!wp) continue;
            const e = Math.hypot(wp[0] - sa[k].x / cell, wp[1] - sa[k].y / cell);
            // ground that left the globe or is nearly at the horizon at either camera is not a meaningful point
            if (!isFinite(e) || e > 400) { bad++; continue; }
            sum += e; max = Math.max(max, e); n++;
          }
        }
        out.push({ z, label, kind: z >= 10.5 ? "mercator" : "globe", mean: n ? sum / n : NaN, max, n, bad });
      }
    }
    return out;
  });
  for (const r of rows) console.log(`z${String(r.z).padEnd(5)} ${r.kind.padEnd(8)} ${r.label.padEnd(20)} mean ${r.mean.toFixed(3)} cells, max ${r.max.toFixed(3)} (${r.n} points)`);
  const merc = rows.filter((r) => r.kind === "mercator");
  const globe = rows.filter((r) => r.kind === "globe");
  check("mercator model: the mesh agrees with MapLibre's projection to under 0.05 cell (mean) and 0.25 cell (max)", merc.every((r) => r.mean < 0.05 && r.max < 0.25), `(worst mean ${Math.max(...merc.map((r) => r.mean)).toFixed(3)}, worst max ${Math.max(...merc.map((r) => r.max)).toFixed(3)})`);
  check("globe model: the mesh agrees with MapLibre's globe to under 0.3 cell (mean) and 1 cell (max) (the match radius is 2)", globe.every((r) => r.mean < 0.3 && r.max < 1), `(worst mean ${Math.max(...globe.map((r) => r.mean)).toFixed(3)}, worst max ${Math.max(...globe.map((r) => r.max)).toFixed(3)})`);
} finally {
  await browser.close();
}
if (failures.length) {
  console.error(`\n${failures.length} FAILED: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("\nwarp ok");
