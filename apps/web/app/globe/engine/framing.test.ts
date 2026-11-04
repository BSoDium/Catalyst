import { describe, expect, it } from "vitest";
import { CONTEXT_FRAMING, DEFAULT_VIEW_RADIUS_KM, EARTH_RADIUS_KM, FRAMING_MARGIN, FRAMING_MIN_RADIUS_KM, VIEW_RADIUS_RANGE_KM, bboxExtentsKm, bboxFitRadiusKm, contextScales, effectiveRadiusKm, placeFraming, radiusFitZoom } from "./framing";
import { zoomToRadiusPx } from "./geo";

/** Circle radius in px that a zoom gives to `km`. */
const pxFor = (zoom: number, km: number) => (zoomToRadiusPx(zoom) * km) / EARTH_RADIUS_KM;

describe("radiusFitZoom", () => {
  it("fits the circle in the smaller free side with the margin", () => {
    const z = radiusFitZoom(10, 1440, 900, 0);
    expect(pxFor(z, 10)).toBeCloseTo(900 / 2 / (1 + FRAMING_MARGIN), 6);
  });
  it("uses the width when the free area is narrower than tall (inset, portrait)", () => {
    const withPanel = radiusFitZoom(10, 1440, 900, 720); // free 720 x 900
    expect(pxFor(withPanel, 10)).toBeCloseTo(720 / 2 / (1 + FRAMING_MARGIN), 6);
    const portrait = radiusFitZoom(10, 390, 844, 0);
    expect(pxFor(portrait, 10)).toBeCloseTo(390 / 2 / (1 + FRAMING_MARGIN), 6);
  });
  it("opening the panel zooms out by log2 of the free-side ratio", () => {
    const closed = radiusFitZoom(12, 1440, 900, 0);
    const open = radiusFitZoom(12, 1440, 900, 720);
    expect(closed - open).toBeCloseTo(Math.log2(900 / 720), 9);
    expect(open).toBeLessThan(closed);
  });
  it("a circle 4x larger needs 2 zoom levels less", () => {
    expect(radiusFitZoom(8, 1000, 800, 0) - radiusFitZoom(32, 1000, 800, 0)).toBeCloseTo(2, 9);
  });
  it("the whole circle is on screen (never wider than the free area minus the margin)", () => {
    for (const [w, h, inset] of [[1440, 900, 0], [1440, 900, 720], [390, 844, 0], [1024, 600, 512]] as const) {
      const r = pxFor(radiusFitZoom(14, w, h, inset), 14);
      expect(r * 2 * (1 + FRAMING_MARGIN)).toBeLessThanOrEqual(Math.min(w - inset, h) + 1e-6);
    }
  });
  it("Lisbon-like numbers land at street scale (desktop, panel open)", () => {
    const z = radiusFitZoom(10, 1440, 900, 720);
    expect(z).toBeGreaterThan(10);
    expect(z).toBeLessThan(12);
  });
});

describe("effectiveRadiusKm", () => {
  it("defaults when absent or invalid and clamps to the contract range", () => {
    expect(effectiveRadiusKm(undefined)).toBe(DEFAULT_VIEW_RADIUS_KM);
    expect(effectiveRadiusKm(null)).toBe(DEFAULT_VIEW_RADIUS_KM);
    expect(effectiveRadiusKm(Number.NaN)).toBe(DEFAULT_VIEW_RADIUS_KM);
    expect(effectiveRadiusKm(0.1)).toBe(0.5);
    expect(effectiveRadiusKm(9999)).toBe(500);
    expect(effectiveRadiusKm(14)).toBe(14);
  });
});

