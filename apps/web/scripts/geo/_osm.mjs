// Shared helpers of the border registration scripts (scripts/geo/*): the OpenMapTiles boundary lines as the street style draws them
// (OpenFreeMap z5 tiles, cached on disk), a distance index, and the Natural Earth / geodata readers. Plain node, no browser.
import { createRequire } from "node:module";
import { gunzipSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const STORE = new URL("../../../../node_modules/.pnpm/", import.meta.url).pathname;
const { VectorTile } = createRequire(`${STORE}@mapbox+vector-tile@3.0.0/node_modules/@mapbox/vector-tile/package.json`)("@mapbox/vector-tile");
const Pbf = createRequire(`${STORE}pbf@5.1.2/node_modules/pbf/package.json`)("pbf").PbfReader;

/** Tile zoom sampled (the first OpenStreetMap-based zoom of OpenFreeMap) and the street style's hand-over zoom / art cell. */
export const TILE_Z = 5;
export const HANDOFF = 5;
export const CELL_CSS = 3;
export const cellKm = (lat) => ((40075.017 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** HANDOFF)) * CELL_CSS;

/** The committed geodata wire format (packages/geodata/src/format.ts) as arrays of [lon, lat] lines. */
export function readGeodata(file) {
  const e = JSON.parse(readFileSync(file, "utf8"));
  const out = [];
  let di = 0;
  for (const n of e.lengths) {
    let x = 0, y = 0;
    const l = [];
    for (let k = 0; k < n; k++) { x += e.deltas[di++]; y += e.deltas[di++]; l.push([x / e.q, y / e.q]); }
    out.push(l);
  }
  return out;
}

/** Natural Earth boundary-line features: [{ cls, id, lines }]. */
export function readNaturalEarth(file) {
  return JSON.parse(readFileSync(file, "utf8")).features.map((f) => ({
    cls: f.properties.FEATURECLA,
    id: f.properties.NE_ID,
    brk: f.properties.BRK_A3,
    lines: f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates,
  }));
}

const tileXY = (lon, lat, n) => {
  const la = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return [Math.min(n - 1, Math.floor(((lon + 180) / 360) * n)), Math.min(n - 1, Math.max(0, Math.floor(((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n)))];
};

/**
 * OpenMapTiles boundary lines (admin_level 2) from the z5 tiles holding any of `lines`. Returns `{ land, disputed, maritime }`,
 * each an array of lines. `land` is exactly what the street style draws. Tiles are cached in `cacheDir`.
 */
export async function osmBoundaries(lines, cacheDir = join(tmpdir(), "catalyst-border-tiles")) {
  mkdirSync(cacheDir, { recursive: true });
  const tj = await (await fetch("https://tiles.openfreemap.org/planet")).json();
  const n = 2 ** TILE_Z;
  const wanted = new Set();
  for (const l of lines) for (const [lon, lat] of l) {
    const [x, y] = tileXY(lon, lat, n);
    wanted.add(`${x},${y}`);
  }
  const out = { land: [], disputed: [], maritime: [] };
  for (const key of wanted) {
    const [x, y] = key.split(",").map(Number);
    const cache = join(cacheDir, `${TILE_Z}-${x}-${y}.pbf`);
    let buf;
    if (existsSync(cache)) buf = readFileSync(cache);
    else {
      const r = await fetch(tj.tiles[0].replace("{z}", TILE_Z).replace("{x}", x).replace("{y}", y));
      if (!r.ok) continue;
      buf = Buffer.from(await r.arrayBuffer());
      writeFileSync(cache, buf);
    }
    const layer = new VectorTile(new Pbf(buf[0] === 0x1f ? gunzipSync(buf) : buf)).layers.boundary;
    for (let i = 0; layer && i < layer.length; i++) {
      const f = layer.feature(i);
      const p = f.properties;
      if (p.admin_level !== 2) continue;
      const g = f.toGeoJSON(x, y, TILE_Z).geometry;
      const kind = p.maritime === 1 ? "maritime" : p.disputed === 1 ? "disputed" : "land";
      for (const line of g.type === "LineString" ? [g.coordinates] : g.coordinates) out[kind].push(line);
    }
  }
  return out;
}

const KM_LAT = 110.57;
const KM_LON = 111.32;
/** Spatial index of line segments answering "distance in km from a point to the nearest line" (equirectangular, fine at a few km). */
export function lineIndex(lines, cell = 2) {
  const segs = [];
  const grid = new Map();
  for (const l of lines) for (let i = 1; i < l.length; i++) {
    const a = l[i - 1], b = l[i];
    const id = segs.push([a, b]) - 1;
    for (let x = Math.floor(Math.min(a[0], b[0]) / cell); x <= Math.floor(Math.max(a[0], b[0]) / cell); x++)
      for (let y = Math.floor(Math.min(a[1], b[1]) / cell); y <= Math.floor(Math.max(a[1], b[1]) / cell); y++) {
        const k = `${x},${y}`;
        const cur = grid.get(k);
        if (cur) cur.push(id); else grid.set(k, [id]);
      }
  }
  return {
    /** Distance in km (Infinity when nothing within ~2 grid cells). */
    dist(pt) {
      const c = Math.cos((pt[1] * Math.PI) / 180) * KM_LON;
      const px = pt[0] * c, py = pt[1] * KM_LAT;
      const gx = Math.floor(pt[0] / cell), gy = Math.floor(pt[1] / cell);
      let best = Infinity;
      const seen = new Set();
      const span = Math.ceil(2 / Math.max(0.2, Math.cos((pt[1] * Math.PI) / 180)));
      for (let dx = -span; dx <= span; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const id of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
          if (seen.has(id)) continue;
          seen.add(id);
          const [a, b] = segs[id];
          const ax = a[0] * c, ay = a[1] * KM_LAT, bx = b[0] * c, by = b[1] * KM_LAT;
          const ddx = bx - ax, ddy = by - ay, L = ddx * ddx + ddy * ddy;
          const t = L ? Math.max(0, Math.min(1, ((px - ax) * ddx + (py - ay) * ddy) / L)) : 0;
          best = Math.min(best, Math.hypot(px - ax - t * ddx, py - ay - t * ddy));
        }
      }
      return best;
    },
  };
}

/** Points every `stepKm` along the lines (vertices included). */
export function densify(lines, stepKm = 2) {
  const out = [];
  for (const l of lines) {
    for (let i = 1; i < l.length; i++) {
      const a = l[i - 1], b = l[i];
      const d = Math.hypot((b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180) * KM_LON, (b[1] - a[1]) * KM_LAT);
      const n = Math.max(1, Math.ceil(d / stepKm));
      for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
    if (l.length) out.push(l[l.length - 1]);
  }
  return out;
}

export const lengthKm = (lines) => lines.reduce((s, l) => s + l.slice(1).reduce((t, p, i) => t + Math.hypot((p[0] - l[i][0]) * Math.cos((p[1] * Math.PI) / 180) * KM_LON, (p[1] - l[i][1]) * KM_LAT), 0), 0);
export const bboxOf = (lines) => lines.flat().reduce((a, [x, y]) => [Math.min(a[0], x), Math.min(a[1], y), Math.max(a[2], x), Math.max(a[3], y)], [1e9, 1e9, -1e9, -1e9]);
