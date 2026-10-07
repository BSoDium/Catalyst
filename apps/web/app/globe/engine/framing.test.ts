import { describe, expect, it } from "vitest";
import { DEFAULT_VIEW_RADIUS_KM, EARTH_RADIUS_KM, FRAMING_MARGIN, bboxExtentsKm, effectiveRadiusKm, placeFraming, radiusFitZoom } from "./framing";
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
