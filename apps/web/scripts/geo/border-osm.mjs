// Which Natural Earth boundary-line features does the street map (OpenMapTiles / OpenStreetMap) draw, which does it only carry as a
// disputed or maritime line, and which are not in its data at all? Read-only check of the globe's border source: no browser, no
// source change. For every feature of the Natural Earth boundary-line file the share of its length within one art cell (3 CSS px at
// the hand-over zoom) of an OSM land line (what the street style draws), of an OSM disputed line, of an OSM maritime line.
//
//   node scripts/geo/border-osm.mjs --ne <ne_50m_admin_0_boundary_lines_land.geojson> --report <report.json> [--cache <dir>] [--all] [--emit <osm-evidence.json>]
//
// <report.json> is written by `pnpm --filter @catalyst/geodata generate -- --strict-classes --countries <ne_50m_admin_0_countries.geojson>
// --report-json <file>` (the class rule alone, and the country pair of each feature). Prints the features the class rule drops, then
// the kept ones that the street map does not draw as a land border, and with --all every feature.
//
// --emit writes packages/geodata/scripts/osm-evidence.json, the exceptions the generator applies on top of the class rule so that the
// globe draws exactly what the street map draws (the file is committed, so the generator needs no network access to OSM):
//   keep  a feature the class rule drops but OSM draws as a land border (>= 50 % within one cell and >= 95 % within eight cells of a land line, or >= 90 % within one);
//   drop  a feature the class rule keeps but OSM draws nowhere as a land border (< 10 % within one cell of a land line);
//   cuts  runs of >= 12 km of a kept feature that OSM carries only as a disputed or a maritime line (no land line within two cells).
import { readFileSync, writeFileSync } from "node:fs";
import { bboxOf, cellKm, densify, lengthKm, lineIndex, osmBoundaries, readNaturalEarth } from "./_osm.mjs";

