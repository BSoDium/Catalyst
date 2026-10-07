/**
 * Camera-delta warp for the temporal ease (docs/street-architecture.md, "Temporal ease").
 *
 * The pass keeps the PRESENTED level image of the previous frame. When the camera moved since, content that merely moved must
 * be looked up where it was, so the ease only acts on what changed for any other reason (a tile arriving or leaving, a tone step).
 * This file answers "where was the cell (u, v) of the new frame in the previous frame": for every node of a coarse mesh over the
 * art grid, in art CELLS (u right, v down, a cell centre is index + 0.5). The shader interpolates the mesh bilinearly.
 *
 * Two camera models, picked by the zoom (the street map's projection is MapLibre's globe up to z12, where it blends to Web Mercator):
 *   mercator  from `MERCATOR_FROM` up: screen = (merc(p) - merc(centre)) * 512 * 2^z + projection centre. Exact, and affine in the screen.
 *   globe     below it: the perspective globe of `engine/geo.ts` (the model the handover registers the street map against, to under a
 *             thousandth of a pixel, docs/street-architecture.md "Registration"): the new cell is un-projected onto the unit sphere
 *             (ray / sphere) and projected with the previous camera. Nodes whose ray misses the globe have no previous position
 *             (`NO_WARP`): the shader takes the new image there.
 * Whatever the model, the previous camera is the one of the last PRESENTED frame, so a frame pair that moved by any amount (a
 * flight's 16 ms step, a jump) is handled by the same maths.
 */
import { DEG, clamp, lonLatToVec3, projectUnit, vec3ToLonLat, viewBasis, type ViewBasis } from "../../engine/geo";
import { registerMapToGlobe } from "./registration";

/** The camera of one presented frame, in the units the compositor works in. */
export interface WarpCamera {
  /** MapLibre camera (zoom of the 512 px tiles). */
  lon: number;
  lat: number;
  zoom: number;
  /** projection centre in CSS px of the root (the map's padding moves it), and the box height the globe model centres on */
  cx: number;
  cy: number;
  /** CSS px of one art cell */
  cell: number;
}

/** Map zoom from which the camera is treated as Web Mercator (MapLibre's globe is flat enough: <1 px within 250 px of the centre from z10). */
export const MERCATOR_FROM = 10.5;
/** Spacing of the mesh nodes, in art cells. The warp is smooth over the screen: 16 cells (about 40 CSS px) interpolate it to <0.05 cell. */
export const MESH_STEP = 16;
/** Value of a mesh node that has no previous position (the cell was not on the globe before): the shader takes the new image there. */
export const NO_WARP = -1e6;

const TILE = 512;

/** Web Mercator unit square position of a lon/lat (y down). */
export function mercatorXY(lon: number, lat: number): [number, number] {
  const phi = clamp(lat, -85.0511287798, 85.0511287798) * DEG;
  return [(lon + 180) / 360, 0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI)];
}

/** Inverse of `mercatorXY`. */
export function mercatorLonLat(x: number, y: number): { lon: number; lat: number } {
  return { lon: x * 360 - 180, lat: (2 * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - Math.PI / 2) / DEG };
}

/** Screen position (CSS px) of a lon/lat for a Mercator camera. */
export function projectMercator(cam: WarpCamera, lon: number, lat: number): [number, number] {
  const w = TILE * 2 ** cam.zoom;
  const [mx, my] = mercatorXY(lon, lat);
  const [cx, cy] = mercatorXY(cam.lon, cam.lat);
  return [(mx - cx) * w + cam.cx, (my - cy) * w + cam.cy];
}

/** Lon/lat under a screen position (CSS px) for a Mercator camera. */
export function unprojectMercator(cam: WarpCamera, x: number, y: number): { lon: number; lat: number } {
  const w = TILE * 2 ** cam.zoom;
  const [cx, cy] = mercatorXY(cam.lon, cam.lat);
  return mercatorLonLat(cx + (x - cam.cx) / w, cy + (y - cam.cy) / w);
}

