/** Mapping between the app's `GlobeViewState` (zoom in [0, 1]) and the internal zoom (globe zoom levels). */
import { clamp, type ViewState } from "./geo";
import type { GlobeViewState } from "../types";

/** 0 = whole globe fits, 1 = closest. Linear in zoom levels, so it is stable across viewport sizes. */
export function zoomTo01(zoom: number, minZoom: number, maxZoom: number): number {
  return maxZoom > minZoom ? clamp((zoom - minZoom) / (maxZoom - minZoom), 0, 1) : 0;
}

export function zoomFrom01(z01: number, minZoom: number, maxZoom: number): number {
  return minZoom + clamp(z01, 0, 1) * (maxZoom - minZoom);
}

export function toViewState(v: ViewState, minZoom: number, maxZoom: number): GlobeViewState {
  return { lon: v.lon, lat: v.lat, zoom: zoomTo01(v.zoom, minZoom, maxZoom) };
}

export const sameView = (a: GlobeViewState | null, b: GlobeViewState) =>
  a !== null && a.lon === b.lon && a.lat === b.lat && a.zoom === b.zoom;