describe("placeFraming and bounding boxes", () => {
  const box = [-95.8, 29.5, -95.1, 30.1] as const;
  it("frames the box, centred on the box, with the unchanged fit formula: its longer side takes 1 / (1 + margin) of the smaller free side", () => {
    const f = placeFraming({ lat: 29.76, lon: -95.37, viewRadiusKm: 12, bbox: box });
    const ext = bboxExtentsKm(box)!;
    expect(f.lon).toBeCloseTo(-95.45, 9);
    expect(f.lat).toBeCloseTo(29.8, 9);
    expect(f.radiusKm).toBeCloseTo(Math.max(ext.halfXKm, ext.halfYKm), 9);
    const z = radiusFitZoom(f.radiusKm, 1440, 900, 0);
    expect(pxFor(z, 2 * Math.max(ext.halfXKm, ext.halfYKm)) / 2 / (900 / 2 / (1 + FRAMING_MARGIN))).toBeCloseTo(1, 6);
  });
  it("falls back to the point and its radius (clamped, defaulted) when there is no valid box", () => {
    expect(placeFraming({ lat: 1, lon: 2, viewRadiusKm: 30 })).toEqual({ lon: 2, lat: 1, radiusKm: 30 });
    expect(placeFraming({ lat: 1, lon: 2 })).toEqual({ lon: 2, lat: 1, radiusKm: DEFAULT_VIEW_RADIUS_KM });
    expect(placeFraming({ lat: 1, lon: 2, viewRadiusKm: 9999, bbox: [5, 5, 1, 1] })).toEqual({ lon: 2, lat: 1, radiusKm: 500 });
  });
  it("centres the camera on the box, not on the recorded point, which stays where it is", () => {
    // the recorded point sits in the north-east corner of the box: the box's centre is well away from it
    const place = { lat: 30.05, lon: -95.15, viewRadiusKm: 12, bbox: box };
    const f = placeFraming(place);
    expect(f.lon).toBeCloseTo((box[0] + box[2]) / 2, 9);
    expect(f.lat).toBeCloseTo((box[1] + box[3]) / 2, 9);
    expect(Math.hypot(f.lon - place.lon, f.lat - place.lat)).toBeGreaterThan(0.3);
    expect(place.lat).toBe(30.05);
    expect(place.lon).toBe(-95.15);
    // the radius frames the box around ITS centre
    expect(f.radiusKm).toBeCloseTo(bboxFitRadiusKm(box)!, 9);
  });
  it("falls back to the point and the view radius for an absent or invalid box, at any latitude", () => {
    for (const bbox of [undefined, [], [1, 2, 3], [0, 0, 0, 1], [5, 5, 1, 1], [0, 0, 1, Number.NaN], [-181, 0, 1, 1]]) {
      expect(placeFraming({ lat: 48.85, lon: 2.35, viewRadiusKm: 14, bbox })).toEqual({ lon: 2.35, lat: 48.85, radiusKm: 14 });
    }
  });
  it("assumes no antimeridian crossing: a crossing box ([west > east]) is rejected, a box up to 180 is centred plainly", () => {
    // a Fiji-like box across the antimeridian is not a box here: the point and the radius are used
    expect(bboxExtentsKm([179.5, -17, -179.5, -16])).toBeNull();
    expect(placeFraming({ lat: -16.5, lon: 179.9, viewRadiusKm: 20, bbox: [179.5, -17, -179.5, -16] })).toEqual({ lon: 179.9, lat: -16.5, radiusKm: 20 });
    // a box that ends at 180 is centred on the plain mean of its longitudes, no wrapping
    const f = placeFraming({ lat: -16.5, lon: 179.9, bbox: [179, -17, 180, -16] });
    expect(f.lon).toBeCloseTo(179.5, 9);
    expect(f.lat).toBeCloseTo(-16.5, 9);
  });
  it("km extents: a degree of latitude is 111 km, a degree of longitude shrinks with the cosine of the latitude", () => {
    const eq = bboxExtentsKm([0, -1, 2, 1])!;
    expect(eq.halfYKm).toBeCloseTo(111.19, 1);
    expect(eq.halfXKm).toBeCloseTo(111.19, 1);
    const north = bboxExtentsKm([0, 59, 2, 61])!;
    expect(north.halfXKm / north.halfYKm).toBeCloseTo(0.5, 2);
    expect(bboxExtentsKm(undefined)).toBeNull();
    expect(bboxExtentsKm([1, 2, 3])).toBeNull();
    expect(bboxExtentsKm([0, 0, 0, 1])).toBeNull();
  });
});

