/**
 * The travel paths as one data set, built ONCE from the routes (`buildNetwork`) and turned into GPU buffers once
 * (`buildBuffers`): decoded polylines, geodesic arcs for the legs that have none, and a pyramid of simplified levels
 * (Douglas-Peucker at growing tolerances, each a subset of the one before) so the globe can pick the coarsest level whose error
 * is under half an art pixel (`lod.ts`) without touching the geometry. Pure functions: no WebGL, no DOM.
 */
import type { GlobeRoute } from "../types";
import { lonLatToVec3 } from "../engine/geo";
import { MODE_STYLE, isLegMode, type LegMode } from "./modes";
import { decodePolyline5 } from "./polyline";
import { EARTH_RADIUS_M, simplify } from "./simplify";
import { paletteOf } from "./trail";

/** Simplification tolerances in metres, finest first: level 0 only drops points that are collinear to 20 m. The top one is about
 *  what a chord may sink under the globe's surface before the planet hides it (`OCCLUDER_RADIUS`: 12.7 km), so coarser is never useful. */
export const LOD_TOLERANCES_M = [20, 80, 320, 1280, 5120] as const;
/** Geodesic arcs (a leg without a polyline) are sampled at most this many degrees apart, as the curated routes always were. */
export const ARC_STEP_DEG = 0.4;
/** Height of a lifted arc above the surface per radian of its length (the curated routes' look; `engine/geometry.ts`). */
export const ARC_LIFT_PER_RADIAN = 0.12;

export interface PathLeg {
  /** Index in `PathNetwork.legs`: the GPU's leg id. */
  index: number;
  routeId: string;
  /** The route's palette (`trail.ts`: blue, green, ocre, violet by the route's order). */
  palette: number;
  /** Position in the route: the leg between stop `legIndex` and `legIndex + 1`. */
  legIndex: number;
  mode: LegMode;
  /** No polyline: the geodesic arc between the two stops, lifted above the surface on the globe. */
  arc: boolean;
  fromKey: string;
  toKey: string;
  /** Length along the path, metres (0 is never stored: such legs are dropped). */
  lengthM: number;
  /** Ground points `[lon, lat, ...]`, degrees. */
  lonlat: Float64Array;
  /** Height above the unit sphere per point (0 on the ground, `ARC_LIFT_PER_RADIAN * omega * sin(pi t)` on an arc). */
  lift: Float32Array;
  /** Per level, the indices (into `lonlat` points) kept: ascending, first and last always. Level 0 is the finest. */
  levels: Uint32Array[];
}

export interface PathNetwork {
  legs: PathLeg[];
  /** Place key -> legs that start (`out`) or end (`in`) there. */
  byPlace: Map<string, { leg: number; end: "from" | "to" }[]>;
  /** Decoded or sampled points over all legs (the finest level). */
  points: number;
}

/** The key under which a place is looked up: its coordinates exactly as the routes carry them. */
export const placeKey = (lat: number, lon: number): string => `${lat},${lon}`;

const xyzM = (lon: number, lat: number, lift: number): [number, number, number] => {
  const v = lonLatToVec3(lon, lat);
  const r = EARTH_RADIUS_M * (1 + lift);
  return [v[0] * r, v[1] * r, v[2] * r];
};

