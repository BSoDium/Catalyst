// Registration of the globe's border dataset (@catalyst/geodata borders-50m) against the street map's boundary lines (OpenMapTiles
// admin_level 2, not disputed, not maritime: what the street style draws after the hand-over). Same method as
// scripts/street/border-register.mjs (every vertex and segment midpoint, distance to the nearest line, in art cells at the
// hand-over zoom), plus the frontier-by-frontier list of what differs, labelled with country pairs.
//
//   node scripts/geo/border-register.mjs [--data <geodata json>] [--ne <ne lines geojson> --report <report.json>] [--cache <dir>]
//
// --data   a dataset in the geodata wire format (default packages/geodata/data/borders-50m.json); run it on the committed file and on
//          an older copy (git show HEAD:packages/geodata/data/borders-50m.json) to get the before / after numbers.
// --ne / --report  label differences with the country pair of the nearest Natural Earth feature (report.json: see border-osm.mjs).
import { readFileSync } from "node:fs";
import { cellKm, densify, lengthKm, lineIndex, osmBoundaries, readGeodata, readNaturalEarth } from "./_osm.mjs";

const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const dataPath = arg("--data") ?? new URL("../../../../packages/geodata/data/borders-50m.json", import.meta.url).pathname;
const data = readGeodata(dataPath);
const ne = arg("--ne") ? readNaturalEarth(arg("--ne")) : null;
const report = arg("--report") ? JSON.parse(readFileSync(arg("--report"), "utf8")) : null;

const tilesFrom = ne ? [...data, ...ne.flatMap((f) => f.lines)] : data;
const osm = (await osmBoundaries(tilesFrom, arg("--cache"))).land;
const osmOwn = ne ? (await osmBoundaries(data, arg("--cache"))).land : osm;
const dataIdx = lineIndex(data);

// The samples of the old script: every vertex and every segment midpoint.
const sample = (lines) => lines.flatMap((l) => l.flatMap((p, i) => (i ? [p, [(p[0] + l[i - 1][0]) / 2, (p[1] + l[i - 1][1]) / 2]] : [p])));
function stats(label, A, ixB) {
  const pts = sample(A);
  let half = 0, one = 0, two = 0;
  for (const p of pts) { const d = ixB.dist(p), c = cellKm(p[1]); if (d <= 0.5 * c) half++; if (d <= c) one++; if (d <= 2 * c) two++; }
  const pc = (v) => `${((100 * v) / pts.length).toFixed(1)} %`;
  console.log(`${label}: ${pts.length} samples, within 0.5 cell ${pc(half)}, within 1 cell ${pc(one)}, within 2 cells ${pc(two)}, farther than 2 cells ${pc(pts.length - two)}`);
}
console.log(`dataset ${dataPath}: ${data.length} lines, ${data.reduce((s, l) => s + l.length, 0)} vertices, ${Math.round(lengthKm(data))} km; OSM land lines in the tiles: ${osm.length}`);
stats("globe borders vs street-map land lines (precision)", data, lineIndex(osmOwn));
stats("street-map land lines vs globe borders, tiles that hold a globe vertex (recall, the old script's figure)", osmOwn, dataIdx);
if (ne) stats("street-map land lines vs globe borders, all tiles incl. where Natural Earth lines are dropped (recall)", osm, dataIdx);

if (ne && report) {
  // Label a point with the pair of the nearest Natural Earth feature (any class).
  const feats = ne.map((f, i) => ({ i, ix: lineIndex(f.lines), pair: report[i].pair || "?", cls: report[i].cls }));
  const label = (p) => { let b = null, bd = Infinity; for (const f of feats) { const d = f.ix.dist(p); if (d < bd) { bd = d; b = f; } } return bd < 60 ? `${b.pair}${b.cls.startsWith("Inter") ? "" : ` [${b.cls.replace(/ \(.*/, "").toLowerCase()}]`}` : "(no Natural Earth line within 60 km)"; };
  const far = (lines, ix) => { const m = new Map(); for (const p of densify(lines, 5)) { if (ix.dist(p) > 2 * cellKm(p[1])) { const k = label(p); m.set(k, (m.get(k) ?? 0) + 5); } } return [...m].filter(([, km]) => km >= 15).sort((a, b) => b[1] - a[1]); };
  console.log("\nthe street map draws it, the globe dataset does not (more than 2 cells away, km):");
  for (const [k, km] of far(osm, dataIdx)) console.log(`  ${km.toString().padStart(5)} km  ${k}`);
  console.log("\nthe globe dataset draws it, the street map does not (km):");
  for (const [k, km] of far(data, lineIndex(osm))) console.log(`  ${km.toString().padStart(5)} km  ${k}`);
}
