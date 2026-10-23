/**
 * The camera's flight through the cinematic interlude (engine/cinematic.ts): the studio's intro opens low over the earth, level with the horizon, and
 * climbs and pans away over the Mediterranean until the whole earth is in the frame, where the word lands. A pure function of the progress `u`
 * (0 at the interlude's start, 1 where the word lands) and of the pose it must end on (the page's own camera, with the interlude's pull-back and lean),
 * so that at 1 the picture is exactly the one the renderer would draw without a flight, and at 0 it is the page's own (the first moments are a dive from
 * it down to the first key).
 *
 * A pose is a camera POSITION above the earth (longitude, latitude, altitude in earth radii), a point it LOOKS at (a surface point, taken the given share
 * of the way to the earth's centre: 0 looks at the ground, 1 at the middle of the planet, as every other camera of the page does) and a roll about the
 * line of sight. The keys are interpolated by cubic Hermite splines (zero speed at both ends, finite-difference tangents between), the altitude in
 * logs (a climb by equal ratios, not equal heights).
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
  /** The surface point looked at (longitude, latitude), and how far from it towards the earth's centre the look goes, 0..1 (negative: aimed above it, at a point out in space over it, to raise the horizon). */
  look: readonly [number, number];
  lookK: number;
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

export interface FlightPose {
  /** The camera's position and the point it looks at, in the earth's frame (radii), its up (the roll applied) and the position's longitude and latitude. */
  pos: Vec3;
  target: Vec3;
  up: Vec3;
  lon: number;
  lat: number;
}

/**
 * The keys after the start. The opening is the studio's: a camera just above Greece, the horizon level (a slight lean to the right, a negative roll),
 * Turkey on the horizon; it backs off and climbs over Italy and Spain, looking down more and more towards the middle of the planet.
 */
export const FLIGHT = {
  keys: [
    { u: 0.07, lon: 24, lat: 36.5, alt: 0.08, look: [36.5, 38], lookK: 0, roll: -5 },
    { u: 0.3, lon: 16.5, lat: 39.5, alt: 0.18, look: [30, 37], lookK: 0.05, roll: -3 },
    { u: 0.55, lon: 9.5, lat: 41.5, alt: 0.5, look: [20, 36], lookK: 0.3, roll: 0 },
    { u: 0.78, lon: -1, lat: 38, alt: 1.15, look: [10, 30], lookK: 0.7, roll: 4 },
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
    const slope = (j: number) => {
      if (j === 0 || j === n - 1) return 0;
      const p = knots[j - 1]!;
      const q = knots[j + 1]!;
      return (q.v[k]! - p.v[k]!) / (q.u - p.u);
    };
    return h00 * a.v[k]! + h10 * h * slope(i) + h01 * b.v[k]! + h11 * h * slope(i + 1);
  });
}

/** The flight's pose at progress `u` (0..1) for a flight that ends on `end`. */
export function flightPose(u: number, end: FlightEnd): FlightPose {
  const k = FLIGHT.keys;
  // the knots: the pose it starts from (the page's: the end's), the keys, the end; each a vector [lon, lat, ln alt, look lon, look lat, lookK, roll]
  const rows: number[][] = [];
  const first = k[0]!;
  rows.push([unwrap(first.lon, end.lon) - 0, end.lat, Math.log(Math.max(1e-4, end.alt)), first.look[0], first.look[1], 1, end.roll]);
  rows[0]![0] = unwrap(end.lon, first.lon); // (the start is the end's longitude, brought to the first key's turn: the dive takes the short way)
  const times = [0];
  let lon = rows[0]![0]!;
  for (const key of k) {
    lon = unwrap(key.lon, lon);
    rows.push([lon, key.lat, Math.log(key.alt), key.look[0], key.look[1], key.lookK, key.roll * DEG]);
    times.push(key.u);
  }
  const last = k[k.length - 1]!;
  rows.push([unwrap(end.lon, lon), end.lat, Math.log(Math.max(1e-4, end.alt)), last.look[0], last.look[1], 1, end.roll]);
  times.push(1);
  const v = spline(
    rows.map((r, i) => ({ u: times[i]!, v: r })),
    u,
  );
  const lonNow = v[0]!;
  const latNow = Math.max(-89, Math.min(89, v[1]!));
  const pos = scale(lonLatToVec3(lonNow, latNow), 1 + Math.exp(v[2]!));
  const ground = lonLatToVec3(v[3]!, Math.max(-89, Math.min(89, v[4]!)));
  const target = scale(ground, 1 - Math.min(1, Math.max(-1, v[5]!)));
  const roll = v[6]!;
  // the camera's up: the local north, taken square to the line of sight, turned about it by the roll (the sign is `viewBasis`'s: at the end it is the same)
  const f = unit(sub(target, pos));
  const c = unit(pos);
  const east = unit(cross([0, 1, 0], c));
  const north = cross(c, east);
  let up0 = sub(north, scale(f, dot(north, f)));
  up0 = Math.hypot(up0[0], up0[1], up0[2]) < 1e-6 ? east : unit(up0);
  const right = cross(f, up0);
  const cs = Math.cos(roll);
  const sn = Math.sin(roll);
  const up: Vec3 = [up0[0] * cs + right[0] * sn, up0[1] * cs + right[1] * sn, up0[2] * cs + right[2] * sn];
  return { pos, target, up, lon: lonNow, lat: latNow };
}
