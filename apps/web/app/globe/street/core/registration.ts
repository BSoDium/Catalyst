/**
 * Camera registration between the Three.js globe (`engine/geo.ts`) and the MapLibre street map.
 *
 * Both cameras share the same vertical FOV (36.87 degrees) and the same zoom semantics, but MapLibre's zoom is the
 * Web Mercator zoom AT THE CENTRE LATITUDE: a globe of apparent radius R(z) in the Three engine appears with radius
 * R(z) / cos(lat) in MapLibre at the same number. The correction is therefore
 *
 *     zoom_map = zoom_globe + log2(cos(lat))        zoom_globe = zoom_map - log2(cos(lat))
 *
 * Measured (docs/street-zoom-spike.md, re-run by scripts/street/registration.mjs against this module): with it the
 * two projections of a 5x5 grid of points (+-8 degrees) agree to about 1.3 px mean, 2.1 px max at 1440x900. The
 * latitude is clamped to `TUNING.maxLat` (the globe's own clamp) so the correction stays finite near the poles.
 *
 * `zoom_globe` is the globe's INTERNAL zoom (globe zoom levels, `GlobeRenderer.getView().zoom`), not the app's [0, 1]
 * `GlobeViewState.zoom`; the `...View` variants convert with the globe's own mapping (`engine/view.ts`).
 */
import type { GlobeViewState } from "../../types";
import { DEG, clamp, type ViewState } from "../../engine/geo";
import { zoomFrom01, zoomTo01 } from "../../engine/view";
import { STREET_TUNING } from "../tuning";

export interface MapView {
  lon: number;
  lat: number;
  /** MapLibre zoom (512 px tiles). */
  zoom: number;
}

/** `log2(cos(lat))`, the zoom offset between the two engines at a centre latitude (always <= 0). */
export function zoomCorrection(lat: number): number {
  const c = Math.cos(clamp(lat, -STREET_TUNING.maxLat, STREET_TUNING.maxLat) * DEG);
  return Math.log2(c);
}

/** Globe camera (internal zoom) to the MapLibre camera that frames the same ground. */
export function registerGlobeToMap(globe: ViewState): MapView {
  return { lon: globe.lon, lat: globe.lat, zoom: globe.zoom + zoomCorrection(globe.lat) };
}

/** Inverse of `registerGlobeToMap`. */
export function registerMapToGlobe(map: MapView): ViewState {
  return { lon: map.lon, lat: map.lat, zoom: map.zoom - zoomCorrection(map.lat) };
}

export interface GlobeZoomRange {
  /** The globe's current minimum internal zoom (`GlobeRenderer.getMinZoom()`: depends on viewport and inset). */
  minZoom: number;
  /** The globe's maximum internal zoom (`TUNING.maxZoom`, 6.5). */
  maxZoom: number;
}

/** App-level globe view (zoom in [0, 1]) to the MapLibre camera. */
export function globeViewToMap(view: GlobeViewState, range: GlobeZoomRange): MapView {
  return registerGlobeToMap({ lon: view.lon, lat: view.lat, zoom: zoomFrom01(view.zoom, range.minZoom, range.maxZoom) });
}

/** MapLibre camera to the app-level globe view (zoom clamped to [0, 1]). */
export function mapToGlobeView(view: MapView, range: GlobeZoomRange): GlobeViewState {
  const g = registerMapToGlobe(view);
  return { lon: g.lon, lat: g.lat, zoom: zoomTo01(g.zoom, range.minZoom, range.maxZoom) };
}
