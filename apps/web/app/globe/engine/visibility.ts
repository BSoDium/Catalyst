/**
 * Whole-marker visibility (pure, unit tested).
 *
 * A marker is a sprite a few art pixels wide. It is decided from its CENTRE only: front hemisphere, and far
 * enough inside the globe's silhouette for its whole footprint to fit. It is then drawn in full (no depth test
 * against the globe) or not drawn at all. Picking, labels and the GPU all read this one answer, so they cannot
 * disagree. Nothing here depends on the pixel grid, so the answer cannot flicker from snapping.
 */
import type { ScreenPoint, ViewBasis } from "./geo";

/** Radius of the globe's silhouette on screen, in the same px as `ViewBasis.f`. */
export function silhouetteRadius(basis: ViewBasis): number {
  // A sphere of radius 1 seen from distance d subtends asin(1/d): f * tan(asin(1/d)) = f / sqrt(d^2 - 1).
  return basis.f / Math.sqrt(Math.max(basis.d * basis.d - 1, 1e-12));
}

/**
 * Distance in px from a projected point to the silhouette, measured along the radius from the view centre
 * (`centreX`, `centreY` is where the view centre lands). Positive inside the disc; meaningful for front-hemisphere points.
 */
export function limbClearance(p: Pick<ScreenPoint, "x" | "y">, basis: ViewBasis, centreX: number, centreY: number): number {
  return silhouetteRadius(basis) - Math.hypot(p.x - centreX, p.y - centreY);
}

/**
 * True when a marker centred on `p` is drawn: on the hemisphere facing the camera (`p.visible`, from
 * `projectLonLat`) and at least `clearancePx` inside the silhouette, so a footprint of that half-size never
 * reaches the limb. `p` must be unsnapped.
 */
export function markerShown(
  p: ScreenPoint,
  basis: ViewBasis,
  centreX: number,
  centreY: number,
  clearancePx: number,
): boolean {
  return p.visible && limbClearance(p, basis, centreX, centreY) >= clearancePx;
}
