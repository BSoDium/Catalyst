/**
 * The camera's flight through the cinematic interlude (engine/cinematic.ts), after the studio's intro: it opens low over the Mediterranean, level with
 * the horizon with the earth along the bottom of the frame, as the first letter of the word comes over the horizon from the east; then it backs away,
 * west over Italy and Spain and up, turning to keep the word in the frame, until the whole earth is in it and the letters line up in front of the planet,
 * which is the page's own camera with the interlude's pull-back and lean.
 *
 * It is a SPLINE, not a lock: the camera's position and the point it looks at are each a smooth curve of the progress `u` through hand-set keys, and
 * nothing in it reads where the word is (a camera that followed the word would inherit every change of its pace, and snaps when the weighting moves).
 * The keys are set so that the word, whose own path is nearly even in `u`, stays in the frame, a little to one side: a test holds that.
 *
 * A pure function of `u` (0 at the interlude's start, 1 where the word lands) and of the pose it ends on, so that at 1 the picture is exactly the one
 * the renderer would draw without a flight, and at 0 it is the page's own (the first moments are a dive from it to the first key).
 *
 * A pose is a camera POSITION above the earth (longitude, latitude, altitude in earth radii), a point it LOOKS at (longitude, latitude and radius
 * from the planet's centre: radius 0 is the centre, as every other camera of the page looks), which way is up (the local vertical, for a level horizon,
 * towards the planet's north), a pitch down from that line of sight and a roll about it. The keys are interpolated by cubic Hermite splines
 * (zero speed at both ends, slopes that never overshoot between). (The altitude is linear: in logs, a climb by equal ratios, the first dive from the
 * page's view was nearly over in the first third of its time, which read as a snap.)
 */
import { lonLatToVec3 } from "./geo";

const DEG = Math.PI / 180;

export type Vec3 = [number, number, number];

export interface FlightKey {
  /** Where in the flight it is, 0..1. */
  u: number;
  lon: number;
  lat: number;
  /** Height above the surface, earth radii. */
  alt: number;
  /** The point looked at: longitude, latitude and radius from the planet's centre (earth radii: the word's shell is 2). */
  look: readonly [number, number, number];
  /** Which way is up: 1 the local vertical (the horizon level, the earth below), 0 the planet's north (as every other camera of the page). */
  level: number;
  /** Degrees the camera is pitched DOWN from the line to the look point (the earth then fills more of the frame). */
  pitch: number;
  /** Degrees; positive leans the planet's north to the left on the screen (`ViewState.roll`). */
  roll: number;
  /**
   * How much the camera looks along the HORIZON instead of at `look` (0..1), and towards which compass bearing (degrees from north, 90 east): the point
   * looked at is then the planet's limb in that direction as seen from the camera, wherever it flies, so the camera can back away and climb with the
   * horizon staying where it is in the picture (with a negative `pitch`, a few degrees below the middle).
   */
  horizon: number;
  bearing: number;
}

/** The pose the flight ends on (and, at its start, the page's): the orbit camera's. */
export interface FlightEnd {
  lon: number;
  lat: number;
  /** The camera's distance from the centre less one. */
  alt: number;
  /** Radians. */
  roll: number;
}

export interface FlightPose {
  /** The camera's position and the point it looks at, in the earth's frame (radii), its up (the roll applied) and the position's longitude and latitude. */
  pos: Vec3;
  target: Vec3;
  up: Vec3;
  lon: number;
  lat: number;
}

/**
 * The keys after the start. The opening: a camera over Greece, high enough to see Greece and Turkey, aimed past the horizon at the word's leading
 * letter (a slight lean to the right, a negative roll); then back and up over Italy and Spain, the look sliding from the leading end to the middle of
 * the word and, at the end, to the middle of the planet.
 */
