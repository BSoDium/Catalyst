/**
 * The immersive zoom of a narrow screen (pure, `immersion.test.ts`). The home screen rests at the planet's size that clears its caption and the page's content: on a phone that is a small planet,
 * a fourth of the screen. When the visitor takes the globe (the first gesture on it) that is too far: the planet comes closer, until its disc is wider than the screen and fills its height, the
 * sides cut off. That zoom is the phone's WORLD VIEW: everything the whole-globe fit is on a wide window (the night, the sun and its flare, the moon, the idle rotation, the way back to the
 * home screen) is measured from it, not from the fit, so none of them goes out the moment the planet comes closer.
 *
 * A window's narrowness is smooth (`LANDING.narrowPx` and below: all of it; `LANDING.widePx` and over: none), so a tablet or a resized window does not jump.
 */
import { clamp, silhouetteZoom } from "./geo";
import { LANDING } from "./tuning";

export const IMMERSION = {
  /** The planet's radius, in half widths of the screen: over 1 it is wider than the screen, the sides cut off. */
  overscan: 1.25,
  /** The most the radius is, in screen heights (a window that is not tall must not be filled by a planet of many heights). */
  maxHeightShare: 0.36,
  /** How long the planet takes to come closer, ms. */
  glideMs: 1100,
} as const;

/** How much of the immersion a window gets, 0 (a wide one) to 1 (a phone), a smoothstep over `LANDING.narrowPx` to `LANDING.widePx`. */
export function narrowness(width: number): number {
  const t = clamp((width - LANDING.narrowPx) / (LANDING.widePx - LANDING.narrowPx), 0, 1);
  return 1 - t * t * (3 - 2 * t);
}

/**
 * The zoom of the world view in a window `width` x `height` (CSS px) whose whole-globe fit is `fit`: the fit on a wide window, and on a narrow one the zoom at which the planet's radius is
 * `IMMERSION.overscan` half widths (at most `IMMERSION.maxHeightShare` of the height), never less than the fit. 0 for a window with no size: the fit.
 */
export function immersiveZoom(width: number, height: number, fit: number): number {
  const k = narrowness(width);
  if (!(k > 0) || !(width > 0) || !(height > 0)) return fit;
  const radius = Math.min((IMMERSION.overscan * width) / 2, IMMERSION.maxHeightShare * height);
  const zoom = silhouetteZoom(radius, height);
  return fit + Math.max(0, zoom - fit) * k;
}
