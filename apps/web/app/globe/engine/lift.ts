/**
 * The lift (pure, unit tested in `lift.test.ts`): how far the planet's centre goes UP while something (the landing hero) covers the bottom of the
 * page. The planet keeps its size and the app's measured cover decides; the room above decides the most: whatever is highest on the screen (the
 * planet's top, or the ring of type where it is shown) keeps `marginPx` from the top edge, so the planet is never pushed out of the window.
 *
 *   without a lift the lowest drawn point (the ring's) is at   height / 2 + reach
 *   what covers it starts at                             height - cover
 *   the lift that clears it (with `gapPx` of air)        height / 2 + reach + gapPx - (height - cover)          (never negative)
 *   the room above                                       height / 2 - reachTopPx - marginPx                        (never negative)
 *
 * The result is a function of the viewport, the cover and the planet at its lowest zoom (the one the home screen rests at), not of the zoom now:
 * nothing moves while the camera does.
 */
import { clamp } from "./geo";
import { LANDING, LIFT } from "./tuning";

export interface LiftArgs {
  /** CSS px of the container's bottom that the app covers (from the container's bottom edge to the top of what covers the planet). */
  cover: number;
  /** The container's height, CSS px. */
  height: number;
  /** The planet's silhouette radius at the zoom the lift is for, CSS px. */
  planetPx: number;
  /** How far above the planet's centre the highest drawn thing reaches at that zoom (the planet itself, or the ring), CSS px. At least `planetPx`. */
  reachTopPx: number;
  gapPx?: number;
  marginPx?: number;
}

/** How far the planet's centre moves up, CSS px (0 when nothing covers the planet, or when there is no room). */
export function liftFor(a: LiftArgs): number {
  const gap = a.gapPx ?? LIFT.gapPx;
  const margin = a.marginPx ?? LIFT.marginPx;
  if (!(a.cover > 0) || !(a.height > 0) || !(a.planetPx > 0)) return 0;
  // The ring runs round the planet, so what must clear the cover is the ring's bottom, as far below the centre as its top is above it.
  const reach = Math.max(a.reachTopPx, a.planetPx);
  const overlap = a.height / 2 + reach + gap - (a.height - a.cover);
  const room = a.height / 2 - reach - margin;
  return Math.max(0, Math.min(overlap, room));
}

/* ------------------------------------------------------------------ placing the globe above the home screen's content */

/** The share (`LANDING.desktop` to 1) of the largest planet that the home screen takes, by the width of the container, CSS px: 1 on a phone, smoothly less on a wide window. */
export function landingScale(width: number): number {
  const t = clamp((width - LANDING.narrowPx) / (LANDING.widePx - LANDING.narrowPx), 0, 1);
  return 1 - (1 - LANDING.desktop) * t * t * (3 - 2 * t);
}

/** A block of the home screen over the globe (`GlobeShowcase.blocks`): across the container `x0` to `x1`, its top edge `top` px from the container's top. */
export interface PlaceBlock {
  x0: number;
  x1: number;
  top: number;
}

/**
 * How far below the planet's centre the lowest line of the caption reaches, in planet radii (the four rows are centred on the equator, one cap
 * height of 0.084 and 1.7 caps from baseline to baseline, on a shell above the surface; measured on the page: 0.31, with air).
 */
export const CAPTION_BOTTOM_R = 0.32;
/** How far to each side of the planet's centre the caption's words reach, in planet radii (`CAPTION.maxHalfWidth`). */
export const CAPTION_HALF_R = 1.04;

export interface PlaceArgs {
  /** The container, CSS px, and the x of the planet's centre in it. */
  height: number;
  cx: number;
  blocks: readonly PlaceBlock[];
  /** The largest planet radius there is room for with nothing over it (CSS px). */
  rMax: number;
  /** How far above the planet's centre the highest drawn thing (the ring) reaches, as a function of the planet's radius. */
  reachTop: (r: number) => number;
  /** Air kept between the caption's lowest line and what is below it, and between the highest thing and the top edge. */
  gap?: number;
  margin?: number;
  /** The smallest radius tried. */
  rMin?: number;
}

export interface Placement {
  /** Planet radius, CSS px. */
  r: number;
  /** How far the planet's centre goes up from the middle of the height (never negative). */
  lift: number;
  /** The top edge of what is under the caption's column at that size (the container's height when nothing is). */
  top: number;
}

/**
 * The biggest planet whose CAPTION stays clear of the home screen's content, and where it goes. The planet's lower part may go under the content (it
 * is a drawing that fades into the page there; only the words must be readable): the lowest line of the caption, `CAPTION_BOTTOM_R` of a radius
 * below the centre, stays `gap` above the top of whatever stands in the column the words span (`CAPTION_HALF_R` of a radius to each side). That is
 * the MINIMUM: where there is more room the globe uses it, as big as the window allows and in the middle of the free room (the space above the ring
 * equal to the space between the planet's bottom and the content under it), never lower than the page's middle and never nearer the top than the
 * ring needs to keep its margin.
 * Searched from `rMax` downward: a smaller planet has a narrower column and may clear a block that a larger one would stand over.
 */
export function placeAbove(a: PlaceArgs): Placement | null {
  const gap = a.gap ?? LIFT.gapPx;
  const margin = a.margin ?? LIFT.marginPx;
  const rMin = a.rMin ?? 40;
  if (!(a.height > 0) || !(a.rMax > 0)) return null;
  for (let r = a.rMax; r >= rMin; r -= 2) {
    let top = a.height;
    for (const b of a.blocks) if (b.x1 > a.cx - CAPTION_HALF_R * r && b.x0 < a.cx + CAPTION_HALF_R * r) top = Math.min(top, b.top);
    const reach = Math.max(r, a.reachTop(r));
    const highest = margin + reach; // the centre cannot be nearer the top than this
    const lowest = Math.min(a.height / 2, top - gap - CAPTION_BOTTOM_R * r); // nor lower than this (and never below the page's middle)
    if (highest <= lowest) {
      // Between the two the globe takes the middle of the free room: the space above the ring equal to the space between the planet's bottom and
      // what stands under the planet (where there is room for the whole planet above the content: when there is not, the caption rule holds).
      let under = a.height;
      for (const b of a.blocks) if (b.x1 > a.cx - r && b.x0 < a.cx + r) under = Math.min(under, b.top);
      const balanced = (under - gap + reach - r) / 2;
      const centre = Math.min(lowest, Math.max(highest, balanced));
      return { r, lift: Math.max(0, a.height / 2 - centre), top };
    }
  }
  // Nothing fits: the smallest planet, as high as it goes (the caller does not draw words that would be cut or run over the content).
  let top = a.height;
  for (const b of a.blocks) if (b.x1 > a.cx - CAPTION_HALF_R * rMin && b.x0 < a.cx + CAPTION_HALF_R * rMin) top = Math.min(top, b.top);
  return { r: rMin, lift: Math.max(0, a.height / 2 - (margin + Math.max(rMin, a.reachTop(rMin)))), top };
}