describe("a small box is framed on itself (#622)", () => {
  // Frederik's Church: 88 x 75 m
  const church = { lat: 55.685, lon: 12.59, viewRadiusKm: 0.5, bbox: [12.58887, 55.68464, 12.59028, 55.68531] as const };
  it("a box under the minimum view is framed to its own size, from FRAMING_MIN_RADIUS_KM, not to the 0.5 km of a view radius", () => {
    const r = placeFraming(church).radiusKm;
    expect(r).toBe(FRAMING_MIN_RADIUS_KM);
    expect(FRAMING_MIN_RADIUS_KM).toBeLessThan(VIEW_RADIUS_RANGE_KM.min);
    expect(radiusFitZoom(r, 400, 600, 0)).toBeGreaterThan(radiusFitZoom(VIEW_RADIUS_RANGE_KM.min, 400, 600, 0) + 2); // more than two levels closer: the buildings are in
  });
  it("a box of 300 m is framed to its half extent, a place with no box keeps the 0.5 km minimum", () => {
    expect(placeFraming({ lat: 10, lon: 10, bbox: [9.9986, 9.9986, 10.0014, 10.0014] }).radiusKm).toBeCloseTo(0.155, 2);
    expect(placeFraming({ lat: 10, lon: 10, viewRadiusKm: 0.5 }).radiusKm).toBe(0.5);
    expect(placeFraming({ lat: 10, lon: 10 }).radiusKm).toBe(DEFAULT_VIEW_RADIUS_KM);
  });
});

describe("framing by context (#457)", () => {
  const toulouse = { slug: "toulouse", lat: 43.6, lon: 1.44 };
  const albi = { slug: "albi", lat: 43.93, lon: 2.15 };
  const desert = { slug: "oued-el-ouaar", lat: 28.17, lon: -11.87 };
  const nearby = (n: number) => Array.from({ length: n }, (_, i) => ({ slug: `n${i}`, lat: 43.6 + i * 0.1, lon: 1.44 }));
  it("an isolated place keeps its own framing; a place on a route only is framed routeScale wider", () => {
    const s = contextScales([desert], []);
    expect(s.get("oued-el-ouaar")).toBe(1);
    const r = contextScales([desert], [["oued-el-ouaar", "elsewhere"]]);
    expect(r.get("oued-el-ouaar")).toBe(CONTEXT_FRAMING.routeScale);
  });
  it("the scale grows with the places around, up to the full scale", () => {
    const first = (n: number, stops: string[][] = []) => contextScales([{ slug: "c", lat: 43.6, lon: 1.44 }, ...nearby(n)], stops).get("c")!;
    expect(first(1)).toBeGreaterThan(1);
    expect(first(1)).toBeLessThan(first(2));
    expect(first(CONTEXT_FRAMING.fullNeighbours)).toBe(CONTEXT_FRAMING.scale);
    expect(first(CONTEXT_FRAMING.fullNeighbours + 5)).toBe(CONTEXT_FRAMING.scale);
    // on a route, the first neighbour starts from routeScale
    expect(first(1, [["c", "n0"]])).toBeGreaterThan(CONTEXT_FRAMING.routeScale);
    expect(first(0, [["c", "far"]])).toBe(CONTEXT_FRAMING.routeScale);
  });
  it("Toulouse and Albi, 70 km apart, frame each other wider than the desert", () => {
    const s = contextScales([toulouse, albi, desert], []);
    expect(s.get("toulouse")).toBeGreaterThan(1);
    expect(s.get("albi")).toBe(s.get("toulouse"));
    expect(s.get("oued-el-ouaar")).toBe(1);
  });
  it("placeFraming applies the scale to the box's radius and ignores a scale under 1", () => {
    const place = { lat: 43.6, lon: 1.44, bbox: [1.35, 43.55, 1.53, 43.65] as const };
    const base = placeFraming(place).radiusKm;
    expect(placeFraming({ ...place, framingScale: 6 }).radiusKm).toBeCloseTo(Math.min(VIEW_RADIUS_RANGE_KM.max, base * 6), 5);
    expect(placeFraming({ ...place, framingScale: 0.2 }).radiusKm).toBe(base);
  });
});
