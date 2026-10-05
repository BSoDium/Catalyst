/**
 * Framing from a view radius (pure, unit tested): the unified (internal) zoom at which a circle of `radiusKm` around
 * a place fits the free map area with a margin.
 *
 * The unified zoom has one scale at the view centre whatever the latitude: `zoomToRadiusPx(zu)` CSS px per radian
 * of arc (the street map's Mercator zoom differs by `log2 cos lat`, which cancels the Mercator stretch). So
 *
 *   px per km      = zoomToRadiusPx(zu) / EARTH_RADIUS_KM
 *   circle radius  = min(freeWidth, height) / 2 / (1 + FRAMING_MARGIN)       (px; the circle is the limiting shape)
 *   zu             = radiusPxToZoom(circle radius * EARTH_RADIUS_KM / radiusKm)
 *
 * `freeWidth` is the box width minus the right inset (the detail panel), so the circle is centred in, and fits,
 * the visible area, in any aspect ratio.
 */
import { clampInset, freeWidth } from "./inset";
import { radiusPxToZoom } from "./geo";

export const EARTH_RADIUS_KM = 6371.0088;
/** View radius used when a place has none (km): a typical city-wide framing (centre to edge of a mid-size city). */
export const DEFAULT_VIEW_RADIUS_KM = 12;
/** Empty room around the circle, as a fraction of its radius: the circle takes 1 / (1 + margin) = 80% of the smaller free side. */
export const FRAMING_MARGIN = 0.25;
export const VIEW_RADIUS_RANGE_KM = { min: 0.5, max: 500 } as const;

/** The radius to use for a place: its own, clamped to the contract's range, else the default. */
export function effectiveRadiusKm(radiusKm: number | undefined | null): number {
  if (typeof radiusKm !== "number" || !Number.isFinite(radiusKm)) return DEFAULT_VIEW_RADIUS_KM;
  return Math.min(VIEW_RADIUS_RANGE_KM.max, Math.max(VIEW_RADIUS_RANGE_KM.min, radiusKm));
}

/** Unified zoom (unclamped) at which the circle fits a `width` x `height` box whose right `insetRight` px are covered. */
export function radiusFitZoom(radiusKm: number, width: number, height: number, insetRight: number): number {
  const free = freeWidth(width, clampInset(insetRight, width));
  const circlePx = Math.max(1, Math.min(free, height)) / 2 / (1 + FRAMING_MARGIN);
  return radiusPxToZoom((circlePx * EARTH_RADIUS_KM) / effectiveRadiusKm(radiusKm));
}