const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const nePath = arg("--ne"), reportPath = arg("--report");
if (!nePath || !reportPath) { console.error("usage: border-osm.mjs --ne <ne lines geojson> --report <report.json> [--cache dir] [--all] [--emit file]"); process.exit(2); }
const KEEP_CLASS = "International boundary (verify)";
const features = readNaturalEarth(nePath);
const report = JSON.parse(readFileSync(reportPath, "utf8"));
const osm = await osmBoundaries(features.flatMap((f) => f.lines), arg("--cache"));
const idx = { land: lineIndex(osm.land), disputed: lineIndex(osm.disputed), maritime: lineIndex(osm.maritime) };
console.log(`OSM admin_level 2 lines in the z5 tiles: ${osm.land.length} land, ${osm.disputed.length} disputed (land), ${osm.maritime.length} maritime`);
const near = (ix, p, cells) => ix.dist(p) <= cells * cellKm(p[1]);
const share = (pts, ix, cells = 1) => (pts.filter((p) => near(ix, p, cells)).length / pts.length) * 100;
const rows = features.map((f, i) => {
  const r = report[i];
  const pts = densify(f.lines, 2);
  return { i, id: f.id, classKeep: f.cls === KEEP_CLASS, cls: f.cls.replace(/ \(.*/, ""), pair: r.pair, km: Math.round(lengthKm(f.lines)), pts, land: share(pts, idx.land), land8: share(pts, idx.land, 8), disputed: share(pts, idx.disputed), maritime: share(pts, idx.maritime), bbox: bboxOf(f.lines).map((v) => v.toFixed(1)).join(",") };
});
const fmt = (r) => `#${String(r.i).padStart(3)} ${r.classKeep ? "KEEP" : "drop"} ${r.cls.padEnd(22)} ${r.pair.padEnd(34)} ${String(r.km).padStart(5)} km  land ${r.land.toFixed(0).padStart(3)}%  disputed ${r.disputed.toFixed(0).padStart(3)}%  maritime ${r.maritime.toFixed(0).padStart(3)}%  [${r.bbox}]`;
console.log("\n== dropped by the class rule");
rows.filter((r) => !r.classKeep).forEach((r) => console.log(fmt(r)));
console.log("\n== kept by the class rule, but under 70 % on an OSM land line (look at these)");
rows.filter((r) => r.classKeep && r.land < 70).sort((a, b) => b.km - a.km).forEach((r) => console.log(fmt(r)));
if (process.argv.includes("--all")) { console.log("\n== all"); rows.forEach((r) => console.log(fmt(r))); }

const keep = rows.filter((r) => !r.classKeep && (r.land >= 90 || (r.land >= 50 && r.land8 >= 95)));
const drop = rows.filter((r) => r.classKeep && r.land < 10);
const dropped = new Set(drop.map((r) => r.i));
const cuts = [];
for (const r of rows) {
  if (dropped.has(r.i) || !(r.classKeep || keep.includes(r))) continue;
  for (const line of features[r.i].lines) {
    const pts = densify([line], 2);
    let cur = null, n = 0, start = null;
    const kind = (p) => (near(idx.land, p, 2) ? "land" : near(idx.disputed, p, 1) ? "disputed" : near(idx.maritime, p, 1) ? "maritime" : "none");
    const flush = (end) => { if ((cur === "disputed" || cur === "maritime") && n * 2 >= 12) cuts.push({ feature: r.i, id: r.id, pair: r.pair, osm: cur, km: n * 2, from: start.map((v) => +v.toFixed(3)), to: end.map((v) => +v.toFixed(3)) }); };
    pts.forEach((p, k) => { const kd = kind(p); if (kd !== cur) { flush(pts[k - 1] ?? p); cur = kd; n = 0; start = p; } n++; });
    flush(pts[pts.length - 1]);
  }
}
const km = (l) => l.reduce((s, r) => s + (r.km ?? 0), 0);
console.log(`\nclass rule: kept ${rows.filter((r) => r.classKeep).reduce((s, r) => s + r.km, 0)} km, dropped ${rows.filter((r) => !r.classKeep).reduce((s, r) => s + r.km, 0)} km`);
console.log(`evidence: ${keep.length} dropped features OSM draws as land (${km(keep)} km), ${drop.length} kept features OSM does not draw as land (${km(drop)} km), ${cuts.length} runs cut (${km(cuts)} km)`);
console.log("  keep:", keep.map((r) => `#${r.i} ${r.pair}`).join("; "));
console.log("  drop:", drop.map((r) => `#${r.i} ${r.pair || "?"} (${r.km} km)`).join("; "));
console.log("  cuts:", cuts.map((c) => `#${c.feature} ${c.pair || "?"} ${c.osm} ${c.km} km`).join("; "));
const out = arg("--emit");
if (out) {
  writeFileSync(out, JSON.stringify({
    source: `Compared with the OpenMapTiles boundary layer (admin_level 2) of OpenFreeMap planet z${5} tiles, ${new Date().toISOString().slice(0, 10)}, tolerance one art cell (3 CSS px at the hand-over zoom 5); regenerate with apps/web/scripts/geo/border-osm.mjs --emit. Feature numbers index the features of the pinned ne_50m_admin_0_boundary_lines_land.geojson (scripts/sources.json).`,
    keep: keep.map((r) => ({ feature: r.i, id: r.id, pair: r.pair, class: r.cls, why: `OSM draws it as a land border (${r.land.toFixed(0)} % within one cell, ${r.land8.toFixed(0)} % within eight)` })),
    drop: drop.map((r) => ({ feature: r.i, id: r.id, pair: r.pair, why: `OSM has no land border here (${r.land.toFixed(0)} % within one cell; maritime ${r.maritime.toFixed(0)} %, disputed ${r.disputed.toFixed(0)} %)` })),
    cuts: cuts.map((c) => ({ ...c, why: `OSM carries this stretch only as a ${c.osm} line` })),
  }, null, 1) + "\n");
  console.log(`wrote ${out}`);
}
