/**
 * The smooth experiment (`?smooth`, `?smooth=0.5`, or sessionStorage "smooth" = "1" or a number): the globe drawn with coverage instead of whole pixels, so that a slow turn is a
 * glide and not a hop across the art grid, at an INTENSITY from 0 (the art grid, as the page is by default) to 1 (full coverage, no steps), to be tuned by eye until it feels like a
 * screen's pixels and not like stutter. Off by default; a bare `?smooth` is 0.5.
 *
 *  - MSAA on the globe's canvas (`antialias`; creation time: a reload), so a one-pixel line at a fraction of a pixel is a fraction of a pixel's tone. It is on or off.
 *  - The moon's silhouette is drawn with coverage over `amount` of a pixel: 0 is a hard edge (a pixel is in or out), 1 a pixel of coverage (engine/moon-layer.ts). Live.
 *  - A slight blur on the globe's canvas, `amount` times `blur` of an art cell (`blur` is 0.2: a fifth): the pixels' edges bleed into each other as an LCD's do, which hides a one-pixel
 *    step without hiding the grid. A CSS `filter` on the canvas, so the GPU's compositor does it. Live, and its own knob (`__smooth.blur(x)`), because the Earth wants less than the moon.
 *  - The idle rotation at the display's rate (not ten frames a second, `ENERGY.spinFrameMs`), so that there are frames to see it in. The cost: the home screen draws every frame it
 *    is turning, where it draws ten a second now.
 * The stippled land (a dither anchored to the screen) and its edges stay whole pixels in the picture itself: the experiment says how far coverage alone gets.
 *
 * Live: `window.__smooth.set(0.3)` in the console (and `.get()`), `window.__smooth.blur(0.15)` for the blur's own strength (`.getBlur()`); the moon and the blur follow at once, MSAA only after a
 * reload.
 */
export const SMOOTH_STATE = { enabled: false, amount: 0, /** The blur at intensity 1, in art cells: the Earth was too smooth at a third, so a fifth. */ blur: 0.2 };

/** The default intensity of a bare `?smooth`. */
export const SMOOTH_DEFAULT = 0.5;

const listeners = new Set<() => void>();

/** Be told when the intensity changes (the renderer re-applies its blur and asks for a frame). Returns the way out. */
export function onSmoothChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The intensity a `?smooth` flag or a stored value asks for: null when it asks for none. `"" | "1"` -> the default (bare flag) / 1, a number in 0..1 is itself. */
export function parseSmooth(value: string | null): number | null {
  if (value === null) return null;
  if (value === "") return SMOOTH_DEFAULT;
  const n = Number(value);
  if (!Number.isFinite(n)) return SMOOTH_DEFAULT;
  return Math.min(1, Math.max(0, n));
}

export function setSmooth(amount: number): void {
  SMOOTH_STATE.amount = Math.min(1, Math.max(0, amount));
  for (const fn of listeners) fn();
}

/** The blur at intensity 1, in art cells (0 to 1). */
export function setSmoothBlur(cells: number): void {
  SMOOTH_STATE.blur = Math.min(1, Math.max(0, cells));
  for (const fn of listeners) fn();
}

export function applySmoothFlags(): void {
  SMOOTH_STATE.enabled = false;
  SMOOTH_STATE.amount = 0;
  try {
    const q = new URLSearchParams(location.search);
    const asked = parseSmooth(q.has("smooth") ? q.get("smooth") : sessionStorage.getItem("smooth"));
    if (asked === null) return;
    SMOOTH_STATE.enabled = true;
    SMOOTH_STATE.amount = asked;
    (window as unknown as { __smooth?: unknown }).__smooth = { get: () => SMOOTH_STATE.amount, set: setSmooth, getBlur: () => SMOOTH_STATE.blur, blur: setSmoothBlur };
  } catch {
    // no storage: keep the default
  }
}
