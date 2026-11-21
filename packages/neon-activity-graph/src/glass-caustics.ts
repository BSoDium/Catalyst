/**
 * Caustics under glass blocks, by tracing light through them (a readable reference of the optics the GPU traces in `ground-light.ts`, kept for its tests). Pure, no three.js.
 *
 * A block is a rounded box of glass (index 1.5). Its faces are flat, so a ray is intersected with the sharp box (a few multiplications); only the NORMAL is that of the rounded box (at a point near an edge it turns
 * smoothly from one face's to the next, like a small cylindrical lens: that is what gathers the light into the bright lines along the edges of a real glass cube). Rays are refracted in and out (Snell's law, Fresnel's
 * share of what is reflected, total internal reflection with a few bounces) and land on the ground (the plane y = 0), where the caller adds their power.
 *
 * Two kinds of light: a sun, whose rays are parallel and come from outside (light theme), and an emitter inside the block (a rod; the dark theme). The sun's are traced as a signed difference to what the same rays
 * would have done with no block: the caller adds the power where a ray lands and takes it away where it would have landed, so the ground keeps its brightness everywhere the glass does not reach, a shadow is a lack of
 * rays and a caustic a surplus of them.
 */
export type V3 = readonly [number, number, number];

/** A block of glass: its centre, half extents and the radius of its rounded edges. */
export interface GlassBox {
  c: V3;
  h: V3;
  r: number;
  /** A small, constant tilt of every normal of the block (a glass that is not quite true: one block bends the light a little more to one side than the next). */
  bias?: V3;
}

/** A normal, with the block's own tilt applied. */
function tilted(n: V3, box: GlassBox): V3 {
  const b = box.bias;
  return b ? norm([n[0] + b[0], n[1] + b[1], n[2] + b[2]]) : n;
}

export const GLASS_IOR = 1.5;
const R0 = ((1 - GLASS_IOR) / (1 + GLASS_IOR)) ** 2;
const EPS = 1e-4;

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Schlick's approximation: the share of the light a surface reflects, `cos` being the cosine of the angle in the thinner medium. */
const reflectance = (cos: number) => R0 + (1 - R0) * (1 - Math.min(1, Math.max(0, cos))) ** 5;

/** The outward normal of the rounded box at a point of (or near) its surface, in the box's own coordinates. */
export function roundedNormal(p: V3, h: V3, r: number): V3 {
  const q = [Math.abs(p[0]) - (h[0] - r), Math.abs(p[1]) - (h[1] - r), Math.abs(p[2]) - (h[2] - r)];
  const s = [Math.sign(p[0]) || 1, Math.sign(p[1]) || 1, Math.sign(p[2]) || 1];
  const m = Math.max(q[0]!, q[1]!, q[2]!);
  if (m <= 0) {
    // (inside the flat part: the face the point is nearest to)
    const k = q[0]! >= q[1]! && q[0]! >= q[2]! ? 0 : q[1]! >= q[2]! ? 1 : 2;
    const n: [number, number, number] = [0, 0, 0];
    n[k] = s[k]!;
    return n;
  }
  return norm([Math.max(q[0]!, 0) * s[0]!, Math.max(q[1]!, 0) * s[1]!, Math.max(q[2]!, 0) * s[2]!]);
}

