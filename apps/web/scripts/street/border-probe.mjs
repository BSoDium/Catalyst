// Dump the attributes of the OpenMapTiles `boundary` layer around a point, per zoom (what the style has to choose from).
//   node scripts/street/border-probe.mjs [lon,lat] [zooms]      e.g. node scripts/street/border-probe.mjs -13,24 3,5,7,9
// Uses OpenFreeMap's planet tiles (a handful of tiles per run) and @mapbox/vector-tile from the pnpm store.
import { createRequire } from "node:module";
import { gunzipSync } from "node:zlib";
const req = createRequire(new URL("../../../../node_modules/.pnpm/@mapbox+vector-tile@3.0.0/node_modules/@mapbox/vector-tile/", import.meta.url).pathname + "package.json");
const { VectorTile } = req("@mapbox/vector-tile");
const PbfMod = createRequire(new URL("../../../../node_modules/.pnpm/pbf@5.1.2/node_modules/pbf/package.json", import.meta.url).pathname)("pbf");
const Pbf = PbfMod.PbfReader;
const [lon, lat] = (process.argv[2] ?? "-13,24").split(",").map(Number);
const zooms = (process.argv[3] ?? "3,5,7,9").split(",").map(Number);
const tj = await (await fetch("https://tiles.openfreemap.org/planet")).json();
const url = tj.tiles[0];
const tile = (z) => { const n = 2 ** z; return [Math.floor(((lon + 180) / 360) * n), Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n)]; };
for (const z of zooms) {
  const [x, y] = tile(z);
  const buf = Buffer.from(await (await fetch(url.replace("{z}", z).replace("{x}", x).replace("{y}", y))).arrayBuffer());
  const raw = buf[0] === 0x1f ? gunzipSync(buf) : buf;
  const vt = new VectorTile(new Pbf(raw));
  const layer = vt.layers.boundary;
  const groups = new Map();
  for (let i = 0; layer && i < layer.length; i++) {
    const f = layer.feature(i);
    const p = f.properties;
    const key = JSON.stringify({ admin_level: p.admin_level, disputed: p.disputed, maritime: p.maritime, claimed_by: p.claimed_by, disputed_name: p.disputed_name, adm0_l: p.adm0_l, adm0_r: p.adm0_r, class: p.class });
    const g = groups.get(key) ?? { n: 0, pts: 0 };
    g.n++; g.pts += f.loadGeometry().reduce((a, r) => a + r.length, 0);
    groups.set(key, g);
  }
  console.log(`z${z} tile ${x}/${y}: ${layer ? layer.length : 0} features`);
  for (const [k, g] of groups) console.log("   ", k, `x${g.n}`, `${g.pts} pts`);
}
