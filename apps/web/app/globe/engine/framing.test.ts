import { describe, expect, it } from "vitest";
import { DEFAULT_VIEW_RADIUS_KM, EARTH_RADIUS_KM, FRAMING_MARGIN, effectiveRadiusKm, radiusFitZoom } from "./framing";
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
