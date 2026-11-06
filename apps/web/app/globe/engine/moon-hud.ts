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
  /** The angle (radians, ahead of the moon on its orbit) where the shadow in question begins: negative while the moon is already in it; null when the orbit has none. */
  fromAngle: number | null;
  /** The angle ahead where it is deepest: the middle of the shadow. */
  peakAngle: number | null;
  /** The angle ahead where the moon leaves the shadow. */
  endAngle: number | null;
}

/** The part of a lap, ahead of the moon, that is looked at: a quarter lap behind it (a shadow it is in, or has just left) and the rest of the lap in front. */
const BEHIND = Math.PI / 2;

/**
 * The shadow (a thing of `strength(a)`, `a` radians ahead of the moon, over `threshold` is in it) the moon is in or comes to next: where it begins (negative if it is in it), its middle and where it ends.
 * It is a fixed stretch of the orbit and the moon moves along it, so the ends are found at a fine step and refined by halving (the edges move smoothly with the moon and the earth's turn, not by a step at
 * a time). A shadow the moon has completely left is not looked at (it is over: the next is a lap away); null when the orbit has none.
 */
export function spanAhead(strength: (ahead: number) => number, threshold: number, steps = 360): EclipseAhead {
  const lo0 = -BEHIND;
  const hi0 = 2 * Math.PI - BEHIND;
  const inside = (a: number) => strength(a) > threshold;
  // the edge between `out` (not in) and `inn` (in), to a thousandth of a degree
  const edge = (out: number, inn: number): number => {
    for (let k = 0; k < 14; k++) {
      const mid = (out + inn) / 2;
      if (inside(mid)) inn = mid;
      else out = mid;
    }
    return (out + inn) / 2;
  };
  let prev = lo0;
  let was = inside(prev);
  let from: number | null = was ? lo0 : null;
  for (let i = 1; i <= steps; i++) {
    const a = lo0 + ((hi0 - lo0) * i) / steps;
    const is = inside(a);
    if (is && !was) from = edge(prev, a);
    if (!is && was && from !== null) {
      const end = edge(a, prev);
      if (end > 0) return { now: from <= 0, fromAngle: from, peakAngle: (from + end) / 2, endAngle: end };
      from = null; // over: the moon has left it
    }
    prev = a;
    was = is;
  }
  if (from !== null) return { now: from <= 0, fromAngle: from, peakAngle: null, endAngle: null };
  return { now: false, fromAngle: null, peakAngle: null, endAngle: null };
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