/** The perspective globe's view of a camera: its basis for a box of height `2 * cy` (the globe model centres vertically on half of it). */
export function globeBasis(cam: WarpCamera): ViewBasis {
  return viewBasis(registerMapToGlobe({ lon: cam.lon, lat: cam.lat, zoom: cam.zoom }), 2 * cam.cy);
}

/** Screen position (CSS px) of a lon/lat for a globe camera; `null` when it is on the far side. */
export function projectGlobe(cam: WarpCamera, basis: ViewBasis, lon: number, lat: number): [number, number] | null {
  const p = lonLatToVec3(lon, lat);
  const s = projectUnit(p[0], p[1], p[2], basis, 2 * cam.cy, 1, cam.cx);
  return s.visible ? [s.x, s.y] : null;
}

/**
 * Lon/lat under a screen position (CSS px) for a globe camera (ray / sphere); `null` when the ray misses the globe. The inverse of
 * `projectGlobe` on the facing hemisphere: sx = cx + f (p.e) / (d - p.c), sy = cy - f (p.n) / (d - p.c) for a point p of the unit sphere.
 */
export function unprojectGlobe(cam: WarpCamera, basis: ViewBasis, x: number, y: number): { lon: number; lat: number } | null {
  const X = (x - cam.cx) / basis.f;
  const Y = (cam.cy - y) / basis.f;
  const { c, east, north, d } = basis;
  // camera at d * c looking at -c: ray direction r = X e + Y n - c, point = d c + t r
  const r: [number, number, number] = [X * east[0] + Y * north[0] - c[0], X * east[1] + Y * north[1] - c[1], X * east[2] + Y * north[2] - c[2]];
  const rr = r[0] * r[0] + r[1] * r[1] + r[2] * r[2];
  const disc = d * d - rr * (d * d - 1);
  if (disc < 0) return null;
  const t = (d - Math.sqrt(disc)) / rr;
  return vec3ToLonLat([d * c[0] + t * r[0], d * c[1] + t * r[1], d * c[2] + t * r[2]]);
}

/** Which model a frame pair uses. */
export type WarpKind = "identity" | "mercator" | "globe";

export interface WarpMesh {
  kind: WarpKind;
  /** nodes per row and column */
  mw: number;
  mh: number;
  /** (u, v) of the previous frame per node, in cells (interleaved), `NO_WARP` where there is none */
  data: Float32Array;
  /** largest displacement of a node, cells (how far content moved between the two frames) */
  maxShift: number;
  /** the pair is a pure translation by a whole number of cells at scale 1 (a pan snapped to the grid): matches need no tolerance */
  exact: boolean;
  /** scale of the previous frame over the new one (Mercator: 2^(z0 - z1)); 1 for a translation */
  scale: number;
}

const SAME = 1e-9;
/** The two cameras are the same view (no warp at all). */
export function sameCamera(a: WarpCamera, b: WarpCamera): boolean {
  return (
    Math.abs(a.lon - b.lon) < SAME && Math.abs(a.lat - b.lat) < SAME && Math.abs(a.zoom - b.zoom) < SAME && Math.abs(a.cx - b.cx) < 1e-6 && Math.abs(a.cy - b.cy) < 1e-6 && Math.abs(a.cell - b.cell) < 1e-9
  );
}

/** Whether a camera is drawn as Web Mercator (both of a pair must be, else the globe model carries the pair). */
export const isMercator = (cam: WarpCamera): boolean => cam.zoom >= MERCATOR_FROM;

/**
 * The mesh for a pair of cameras over a `cols x rows` art grid. `prev` is the camera of the presented image, `cur` the camera of the
 * frame being drawn; a node holds where its cell was in `prev`. Cheap enough to build every frame (a few hundred nodes).
 */
