/** Mapping between the app's `GlobeViewState` and the internal (unified) zoom, in globe zoom levels. */
import { clamp, smoothstep, type ViewState } from "./geo";
import { TUNING } from "./tuning";
import type { GlobeViewState } from "../types";

/** How lifted the globe's route arcs are at a zoom: 1 on the globe, 0 on the ground (as the street draws them). */
export function routeLift(zu: number): number {
  const { start, end } = TUNING.routeFlat;
  return 1 - smoothstep(clamp((zu - start) / (end - start), 0, 1));
}

/** 0 = whole globe fits, 1 = the closest the Three.js globe goes. Linear in zoom levels, so it is stable across viewport sizes. */
export function zoomTo01(zoom: number, minZoom: number, maxZoom: number): number {
  return maxZoom > minZoom ? clamp((zoom - minZoom) / (maxZoom - minZoom), 0, 1) : 0;
}

export function zoomFrom01(z01: number, minZoom: number, maxZoom: number): number {
  return minZoom + clamp(z01, 0, 1) * (maxZoom - minZoom);
}

/**
 * Internal zoom to the app's view. Beyond the globe's maximum (`maxZoom`) `zoom` stays 1 and `street` carries the
 * extra zoom levels (street scale); below it `street` is absent, so every pre-street view is unchanged.
 */
export function toViewState(v: ViewState, minZoom: number, maxZoom: number): GlobeViewState {
  const out: GlobeViewState = { lon: v.lon, lat: v.lat, zoom: zoomTo01(v.zoom, minZoom, maxZoom) };
  if (v.zoom > maxZoom + 1e-9) out.street = v.zoom - maxZoom;
  return out;
}

/** Inverse of `toViewState`. */
export function fromViewState(v: GlobeViewState, minZoom: number, maxZoom: number): ViewState {
  return { lon: v.lon, lat: v.lat, zoom: zoomFrom01(v.zoom, minZoom, maxZoom) + Math.max(0, v.street ?? 0) };
}

export const sameView = (a: GlobeViewState | null, b: GlobeViewState) =>
  a !== null && a.lon === b.lon && a.lat === b.lat && a.zoom === b.zoom && (a.street ?? 0) === (b.street ?? 0);