/** The signed distance to the rounded box (negative inside), in the box's coordinates. */
function sdf(p: V3, h: V3, r: number): number {
  const qx = Math.abs(p[0]) - (h[0] - r);
  const qy = Math.abs(p[1]) - (h[1] - r);
  const qz = Math.abs(p[2]) - (h[2] - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
}

/** Where a ray from outside first meets the ROUNDED box (sphere tracing from where it enters the sharp one), as a distance, or null if it passes through a corner the rounding has taken off. */
function enterRounded(o: V3, d: V3, box: GlassBox, t0: number, t1: number): number | null {
  let t = Math.max(0, t0 - 1e-3);
  for (let i = 0; i < 48; i++) {
    const v = sdf([o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t], box.h, box.r);
    if (v < 1e-4) return t;
    t += v;
    if (t > t1 + 1e-3) return null;
  }
  return null;
}

/** Where a ray inside the rounded box leaves it: by bisection between a point inside and one just beyond the sharp box's far side. */
function leaveRounded(o: V3, d: V3, box: GlassBox, t1: number): number {
  let lo = 0;
  let hi = t1 + 1e-2;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (sdf([o[0] + d[0] * mid, o[1] + d[1] * mid, o[2] + d[2] * mid], box.h, box.r) < 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Where a ray (origin `o`, direction `d`, both relative to the box's centre) enters and leaves the sharp box: the two distances, or null for a miss. */
function slab(o: V3, d: V3, h: V3): [number, number] | null {
  let t0 = -Infinity;
  let t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]!) < 1e-9) {
      if (Math.abs(o[i]!) > h[i]!) return null;
      continue;
    }
    const a = (-h[i]! - o[i]!) / d[i]!;
    const b = (h[i]! - o[i]!) / d[i]!;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  return t1 >= t0 ? [t0, t1] : null;
}

/** Snell: the refracted direction of unit `d` at a surface of outward normal `n`, going from a medium of index 1 to `eta` (or the reverse for `eta` < 1), or null in total internal reflection. */
function refract(d: V3, n: V3, eta: number): V3 | null {
  const cosi = -dot(d, n);
  const k = 1 - eta * eta * (1 - cosi * cosi);
  if (k < 0) return null;
  const a = eta * cosi - Math.sqrt(k);
  return [eta * d[0] + a * n[0], eta * d[1] + a * n[1], eta * d[2] + a * n[2]];
}

/**
 * From inside the glass, at `p` (box coordinates, the box's centre at the origin) going along unit `d`: bounce inside until the ray gets out, and give where it lands on the ground (world y = 0) with the share of
 * its power that got out and the length it went through the glass. Null when it is trapped or leaves upward.
 */
function leave(box: GlassBox, p: V3, d: V3): { x: number; z: number; share: number; path: number } | null {
  let o = p;
  let dir = d;
  let share = 1;
  let path = 0;
  for (let bounce = 0; bounce < 12; bounce++) {
    const s = slab(o, dir, box.h);
    if (!s) return null;
    const t = leaveRounded(o, dir, box, s[1]);
    path += t;
    const q: V3 = [o[0] + dir[0] * t, o[1] + dir[1] * t, o[2] + dir[2] * t];
    const n = tilted(roundedNormal(q, box.h, box.r), box);
    const inward: V3 = [-n[0], -n[1], -n[2]];
    const out = refract(dir, inward, GLASS_IOR);
    if (out) {
      // (the angle in the thinner medium, the air's, is the refracted one)
      share *= 1 - reflectance(dot(out, n));
      if (out[1] >= -1e-3) return null;
      // to the ground: the box's centre is at world height c[1]
      const wy = q[1] + box.c[1];
      const g = -wy / out[1];
      return { x: q[0] + box.c[0] + out[0] * g, z: q[2] + box.c[2] + out[2] * g, share, path };
    }
    // total internal reflection: back inside
    const k = 2 * dot(dir, n);
    dir = [dir[0] - k * n[0], dir[1] - k * n[1], dir[2] - k * n[2]];
    o = [q[0] + dir[0] * EPS, q[1] + dir[1] * EPS, q[2] + dir[2] * EPS];
  }
  return null;
}

/**
 * The sun through one block. `d` is the unit direction the light travels (down: y < 0); `n` x `n` parallel rays are sent through the block's shadow-casting cross-section. For each ray that meets the block, `land` is
 * called where it lands with its power (the area of its tube) and the length it went through the glass, and `free` where it would have landed without the block (the same power: take it away).
 */
export function traceSun(
  box: GlassBox,
  d: V3,
  n: number,
  random: () => number,
  land: (x: number, z: number, power: number, path: number) => void,
  free: (x: number, z: number, power: number) => void,
) {
  const R = Math.hypot(box.h[0], box.h[1], box.h[2]);
  const u = norm(cross(d, [0, 1, 0]));
  const v = cross(d, u);
  const cell = (2 * R) / n;
  const power = cell * cell;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const a = -R + (i + random()) * cell;
      const b = -R + (j + random()) * cell;
      // the ray starts one radius before the block, in the box's coordinates
      const o: V3 = [u[0] * a + v[0] * b - d[0] * 2 * R, u[1] * a + v[1] * b - d[1] * 2 * R, u[2] * a + v[2] * b - d[2] * 2 * R];
      const s = slab(o, d, box.h);
      if (!s) continue;
      // where it would land with no block (the ground is y = 0 in the world, the box's centre at c[1])
      const fy = -(o[1] + box.c[1]) / d[1];
      free(o[0] + box.c[0] + d[0] * fy, o[2] + box.c[2] + d[2] * fy, power);
      const te = enterRounded(o, d, box, s[0], s[1]);
      if (te === null) continue;
      const q: V3 = [o[0] + d[0] * te, o[1] + d[1] * te, o[2] + d[2] * te];
      const nrm = tilted(roundedNormal(q, box.h, box.r), box);
      const inside = refract(d, nrm, 1 / GLASS_IOR);
      if (!inside) continue;
      const entered = 1 - reflectance(-dot(d, nrm));
      const res = leave(box, [q[0] + inside[0] * EPS, q[1] + inside[1] * EPS, q[2] + inside[2] * EPS], inside);
      if (res) land(res.x, res.z, power * entered * res.share, res.path);
    }
  }
}

