/**
 * Pure geometry helpers shared by both renderers, the label layer and the tests.
 * Coordinate convention (unit sphere, Y up): lon 0 / lat 0 is +Z, lon +90 is +X, north is +Y.
 */
export const DEG = Math.PI / 180;
export type Vec3 = readonly [number, number, number];

/** Web Mercator tile size used by MapLibre; we reuse its zoom semantics for both renderers. */
const TILE_SIZE = 512;
/** Vertical field of view in degrees. 36.87 deg (tan = 1/3) is MapLibre's default. */
export const FOV_DEG = 36.87;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

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
function focalPx(viewportHeight: number, fovDeg = FOV_DEG): number {
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

/** Zoom at which the whole globe fits the viewport with a margin (fraction of the smaller side left empty). */
export function fitZoom(width: number, height: number, margin = 0.1): number {
  // For a perspective globe the apparent silhouette radius is f * tan(asin(1/d)); solving for d given the target radius.
  const target = (Math.min(width, height) / 2) * (1 - margin);
  const f = focalPx(height);
  // silhouette radius r = f * (1/d) / sqrt(1 - 1/d^2) = f / sqrt(d^2 - 1)  =>  d = sqrt((f/r)^2 + 1)
  const d = Math.sqrt((f / target) ** 2 + 1);
  return radiusPxToZoom(f / (d - 1));
}

export interface ViewState {
  lon: number;
  lat: number;
  zoom: number;
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
 * The renderer passes a centre left of the middle when UI covers the right-hand side (see `insetRight`).
 */
export function projectLonLat(
  lon: number,
  lat: number,
  basis: ViewBasis,
  width: number,
  height: number,
  radius = 1,
  centreX = width / 2,
): ScreenPoint {
  const p = lonLatToVec3(lon, lat);
  const pc = dot(p, basis.c);
  const depth = basis.d - pc * radius;
  const sx = centreX + (basis.f * radius * dot(p, basis.east)) / depth;
  const sy = height / 2 - (basis.f * radius * dot(p, basis.north)) / depth;
  const horizon = 1 / basis.d;
  const visible = pc > horizon + 1e-4;
  return { x: sx, y: sy, visible, facing: visible ? clamp((pc - horizon) / (1 - horizon), 0, 1) : 0 };
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
