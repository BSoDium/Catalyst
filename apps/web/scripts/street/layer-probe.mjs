// Which classes does each OpenMapTiles layer hold at each tile zoom around a point (what the style can draw at a map zoom: MapLibre draws
// the tiles of zoom floor(map zoom)). The data bound of every level-of-detail class in street/style/lod.ts.
//   node scripts/street/layer-probe.mjs [lon,lat] [zooms] [layers]     e.g. node scripts/street/layer-probe.mjs 2.35,48.85 3,4,5,6,7,8,9,10,11 water,park,waterway,transportation
// OpenFreeMap planet tiles (a handful of tiles per run), @mapbox/vector-tile from the pnpm store.
import { createRequire } from "node:module";
import { gunzipSync } from "node:zlib";
const S = new URL("../../../../node_modules/.pnpm/", import.meta.url).pathname;
const { VectorTile } = createRequire(`${S}@mapbox+vector-tile@3.0.0/node_modules/@mapbox/vector-tile/package.json`)("@mapbox/vector-tile");
const Pbf = createRequire(`${S}pbf@5.1.2/node_modules/pbf/package.json`)("pbf").PbfReader;
const [lon, lat] = (process.argv[2] ?? "2.35,48.85").split(",").map(Number);
const zooms = (process.argv[3] ?? "3,4,5,6,7,8,9,10,11,12").split(",").map(Number);
const layers = (process.argv[4] ?? "water,park,landcover,waterway,transportation,boundary").split(",");
const tj = await (await fetch("https://tiles.openfreemap.org/planet")).json();
const url = tj.tiles[0];
const tile = (z) => { const n = 2 ** z; return [Math.floor(((lon + 180) / 360) * n), Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n)]; };
for (const z of zooms) {
  const [x, y] = tile(z);
  const buf = Buffer.from(await (await fetch(url.replace("{z}", z).replace("{x}", x).replace("{y}", y))).arrayBuffer());
  const vt = new VectorTile(new Pbf(buf[0] === 0x1f ? gunzipSync(buf) : buf));
  const out = [];
  for (const name of layers) {
    const l = vt.layers[name];
    if (!l) { out.push(`${name}: -`); continue; }
    const by = new Map();
    for (let i = 0; i < l.length; i++) {
      const p = l.feature(i).properties;
      const k = p.class ?? p.kind ?? "?";
      by.set(k, (by.get(k) ?? 0) + 1);
    }
    out.push(`${name}: ${[...by].map(([k, n]) => `${k}=${n}`).join(" ")}`);
  }
  console.log(`z${z} ${x}/${y}  ${out.join(" | ")}`);
}
