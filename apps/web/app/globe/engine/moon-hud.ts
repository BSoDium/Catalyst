/**
 * The numbers behind the moon's orbit display (#586): what the card shows around the orbit once its words are clear, a spaceship's readout. Pure: the orbit's position at an
 * angle comes in as a function, the sun as a unit vector, both in the earth-fixed frame, so this knows nothing of the camera or the scene.
 */
import { eclipseOf, moonShadowOn, type Vec3 } from "./moon";

/** The share of the disc the sun lights, as the earth sees it: 0 new moon (between the earth and the sun) to 1 full (the earth between). `p` is the moon's centre, `sun` the unit direction to the sun. */
export function litShare(p: Vec3, sun: Vec3): number {
  const d = Math.hypot(p[0], p[1], p[2]);
  if (d === 0) return 0;
  const cos = (p[0] * sun[0] + p[1] * sun[1] + p[2] * sun[2]) / d;
  return Math.min(1, Math.max(0, (1 - cos) / 2));
}

/** The phase's name from the lit share and whether it is growing. The quarters are named by a band around a half, as the eye reads them. */
export function phaseName(lit: number, waxing: boolean): string {
  if (lit < 0.03) return "New moon";
  if (lit > 0.97) return "Full moon";
  if (lit >= 0.45 && lit <= 0.55) return waxing ? "First quarter" : "Last quarter";
  const side = waxing ? "Waxing" : "Waning";
  return lit < 0.5 ? `${side} crescent` : `${side} gibbous`;
}

/** The darkening (`eclipseOf().dark`) over which the moon counts as in an eclipse. */
export const ECLIPSE_FROM = 0.08;

export interface EclipseAhead {
  /** The moon is in the shadow now. */
  now: boolean;
  /** The angle (radians, ahead of the moon on its orbit) where the next shadow begins; null when the orbit never meets it. 0 while `now`. */
  fromAngle: number | null;
  /** The angle ahead where the moon is deepest in the shadow; null as above. */
  peakAngle: number | null;
  /** The angle ahead where it leaves the shadow again; null as above, and when it does not within a lap. */
  endAngle: number | null;
}

/**
 * Where, along the orbit, a thing of `strength(a)` (0 is none, over `threshold` is in it) next begins, peaks and ends, `a` radians ahead of the moon. Scans one lap in `steps`. The peak is the middle of
 * the stretch where it is at its strongest (a shadow's full strength is a plateau, not a point).
 */
export function spanAhead(strength: (ahead: number) => number, threshold: number, steps = 360): EclipseAhead {
  const now = strength(0) > threshold;
  let from: number | null = now ? 0 : null;
  let end: number | null = null;
  const inside: { a: number; s: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (2 * Math.PI * i) / steps;
    const s = strength(a);
    if (from === null) {
      if (s > threshold) {
        from = a;
        inside.push({ a, s });
      }
      continue;
    }
    if (s <= threshold) {
      end = a;
      break;
    }
    inside.push({ a, s });
  }
  if (from === null) return { now, fromAngle: null, peakAngle: null, endAngle: null };
  const top = Math.max(...inside.map((p) => p.s));
  const level = inside.filter((p) => p.s >= top - 0.01 * Math.abs(top));
  return { now, fromAngle: from, peakAngle: (level[0]!.a + level[level.length - 1]!.a) / 2, endAngle: end };
}

/**
 * Where, along the orbit, the moon next meets the earth's shadow: `at(a)` is the moon's centre when it has gone `a` radians further. Scans one lap in `steps`.
 * The earth's turn under the orbit is not followed (the lap is short against it): this is the shadow as it stands now.
 */
export function eclipseAhead(at: (ahead: number) => Vec3, sun: Vec3, steps = 360): EclipseAhead {
  return spanAhead((a) => eclipseOf(at(a), sun).dark, ECLIPSE_FROM, steps);
}

/** How far into the moon's shadow on the earth the ground is, 0..1 at the nearest: 0 where it misses (`moonShadowOn`). */
export function solarStrength(p: Vec3, sun: Vec3): number {
  const m = moonShadowOn(p, sun);
  return m ? Math.max(0, 1 - Math.hypot(...m.axis) / (1 + m.fall)) : 0;
}

/** Where, along the orbit, the moon's shadow falls on the earth (a solar eclipse), as `eclipseAhead` does for the earth's on the moon. */
export function solarAhead(at: (ahead: number) => Vec3, sun: Vec3, steps = 360): EclipseAhead {
  return spanAhead((a) => solarStrength(at(a), sun), 0.02, steps);
}

/** `ms` as mm:ss, for the countdown (a day and over is "--:--"). */
export function clock(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0 || ms >= 3_600_000) return "--:--";
  const s = Math.round(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
