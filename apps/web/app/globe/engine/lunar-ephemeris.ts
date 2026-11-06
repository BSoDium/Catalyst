/**
 * Where the moon really is (docs/landing.md, "The moon"): a truncated form of the lunar theory of Meeus' "Astronomical Algorithms" (chapter 47, itself a truncation of Chapront's ELP-2000/82): the largest periodic terms of the
 * longitude, the latitude and the distance, and with the low-precision sun of the Astronomical Almanac (the one `daylight.ts` uses) the phase. Pure: no DOM, no three, no clock (the caller gives epoch milliseconds,
 * as `subsolarPoint` does), `lunar-ephemeris.test.ts`. Good to about 0.1 to 0.3 degrees in longitude and latitude and a few hundred kilometres in distance, which is far finer than anything the page prints or draws.
 *
 * The scene is compressed (the orbit is 9 earth radii, a lap is six minutes, the moon moves in a composition plane): what is printed on the HUD and what the lap starts from can be real, and this is where it comes from.
 * It costs scalar maths, once or per HUD tick, never per pixel.
 */
import { normalizeLon } from "./geo";

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const wrap360 = (d: number): number => ((d % 360) + 360) % 360;

/** The moon's orbit as it is on average: what the HUD can state without an ephemeris. */
export const LUNAR = {
  meanDistanceKm: 384_400,
  /** One turn against the stars, in days. */
  siderealDays: 27.321661,
  /** One turn against the sun (new moon to new moon), in days. */
  synodicDays: 29.530589,
  eccentricity: 0.0549,
  /** The inclination of the orbit to the ecliptic, degrees. */
  inclinationDeg: 5.145,
} as const;

const AU_KM = 149_597_870.7;
const J2000_MS = Date.UTC(2000, 0, 1, 12);

/** [D, M, M', F, coefficient]: the multiples of the mean elongation, the sun's and the moon's mean anomaly and the argument of latitude, and the term's amplitude in 1e-6 degree (the longitude), 1e-3 km (the distance) or 1e-6 degree (the latitude). */
type Term = readonly [number, number, number, number, number];

/** The sum of the sines of the longitude (chapter 47, table 47.A, the terms above 3000e-6 degree). */
const LONGITUDE: readonly Term[] = [
  [0, 0, 1, 0, 6288774],
  [2, 0, -1, 0, 1274027],
  [2, 0, 0, 0, 658314],
  [0, 0, 2, 0, 213618],
  [0, 1, 0, 0, -185116],
  [0, 0, 0, 2, -114332],
  [2, 0, -2, 0, 58793],
  [2, -1, -1, 0, 57066],
  [2, 0, 1, 0, 53322],
  [2, -1, 0, 0, 45758],
  [0, 1, -1, 0, -40923],
  [1, 0, 0, 0, -34720],
  [0, 1, 1, 0, -30383],
  [2, 0, 0, -2, 15327],
  [0, 0, 1, 2, -12528],
  [0, 0, 1, -2, 10980],
  [4, 0, -1, 0, 10675],
  [0, 0, 3, 0, 10034],
  [4, 0, -2, 0, 8548],
  [2, 1, -1, 0, -7888],
  [2, 1, 0, 0, -6766],
  [1, 0, -1, 0, -5163],
  [1, 1, 0, 0, 4987],
  [2, -1, 1, 0, 4036],
  [2, 0, 2, 0, 3994],
];

/** The sum of the cosines of the distance (the same table, in 1e-3 km; the terms above 8000). */
const DISTANCE: readonly Term[] = [
  [0, 0, 1, 0, -20905355],
  [2, 0, -1, 0, -3699111],
  [2, 0, 0, 0, -2955968],
  [0, 0, 2, 0, -569925],
  [0, 1, 0, 0, 48888],
  [0, 0, 0, 2, -3149],
  [2, 0, -2, 0, 246158],
  [2, -1, -1, 0, -152138],
  [2, 0, 1, 0, -170733],
  [2, -1, 0, 0, -204586],
  [0, 1, -1, 0, -129620],
  [1, 0, 0, 0, 108743],
  [0, 1, 1, 0, 104755],
  [2, 0, 0, -2, 10321],
  [0, 0, 1, -2, 79661],
  [4, 0, -1, 0, -34782],
  [0, 0, 3, 0, -23210],
  [4, 0, -2, 0, -21636],
  [2, 1, -1, 0, 24208],
  [2, 1, 0, 0, 30824],
  [1, 0, -1, 0, -8379],
  [1, 1, 0, 0, -16675],
  [2, -1, 1, 0, -12831],
  [2, 0, 2, 0, -10445],
];

/** The sum of the sines of the latitude (table 47.B, the terms above 3000e-6 degree). */
const LATITUDE: readonly Term[] = [
  [0, 0, 0, 1, 5128122],
  [0, 0, 1, 1, 280602],
  [0, 0, 1, -1, 277693],
  [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413],
  [2, 0, -1, -1, 46271],
  [2, 0, 0, 1, 32573],
  [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266],
  [0, 0, 2, -1, 8822],
  [2, -1, 0, -1, 8216],
  [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200],
  [2, 1, 0, -1, -3359],
];

