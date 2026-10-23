/**
 * The camera's flight through the cinematic interlude (engine/cinematic.ts), after the studio's intro: it opens low over the Mediterranean, level with
 * the horizon with the earth in the bottom third of the frame, as the first letter of the word comes over the horizon from the east; then it backs
 * away, west over Italy and Spain and up, pitching to keep the letters in view (it LOOKS AT THE WORD, not at the planet), until the whole earth is in
 * the frame and the letters line up in front of it, which is the page's own camera with the interlude's pull-back and lean.
 *
 * A pure function of the progress `u` (0 at the interlude's start, 1 where the word lands) and of the pose it ends on, so that at 1 the picture is
 * exactly the one the renderer would draw without a flight, and at 0 it is the page's own (the first moments are a dive from it to the first key).
 *
 * A pose is a camera POSITION above the earth (longitude, latitude, altitude in earth radii), a point it LOOKS at and a roll about the line of sight.
 * The point is `follow` (0..1) of the way from the earth's centre to a point of the word, which is `lead` (0..1) of the way from the word's middle to its
 * LEADING end (the end it moves with: the west one, for a word that comes in from the east): follow 0 is the planet's centre, as every other camera of
 * the page looks, follow 1 the word itself. The keys are interpolated by cubic Hermite splines (zero speed at both ends, finite-difference tangents
 * between), the altitude in logs (a climb by equal ratios, not equal heights).
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
  /** How far the look goes from the planet's centre to the word, and from the word's middle to its leading end (both 0..1). */
  follow: number;
  lead: number;
  /** Which way is up: 1 the local vertical (the horizon level, the earth below), 0 the planet's north (as every other camera of the page). */
  level: number;
  /** Degrees the camera is pitched DOWN from looking at its point (the leading letter then sits above the middle of the frame, the earth fills more of it). */
  pitch: number;
  /** Degrees; positive leans the planet's north to the left on the screen (`ViewState.roll`). */
  roll: number;
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

/** Where the word is at progress `u`: its middle and its leading end, in the earth's frame (earth radii). */
export type FlightWord = (u: number) => { centre: Vec3; lead: Vec3 } | null;

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
    { u: 0.07, lon: 22, lat: 36, alt: 0.15, follow: 1, lead: 1, level: 1, pitch: 7, roll: -6 },
    { u: 0.28, lon: 13, lat: 39, alt: 0.6, follow: 1, lead: 0.75, level: 1, pitch: 4, roll: -3 },
    { u: 0.5, lon: 5, lat: 40, alt: 1.8, follow: 1, lead: 0.4, level: 0.7, pitch: 2, roll: 0 },
    { u: 0.78, lon: -1, lat: 32, alt: 2.8, follow: 0.85, lead: 0.1, level: 0.2, pitch: 0, roll: 3 },
  ] satisfies readonly FlightKey[],
};

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
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
function spline(knots: readonly Knot[], u: number): number[] {
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
      if (j === 0 || j === n - 1) return 0;
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

/** The flight's pose at progress `u` (0..1) for a flight that ends on `end`, the word being where `word` says. */
export function flightPose(u: number, end: FlightEnd, word: FlightWord | null): FlightPose {
  const k = FLIGHT.keys;
  const lnEnd = Math.log(Math.max(1e-4, end.alt));
  // the knots: the pose it starts from (the page's: the end's), the keys, the end; each a vector [lon, lat, ln alt, follow, lead, level, pitch, roll]
  const first = k[0]!;
  const rows: number[][] = [[unwrap(end.lon, first.lon), end.lat, lnEnd, 0, first.lead, 0, 0, end.roll]];
  const times = [0];
  let lon = rows[0]![0]!;
  for (const key of k) {
    lon = unwrap(key.lon, lon);
    rows.push([lon, key.lat, Math.log(Math.min(key.alt, end.alt * 0.9)), key.follow, key.lead, key.level, key.pitch * DEG, key.roll * DEG]);
    times.push(key.u);
  }
  const last = k[k.length - 1]!;
  rows.push([unwrap(end.lon, lon), end.lat, lnEnd, 0, last.lead, 0, 0, end.roll]);
  times.push(1);
  const v = spline(
    rows.map((r, i) => ({ u: times[i]!, v: r })),
    u,
  );
  const lonNow = v[0]!;
  const latNow = Math.max(-89, Math.min(89, v[1]!));
  const pos = scale(lonLatToVec3(lonNow, latNow), 1 + Math.exp(v[2]!));
  // the look: the planet's centre (0) towards the word's point (the middle, or the leading end by `lead`)
  const follow = Math.min(1, Math.max(0, v[3]!));
  const lead = Math.min(1, Math.max(0, v[4]!));
  let target: Vec3 = [0, 0, 0];
  const w = word?.(u);
  if (w && follow > 0) {
    const point: Vec3 = [w.centre[0] + (w.lead[0] - w.centre[0]) * lead, w.centre[1] + (w.lead[1] - w.centre[1]) * lead, w.centre[2] + (w.lead[2] - w.centre[2]) * lead];
    target = scale(point, follow);
  }
  const pitch = v[6]!;
  const roll = v[7]!;
  const level = Math.min(1, Math.max(0, v[5]!));
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

/** How much the planet's disc is a ground (a tone of its own, `GlobeScene.setGround`) at progress `u`: from the dive in, to the last stretch before the final shot. */
export function flightGroundShare(u: number): number {
  const sm = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  return Math.min(sm(0, 0.07, u), 1 - sm(0.7, 1, u));
}
