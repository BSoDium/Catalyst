/**
 * Curated routes as map geometry. Only the routes in the `routes` option are ever drawn, between their ordered stops
 * (the same `GlobeRoute` shape the globe takes). At street scale the lines lie on the ground: great-circle
 * polylines, split at the antimeridian so they never wrap across the whole map.
 */
import type { GlobeRoute } from "../../types";
import { lonLatToVec3, vec3ToLonLat, DEG } from "../../engine/geo";

type LonLat = [number, number];

/** Points along the great circle from a to b, `stepDeg` apart at most, both ends included. */
export function greatCircle(a: LonLat, b: LonLat, stepDeg = 0.5): LonLat[] {
  const va = lonLatToVec3(a[0], a[1]);
  const vb = lonLatToVec3(b[0], b[1]);
  const dot = Math.min(1, Math.max(-1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
  const omega = Math.acos(dot);
  const n = Math.max(1, Math.ceil(omega / (stepDeg * DEG)));
  const sinO = Math.sin(omega);
  const out: LonLat[] = [];
  for (let k = 0; k <= n; k++) {
    if (k === 0) {
      out.push([a[0], a[1]]);
      continue;
    }
    if (k === n) {
      out.push([b[0], b[1]]);
      continue;
    }
    const t = k / n;
    if (sinO < 1e-9) {
      out.push([a[0], a[1]]);
      continue;
    }
    const wa = Math.sin((1 - t) * omega) / sinO;
    const wb = Math.sin(t * omega) / sinO;
    const ll = vec3ToLonLat([wa * va[0] + wb * vb[0], wa * va[1] + wb * vb[1], wa * va[2] + wb * vb[2]]);
    out.push([ll.lon, ll.lat]);
  }
  return out;
}

/**
 * Split a polyline at the antimeridian. Consecutive longitudes differing by more than 180 degrees mean the segment
 * crosses it: the part before ends on the edge it leaves through, the next part starts on the opposite edge.
 */
export function splitAtAntimeridian(points: readonly LonLat[]): LonLat[][] {
  const parts: LonLat[][] = [];
  let cur: LonLat[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const prev = points[i - 1];
    if (prev && Math.abs(p[0] - prev[0]) > 180) {
      // crossing: eastward (prev near +180, p near -180) or westward
      const east = prev[0] > p[0];
      const lonP = east ? p[0] + 360 : p[0] - 360; // p seen from prev's side
      const edge = east ? 180 : -180;
      const t = (edge - prev[0]) / (lonP - prev[0]);
      const lat = prev[1] + (p[1] - prev[1]) * t;
      cur.push([edge, lat]);
      parts.push(cur);
      cur = [[-edge, lat]];
    }
    cur.push([p[0], p[1]]);
  }
  if (cur.length > 1) parts.push(cur);
  return parts.filter((part) => part.length > 1);
}

/** All routes as one MultiLineString feature per route (one `id` property each). */
export function routeFeatures(routes: readonly GlobeRoute[], stepDeg = 0.5): GeoJSON.FeatureCollection<GeoJSON.MultiLineString> {
  const features: GeoJSON.Feature<GeoJSON.MultiLineString>[] = [];
  for (const route of routes) {
    if (route.points.length < 2) continue;
    const pts: LonLat[] = [];
    for (let i = 0; i < route.points.length - 1; i++) {
      const a = route.points[i]!;
      const b = route.points[i + 1]!;
      const seg = greatCircle([a.lon, a.lat], [b.lon, b.lat], stepDeg);
      pts.push(...(i === 0 ? seg : seg.slice(1)));
    }
    features.push({
      type: "Feature",
      properties: { id: route.id },
      geometry: { type: "MultiLineString", coordinates: splitAtAntimeridian(pts) },
    });
  }
  return { type: "FeatureCollection", features };
}