/** The moon's place at an instant. */
export interface LunarPosition {
  /** Geocentric ecliptic longitude and latitude of date, degrees (longitude 0 to 360). */
  lonDeg: number;
  latDeg: number;
  /** The distance from the centre of the earth to the centre of the moon, km. */
  distanceKm: number;
  /** The angle between the moon and the sun seen from the earth, degrees, 0 (new) to 180 (full). */
  elongationDeg: number;
  /** The angle sun - moon - earth, degrees: 0 at full, near 180 at new. */
  phaseAngleDeg: number;
  /** The lit part of the disc as seen from the earth, 0 (new) to 1 (full). */
  illuminatedFraction: number;
  /** Days since the new moon, 0 to the synodic month (from the ecliptic longitudes: within about half a day). */
  ageDays: number;
  /** The equatorial position of date, degrees. */
  raDeg: number;
  decDeg: number;
  /** The point of the earth under the moon (the subsolar point's counterpart), degrees. */
  sublunar: { lon: number; lat: number };
}

/** Julian centuries from J2000.0. */
const centuries = (ms: number): number => (ms - J2000_MS) / 86_400_000 / 36525;

/** The sum of a table at the arguments (radians), the terms that hold the sun's anomaly scaled by the eccentricity of the earth's orbit (`e`, once for a multiple of 1, squared for 2). */
function series(terms: readonly Term[], fn: (x: number) => number, D: number, M: number, Mp: number, F: number, e: number): number {
  let sum = 0;
  for (const [d, m, mp, f, c] of terms) {
    const scale = m === 0 ? 1 : Math.abs(m) === 1 ? e : e * e;
    sum += c * scale * fn(d * D + m * M + mp * Mp + f * F);
  }
  return sum;
}

/** The moon's place at `ms` (epoch milliseconds, UTC: the difference to dynamical time, about a minute, is a hundredth of a degree for the moon). */
export function lunarPosition(ms: number): LunarPosition {
  const T = centuries(ms);
  const T2 = T * T;
  // The mean elements (degrees): the moon's mean longitude, the mean elongation, the sun's and the moon's mean anomaly, the moon's argument of latitude
  const Lp = wrap360(218.3164477 + 481267.88123421 * T - 0.0015786 * T2);
  const D = wrap360(297.8501921 + 445267.1114034 * T - 0.0018819 * T2) * RAD;
  const M = wrap360(357.5291092 + 35999.0502909 * T - 0.0001536 * T2) * RAD;
  const Mp = wrap360(134.9633964 + 477198.8675055 * T + 0.0087414 * T2) * RAD;
  const F = wrap360(93.272095 + 483202.0175233 * T - 0.0036539 * T2) * RAD;
  const e = 1 - 0.002516 * T - 0.0000074 * T2;
  // Venus, Jupiter and the flattening of the earth
  const A1 = (119.75 + 131.849 * T) * RAD;
  const A2 = (53.09 + 479264.29 * T) * RAD;
  const A3 = (313.45 + 481266.484 * T) * RAD;
  const LpRad = Lp * RAD;

  const sumL = series(LONGITUDE, Math.sin, D, M, Mp, F, e) + 3958 * Math.sin(A1) + 1962 * Math.sin(LpRad - F) + 318 * Math.sin(A2);
  const sumR = series(DISTANCE, Math.cos, D, M, Mp, F, e);
  const sumB =
    series(LATITUDE, Math.sin, D, M, Mp, F, e) -
    2235 * Math.sin(LpRad) +
    382 * Math.sin(A3) +
    175 * Math.sin(A1 - F) +
    175 * Math.sin(A1 + F) +
    127 * Math.sin(LpRad - Mp) -
    115 * Math.sin(LpRad + Mp);

  const lonDeg = wrap360(Lp + sumL / 1e6);
  const latDeg = sumB / 1e6;
  const distanceKm = 385_000.56 + sumR / 1e3;

  // The sun (the Astronomical Almanac's low-precision position, as `subsolarPoint`)
  const n = (ms - J2000_MS) / 86_400_000;
  const sunMean = wrap360(280.46 + 0.9856474 * n);
  const g = wrap360(357.528 + 0.9856003 * n) * RAD;
  const sunLon = wrap360(sunMean + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g));
  const sunDistanceKm = (1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g)) * AU_KM;

  // The phase (chapter 48): the elongation, then the angle at the moon
  const dLon = (lonDeg - sunLon) * RAD;
  const cosPsi = Math.cos(latDeg * RAD) * Math.cos(dLon);
  const psi = Math.acos(Math.min(1, Math.max(-1, cosPsi)));
  const phaseAngle = Math.atan2(sunDistanceKm * Math.sin(psi), distanceKm - sunDistanceKm * Math.cos(psi));
  const ageDays = (wrap360(lonDeg - sunLon) / 360) * LUNAR.synodicDays;

  // The equatorial position, and the point of the earth under the moon
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const lam = lonDeg * RAD;
  const bet = latDeg * RAD;
  const ra = Math.atan2(Math.sin(lam) * Math.cos(eps) - Math.tan(bet) * Math.sin(eps), Math.cos(lam)) * DEG;
  const dec = Math.asin(Math.sin(bet) * Math.cos(eps) + Math.cos(bet) * Math.sin(eps) * Math.sin(lam)) * DEG;
  const gmst = wrap360(280.46061837 + 360.98564736629 * n);

  return {
    lonDeg,
    latDeg,
    distanceKm,
    elongationDeg: psi * DEG,
    phaseAngleDeg: phaseAngle * DEG,
    illuminatedFraction: (1 + Math.cos(phaseAngle)) / 2,
    ageDays,
    raDeg: wrap360(ra),
    decDeg: dec,
    sublunar: { lon: normalizeLon(ra - gmst), lat: dec },
  };
}
