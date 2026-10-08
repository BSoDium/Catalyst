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
/**
 * Empty room around a GROUP's circle when the camera flies to it (fraction of its radius): the circle takes 1 / (1 + margin)
 * = 92 % of the smaller free side, a little more than a place's 80 %, so that its square is past `LOD.expandOut` (85 %) and
 * the squares of its children are showing when the flight arrives (engine/lod-tree.ts).
 */
export const GROUP_FRAMING_MARGIN = 0.087;

/**
 * A place's bounding box: `[west, south, east, north]` in degrees (WGS84), the true extent of the city or area the place sits
 * in (published `bbox`, independent of where the recorded point lies). Boxes that cross the antimeridian are not supported.
 */
export type Bbox = readonly [number, number, number, number];

/** A bounding box in km at its own latitude: its centre and half extents. */
export interface BboxExtents {
  lon: number;
  lat: number;
  halfXKm: number;
  halfYKm: number;
}

const KM_PER_DEG = (EARTH_RADIUS_KM * Math.PI) / 180;

/** The extents of a bounding box, or null when it is absent or not a plain box (not 4 finite numbers, west >= east, south >= north, out of range): callers then fall back to the view radius. Half extents are never 0. */
export function bboxExtentsKm(bbox: Bbox | readonly number[] | undefined | null): BboxExtents | null {
  if (!bbox || bbox.length !== 4) return null;
  const [w, s, e, n] = bbox as Bbox;
  if (![w, s, e, n].every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  if (!(w < e && s < n) || w < -180 || e > 180 || s < -90 || n > 90) return null;
  const lat = (s + n) / 2;
  return {
    lon: (w + e) / 2,
    lat,
    halfXKm: Math.max(1e-6, ((e - w) / 2) * KM_PER_DEG * Math.cos((lat * Math.PI) / 180)),
    halfYKm: Math.max(1e-6, ((n - s) / 2) * KM_PER_DEG),
  };
}

/**
 * The view radius that frames a bounding box with the framing formula below unchanged: the circle of this radius has as its
 * radius the box's longer half extent (the camera is centred on the box's centre: `placeFraming`), so the whole box is on screen
 * with `FRAMING_MARGIN` of room and its longer side takes 1 / (1 + margin) of the smaller free side. Clamped like any view radius;
 * null for no (valid) box.
 */
export function bboxFitRadiusKm(bbox: Bbox | readonly number[] | undefined | null): number | null {
  const ext = bboxExtentsKm(bbox);
  return ext ? effectiveRadiusKm(Math.max(ext.halfXKm, ext.halfYKm)) : null;
}

/**
 * Where the camera goes to "focus this place" and the view radius to fit there: the centre of the place's bounding box and the
 * radius that frames it when it has one (the contract: the client fits the box, centred on the box, which is not necessarily the
 * recorded point), else the recorded point and its (clamped, defaulted) view radius. Pure; feeds `radiusFitZoom` unchanged.
 * Every camera move to a place (selection flight, direct load, retreat) takes its centre and zoom from here; the marker and the
 * label stay on the recorded point (`lat`, `lon`). Boxes crossing the antimeridian are not supported (west < east is required,
 * so the centre is the plain mean of the longitudes; an invalid box falls back to the point).
 */
export function placeFraming(place: { lat: number; lon: number; viewRadiusKm?: number | undefined; bbox?: Bbox | readonly number[] | undefined }): { lon: number; lat: number; radiusKm: number } {
  const ext = bboxExtentsKm(place.bbox);
  if (ext) return { lon: ext.lon, lat: ext.lat, radiusKm: effectiveRadiusKm(Math.max(ext.halfXKm, ext.halfYKm)) };
  return { lon: place.lon, lat: place.lat, radiusKm: effectiveRadiusKm(place.viewRadiusKm) };
}

/** The radius to use for a place: its own, clamped to the contract's range, else the default. */
export function effectiveRadiusKm(radiusKm: number | undefined | null): number {
  if (typeof radiusKm !== "number" || !Number.isFinite(radiusKm)) return DEFAULT_VIEW_RADIUS_KM;
  return Math.min(VIEW_RADIUS_RANGE_KM.max, Math.max(VIEW_RADIUS_RANGE_KM.min, radiusKm));
}

/** Unified zoom (unclamped) at which the circle fits a `width` x `height` box whose right `insetRight` px are covered, with `margin` empty room (fraction of the radius). */
export function radiusFitZoom(radiusKm: number, width: number, height: number, insetRight: number, margin: number = FRAMING_MARGIN): number {
  const free = freeWidth(width, clampInset(insetRight, width));
  const circlePx = Math.max(1, Math.min(free, height)) / 2 / (1 + margin);
  return radiusPxToZoom((circlePx * EARTH_RADIUS_KM) / effectiveRadiusKm(radiusKm));
}

/**
 * Unified zoom (unclamped) at which a GROUP's circle of `radiusKm` fits the free area with `GROUP_FRAMING_MARGIN` of room.
 * A group's radius is not limited to a place's view radius range (a continent can span thousands of km), but it is kept
 * above 0.5 km.
 */
export function groupFitZoom(radiusKm: number, width: number, height: number, insetRight: number): number {
  const free = freeWidth(width, clampInset(insetRight, width));
  const circlePx = Math.max(1, Math.min(free, height)) / 2 / (1 + GROUP_FRAMING_MARGIN);
  return radiusPxToZoom((circlePx * EARTH_RADIUS_KM) / Math.max(VIEW_RADIUS_RANGE_KM.min, radiusKm));
}
