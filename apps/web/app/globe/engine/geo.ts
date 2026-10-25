/**
 * Pure geometry helpers shared by both renderers, the label layer and the tests.
 * Coordinate convention (unit sphere, Y up): lon 0 / lat 0 is +Z, lon +90 is +X, north is +Y.
 */
import { TUNING } from "./tuning";

export const DEG = Math.PI / 180;
export type Vec3 = readonly [number, number, number];

/** Web Mercator tile size used by MapLibre; we reuse its zoom semantics for both renderers. */
const TILE_SIZE = 512;
/** Vertical field of view in degrees. 36.87 deg (tan = 1/3) is MapLibre's default. */
export const FOV_DEG = 36.87;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Smoothstep of a value already in [0, 1]. */
export const smoothstep = (t: number) => t * t * (3 - 2 * t);

/**
 * `log2(cos(lat))`, the zoom offset between the globe's internal zoom and MapLibre's zoom at a centre latitude (always
 * <= 0; see `street/core/registration.ts` for the registration it belongs to). The latitude is clamped to the view's own
 * `TUNING.maxLat` so the value stays finite near the poles.
 */
export function zoomCorrection(lat: number): number {
  return Math.log2(Math.cos(clamp(lat, -TUNING.maxLat, TUNING.maxLat) * DEG));
}

/** Wrap a longitude into [-180, 180). */
export function normalizeLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** Signed shortest longitude difference, in (-180, 180]. */
export function shortestLonDelta(from: number, to: number): number {
  const d = normalizeLon(to - from);
  return d === -180 ? 180 : d;
}

export function lonLatToVec3(lon: number, lat: number): [number, number, number] {
  const phi = lat * DEG;
  const lam = lon * DEG;
  const c = Math.cos(phi);
  return [c * Math.sin(lam), Math.sin(phi), c * Math.cos(lam)];
}