export const FLIGHT = {
  keys: [
    // the opening: over Greece, the horizon level and in the lower part of the picture, the letters about to come up over it
    { u: 0.16, lon: 22, lat: 36, alt: 0.15, look: [106, 8, 2], level: 1, pitch: -6, roll: -6, horizon: 1, bearing: 85 },
    // backing away west over Italy, climbing, the horizon held: the planet stays in the picture while the word rises from the limb
    { u: 0.38, lon: 14, lat: 38, alt: 0.62, look: [106, 8, 2], level: 1, pitch: -6, roll: -4, horizon: 1, bearing: 85 },
    // the camera leaves the limb and turns towards the word and the planet together
    { u: 0.54, lon: 7, lat: 36, alt: 1.5, look: [50, 6, 1.5], level: 0.9, pitch: -3, roll: -2, horizon: 0.7, bearing: 85 },
    { u: 0.7, lon: 2, lat: 26, alt: 2.4, look: [14, 2, 0.9], level: 0.5, pitch: 0, roll: 2, horizon: 0, bearing: 85 },
    // the space view, reached with the word still on its way in: the letters line up in front of the planet over the last part
    { u: 0.82, lon: 0, lat: 12, alt: 3.2, look: [0, 0, 0.1], level: 0.15, pitch: 0, roll: 8, horizon: 0, bearing: 85 },
  ] satisfies readonly FlightKey[],
};

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** A value that wraps (a longitude) brought to the nearest equivalent of `near`. */
const unwrap = (v: number, near: number) => v + 360 * Math.round((near - v) / 360);

interface Knot {
  u: number;
  v: number[];
}

/** Cubic Hermite through the knots at `u`: zero speed at the ends, central differences inside. */
function spline(knots: readonly Knot[], u: number, still: ReadonlySet<number> = new Set()): number[] {
  const n = knots.length;
  const x = Math.min(1, Math.max(0, u));
  let i = 0;
  while (i < n - 2 && x > knots[i + 1]!.u) i++;
  const a = knots[i]!;
  const b = knots[i + 1]!;
  const h = b.u - a.u;
  const t = h > 0 ? (x - a.u) / h : 1;
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return a.v.map((_, k) => {
    // the slope at a knot: the mean of the slopes either side, none where the value turns round there (a minimum stays a minimum: no dip past it) and
    // never more than three times the smaller of the two (no overshoot)
    const slope = (j: number) => {
      if (j === 0 || j === n - 1 || still.has(j)) return 0;
      const p = knots[j - 1]!;
      const c = knots[j]!;
      const q = knots[j + 1]!;
      const dl = (c.v[k]! - p.v[k]!) / (c.u - p.u);
      const dr = (q.v[k]! - c.v[k]!) / (q.u - c.u);
      if (dl * dr <= 0) return 0;
      return Math.sign(dl) * Math.min(Math.abs(dl + dr) / 2, 3 * Math.min(Math.abs(dl), Math.abs(dr)));
    };
    return h00 * a.v[k]! + h10 * h * slope(i) + h01 * b.v[k]! + h11 * h * slope(i + 1);
  });
}