/** The geodesic arc between two points: `[lon, lat, ...]`, per-point lift, and the angle in radians. */
export function arcPoints(a: { lat: number; lon: number }, b: { lat: number; lon: number }, stepDeg = ARC_STEP_DEG) {
  const va = lonLatToVec3(a.lon, a.lat);
  const vb = lonLatToVec3(b.lon, b.lat);
  const dot = Math.min(1, Math.max(-1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
  const omega = Math.acos(dot);
  const n = Math.max(1, Math.ceil(omega / ((stepDeg * Math.PI) / 180)));
  const sinO = Math.sin(omega);
  const lonlat = new Float64Array((n + 1) * 2);
  const lift = new Float32Array(n + 1);
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    let x: number, y: number, z: number;
    if (k === 0 || sinO < 1e-9) [x, y, z] = va;
    else if (k === n) [x, y, z] = vb;
    else {
      const wa = Math.sin((1 - t) * omega) / sinO;
      const wb = Math.sin(t * omega) / sinO;
      x = wa * va[0] + wb * vb[0];
      y = wa * va[1] + wb * vb[1];
      z = wa * va[2] + wb * vb[2];
    }
    lonlat[k * 2] = (Math.atan2(x, z) * 180) / Math.PI;
    lonlat[k * 2 + 1] = (Math.asin(Math.min(1, Math.max(-1, y / Math.hypot(x, y, z)))) * 180) / Math.PI;
    lift[k] = ARC_LIFT_PER_RADIAN * omega * Math.sin(Math.PI * t);
  }
  // exact ends: the places' own coordinates, whatever the round trip through the vector gave
  lonlat[0] = a.lon;
  lonlat[1] = a.lat;
  lonlat[n * 2] = b.lon;
  lonlat[n * 2 + 1] = b.lat;
  return { lonlat, lift, omega };
}

/** Length of a `[lon, lat, ...]` path along great-circle steps, metres. */
export function pathLengthM(lonlat: ArrayLike<number>): number {
  let sum = 0;
  let prev = lonLatToVec3(lonlat[0]!, lonlat[1]!);
  for (let i = 2; i + 1 < lonlat.length; i += 2) {
    const v = lonLatToVec3(lonlat[i]!, lonlat[i + 1]!);
    const dot = Math.min(1, Math.max(-1, prev[0] * v[0] + prev[1] * v[1] + prev[2] * v[2]));
    sum += Math.acos(dot);
    prev = v;
  }
  return sum * EARTH_RADIUS_M;
}

/**
 * Length in metres of a leg as the globe and the street map draw it: along its polyline when it has a valid one (and is not a
 * flight), else along the geodesic arc between its stops. The one rule the journeys text shares with the drawing.
 */
export function legLengthM(a: { lat: number; lon: number }, b: { lat: number; lon: number }, leg?: { mode: string; polyline?: string }): number {
  const decoded = leg?.polyline && leg.mode !== "flight" ? decodePolyline5(leg.polyline) : null;
  return pathLengthM(decoded ?? arcPoints(a, b).lonlat);
}

/**
 * What the routes ARE, as a short key: every id, palette, point and leg (mode and polyline), hashed. The network below is a pure function of them, and
 * it is the dearest thing the globe builds when it mounts (a phone paid about a quarter of a second, at 4x slowdown, every time the globe came back
 * from a place), so a mount with the same routes takes the one the page already has. The loader's array is a new object whenever it revalidates, so
 * the key is the content, not the array.
 */
function routesKey(routes: readonly GlobeRoute[]): string {
  let h = 0x811c9dc5 | 0;
  const mix = (n: number) => {
    h = Math.imul(h ^ n, 16777619);
  };
  const str = (v: string) => {
    for (let i = 0; i < v.length; i++) mix(v.charCodeAt(i));
    mix(v.length);
  };
  for (const r of routes) {
    str(r.id);
    mix((r.palette ?? -1) + 7);
    mix(r.points.length);
    for (const p of r.points) {
      mix(Math.round(p.lat * 1e6));
      mix(Math.round(p.lon * 1e6));
    }
    const legs = r.legs ?? [];
    mix(legs.length);
    for (const l of legs) {
      str(l?.mode ?? "");
      str(l?.polyline ?? "");
    }
  }
  return `${routes.length}:${(h >>> 0).toString(16)}`;
}

const networkByRoutes = new WeakMap<readonly GlobeRoute[], PathNetwork>();
let lastNetwork: { key: string; net: PathNetwork } | null = null;

/** The network of these routes: built once per page for the same content (see `routesKey`), shared by every mount. Read-only for its users. */
export function buildNetwork(routes: readonly GlobeRoute[]): PathNetwork {
  const known = networkByRoutes.get(routes);
  if (known) return known;
  const key = routesKey(routes);
  const net = lastNetwork?.key === key ? lastNetwork.net : buildNetworkUncached(routes);
  lastNetwork = { key, net };
  networkByRoutes.set(routes, net);
  return net;
}

function buildNetworkUncached(routes: readonly GlobeRoute[]): PathNetwork {
  const legs: PathLeg[] = [];
  const byPlace: PathNetwork["byPlace"] = new Map();
  let points = 0;
  routes.forEach((route, order) => {
    const palette = paletteOf(route.palette ?? order);
    for (let i = 0; i + 1 < route.points.length; i++) {
      const a = route.points[i]!;
      const b = route.points[i + 1]!;
      if (a.lat === b.lat && a.lon === b.lon) continue; // the same place twice in a row: nothing to draw
      const spec = route.legs?.[i];
      const mode: LegMode = spec && isLegMode(spec.mode) ? spec.mode : "unknown";
      let lonlat: Float64Array | null = null;
      let arc = true;
      if (spec?.polyline && mode !== "flight") {
        lonlat = decodePolyline5(spec.polyline);
        arc = lonlat === null;
      }
      let lift: Float32Array;
      if (lonlat) {
        lift = new Float32Array(lonlat.length / 2);
      } else {
        const a2 = arcPoints(a, b);
        lonlat = a2.lonlat;
        lift = a2.lift;
      }
      const n = lonlat.length / 2;
      const lengthM = pathLengthM(lonlat);
      if (n < 2 || !(lengthM > 0)) continue;
      // levels: 0 .. K-1, each a subset of the one before
      const xyz = new Float64Array(n * 3);
      for (let k = 0; k < n; k++) xyz.set(xyzM(lonlat[k * 2]!, lonlat[k * 2 + 1]!, lift[k]!), k * 3);
      const levels: Uint32Array[] = [];
      let prev: Uint32Array | undefined;
      for (const tol of LOD_TOLERANCES_M) {
        const lv = simplify(xyz, tol, prev);
        levels.push(lv);
        prev = lv;
      }
      const leg: PathLeg = {
        index: legs.length,
        routeId: route.id,
        palette,
        legIndex: i,
        mode,
        arc,
        fromKey: placeKey(a.lat, a.lon),
        toKey: placeKey(b.lat, b.lon),
        lengthM,
        lonlat,
        lift,
        levels,
      };
      legs.push(leg);
      points += n;
      for (const [key, end] of [[leg.fromKey, "from"], [leg.toKey, "to"]] as const) {
        const list = byPlace.get(key) ?? [];
        list.push({ leg: leg.index, end });
        byPlace.set(key, list);
      }
    }
  });
  return { legs, byPlace, points };
}

/** The legs next to a place and which way each is drawn on: `fwd` starts at the place, `rev` ends there (the draw-on runs outwards). */
export function legsAt(net: PathNetwork, key: string): { leg: number; dir: "fwd" | "rev" }[] {
  return (net.byPlace.get(key) ?? []).map((e) => ({ leg: e.leg, dir: e.end === "from" ? "fwd" : "rev" }));
}

export interface PathBuffers {
  /** xyz per vertex on the unit sphere, lifted. */
  position: Float32Array;
  /** Distance along the leg from its start, radians. */
  dist: Float32Array;
  /** Per vertex: leg id, mode id, the leg's length in radians, the route's palette index. The position along the leg (0 origin, 1 destination) is `dist / length`: the same number as a stored fraction, one attribute less. */
  info: Float32Array;
  /** Unit tangent of the path at the vertex (the direction a rail tick is drawn across). */
  tangent: Float32Array;
  /** Line segments, vertex pairs, grouped by level. */
  index: Uint32Array;
  /** Where each level's segments are in `index` (counts are in indices, 2 per segment). */
  levels: { start: number; count: number; tolM: number }[];
  vertexCount: number;
  legCount: number;
}

const buffersByNetwork = new WeakMap<PathNetwork, PathBuffers>();

/** The vertex buffers of a network, built once per network (a mount takes the ones the page already has: they are only ever read, and uploaded to each context). */
export function buildBuffers(net: PathNetwork): PathBuffers {
  const known = buffersByNetwork.get(net);
  if (known) return known;
  const built = buildBuffersUncached(net);
  buffersByNetwork.set(net, built);
  return built;
}

function buildBuffersUncached(net: PathNetwork): PathBuffers {
  const vertexCount = net.points;
  const position = new Float32Array(vertexCount * 3);
  const dist = new Float32Array(vertexCount);
  const info = new Float32Array(vertexCount * 4);
  const tangent = new Float32Array(vertexCount * 3);
  const base: number[] = [];
  let v = 0;
  for (const leg of net.legs) {
    base.push(v);
    const n = leg.lonlat.length / 2;
    const lenRad = leg.lengthM / EARTH_RADIUS_M;
    let acc = 0;
    let prev: [number, number, number] | null = null;
    for (let k = 0; k < n; k++) {
      const g = lonLatToVec3(leg.lonlat[k * 2]!, leg.lonlat[k * 2 + 1]!);
      if (prev) acc += Math.acos(Math.min(1, Math.max(-1, prev[0] * g[0] + prev[1] * g[1] + prev[2] * g[2])));
      prev = g;
      const r = 1 + leg.lift[k]!;
      const o = (v + k) * 3;
      position[o] = g[0] * r;
      position[o + 1] = g[1] * r;
      position[o + 2] = g[2] * r;
      dist[v + k] = acc;
      const q4 = (v + k) * 4;
      info[q4] = leg.index;
      info[q4 + 1] = MODE_STYLE[leg.mode].id;
      info[q4 + 2] = lenRad;
      info[q4 + 3] = leg.palette;
      const p = lonLatToVec3(leg.lonlat[Math.max(0, k - 1) * 2]!, leg.lonlat[Math.max(0, k - 1) * 2 + 1]!);
      const q = lonLatToVec3(leg.lonlat[Math.min(n - 1, k + 1) * 2]!, leg.lonlat[Math.min(n - 1, k + 1) * 2 + 1]!);
      const tx = q[0] - p[0], ty = q[1] - p[1], tz = q[2] - p[2];
      const tl = Math.hypot(tx, ty, tz) || 1;
      tangent[o] = tx / tl;
      tangent[o + 1] = ty / tl;
      tangent[o + 2] = tz / tl;
    }
    v += n;
  }
  const levelCount = LOD_TOLERANCES_M.length;
  const lists: number[][] = Array.from({ length: levelCount }, () => []);
  for (const leg of net.legs) {
    for (let L = 0; L < levelCount; L++) {
      const lv = leg.levels[L]!;
      for (let k = 0; k + 1 < lv.length; k++) lists[L]!.push(base[leg.index]! + lv[k]!, base[leg.index]! + lv[k + 1]!);
    }
  }
  const total = lists.reduce((s, l) => s + l.length, 0);
  const index = new Uint32Array(total);
  const levels: PathBuffers["levels"] = [];
  let at = 0;
  for (let L = 0; L < levelCount; L++) {
    index.set(lists[L]!, at);
    levels.push({ start: at, count: lists[L]!.length, tolM: LOD_TOLERANCES_M[L]! });
    at += lists[L]!.length;
  }
  return { position, dist, info, tangent, index, levels, vertexCount, legCount: net.legs.length };
}
