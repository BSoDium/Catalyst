/**
 * The real day and night (docs/landing.md, "The sun"): where the sun is over the earth at a given instant, and the opening state that puts the page's light there. Pure (no DOM, no three, no clock:
 * the caller gives the time), `daylight.test.ts`.
 *
 * The page's light is laid against the opening camera (`MOON.sunAzimuthDeg` to its right, at an elevation): the planet is lit as the page opens, whatever the hour. What the clock decides is WHICH side of
 * the earth that camera looks at: the camera starts over the longitude that puts the subsolar point `MOON.sunAzimuthDeg` to its right, and the earth rotation angle is whatever keeps the camera at
 * `MOON.ref` in the inertial frame (the moon's orbit, `litTurn`, the stars' lean all stay as they were). The sun's elevation is the real declination, so the terminator is where it really is.
 */
import { normalizeLon } from "./geo";
import { MOON, toRad } from "./moon";

const DEG = 180 / Math.PI;
const wrap360 = (d: number): number => ((d % 360) + 360) % 360;

/** The subsolar point (where the sun stands at the zenith) at `ms` (epoch milliseconds), degrees: the low-precision solar position of the Astronomical Almanac, good to a hundredth of a degree. */
export function subsolarPoint(ms: number): { lon: number; lat: number } {
  const n = (ms - Date.UTC(2000, 0, 1, 12)) / 86_400_000; // days since J2000.0
  const L = wrap360(280.46 + 0.9856474 * n); // mean longitude
  const g = toRad(wrap360(357.528 + 0.9856003 * n)); // mean anomaly
  const lambda = toRad(L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)); // ecliptic longitude
  const eps = toRad(23.439 - 0.0000004 * n); // obliquity
  const lat = Math.asin(Math.sin(eps) * Math.sin(lambda)) * DEG;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) * DEG;
  const gmst = wrap360(280.46061837 + 360.98564736629 * n);
  return { lon: normalizeLon(ra - gmst), lat };
}

export interface Opening {
  /** The camera's longitude at load (the planet is lit from its right). */
  lon: number;
  /** The earth rotation angle at load. */
  eraDeg: number;
  /** The sun's elevation over the equator, degrees: the declination. */
  sunElevationDeg: number;
}

/** The opening state for `ms`, or the fixed one the page had before the real sun (`ms` null: the camera at longitude 0, the sun at `MOON.sunElevationDeg`). */
export function opening(ms: number | null, fixedEraDeg: number): Opening {
  if (ms === null) return { lon: 0, eraDeg: fixedEraDeg, sunElevationDeg: MOON.sunElevationDeg };
  const sub = subsolarPoint(ms);
  const lon = normalizeLon(sub.lon - MOON.sunAzimuthDeg);
  return { lon, eraDeg: normalizeLon(MOON.ref.lonDeg - lon), sunElevationDeg: sub.lat };
}

/** Whether the page follows the clock: yes, except on a debug page (`?globe-debug`, what the browser checks run in: their assertions need the same planet every time) unless `?live-sun` asks for it. */
export function liveSun(): boolean {
  try {
    const q = new URLSearchParams(location.search);
    const debug = q.has("globe-debug") || sessionStorage.getItem("globe-debug") === "1";
    return !debug || q.has("live-sun");
  } catch {
    return false;
  }
}
