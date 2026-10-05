/**
 * Markers are drawn WHOLE or not at all (the rule of engine/visibility.ts for the globe, here for a map that is a
 * globe at low zoom and a Web Mercator map from about z12):
 *
 *  1. the marker's snapped footprint (a block of whole art pixels) must lie inside the container box, so the map edge
 *     never crops half a marker;
 *  2. while the projection is still a globe (below `MERCATOR_FROM`), the place must be on the hemisphere facing the
 *     camera and at least `TUNING.markerLimbClearance` art pixels inside the silhouette, so a drawn marker never
 *     reaches the limb. That test reuses the globe's own camera model through the registration, so it agrees with
 *     the Three globe at the handover.
 *
 * The decision uses the unsnapped projected position for 2 (no flicker from snapping) and the snapped one for 1
 * (it is the footprint that is drawn). Picking and labels read this same answer.
 */
import { projectLonLat, viewBasis } from "../../engine/geo";
import { markerShown } from "../../engine/visibility";
import { registerMapToGlobe, type MapView } from "./registration";
import { STREET_TUNING } from "../tuning";

/** MapLibre blends the globe into Web Mercator between z11 and z12; from here the limb is far off screen. */
export const MERCATOR_FROM = 11.5;

export interface MarkerViewport {
  width: number;
  height: number;
  /** Where the view centre lands: the middle of the free area when an inset covers the right edge. */
  centreX: number;
}

/** Whole-block footprint check: a marker of `sizeCells` cells centred on the snapped cell centre `(sx, sy)`. */
export function footprintInside(sx: number, sy: number, sizeCells: number, cellCss: number, vp: Pick<MarkerViewport, "width" | "height">): boolean {
  const half = (sizeCells * cellCss) / 2;
  return sx - half >= 0 && sy - half >= 0 && sx + half <= vp.width && sy + half <= vp.height;
}

/** Front hemisphere and limb clearance for a place, from the camera (globe regime only). */
export function onVisibleGlobe(place: { lon: number; lat: number }, view: MapView, vp: MarkerViewport, cellCss: number): boolean {
  if (view.zoom >= MERCATOR_FROM) return true;
  const basis = viewBasis(registerMapToGlobe(view), vp.height);
  const p = projectLonLat(place.lon, place.lat, basis, vp.width, vp.height, 1, vp.centreX);
  return markerShown(p, basis, vp.centreX, vp.height / 2, STREET_TUNING.markerLimbClearance * cellCss);
}

export function markerDrawn(
  place: { lon: number; lat: number },
  snapped: { x: number; y: number },
  sizeCells: number,
  view: MapView,
  vp: MarkerViewport,
  cellCss: number,
): boolean {
  return footprintInside(snapped.x, snapped.y, sizeCells, cellCss, vp) && onVisibleGlobe(place, view, vp, cellCss);
}
