/**
 * Curated routes as map geometry: the legs of the routes in the `routes` option, between their ordered stops (the same
 * `GlobeRoute` shape the globe takes). At street scale the lines lie on the ground: the legs' own polylines, or great-circle
 * polylines where a leg has none, split at the antimeridian so they never wrap across the whole map.
 */
import type { GlobeRoute } from "../types";
import { lonLatToVec3, vec3ToLonLat, DEG } from "../engine/geo";
import { isLegMode } from "./modes";
import { paletteOf } from "./trail";
import { cropToBoxes } from "./crop";
import { decodePolyline5 } from "./polyline";
import { legKey } from "./thin";

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

/** The key of a leg in the street map's source and filters: the route and the position of the leg in it. */
export { legKey };

/**
 * The keys of the legs next to a place: the one that arrives at it and the one that leaves it, on every route through it (the
 * same legs the globe lights, `engine/route-layer.ts`). `[]` for no place.
 */
export function legKeysAt(routes: readonly GlobeRoute[], place: { lat: number; lon: number } | undefined): string[] {
  if (!place) return [];
  const keys: string[] = [];
  for (const route of routes) {
    route.points.forEach((p, i) => {
      if (p.lat !== place.lat || p.lon !== place.lon) return;
      if (i > 0) keys.push(legKey(route.id, i - 1));
      if (i + 1 < route.points.length) keys.push(legKey(route.id, i));
    });
  }
  return keys;
}

/**
 * Every leg of every route as ONE feature each (`id`: the route, `key`: the leg, `mode`), on the ground: the decoded polyline
 * when the leg has one, else the great-circle arc between its stops. Split at the antimeridian so no line wraps the map. This is the
 * single source of the street map's path layers; selecting a place never changes it (the layers' filters do).
 */
export function legFeatures(routes: readonly GlobeRoute[], stepDeg = 0.5): GeoJSON.FeatureCollection<GeoJSON.MultiLineString> {
  const features: GeoJSON.Feature<GeoJSON.MultiLineString>[] = [];
  routes.forEach((route, order) => {
    const pal = paletteOf(route.palette ?? order);
    for (let i = 0; i + 1 < route.points.length; i++) {
      const a = route.points[i]!;
      const b = route.points[i + 1]!;
      if (a.lat === b.lat && a.lon === b.lon) continue;
      const spec = route.legs?.[i];
      const mode = spec && isLegMode(spec.mode) ? spec.mode : "unknown";
      let pts: LonLat[] | null = null;
      let usedPolyline = false;
      if (spec?.polyline && mode !== "flight") {
        const flat = decodePolyline5(spec.polyline);
        if (flat) {
          pts = Array.from({ length: flat.length / 2 }, (_, k) => [flat[k * 2]!, flat[k * 2 + 1]!] as LonLat);
          usedPolyline = true;
        }
      }
      pts ??= greatCircle([a.lon, a.lat], [b.lon, b.lat], stepDeg);
      // every mode ends where it meets the boxes of its stops, as on the globe (paths/crop.ts)
      const flat = new Float64Array(pts.length * 2);
      pts.forEach((p, k) => flat.set(p, k * 2));
      const cropped = cropToBoxes(flat, null, route.boxes?.[i], route.boxes?.[i + 1]);
      if (!cropped) continue;
      pts = Array.from({ length: cropped.lonlat.length / 2 }, (_, k) => [cropped.lonlat[k * 2]!, cropped.lonlat[k * 2 + 1]!] as LonLat);
      features.push({
        type: "Feature",
        properties: { id: route.id, key: legKey(route.id, i), mode, pal, arc: !usedPolyline },
        geometry: { type: "MultiLineString", coordinates: splitAtAntimeridian(pts) },
      });
    }
  });
  return { type: "FeatureCollection", features };
}

/** One point per leg, at its destination (the head of the trail), with the leg's key and palette: the street map's sparks. */
export function legHeads(routes: readonly GlobeRoute[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
  routes.forEach((route, order) => {
    const pal = paletteOf(route.palette ?? order);
    for (let i = 0; i + 1 < route.points.length; i++) {
      const a = route.points[i]!;
      const b = route.points[i + 1]!;
      if (a.lat === b.lat && a.lon === b.lon) continue;
      features.push({ type: "Feature", properties: { key: legKey(route.id, i), pal }, geometry: { type: "Point", coordinates: [b.lon, b.lat] } });
    }
  });
  return { type: "FeatureCollection", features };
}
