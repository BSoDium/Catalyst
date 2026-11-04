/**
 * The numbers behind the moon's orbit display (#586): what the card shows around the orbit once its words are clear, a spaceship's readout. Pure: the orbit's position at an
 * angle comes in as a function, the sun as a unit vector, both in the earth-fixed frame, so this knows nothing of the camera or the scene.
 */
import { eclipseOf, type Vec3 } from "./moon";

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
}

/**
 * Where, along the orbit, the moon next meets the earth's shadow: `at(a)` is the moon's centre when it has gone `a` radians further. Scans one lap in `steps`.
 * The earth's turn under the orbit is not followed (the lap is short against it): this is the shadow as it stands now.
 */
export function eclipseAhead(at: (ahead: number) => Vec3, sun: Vec3, steps = 360): EclipseAhead {
  const dark = (a: number) => eclipseOf(at(a), sun).dark;
  const now = dark(0) > ECLIPSE_FROM;
  let from: number | null = now ? 0 : null;
  let leftShadow = false;
  let peak = -1;
  let peakAt: number | null = null;
  for (let i = 0; i <= steps; i++) {
    const a = (2 * Math.PI * i) / steps;
    const d = dark(a);
    if (from === null) {
      if (d > ECLIPSE_FROM) {
        from = a;
        peak = d;
        peakAt = a;
      }
      continue;
    }
    if (d <= ECLIPSE_FROM) {
      leftShadow = true;
      if (!now) break;
      continue;
    }
    if (!leftShadow && d > peak) {
      peak = d;
      peakAt = a;
    }
  }
  if (from === null) return { now: false, fromAngle: null, peakAngle: null };
  return { now, fromAngle: from, peakAngle: peakAt };
}

/** `ms` as mm:ss, for the countdown (a day and over is "--:--"). */
export function clock(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0 || ms >= 3_600_000) return "--:--";
  const s = Math.round(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
