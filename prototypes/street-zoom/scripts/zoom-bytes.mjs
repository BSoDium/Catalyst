// Compressed bytes per zoom level of a local PMTiles archive (walks every tile of the bounds through the public API).
import { open } from "node:fs/promises";
import { PMTiles } from "pmtiles";

const path = process.argv[2] ?? "public/hcmc.pmtiles";
// optional: sub-box as "lon,lat,halfKm" and max zoom, e.g. `106.70,10.776,10 15`: what an extract of just that box would weigh
const sub = process.argv[3]?.split(",").map(Number);
const maxZ = process.argv[4] ? Number(process.argv[4]) : 99;
const fh = await open(path, "r");
const source = {
  getKey: () => path,
  async getBytes(offset, length) {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, offset);
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + bytesRead) };
  },
};
// count raw (still gzip-compressed) tile bytes: pass-through decompressor
const raw = async (data) => data;
const p = new PMTiles(source, undefined, raw);
const h = await p.getHeader();
const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z);
const rows = [];
let total = 0;
let box = { minLon: h.minLon, maxLon: h.maxLon, minLat: h.minLat, maxLat: h.maxLat };
if (sub) {
  const [lon, lat, km] = sub;
  const dLat = km / 111.32, dLon = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  box = { minLon: lon - dLon, maxLon: lon + dLon, minLat: lat - dLat, maxLat: lat + dLat };
}
for (let z = h.minZoom; z <= Math.min(h.maxZoom, maxZ); z++) {
  let n = 0, bytes = 0, max = 0;
  const x0 = lon2x(box.minLon, z), x1 = lon2x(box.maxLon, z), y0 = lat2y(box.maxLat, z), y1 = lat2y(box.minLat, z);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    const t = await p.getZxy(z, x, y);
    if (t) { n++; bytes += t.data.byteLength; max = Math.max(max, t.data.byteLength); }
  }
  total += bytes;
  rows.push({ z, tiles: n, KB: Math.round(bytes / 1024), avgKB: n ? +(bytes / n / 1024).toFixed(1) : 0, maxKB: +(max / 1024).toFixed(1) });
}
console.table(rows);
console.log("total tile bytes MB", (total / 1048576).toFixed(2));
await fh.close();
