/**
 * Pure maths of the globe-to-street handover (unit tested, no DOM, no GL). The controller (controller.ts) applies it.
 *
 * ONE camera: the globe renderer owns the view, in its INTERNAL zoom (`zu`, globe zoom levels). Its range goes beyond
 * the Three.js globe's own maximum (6.5): above it the same number is the street map's camera through
 * `registerGlobeToMap` (`zoom_map = zu + log2 cos lat`). Everything below is a function of that one number, so the
 * dissolve is scrubbable in both directions, needs no state machine to flap, and a gesture, a flight or a restored
 * view all behave the same.
 *
 *   zu <  mountZoom                street chunk not loaded (unmounted again below `unmountZoom`)
 *        followZoom ..             the street map follows the camera, invisible, to have its tiles ready
 *   CUT (default, `HANDOVER.dissolve = false`):
 *        zu >= cutZoom             as soon as the street map has its tiles for the camera (or `cutMaxWaitMs` passed):
 *                                  ONE instant swap of renderer, markers and labels; Three.js is suspended (no frames)
 *        zu <  cutBackZoom         the same swap the other way (hysteresis: no flapping at the threshold)
 *   DISSOLVE (`HANDOVER.dissolve = true`, kept for when the fade is mastered):
 *        blendStart .. blendEnd    pixel-grid (Bayer) dissolve from the Three.js render to the street render
 *        zu >= blendEnd            the street map alone is drawn; Three.js is suspended (no frames)
 */
import { TUNING } from "../engine/tuning";
import { clamp } from "../engine/geo";
import { zoomCorrection } from "../street/core/registration";

export const HANDOVER = {
  /** The street chunk is requested and the map created from here (the chunk is large: start early). */
  mountZoom: 2.6,
  /** ... and released below this, after `unmountDelayMs` (hysteresis: the chunk and tiles stay warm while the user hovers). */
  unmountZoom: 1.9,
  unmountDelayMs: 2500,
  /** From here the street map follows the camera while still invisible, so its tiles are loaded when the dissolve starts. */
  followZoom: 3.0,
  /** Trailing debounce of the invisible follow (ms): tiles for where the camera rests, not for every frame of a drag. */
  followDebounceMs: 140,
  /**
   * false (default): a clean CUT between the renderers at `cutZoom`; true: the dither dissolve below. The dissolve
   * code path is kept (and works) to be reintroduced once the fade is right; `boolean`, not a literal, so it can be switched.
   */
  dissolve: false as boolean,
  /** CUT: the zoom from which the street map replaces the globe (the middle of the dissolve range: both are registered there). */
  cutZoom: 3.7,
  /** CUT: the street map gives way to the globe again below this zoom (hysteresis against flapping at the threshold). */
  cutBackZoom: 3.45,
  /**
   * CUT: how long to wait for the street map's tiles past the threshold before swapping anyway (ms): never a stalled globe. A short wait
   * only: the street map keeps the bundled world lines under its tile lines while tiles load (`WORLD_PLACEHOLDER_BELOW` in
   * street/style/street-style.ts), so a swap onto a half-loaded map shows the globe's own lines and the tile lines cross-fade in when
   * they arrive; the wait just avoids the second transition on a normal connection. (The world-scale tiles are heavy: a z3 tile holds
   * every region border of a continent, a second or more on a slow network.)
   */
  cutMaxWaitMs: 1200,
  /**
   * CUT: the swap is a tone cross-fade of this many ms (about a quarter of a second: the loudest map tone is 10 levels of the 24 ms ease). Going to the street
   * map it starts from the globe's last frame, going back it eases to the globe's frames; 0 or reduced motion: an instant swap.
   */
  crossfadeMs: 300,
  /** DISSOLVE: the blend is a function of zoom between these two. */
  blendStart: 3.3,
  blendEnd: 4.1,
  /** Slew limit of the dissolve value: a full 0 to 1 swing takes at least this long (fast flicks, availability changes). */
  dissolveMs: 450,
  /** Markers and labels switch to the street map's own overlay once the dissolve is this far (with hysteresis). */
  overlayIn: 0.8,
  overlayOut: 0.65,
  /** The globe's lifted route arcs flatten onto the ground between these zooms, ahead of the dissolve. */
  routeFlat: { start: 2.5, end: 3.3 },
  /**
   * Sharp-focus circle around the selected place at street scale. OFF by default: with the cut and the city-wide framing
   * the anti-aliased source render inside the circle sits over the pixel art and reads as doubled lines (the Seine,
   * the boulevards) rather than as a focus. Reintroduce together with the dissolve.
   */
  revealFocus: false,
  /** Delay after arrival before the focus circle opens (ms). */
  revealDelayMs: 450,
  /** A direct load framed at street scale waits this long (ms) for the street map before it shows the globe's frame instead. */
  revealWaitMs: 1500,
  /** The stage fades in from the page colour over this long (ms), instantly under reduced motion. */
  fadeInMs: 500,
} as const;

