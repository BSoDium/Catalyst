/**
 * Douglas-Peucker on the sphere, in metres. Points are unit vectors scaled to the earth's radius, so the distance of a point to a
 * chord is the true 3D distance: the sag of a long chord under the surface counts as error, which is exactly what keeps a
 * simplified line from sinking into the planet's disc (the same reason the arcs are sampled, engine/geometry.ts).
 */

import { EARTH_RADIUS_KM } from "@catalyst/schemas/polyline";

export const EARTH_RADIUS_M = EARTH_RADIUS_KM * 1000;

/** Distance in metres from point p to the segment a-b; all `[x, y, z]` in metres, read from `xyz` at vertex indices. */
function distToSegment(xyz: ArrayLike<number>, p: number, a: number, b: number): number {
  const ax = xyz[a * 3]!, ay = xyz[a * 3 + 1]!, az = xyz[a * 3 + 2]!;
  const bx = xyz[b * 3]!, by = xyz[b * 3 + 1]!, bz = xyz[b * 3 + 2]!;
  const px = xyz[p * 3]! - ax, py = xyz[p * 3 + 1]! - ay, pz = xyz[p * 3 + 2]! - az;
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / len2));
  const qx = px - dx * t, qy = py - dy * t, qz = pz - dz * t;
  return Math.hypot(qx, qy, qz);
}

/**
 * Indices (ascending, always including the first and the last) of the points that keep every dropped point within `tolM` of
 * the simplified line. `xyz` is 3 numbers per point, in metres; `from` restricts the work to a sub-selection of point indices
 * (a coarser level is derived from a finer one, so it is always a subset of it).
 */
export function simplify(xyz: ArrayLike<number>, tolM: number, from?: ArrayLike<number>): Uint32Array {
  const n = from ? from.length : xyz.length / 3;
  const idx = (k: number) => (from ? from[k]! : k);
  if (n <= 2) return Uint32Array.from({ length: n }, (_, k) => idx(k));
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: number[] = [0, n - 1];
  while (stack.length) {
    const hi = stack.pop()!;
    const lo = stack.pop()!;
    if (hi - lo < 2) continue;
    let worst = -1;
    let at = -1;
    const a = idx(lo);
    const b = idx(hi);
    for (let k = lo + 1; k < hi; k++) {
      const d = distToSegment(xyz, idx(k), a, b);
      if (d > worst) {
        worst = d;
        at = k;
      }
    }
    if (worst > tolM) {
      keep[at] = 1;
      stack.push(lo, at, at, hi);
    }
  }
  const out: number[] = [];
  for (let k = 0; k < n; k++) if (keep[k]) out.push(idx(k));
  return Uint32Array.from(out);
}