/** The flight's pose at progress `u` (0..1) for a flight that ends on `end`. */
export function flightPose(u: number, end: FlightEnd): FlightPose {
  const k = FLIGHT.keys;
  const altEnd = Math.max(0.02, end.alt);
  // the knots: the pose it starts from (the page's: the end's), the keys, the end; each a vector
  // [lon, lat, alt, look lon, look lat, look radius, level, pitch, roll, horizon, bearing]
  const first = k[0]!;
  const last = k[k.length - 1]!;
  const rows: number[][] = [[unwrap(end.lon, first.lon), end.lat, altEnd, first.look[0], first.look[1], 0, 0, 0, end.roll, 0, first.bearing]];
  const times = [0];
  let lon = rows[0]![0]!;
  let look = first.look[0];
  for (const key of k) {
    lon = unwrap(key.lon, lon);
    look = unwrap(key.look[0], look);
    rows.push([lon, key.lat, Math.min(key.alt, end.alt * 0.9), look, key.look[1], key.look[2], key.level, key.pitch * DEG, key.roll * DEG, key.horizon, key.bearing]);
    times.push(key.u);
  }
  rows.push([unwrap(end.lon, lon), end.lat, altEnd, look, last.look[1], 0, 0, 0, end.roll, 0, last.bearing]);
  times.push(1);
  const v = spline(
    rows.map((r, i) => ({ u: times[i]!, v: r })),
    u,
    // (the camera is momentarily still at the opening shot: the dive eases in AND out, and the departure eases out of it)
    new Set([1]),
  );
  const lonNow = v[0]!;
  const latNow = Math.max(-89, Math.min(89, v[1]!));
  const pos = scale(lonLatToVec3(lonNow, latNow), 1 + Math.max(0.02, v[2]!));
  // the look: a point at that longitude and latitude, at that radius from the planet's centre (0: the centre itself)
  let target: Vec3 = scale(lonLatToVec3(v[3]!, Math.max(-89, Math.min(89, v[4]!))), Math.max(0, v[5]!));
  // along the horizon: the planet's limb in the bearing, from here (the tangent point of the sight line that just grazes the planet)
  const horizon = Math.min(1, Math.max(0, v[9]!));
  if (horizon > 0) {
    const d = len(pos);
    const cu = unit(pos);
    const e = unit(cross([0, 1, 0], cu));
    const n = cross(cu, e);
    const b = v[10]! * DEG;
    const alpha = Math.acos(Math.min(1, 1 / Math.max(1.0001, d)));
    const t: Vec3 = [n[0] * Math.cos(b) + e[0] * Math.sin(b), n[1] * Math.cos(b) + e[1] * Math.sin(b), n[2] * Math.cos(b) + e[2] * Math.sin(b)];
    const limb: Vec3 = [cu[0] * Math.cos(alpha) + t[0] * Math.sin(alpha), cu[1] * Math.cos(alpha) + t[1] * Math.sin(alpha), cu[2] * Math.cos(alpha) + t[2] * Math.sin(alpha)];
    target = [target[0] + (limb[0] - target[0]) * horizon, target[1] + (limb[1] - target[1]) * horizon, target[2] + (limb[2] - target[2]) * horizon];
  }
  const level = Math.min(1, Math.max(0, v[6]!));
  const pitch = v[7]!;
  const roll = v[8]!;
  // the camera's up: the local vertical (horizon level) towards the planet's north by `level`, taken square to the line of sight, then the camera pitched
  // down by `pitch` about its right, then turned about the line of sight by the roll (the sign is `viewBasis`'s: at the end, with level 0 and no pitch,
  // it is the same)
  const f0 = unit(sub(target, pos));
  const c = unit(pos);
  const east = unit(cross([0, 1, 0], c));
  const north = cross(c, east);
  const hint: Vec3 = [c[0] * level + north[0] * (1 - level), c[1] * level + north[1] * (1 - level), c[2] * level + north[2] * (1 - level)];
  let u0 = sub(hint, scale(f0, dot(hint, f0)));
  if (Math.hypot(u0[0], u0[1], u0[2]) < 1e-3) u0 = sub(north, scale(f0, dot(north, f0)));
  u0 = Math.hypot(u0[0], u0[1], u0[2]) < 1e-6 ? east : unit(u0);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const f: Vec3 = [f0[0] * cp - u0[0] * sp, f0[1] * cp - u0[1] * sp, f0[2] * cp - u0[2] * sp];
  const up0: Vec3 = [u0[0] * cp + f0[0] * sp, u0[1] * cp + f0[1] * sp, u0[2] * cp + f0[2] * sp];
  const right = cross(f, up0);
  const cs = Math.cos(roll);
  const sn = Math.sin(roll);
  const up: Vec3 = [up0[0] * cs + right[0] * sn, up0[1] * cs + right[1] * sn, up0[2] * cs + right[2] * sn];
  // (the point looked at is where the pitched line of sight is, as far off as the point the look was aimed at)
  if (pitch !== 0) {
    const dist = Math.hypot(target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]);
    target = [pos[0] + f[0] * dist, pos[1] + f[1] * dist, pos[2] + f[2] * dist];
  }
  return { pos, target, up, lon: lonNow, lat: latNow };
}

/**
 * How much of the page's layout offset (the planet shifted aside and up to leave room for the text and the menu) the picture keeps at progress `u`,
 * 0..1: all of it at the start and at the end (the final shot is the page's own composition), none through the middle, where the shot is the studio's
 * and centred.
 */
export function flightOffsetShare(u: number): number {
  const sm = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  return Math.max(1 - sm(0, 0.08, u), sm(0.62, 1, u));
}


/**
 * The pose `k` (0..1, eased by the caller) of the way from `a` to `b`: the camera glides, and so does the point it looks at and its up. For a flight cut
 * short by a gesture: from where the camera is, to the page's own camera, in one smooth move, not the rest of the path flown in a rush.
 */
export function blendPose(a: FlightPose, b: FlightPose, k: number): FlightPose {
  const mix = (x: Vec3, y: Vec3): Vec3 => [x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k];
  return {
    pos: mix(a.pos, b.pos),
    target: mix(a.target, b.target),
    up: unit(mix(a.up, b.up)),
    lon: a.lon + (b.lon - a.lon) * k,
    lat: a.lat + (b.lat - a.lat) * k,
  };
}
