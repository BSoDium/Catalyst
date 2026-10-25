import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildJsonSchema } from "./generate-json-schema";
import { decodePolyline5, encodePolyline5, haversineKm } from "./polyline";
import { EMPTY_PROJECTION, ROUTE_LEG_LIMITS, parsePublishedProjection, publishedRouteSchema, type PublishedProjection } from "./published";

const place = (slug: string, lat: number, lon: number) => ({ slug, name: slug, coordinates: { lat, lon }, labelPriority: 0, body: [], images: [], related: [] });
// Three fictional-ish points about 55 km and 60 km apart.
const A = [48.0, 2.0] as const;
const B = [48.5, 2.1] as const;
const C = [48.9, 2.4] as const;
const places = [place("a", ...A), place("b", ...B), place("c", ...C)];

/** A gently bent line from p to q with `n` points (inclusive). */
const line = (p: readonly [number, number], q: readonly [number, number], n = 12): [number, number][] =>
  Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return [p[0] + (q[0] - p[0]) * t + Math.sin(t * 3) * 0.01 * Math.sin(Math.PI * t), p[1] + (q[1] - p[1]) * t] as [number, number];
  });

const withRoute = (route: unknown): unknown => ({ ...EMPTY_PROJECTION, places, routes: [route] });
const parse = (route: unknown) => parsePublishedProjection(withRoute(route));
const stops = ["a", "b", "c"];

