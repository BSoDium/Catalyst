import { describe, expect, it } from "vitest";
import { zoomToRadiusPx } from "../../engine/geo";
import { FLAT, bulgePx, flatZoom, isFlat } from "./flatness";
import { registerMapToGlobe } from "./registration";

describe("flatness of the view", () => {
  it("the bulge halves with every zoom level and grows with the square of the view height", () => {
    for (const h of [600, 900, 1400]) for (let z = 4; z < 12; z++) expect(bulgePx(z + 1, h) / bulgePx(z, h)).toBeCloseTo(0.5, 12);
    expect(bulgePx(7, 1800) / bulgePx(7, 900)).toBeCloseTo(4, 12);
  });
  it("is the height by which the sphere falls away at the top edge, (h/2)^2 / 2R, to a hundredth of a pixel where the switch happens", () => {
    for (const z of [8, 9, 10]) {
      const R = zoomToRadiusPx(z);
      expect(Math.abs(bulgePx(z, 900) - (R - Math.sqrt(R * R - 450 * 450)))).toBeLessThan(0.01);
    }
    expect(bulgePx(6, 900)).toBeCloseTo(450 ** 2 / (2 * zoomToRadiusPx(6)), 12);
  });
  it("the earth is curved at the world and regional zooms and flat at the street ones, on a desktop and on a phone", () => {
    for (const h of [844, 900, 1200]) {
      expect(isFlat(false, 3.7, h), `h ${h} at the cut`).toBe(false);
      expect(isFlat(false, 5.2, h), `h ${h} where the sea used to start`).toBe(false);
      expect(isFlat(false, 6.5, h), `h ${h} where the graticule used to start to leave`).toBe(false);
      expect(isFlat(false, 11, h), `h ${h}`).toBe(true);
      expect(isFlat(true, 11, h)).toBe(true);
    }
  });
  it("the unified zoom of the switch is a bit over 8 on a desktop, whatever the latitude (the latitude cancels in the unified zoom)", () => {
    const z = flatZoom(900);
    expect(z).toBeGreaterThan(8);
    expect(z).toBeLessThan(8.6);
    expect(bulgePx(z, 900)).toBeCloseTo(FLAT.flatPx, 9);
    for (const lat of [0, 40, 60]) {
      const mapZoom = z + Math.log2(Math.cos((lat * Math.PI) / 180));
      expect(registerMapToGlobe({ lon: 0, lat, zoom: mapZoom }).zoom).toBeCloseTo(z, 9);
    }
    expect(flatZoom(844)).toBeLessThan(z); // a shorter screen is flat sooner
    expect(flatZoom(1400)).toBeGreaterThan(z);
  });
  it("hysteresis: between the two thresholds it keeps its state, and a jitter around the switch changes it at most once", () => {
    const h = 900;
    // zoom range where the bulge is between flatPx and curvedPx
    const zFlat = flatZoom(h);
    const zCurved = Math.log2((((h / 2) ** 2 / (2 * FLAT.curvedPx)) * 2 * Math.PI) / 512);
    expect(zCurved).toBeLessThan(zFlat);
    const mid = (zFlat + zCurved) / 2;
    expect(isFlat(true, mid, h)).toBe(true);
    expect(isFlat(false, mid, h)).toBe(false);
    let flat = false;
    let changes = 0;
    for (let k = 0; k < 200; k++) {
      const next = isFlat(flat, zFlat + (k % 2 ? 0.01 : -0.01), h);
      if (next !== flat) changes++;
      flat = next;
    }
    expect(changes).toBeLessThanOrEqual(1);
  });
});