/**
 * A rod of light inside the block (an emitter that is not a point: a thin box of half width `rx` and half height `ry`, centred `cy` above the block's centre, giving out light from its four sides the way a surface does,
 * most of it straight out from the face and less at a slant: cosine-weighted). `rays` rays are sent from random points of its sides; `land` is called for each that gets out and lands on the ground, with the share of its
 * power that got out (to be multiplied by the power of one ray). A point source would draw sharp lines where the corners of the glass focus it; a rod blurs them, as a real light does.
 */
/** The i-th number (from 1) of the van der Corput sequence in a prime base: evenly spread, much more than random ones are. */
function halton(i: number, base: number): number {
  let f = 1;
  let r = 0;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

export function traceEmitter(
  box: GlassBox,
  rod: { cy: number; rx: number; ry: number },
  rays: number,
  random: () => number,
  land: (x: number, z: number, share: number, path: number) => void,
) {
  // (the five numbers a ray needs, in as many different bases, so that the rays are evenly spread in all of them at once; shifted by a random amount for each call, so that the blocks' patterns do not repeat)
  const shift = [random(), random(), random(), random(), random()];
  const u = (i: number, k: number) => (halton(i + 1, [2, 3, 5, 7, 11][k]!) + shift[k]!) % 1;
  for (let i = 0; i < rays; i++) {
    const side = Math.floor(u(i, 0) * 4);
    const along = (u(i, 1) * 2 - 1) * rod.rx;
    const y = rod.cy + (u(i, 2) * 2 - 1) * rod.ry;
    // the side's outward normal (n) and the horizontal direction along it (t)
    const nx = side === 0 ? 1 : side === 1 ? -1 : 0;
    const nz = side === 2 ? 1 : side === 3 ? -1 : 0;
    const tx = nz !== 0 ? 1 : 0;
    const tz = nx !== 0 ? 1 : 0;
    const p: V3 = [nx * rod.rx + tx * along, y, nz * rod.rx + tz * along];
    // cosine-weighted direction about the normal: (sin a cos b) along t, (sin a sin b) up, cos a out
    const r1 = u(i, 3);
    const sa = Math.sqrt(r1);
    const ca = Math.sqrt(1 - r1);
    const b = u(i, 4) * 2 * Math.PI;
    const dir: V3 = [nx * ca + tx * sa * Math.cos(b), sa * Math.sin(b), nz * ca + tz * sa * Math.cos(b)];
    const res = leave(box, p, dir);
    if (res) land(res.x, res.z, res.share, res.path);
  }
}