export function buildWarpMesh(prev: WarpCamera, cur: WarpCamera, cols: number, rows: number, step: number = MESH_STEP): WarpMesh {
  const mw = Math.ceil(cols / step) + 1;
  const mh = Math.ceil(rows / step) + 1;
  const data = new Float32Array(mw * mh * 2);
  const identity = sameCamera(prev, cur);
  // A cell size change cannot be warped (a different grid): the compositor starts over then; never mind here, the ratio is handled
  const k = cur.cell / prev.cell;
  const mercator = isMercator(prev) && isMercator(cur);
  let kind: WarpKind = identity ? "identity" : mercator ? "mercator" : "globe";
  let maxShift = 0;
  const basisPrev = kind === "globe" ? globeBasis(prev) : null;
  const basisCur = kind === "globe" ? globeBasis(cur) : null;
  // Mercator: the map is affine, so one closed form serves every node: old = a (new - cur.c) + (cur.c) shifted by the centre move
  let a = 1, bx = 0, by = 0;
  if (kind === "mercator") {
    const [px, py] = mercatorXY(prev.lon, prev.lat);
    const [qx, qy] = mercatorXY(cur.lon, cur.lat);
    const wPrev = TILE * 2 ** prev.zoom;
    const wCur = TILE * 2 ** cur.zoom;
    a = wPrev / wCur;
    // css_old = (m - p) * wPrev + prev.c ; m = q + (css_new - cur.c) / wCur
    bx = (qx - px) * wPrev + prev.cx - a * cur.cx;
    by = (qy - py) * wPrev + prev.cy - a * cur.cy;
  }
  for (let j = 0; j < mh; j++) {
    for (let i = 0; i < mw; i++) {
      const u = i * step;
      const v = j * step;
      const o = (j * mw + i) * 2;
      let ou = u;
      let ov = v;
      if (kind === "mercator") {
        ou = (a * u * cur.cell + bx) / prev.cell;
        ov = (a * v * cur.cell + by) / prev.cell;
      } else if (kind === "globe") {
        const ll = unprojectGlobe(cur, basisCur!, u * cur.cell, v * cur.cell);
        const s = ll ? projectGlobe(prev, basisPrev!, ll.lon, ll.lat) : null;
        if (!s) {
          data[o] = NO_WARP;
          data[o + 1] = NO_WARP;
          continue;
        }
        ou = s[0] / prev.cell;
        ov = s[1] / prev.cell;
      }
      data[o] = ou;
      data[o + 1] = ov;
      const sh = Math.hypot(ou - u, ov - v);
      if (sh > maxShift) maxShift = sh;
    }
  }
  const scale = kind === "mercator" ? a * k : 1;
  // pure translation by whole cells: scale 1 and the shift of every node equal and integral
  let exact = identity;
  if (kind === "mercator" && Math.abs(a - 1) < 1e-9 && Math.abs(k - 1) < 1e-9) {
    const du = data[0]! - 0;
    const dv = data[1]! - 0;
    exact = Math.abs(du - Math.round(du)) < 1e-3 && Math.abs(dv - Math.round(dv)) < 1e-3;
  }
  if (identity) kind = "identity";
  return { kind, mw, mh, data, maxShift, exact, scale };
}

/** Where the cell centre (u + 0.5, v + 0.5) of the new frame was in the previous one (bilinear in the mesh, as the shader does), or null. */
export function warpPoint(mesh: WarpMesh, u: number, v: number, step: number = MESH_STEP): [number, number] | null {
  const gx = Math.min(u / step, mesh.mw - 1 - 1e-9);
  const gy = Math.min(v / step, mesh.mh - 1 - 1e-9);
  const i = Math.max(0, Math.floor(gx));
  const j = Math.max(0, Math.floor(gy));
  const fx = gx - i;
  const fy = gy - j;
  const at = (ii: number, jj: number, c: number) => mesh.data[(jj * mesh.mw + ii) * 2 + c]!;
  if (at(i, j, 0) <= NO_WARP / 2 || at(i + 1, j, 0) <= NO_WARP / 2 || at(i, j + 1, 0) <= NO_WARP / 2 || at(i + 1, j + 1, 0) <= NO_WARP / 2) return null;
  const lerp = (c: number) => (at(i, j, c) * (1 - fx) + at(i + 1, j, c) * fx) * (1 - fy) + (at(i, j + 1, c) * (1 - fx) + at(i + 1, j + 1, c) * fx) * fy;
  return [lerp(0), lerp(1)];
}