/** The Three.js globe's own maximum internal zoom: above it only the street map can draw. */
export const GLOBE_MAX_ZOOM = TUNING.maxZoom;

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Dissolve target (0 = Three.js only, 1 = street only) for a zoom. */
export function blendAt(zu: number): number {
  const { blendStart: a, blendEnd: b } = HANDOVER;
  return smooth(clamp((zu - a) / (b - a), 0, 1));
}

/** How lifted the globe's route arcs are at a zoom: 1 on the globe, 0 on the ground (as the street draws them). */
export function routeLift(zu: number): number {
  const { start, end } = HANDOVER.routeFlat;
  return 1 - smooth(clamp((zu - start) / (end - start), 0, 1));
}

/** Move `current` towards `target` by at most one full swing per `ms` (0 ms = instant). */
export function slew(current: number, target: number, dtMs: number, ms: number = HANDOVER.dissolveMs): number {
  if (ms <= 0) return target;
  const step = Math.max(0, dtMs) / ms;
  return current < target ? Math.min(target, current + step) : Math.max(target, current - step);
}

export type OverlayOwner = "globe" | "street";

/** Who draws markers and labels, with hysteresis on the dissolve value. */
export function overlayOwner(previous: OverlayOwner, blend: number): OverlayOwner {
  if (previous === "globe") return blend >= HANDOVER.overlayIn ? "street" : "globe";
  return blend <= HANDOVER.overlayOut ? "globe" : "street";
}

/** The street map's Mercator zoom for a unified zoom at a latitude, and back. */
export const toMapZoom = (zu: number, lat: number) => zu + zoomCorrection(lat);
export const fromMapZoom = (zm: number, lat: number) => zm - zoomCorrection(lat);

/**
 * Unified zoom a selection flies to, given `fit` (the zoom at which the place's view radius fits the free area, see
 * engine/framing.ts). With the street map possible: exactly the framing (it may zoom out as well as in), at most the
 * street map's maximum. Without it: the regional select zoom, never zooming out (as before street scale existed), or
 * the framing if that is further out.
 */
export function selectionZoom(fit: number, lat: number, streetPossible: boolean, current: number): number {
  if (streetPossible) return Math.min(fit, zoomCeiling(lat, true));
  return Math.max(current, Math.min(fit, TUNING.selectZoom));
}

/**
 * CUT mode: whether the street map should be the one shown, with hysteresis (`showing`: it is now). A street map
 * that is not usable shows nothing, unless the camera is still up there (retreat), as for the dissolve.
 */
export function cutWanted(showing: boolean, zu: number, streetOk: boolean): boolean {
  if (!streetOk && !(zu > GLOBE_MAX_ZOOM + 1e-6)) return false;
  return showing ? zu >= HANDOVER.cutBackZoom : zu >= HANDOVER.cutZoom;
}

/** Highest unified zoom the experience offers at a latitude: the street map's maximum, or the globe's when there is no street. */
export function zoomCeiling(lat: number, streetOk: boolean): number {
  return streetOk ? fromMapZoom(TUNING.streetMapMaxZoom, lat) : GLOBE_MAX_ZOOM;
}

/** Whether the street map should exist, with hysteresis. `wanted`: a place is selected or a street view is being restored. */
export function mountWanted(mounted: boolean, zu: number, wanted: boolean): boolean {
  if (wanted) return true;
  return mounted ? zu >= HANDOVER.unmountZoom : zu >= HANDOVER.mountZoom;
}

/** Dissolve target given availability: a street that is not usable shows nothing, unless the camera is still up there (retreat). */
export function blendTarget(zu: number, streetOk: boolean): number {
  return streetOk || zu > GLOBE_MAX_ZOOM + 1e-6 ? blendAt(zu) : 0;
}
