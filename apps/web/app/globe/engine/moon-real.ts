/**
 * The REAL readouts of the moon's orbit display (#631, #632): every value is a tested function of the clock (`lunar-ephemeris.ts`, `daylight.ts`), never a scene constant. Pure: the caller gives the time.
 * They are scalar maths for the HUD tick (about 10 times a second at most, cached by `realLines`), never per pixel. Each line starts with `REAL`: no scene constant is printed as a physical quantity (#628).
 */
import { sunAngularRadiusDeg, sunDistanceAu } from "./daylight";
import { daysToAnomaly, lunarPosition, moonAngularSizeDeg, moonEquatorInclinationDeg, moonSpeedKmS, nextPhaseMs, LUNAR } from "./lunar-ephemeris";

const thousands = (n: number): string => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const date = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const days = (d: number): string => (d < 1 ? `${(d * 24).toFixed(0)} H` : `${d.toFixed(1)} D`);
const sign = (n: number, pos: string, neg: string): string => `${Math.abs(n).toFixed(1)} ${n >= 0 ? pos : neg}`;

/** The live REAL lines at `ms`. */
export function computeRealLines(ms: number): string[] {
  const p = lunarPosition(ms);
  return [
    `REAL RANGE ${thousands(p.distanceKm)} KM`,
    `REAL VEL ${moonSpeedKmS(p.distanceKm).toFixed(2)} KM/S`,
    `REAL PERIGEE IN ~${days(daysToAnomaly(ms, 0))}`,
    `REAL APOGEE IN ~${days(daysToAnomaly(ms, 180))}`,
    `REAL ANG SIZE ${moonAngularSizeDeg(p.distanceKm).toFixed(2)}° (SUN ${(2 * sunAngularRadiusDeg(ms)).toFixed(2)}°)`,
    `REAL SUN ${sunDistanceAu(ms).toFixed(4)} AU`,
    `REAL ECL LON ${p.lonDeg.toFixed(1)}° LAT ${p.latDeg >= 0 ? "+" : "-"}${Math.abs(p.latDeg).toFixed(1)}°`,
    `REAL SUBLUNAR ${sign(p.sublunar.lat, "N", "S")} ${sign(p.sublunar.lon, "E", "W")}`,
    `REAL AGE ${p.ageDays.toFixed(1)} D`,
    `REAL ILLUM ${(p.illuminatedFraction * 100).toFixed(1)}%`,
    `REAL NEXT FULL ${date(nextPhaseMs(ms, 180))}`,
    `REAL NEXT NEW ${date(nextPhaseMs(ms, 0))}`,
    `REAL INCL ${LUNAR.inclinationDeg.toFixed(1)}° ECL, ${moonEquatorInclinationDeg(ms).toFixed(1)}° EQ`,
  ];
}

let cache: { bucket: number; lines: string[] } | null = null;

/** `computeRealLines`, kept for 100 ms (the HUD's tick): the frames in between reuse it. */
export function realLines(ms: number): string[] {
  const bucket = Math.floor(ms / 100);
  if (!cache || cache.bucket !== bucket) cache = { bucket, lines: computeRealLines(ms) };
  return cache.lines;
}
