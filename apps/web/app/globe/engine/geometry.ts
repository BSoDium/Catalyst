/** Pure vertex-buffer builders (plain typed arrays, no three.js) so they can be unit tested in node. */
import type { Polylines } from "@catalyst/geodata";
import type { GlobePlace, GlobeRoute } from "../types";
import { lonLatToVec3, sampleRoute } from "./geo";

/** Polylines (lon/lat degrees) to line-segment pairs on a sphere of the given radius. */
export function polylinesToSegments(p: Polylines, radius: number): Float32Array {
  let segments = 0;
  for (let i = 0; i < p.offsets.length - 1; i++) segments += Math.max(0, p.offsets[i + 1]! - p.offsets[i]! - 1);
  const out = new Float32Array(segments * 6);
  let o = 0;
  const put = (idx: number) => {
    const v = lonLatToVec3(p.positions[idx * 2]!, p.positions[idx * 2 + 1]!);
    out[o++] = v[0] * radius;
    out[o++] = v[1] * radius;
    out[o++] = v[2] * radius;
  };
  for (let i = 0; i < p.offsets.length - 1; i++) {
    const end = p.offsets[i + 1]! - 1;
    for (let k = p.offsets[i]!; k < end; k++) {
      put(k);
      put(k + 1);
    }
  }
  return out;
}

/** Meridians and parallels every `stepDeg`, sampled every `sampleDeg`, as segment pairs on the unit sphere. */
export function graticuleSegments(stepDeg: number, sampleDeg: number): Float32Array {
  const pts: number[] = [];
  const push = (lon: number, lat: number) => pts.push(...lonLatToVec3(lon, lat));
  for (let lon = -180; lon < 180; lon += stepDeg) {
    for (let lat = -90 + sampleDeg; lat <= 90 - sampleDeg + 1e-6; lat += sampleDeg) {
      push(lon, lat - sampleDeg);
      push(lon, lat);
    }
  }
  for (let lat = -90 + stepDeg; lat < 90; lat += stepDeg) {
    for (let lon = -180; lon < 180; lon += sampleDeg) {
      push(lon, lat);
      push(lon + sampleDeg, lat);
    }
  }
  return Float32Array.from(pts);
}

/**
 * GL lines are one buffer pixel wide, so a route is emitted four times with 1-pixel offsets
 * (0,0) (1,0) (0,1) (1,1): a 2x2 px stroke that reads heavier than the coastline.
 */
const STROKE_OFFSETS = [0, 0, 1, 0, 0, 1, 1, 1] as const;

export interface RouteBuffers {
  /** Segment pairs, xyz, lifted above the surface. */
  position: Float32Array;
  /** Cumulative arc length (radians) at each segment vertex. */
  distance: Float32Array;
  /** Pixel offset (x, y) per vertex. */
  offset: Float32Array;
  /** Total arc length in radians. */
  length: number;
}

/** Great-circle arcs through the route's curated points, in order. Nothing else is ever connected. */
export function routeBuffers(route: GlobeRoute): RouteBuffers {
  const sampled = sampleRoute(
    route.points.map((p) => [p.lon, p.lat] as const),
    { stepDeg: 0.4, heightPerRadian: 0.12 },
  );
  const n = sampled.positions.length / 3;
  const segs = Math.max(0, n - 1);
  const position = new Float32Array(segs * 6 * 4);
  const distance = new Float32Array(segs * 2 * 4);
  const offset = new Float32Array(segs * 4 * 4);
  for (let k = 0; k < 4; k++) {
    const ox = STROKE_OFFSETS[k * 2]!;
    const oy = STROKE_OFFSETS[k * 2 + 1]!;
    for (let i = 0; i < segs; i++) {
      const s = k * segs + i;
      position.set(sampled.positions.subarray(i * 3, i * 3 + 6), s * 6);
      distance[s * 2] = sampled.distance[i]!;
      distance[s * 2 + 1] = sampled.distance[i + 1]!;
      offset.set([ox, oy, ox, oy], s * 4);
    }
  }
  return { position, distance, offset, length: sampled.length };
}

const SAME_POINT_DEG = 1e-6;

/** A place is on a route when it is one of the route's resolved stop points. */
export function isRouteStop(route: GlobeRoute, place: Pick<GlobePlace, "lat" | "lon">): boolean {
  return route.points.some(
    (p) => Math.abs(p.lat - place.lat) < SAME_POINT_DEG && Math.abs(p.lon - place.lon) < SAME_POINT_DEG,
  );
}

/** The curated route the selected place belongs to (first match), or null. */
export function routeForPlace(routes: readonly GlobeRoute[], place: GlobePlace | undefined): GlobeRoute | null {
  return place ? (routes.find((r) => isRouteStop(r, place)) ?? null) : null;
}
