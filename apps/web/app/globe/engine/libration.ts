/**
 * The scene moon's libration (#634): the moon is tidally locked, it turns once a lap about an axis that stays put, so the point under the earth wobbles. Two causes, both real and both worked out from the
 * scene's own orbit (Kepler, `moon.ts`): the longitude libration, because the moon moves faster near perigee than its turn (the true anomaly minus the mean one, up to 7.9 degrees at the real
 * eccentricity), and the latitude libration, because the pole leans (`LUNAR_POLE_TILT_DEG`, 6.68 degrees from the orbit's normal) toward a fixed side of the orbit (up to 6.7 degrees). Pure.
 *
 * Done in the orbit's own frame (the plane is the x-y plane, `angle` goes from x to y, the normal is z), so it does not depend on the composition plane, the roll or the inclination of the view.
 * The body's frame has its +Z (longitude 0, latitude 0) at the point under the earth at the mean anomaly, +Y at the north pole and +X east, as the texture has them (`moon-layer.ts`: `u = atan(x, z)`).
 */
import { LUNAR_POLE_TILT_DEG } from "./lunar-ephemeris";
import { eccentricAnomaly, meanOfTrue, MOON, type OrbitStart } from "./moon";

type V = [number, number, number];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const DEG = 180 / Math.PI;

/** Rotate `v` about the unit axis `k` by `t` radians (Rodrigues). */
function rotate(v: V, k: V, t: number): V {
  const c = Math.cos(t);
  const s = Math.sin(t);
  const kv = cross(k, v);
  const d = dot(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * d, v[1] * c + kv[1] * s + k[1] * d, v[2] * c + kv[2] * s + k[2] * d];
}

/** Which side the pole leans to: the sign that makes the latitude libration negative a quarter of a lap after the ascending node (the moon north of the ecliptic: the earth sees the south pole, as in Meeus). */
const LEAN = -1;

/**
 * The libration at the orbit angle `angle`: `lonDeg` (east positive) and `latDeg` (north positive) of the point of the moon under the earth. `start` has the mean anomaly's start, the angle of perigee and the
 * angle of the ascending node on the orbit (`node`). `e` is the orbit's eccentricity (0 is a circle, with no longitude libration).
 */
export function libration(angle: number, start: OrbitStart, e: number = MOON.eccentricity, tiltDeg: number = LUNAR_POLE_TILT_DEG): { lonDeg: number; latDeg: number } {
  const mean = meanOfTrue(angle - start.perigee, e);
  // (the body's turn is even: its prime meridian looks at the earth when the angle is the mean one)
  const turn = mean + start.perigee + Math.PI;
  const node: V = [Math.cos(start.node), Math.sin(start.node), 0];
  const lean = (LEAN * tiltDeg) / DEG;
  const pole = rotate([0, 0, 1], node, lean);
  const prime = rotate([Math.cos(turn), Math.sin(turn), 0], node, lean);
  const east = cross(pole, prime);
  const earth: V = [-Math.cos(angle), -Math.sin(angle), 0];
  return { lonDeg: Math.atan2(dot(earth, east), dot(earth, prime)) * DEG, latDeg: Math.asin(Math.max(-1, Math.min(1, dot(earth, pole)))) * DEG };
}

// (eccentricAnomaly is re-exported for the tests that build a start from a mean anomaly)
export { eccentricAnomaly };