export function vec3ToLonLat(v: Vec3): { lon: number; lat: number } {
  const [x, y, z] = v;
  return { lon: Math.atan2(x, z) / DEG, lat: Math.asin(clamp(y / Math.hypot(x, y, z), -1, 1)) / DEG };
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (a: Vec3): [number, number, number] => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Great-circle angular distance in radians. */
export function angularDistance(aLon: number, aLat: number, bLon: number, bLat: number): number {
  return Math.acos(clamp(dot(lonLatToVec3(aLon, aLat), lonLatToVec3(bLon, bLat)), -1, 1));
}

/* ------------------------------------------------------------------ */
/* Zoom <-> camera                                                      */
/* ------------------------------------------------------------------ */

/** Apparent globe radius in CSS px at the sub-camera point (MapLibre globe semantics). */
export function zoomToRadiusPx(zoom: number): number {
  return (TILE_SIZE * 2 ** zoom) / (2 * Math.PI);
}
export function radiusPxToZoom(radiusPx: number): number {
  return Math.log2((radiusPx * 2 * Math.PI) / TILE_SIZE);
}

/** Focal length in px for a viewport height. */
export function focalPx(viewportHeight: number, fovDeg = FOV_DEG): number {
  return viewportHeight / 2 / Math.tan((fovDeg * DEG) / 2);
}

/** Camera distance from the globe centre (globe radius = 1) so that the surface point under the camera has `zoomToRadiusPx(zoom)` px per radian. */
export function cameraDistance(zoom: number, viewportHeight: number, fovDeg = FOV_DEG): number {
  return 1 + focalPx(viewportHeight, fovDeg) / zoomToRadiusPx(zoom);
}

/** Half-angle (radians) of the visible cap seen from distance d. */
export function horizonAngle(d: number): number {
  return Math.acos(1 / d);
}

/** Apparent radius, in CSS px, of the globe's silhouette at a zoom (and so its camera distance): `f / sqrt(d^2 - 1)`, the inverse of `silhouetteZoom`. */
export function silhouetteRadiusPx(zoom: number, viewportHeight: number): number {
  const d = cameraDistance(zoom, viewportHeight);
  return focalPx(viewportHeight) / Math.sqrt(d * d - 1);
}

/** The zoom at which the globe's silhouette has the radius `radiusPx` in a viewport `viewportHeight` px tall. */
export function silhouetteZoom(radiusPx: number, viewportHeight: number): number {
  // For a perspective globe the apparent silhouette radius is f * tan(asin(1/d)); solving for d given the target radius.
  const f = focalPx(viewportHeight);
  // silhouette radius r = f * (1/d) / sqrt(1 - 1/d^2) = f / sqrt(d^2 - 1)  =>  d = sqrt((f/r)^2 + 1)
  const d = Math.sqrt((f / radiusPx) ** 2 + 1);
  return radiusPxToZoom(f / (d - 1));
}

/** Zoom at which the whole globe fits the viewport with a margin (fraction of the smaller side left empty). */
export function fitZoom(width: number, height: number, margin = 0.1): number {
  return silhouetteZoom((Math.min(width, height) / 2) * (1 - margin), height);
}

export interface ViewState {
  lon: number;
  lat: number;
  zoom: number;
  /**
   * A turn of the picture about the line of sight, radians: positive leans the planet's north to the LEFT on the screen (counter-clockwise). Only ever
   * a drawing's: the renderer sets it on the view it draws with (the cinematic interlude's tilt, as the studio's globe leans); a view the visitor
   * moves has none.
   */
  roll?: number;
}

export interface ViewBasis {
  /** Unit vector from globe centre toward the camera (the view centre). */
  c: [number, number, number];
  east: [number, number, number];
  north: [number, number, number];
  d: number;
  f: number;
}

export function viewBasis(view: ViewState, viewportHeight: number): ViewBasis {
  const c = lonLatToVec3(view.lon, view.lat);
  // At the poles east is undefined; clamp lat elsewhere keeps |lat| < 90.
  const east = normalize(cross([0, 1, 0], c));
  const north = cross(c, east);
  const roll = view.roll ?? 0;
  if (roll !== 0) {
    // the screen's right and up, turned about the line of sight: north comes to lean left for a positive roll (up' = north cos + east sin)
    const cs = Math.cos(roll);
    const sn = Math.sin(roll);
    const up: [number, number, number] = [north[0] * cs + east[0] * sn, north[1] * cs + east[1] * sn, north[2] * cs + east[2] * sn];
    const right: [number, number, number] = [east[0] * cs - north[0] * sn, east[1] * cs - north[1] * sn, east[2] * cs - north[2] * sn];
    return { c, east: right, north: up, d: cameraDistance(view.zoom, viewportHeight), f: focalPx(viewportHeight) };
  }
  return { c, east, north, d: cameraDistance(view.zoom, viewportHeight), f: focalPx(viewportHeight) };
}

export interface ScreenPoint {
  x: number;
  y: number;
  /** True when the point is on the hemisphere facing the camera (not occluded by the globe). */
  visible: boolean;
  /** 0 at the horizon, 1 at the view centre. Useful to fade labels near the limb. */
  facing: number;
}

/**
 * Project a lon/lat (optionally lifted to `radius`) to CSS px for an orthogonal-to-view camera model.
 * `centreX` is the x of the projection centre (the view centre lands there); default is the middle of `width`.
 * The renderer passes a centre left of the middle when UI covers the right-hand side (see `insetRight`), and a `centreY` above the middle
 * while the landing hero covers the bottom (see `GlobeProps.coverBottom`).
 */
export function projectLonLat(
  lon: number,
  lat: number,
  basis: ViewBasis,
  width: number,
  height: number,
  radius = 1,
  centreX = width / 2,
  centreY = height / 2,
): ScreenPoint {
  const p = lonLatToVec3(lon, lat);
  return projectUnit(p[0], p[1], p[2], basis, height, radius, centreX, { x: 0, y: 0, visible: false, facing: 0 }, centreY);
}

/**
 * `projectLonLat` for a point already on the unit sphere (`lonLatToVec3`): no trigonometry, and `out` can be reused so a frame allocates nothing. The operations and their
 * order are the same, so the result is bit-identical to `projectLonLat` of the same lon/lat (the LOD tree keeps one
 * unit vector per node and projects the visible ones with this).
 */
export function projectUnit(
  px: number,
  py: number,
  pz: number,
  basis: ViewBasis,
  height: number,
  radius = 1,
  centreX = 0,
  out: ScreenPoint = { x: 0, y: 0, visible: false, facing: 0 },
  centreY = height / 2,
): ScreenPoint {
  const { c, east, north } = basis;
  const pc = px * c[0] + py * c[1] + pz * c[2];
  const depth = basis.d - pc * radius;
  const sx = centreX + (basis.f * radius * (px * east[0] + py * east[1] + pz * east[2])) / depth;
  const sy = centreY - (basis.f * radius * (px * north[0] + py * north[1] + pz * north[2])) / depth;
  const horizon = 1 / basis.d;
  const visible = pc > horizon + 1e-4;
  out.x = sx;
  out.y = sy;
  out.visible = visible;
  out.facing = visible ? clamp((pc - horizon) / (1 - horizon), 0, 1) : 0;
  return out;
}

/* ------------------------------------------------------------------ */
/* Routes                                                               */
/* ------------------------------------------------------------------ */

export interface SampledRoute {
  /** xyz triples, lifted above the surface. */
  positions: Float32Array;
  /** Cumulative arc length in radians at each vertex. */
  distance: Float32Array;
  /** Total arc length in radians. */
  length: number;
}

/**
 * Sample the great-circle polyline through `stops` (ordered [lon, lat]). Each leg is subdivided so that
 * no step exceeds `stepDeg`, and lifted by `heightPerRadian * legLength * sin(pi t)` above the surface.
 * Routes are only ever sampled from an explicit curated stop list.
 */
export function sampleRoute(
  stops: readonly (readonly [number, number])[],
  opts: { stepDeg?: number; heightPerRadian?: number } = {},
): SampledRoute {
  const stepRad = (opts.stepDeg ?? 1) * DEG;
  const hpr = opts.heightPerRadian ?? 0.08;
  const pos: number[] = [];
  const dist: number[] = [];
  let acc = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = lonLatToVec3(stops[i]![0], stops[i]![1]);
    const b = lonLatToVec3(stops[i + 1]![0], stops[i + 1]![1]);
    const omega = Math.acos(clamp(dot(a, b), -1, 1));
    const n = Math.max(1, Math.ceil(omega / stepRad));
    const sinO = Math.sin(omega);
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const t = k / n;
      let x: number, y: number, z: number;
      if (sinO < 1e-9) {
        [x, y, z] = a;
      } else {
        const wa = Math.sin((1 - t) * omega) / sinO;
        const wb = Math.sin(t * omega) / sinO;
        x = wa * a[0] + wb * b[0];
        y = wa * a[1] + wb * b[1];
        z = wa * a[2] + wb * b[2];
      }
      const r = 1 + hpr * omega * Math.sin(Math.PI * t);
      pos.push(x * r, y * r, z * r);
      dist.push(acc + t * omega);
    }
    acc += omega;
  }
  return { positions: Float32Array.from(pos), distance: Float32Array.from(dist), length: acc };
}

/* ------------------------------------------------------------------ */
/* Animation helpers                                                    */
/* ------------------------------------------------------------------ */

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Duration (ms) of a camera flight covering `angleRad` of arc, bounded for UX. */
export function flightDuration(angleRad: number, zoomDelta: number): number {
  return clamp(450 + 700 * (angleRad / Math.PI) + 120 * Math.abs(zoomDelta), 450, 1600);
}
