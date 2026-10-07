// Registration of the world-scale country borders (Natural Earth 50m, @catalyst/geodata: the globe draws them, and the street map
// until the hand-over zoom) against the OpenMapTiles country boundary (the street style after the hand-over), both as the street
// style would draw them: disputed and maritime lines left out. For every Natural Earth vertex the distance to the nearest tile line
// is measured and compared with one art cell at the hand-over zoom (the size of a swap that is visible as a jump).
//
//   node scripts/street/border-register.mjs [z=5]   (z: tile zoom to sample; 5 is the first OpenStreetMap-based zoom of OpenFreeMap; z0 to z4 tiles are Natural Earth)
//
// Prints the share of the Natural Earth length within 0.5 / 1 / 2 cells of a tile line, the same for the tile lines against the
// Natural Earth ones (what the tiles draw that the globe does not), and the worst stretches by region. The tiles come from OpenFreeMap
// (global) only the z5 tiles that hold a Natural Earth border vertex are fetched (a few hundred tiles, about 10 MB once).
import { createRequire } from "node:module";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
const S = new URL("../../../../node_modules/.pnpm/", import.meta.url).pathname;
const { VectorTile } = createRequire(`${S}@mapbox+vector-tile@3.0.0/node_modules/@mapbox/vector-tile/package.json`)("@mapbox/vector-tile");
const Pbf = createRequire(`${S}pbf@5.1.2/node_modules/pbf/package.json`)("pbf").PbfReader;
const Z = Number(process.argv.find((a) => /^z=/.test(a))?.slice(2) ?? 5);
const HANDOFF = 5, CELL_CSS = 3; // BORDER_TILE_MINZOOM in street-style.ts
const cellKm = (lat) => ((40075.017 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** HANDOFF)) * CELL_CSS;

// Natural Earth 50m borders (the generator's wire format)
const e = JSON.parse(readFileSync(new URL("../../../../packages/geodata/data/borders-50m.json", import.meta.url)));
const ne = []; { let di = 0; for (const n of e.lengths) { let x = 0, y = 0; const l = []; for (let k = 0; k < n; k++) { x += e.deltas[di++]; y += e.deltas[di++]; l.push([x / e.q, y / e.q]); } ne.push(l); } }

// OpenMapTiles boundary lines as the style draws them
const tj = await (await fetch("https://tiles.openfreemap.org/planet")).json();
const osm = [];
const n = 2 ** Z;
const wanted = new Set();
for (const l of ne) for (const [lon, lat] of l) {
  const la = Math.max(-85, Math.min(85, lat)) * Math.PI / 180;
  wanted.add(`${Math.min(n - 1, Math.floor(((lon + 180) / 360) * n))},${Math.min(n - 1, Math.max(0, Math.floor(((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n)))}`);
}
for (const key of wanted) {
  const [x, y] = key.split(",").map(Number);
  const r = await fetch(tj.tiles[0].replace("{z}", Z).replace("{x}", x).replace("{y}", y));
  if (!r.ok) continue;
  const buf = Buffer.from(await r.arrayBuffer());
  const l = new VectorTile(new Pbf(buf[0] === 0x1f ? gunzipSync(buf) : buf)).layers.boundary;
  for (let i = 0; l && i < l.length; i++) {
    const f = l.feature(i), p = f.properties;
    if (p.admin_level !== 2 || p.maritime === 1 || p.disputed === 1) continue;
    const g = f.toGeoJSON(x, y, Z).geometry;
    for (const line of g.type === "LineString" ? [g.coordinates] : g.coordinates) osm.push(line);
  }
}
const segs = (lines) => lines.flatMap((l) => l.slice(1).map((p, i) => [l[i], p]));
const toXY = ([lon, lat], lat0) => [lon * Math.cos((lat0 * Math.PI) / 180) * 111.32, lat * 110.57];
function distKm(pt, S2) {
  let best = Infinity;
  const lat0 = pt[1];
  const [px, py] = toXY(pt, lat0);
  for (const [a, b] of S2) {
    if (Math.abs(a[1] - pt[1]) > 6 && Math.abs(b[1] - pt[1]) > 6) continue;
    if (Math.abs(a[0] - pt[0]) > 8 / Math.max(0.2, Math.cos((lat0 * Math.PI) / 180)) && Math.abs(b[0] - pt[0]) > 8 / Math.max(0.2, Math.cos((lat0 * Math.PI) / 180))) continue;
    const [ax, ay] = toXY(a, lat0), [bx, by] = toXY(b, lat0);
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}
// sample every NE vertex and every segment midpoint
const sample = (lines) => lines.flatMap((l) => l.flatMap((p, i) => (i ? [p, [(p[0] + l[i - 1][0]) / 2, (p[1] + l[i - 1][1]) / 2]] : [p])));
function report(label, A, B) {
  const SB = segs(B), rows = { half: 0, one: 0, two: 0, far: 0, total: 0 }, worst = [];
  for (const p of sample(A)) {
    const d = distKm(p, SB), c = cellKm(p[1]);
    rows.total++;
    if (d <= 0.5 * c) rows.half++;
    if (d <= c) rows.one++;
    if (d <= 2 * c) rows.two++;
    if (d > 2 * c) { rows.far++; worst.push([p[0].toFixed(1), p[1].toFixed(1), (d / c).toFixed(1)]); }
  }
  const pc = (v) => `${((100 * v) / rows.total).toFixed(1)} %`;
  console.log(`${label}: ${rows.total} samples, within 0.5 cell ${pc(rows.half)}, within 1 cell ${pc(rows.one)}, within 2 cells ${pc(rows.two)}, farther than 2 cells ${pc(rows.far)}`);
  const cl = new Map();
  for (const [lo, la, d] of worst) { const k = `${Math.round(lo / 5) * 5},${Math.round(la / 5) * 5}`; const c = cl.get(k) ?? { n: 0, max: 0 }; c.n++; c.max = Math.max(c.max, d); cl.set(k, c); }
  console.log("   worst areas (lon,lat 5-degree bins: samples farther than 2 cells, max distance in cells):", [...cl].sort((a, b) => b[1].n - a[1].n).slice(0, 12).map(([k, c]) => `${k}: ${c.n} (${c.max})`).join("  "));
}
console.log(`hand-over zoom ${HANDOFF}, cell = ${CELL_CSS} CSS px = ${cellKm(0).toFixed(1)} km at the equator, ${cellKm(48).toFixed(1)} km at 48 N; OSM lines from z${Z} tiles: ${osm.length}`);
report("Natural Earth (globe, world-borders) vs tile lines", ne, osm);
report("tile lines (style) vs Natural Earth", osm, ne);
