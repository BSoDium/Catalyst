/**
 * The smooth experiment (`?smooth`, or sessionStorage "smooth" = "1"): the globe's own picture drawn with coverage instead of whole pixels, so that a slow turn is a glide and not
 * a hop across the art grid. Two things, both off by default:
 *  - MSAA on the globe's canvas (`antialias`), so a one-pixel line at a fraction of a pixel is a fraction of a pixel's tone (the palette's ramp blends: pixels are no longer all
 *    one of its levels), and the planet's limb and the coastlines move by tone;
 *  - the idle rotation at the display's rate (not ten frames a second, `ENERGY.spinFrameMs`), so that there are frames to see it in. This is the cost: the home screen draws every
 *    frame it is turning, where it draws ten a second now.
 * The stippled land (a dither anchored to the screen) and its edges stay whole pixels: the experiment says how far coverage alone gets.
 */
export const SMOOTH_STATE = { enabled: false };

export function applySmoothFlags(): void {
  SMOOTH_STATE.enabled = false;
  try {
    SMOOTH_STATE.enabled = new URLSearchParams(location.search).has("smooth") || sessionStorage.getItem("smooth") === "1";
  } catch {
    // no storage: keep the default
  }
}