describe("polyline5 codec", () => {
  it("matches the reference example of the format", () => {
    // The worked example of the algorithm description: (38.5, -120.2), (40.7, -120.95), (43.252, -126.453).
    const pts = decodePolyline5("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(pts).toEqual([[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
    expect(encodePolyline5(pts!)).toBe("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
  });
  it("round-trips at 5 decimals, negatives included", () => {
    const pts: [number, number][] = [[-33.92, 18.42], [-33.91234, 18.43111], [-33.9, 18.5], [0, -0.00001]];
    expect(decodePolyline5(encodePolyline5(pts))).toEqual(pts);
  });
  it("refuses what is not a polyline", () => {
    expect(decodePolyline5("")).toBeNull();
    expect(decodePolyline5("_p~iF")).toBeNull(); // one value only
    expect(decodePolyline5("_p~iF~ps|")).toBeNull(); // a value that does not end
    expect(decodePolyline5("ab cd")).toBeNull(); // characters outside ? .. ~
    expect(decodePolyline5(encodePolyline5([[10, 10]]))).toBeNull(); // fewer than 2 points
    expect(decodePolyline5(encodePolyline5([[10, 10]]), 1)).toEqual([[10, 10]]);
  });
  it("measures great-circle distance", () => {
    expect(haversineKm([0, 0], [0, 1])).toBeCloseTo(111.19, 1);
    expect(haversineKm([10, 10], [10, 10])).toBe(0);
  });
});

describe("routes[].legs", () => {
  const polyAB = encodePolyline5(line(A, B));
  const polyBC = encodePolyline5(line(B, C));

  it("is optional: a route without legs stays valid and the key stays absent", () => {
    const p = parse({ id: "r", title: "R", stops });
    expect(p.routes[0]).not.toHaveProperty("legs");
  });

  it("accepts one leg per consecutive pair, with and without a polyline, in any mode", () => {
    const p = parse({ id: "r", title: "R", stops, legs: [{ mode: "road", polyline: polyAB }, { mode: "flight" }] });
    expect(p.routes[0]!.legs).toHaveLength(2);
    for (const mode of ["road", "rail", "ferry", "walk", "unknown"] as const) {
      expect(() => parse({ id: "r", title: "R", stops, legs: [{ mode, polyline: polyAB }, { mode, polyline: polyBC }] }), mode).not.toThrow();
    }
  });

  it("rejects a wrong number of legs", () => {
    expect(() => parse({ id: "r", title: "R", stops, legs: [{ mode: "road" }] })).toThrow(/one entry per consecutive pair/);
    expect(() => parse({ id: "r", title: "R", stops, legs: [{ mode: "road" }, { mode: "road" }, { mode: "road" }] })).toThrow(/one entry per consecutive pair/);
  });

  it("rejects an unknown mode, unknown keys and a malformed polyline", () => {
    expect(() => parse({ id: "r", title: "R", stops, legs: [{ mode: "boat" }, { mode: "road" }] })).toThrow();
    expect(() => parse({ id: "r", title: "R", stops, legs: [{ mode: "road", at: "2024-01-01" }, { mode: "road" }] })).toThrow();
    expect(() => parse({ id: "r", title: "R", stops, legs: [{ mode: "road", polyline: "not a polyline!" }, { mode: "road" }] })).toThrow();
    expect(() => parse({ id: "r", title: "R", stops, legs: [{ mode: "road", polyline: "_p~iF" }, { mode: "road" }] })).toThrow(/valid precision-5/);
  });

  it("refuses a polyline on a flight", () => {
    expect(() => parse({ id: "r", title: "R", stops, legs: [{ mode: "flight", polyline: polyAB }, { mode: "road" }] })).toThrow(/flight/);
  });

  it("requires the ends within 3 km of the stops", () => {
    const near = encodePolyline5(line([A[0] + 0.02, A[1]], B)); // about 2.2 km
    expect(() => parse({ id: "r", title: "R", stops, legs: [{ mode: "road", polyline: near }, { mode: "flight" }] })).not.toThrow();
    const far = encodePolyline5(line([A[0] + 0.05, A[1]], B)); // about 5.6 km
    expect(() => parse({ id: "r", title: "R", stops, legs: [{ mode: "road", polyline: far }, { mode: "flight" }] })).toThrow(/starts more than 3 km/);
    const farEnd = encodePolyline5(line(A, [B[0], B[1] + 0.1])); // about 7 km
    expect(() => parse({ id: "r", title: "R", stops, legs: [{ mode: "road", polyline: farEnd }, { mode: "flight" }] })).toThrow(/ends more than 3 km/);
  });

  it("accepts an end on the edge of the stop's box, however far from its centre, and nowhere else", () => {
    // Box of "a": 0.3 degree of longitude (about 22 km) to each side of A.
    const box: [number, number, number, number] = [A[1] - 0.3, A[0] - 0.1, A[1] + 0.3, A[0] + 0.1];
    const withBox = (start: [number, number]) =>
      parsePublishedProjection({
        ...EMPTY_PROJECTION,
        places: [{ ...places[0]!, bbox: box }, places[1]!, places[2]!],
        routes: [{ id: "r", title: "R", stops, legs: [{ mode: "road", polyline: encodePolyline5(line(start, B)) }, { mode: "flight" }] }],
      });
    expect(() => withBox([A[0], box[2] + 0.00001])).not.toThrow();
    expect(() => withBox([A[0], box[2] + 0.05])).toThrow(/starts more than 3 km/);
  });

  it("refuses a jump of 200 km or more between consecutive points", () => {
    const a: [number, number] = [0, 0];
    const b: [number, number] = [0, 1.9]; // about 211 km
    const p = {
      ...EMPTY_PROJECTION,
      places: [place("x", 0, 0), place("y", 0, 1.9)],
      routes: [{ id: "r", title: "R", stops: ["x", "y"], legs: [{ mode: "road", polyline: encodePolyline5([a, b]) }] }],
    };
    expect(() => parsePublishedProjection(p)).toThrow(/200 km apart or more/);
    const ok = { ...p, routes: [{ ...p.routes[0], legs: [{ mode: "road", polyline: encodePolyline5([a, [0, 1.7], b]) }] }] }; // 189 + 22 km
    expect(() => parsePublishedProjection(ok)).not.toThrow();
  });

  it("limits points per leg, per route and in total", () => {
    const many = (n: number): [number, number][] => Array.from({ length: n }, (_, i) => [A[0] + (i % 2) * 1e-5 * 0 + i * 1e-5, A[1]]);
    expect(ROUTE_LEG_LIMITS.pointsPerLeg).toBe(2000);
    const tooMany = encodePolyline5([A, ...many(ROUTE_LEG_LIMITS.pointsPerLeg + 1)].map((p) => [p[0], p[1]] as [number, number]));
    expect(() => parse({ id: "r", title: "R", stops, legs: [{ mode: "road", polyline: tooMany }, { mode: "flight" }] })).toThrow(/points per leg|characters/i);
    // Per route: 6 legs of 2000 points exceed 12000 -> build a route with 7 stops.
    const slugs = Array.from({ length: 8 }, (_, i) => `s${i}`);
    const pl = slugs.map((s) => place(s, 10, 10));
    const leg = encodePolyline5(Array.from({ length: 2000 }, (_, i) => [10 + (i % 2 ? 0 : 1e-5) * 0, 10 + 0 * i] as [number, number]));
    const route = { id: "r", title: "R", stops: slugs, legs: slugs.slice(1).map(() => ({ mode: "road", polyline: leg })) };
    const proj = { ...EMPTY_PROJECTION, places: pl, routes: [route] };
    expect(() => parsePublishedProjection(proj)).toThrow(/points per route/);
    // In total: 5 routes of 5 legs x 2000 = 10000 each = 50000 (ok), a sixth tips it over 60000.
    const five = slugs.slice(0, 6);
    const mk = (id: string) => ({ id, title: id, stops: five, legs: five.slice(1).map(() => ({ mode: "road", polyline: leg })) });
    const ids = ["r1", "r2", "r3", "r4", "r5", "r6", "r7"];
    expect(() => parsePublishedProjection({ ...EMPTY_PROJECTION, places: pl, routes: ids.slice(0, 6).map(mk) })).not.toThrow();
    expect(() => parsePublishedProjection({ ...EMPTY_PROJECTION, places: pl, routes: ids.map(mk) })).toThrow(/leg points in the projection/);
  });

  it("keeps the true worst case small: every leg at its limits stays under 0.5 MB", () => {
    const bytes = ROUTE_LEG_LIMITS.pointsTotal * 8; // 8 characters per point is the worst case of a 200 km step
    expect(ROUTE_LEG_LIMITS.charsPerLeg).toBeGreaterThanOrEqual(ROUTE_LEG_LIMITS.pointsPerLeg * 8);
    expect(bytes).toBeLessThan(500_000);
  });

  it("is described by the generated JSON Schema (committed file in sync)", () => {
    const committed = readFileSync(new URL("../published.schema.json", import.meta.url), "utf8");
    expect(committed).toBe(buildJsonSchema());
    const schema = JSON.parse(committed);
    const route = schema.properties.routes.items;
    expect(route.properties.legs.maxItems).toBe(ROUTE_LEG_LIMITS.legsPerRoute);
    expect(route.properties.legs.items.properties.mode.enum).toEqual(["road", "rail", "ferry", "flight", "walk", "unknown"]);
    expect(route.properties.legs.items.properties.polyline.maxLength).toBe(ROUTE_LEG_LIMITS.charsPerLeg);
    expect(route.required).toEqual(["id", "title", "stops"]);
  });

  it("route schema alone does not know places (its cross-checks need none)", () => {
    expect(() => publishedRouteSchema.parse({ id: "r", title: "R", stops, legs: [{ mode: "road" }, { mode: "rail" }] })).not.toThrow();
  });

  it("demo fixture: legs of every mode, valid, small", () => {
    const demo = JSON.parse(readFileSync(new URL("../../published/fixtures/demo.json", import.meta.url), "utf8")) as PublishedProjection;
    const p = parsePublishedProjection(demo);
    const modes = new Set(p.routes.flatMap((r) => r.legs ?? []).map((l) => l.mode));
    expect([...modes].sort()).toEqual(["ferry", "flight", "rail", "road", "unknown", "walk"]);
    expect(p.routes.length).toBeGreaterThanOrEqual(4);
  });
});
