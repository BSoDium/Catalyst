/**
 * The land as a picture: a mask of the continents on an equirectangular grid (longitude along the rows, latitude up the columns, row 0 at the south
 * pole), filled from the coastlines the globe already draws (`@catalyst/geodata`, 110 m). The planet's disc samples it (engine/materials.ts) to fill the
 * continents for the cinematic interlude; made once, when an interlude is planned, off the frame that starts it.
 *
 * Pure (no canvas, no DOM): an even-odd scanline fill of the coastline rings in grid space. The rings that were cut at the antimeridian (Eurasia, Fiji,
 * Chukotka, Antarctica) are closed again: along the antimeridian, which is the grid's own edge, or, for the one that runs all the way round (Antarctica),
 * through the pole.
 */
import type { Polylines } from "@catalyst/geodata";

export const LAND_W = 2048;
export const LAND_H = 1024;

/** The coastline rings as arrays of `[lon, lat]`, each closed (a ring cut at the antimeridian is joined along it, or through the pole). */
export function landRings(p: Polylines): [number, number][][] {
  const rings: [number, number][][] = [];
  for (let i = 0; i < p.offsets.length - 1; i++) {
    const a = p.offsets[i]!;
    const b = p.offsets[i + 1]!;
    if (b - a < 3) continue;
    const ring: [number, number][] = [];
    for (let k = a; k < b; k++) ring.push([p.positions[2 * k]!, p.positions[2 * k + 1]!]);
    const first = ring[0]!;
    const last = ring[ring.length - 1]!;
    const sameEnd = Math.abs(first[0] - last[0]) < 1e-4 && Math.abs(first[1] - last[1]) < 1e-4;
    if (!sameEnd) {
      const atEdge = (x: number) => Math.abs(Math.abs(x) - 180) < 1e-3;
      // a ring that runs from one side of the antimeridian to the other, at the same latitude: it goes round the pole (Antarctica)
      if (atEdge(first[0]) && atEdge(last[0]) && Math.sign(first[0]) !== Math.sign(last[0]) && Math.abs(first[1] - last[1]) < 0.05 && Math.abs(first[1]) > 60) {
        const pole = first[1] < 0 ? -90 : 90;
        ring.push([last[0], pole], [first[0], pole]);
      }
    }
    rings.push(ring);
  }
  return rings;
}

/** The mask: 255 on land, 0 at sea, `w` x `h`, row `r` at latitude `-90 + (r + 0.5) * 180 / h`. */
export function landMask(p: Polylines, w = LAND_W, h = LAND_H): Uint8Array {
  const crossings: number[][] = Array.from({ length: h }, () => []);
  for (const ring of landRings(p)) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const [lon0, lat0] = ring[i]!;
      const [lon1, lat1] = ring[(i + 1) % n]!;
      const x0 = ((lon0 + 180) / 360) * w;
      const x1 = ((lon1 + 180) / 360) * w;
      const y0 = ((lat0 + 90) / 180) * h;
      const y1 = ((lat1 + 90) / 180) * h;
      if (y0 === y1) continue;
      const lo = Math.min(y0, y1);
      const hi = Math.max(y0, y1);
      // the rows whose centre (r + 0.5) the edge crosses, half open at the upper end so a vertex on a row's centre counts once
      for (let r = Math.max(0, Math.ceil(lo - 0.5)); r < h && r + 0.5 < hi; r++) {
        const yc = r + 0.5;
        if (yc < lo) continue;
        crossings[r]!.push(x0 + ((x1 - x0) * (yc - y0)) / (y1 - y0));
      }
    }
  }
  const out = new Uint8Array(w * h);
  for (let r = 0; r < h; r++) {
    const xs = crossings[r]!.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k]! - 0.5));
      const to = Math.min(w, Math.ceil(xs[k + 1]! - 0.5));
      out.fill(255, r * w + from, r * w + to);
    }
  }
  return out;
}
