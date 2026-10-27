import { describe, expect, it } from "vitest";
import { SURFACE, surfaceAmount, surfaceCoverage } from "./surface";
import { TUNING } from "./tuning";

describe("the land's picture", () => {
  it("is a stipple of about half the land's pixels at the resting view and below it, and the interlude adds a little", () => {
    expect(surfaceAmount(0, surfaceCoverage(0))).toBeCloseTo(SURFACE.cover);
    expect(surfaceAmount(-1, surfaceCoverage(0))).toBeCloseTo(SURFACE.cover);
    expect(surfaceCoverage(1)).toBeCloseTo(SURFACE.cover + SURFACE.egg);
    expect(surfaceCoverage(1)).toBeLessThan(1);
  });
  it("fills in smoothly with the zoom over the last stretch before the borders, and stays whole to the cut to the street map", () => {
    let last: number = SURFACE.cover;
    for (let z = SURFACE.from; z <= SURFACE.to; z += 0.1) {
      const s = surfaceAmount(z, SURFACE.cover);
      expect(s).toBeGreaterThanOrEqual(last - 1e-9);
      last = s;
    }
    expect(surfaceAmount(SURFACE.to, SURFACE.cover)).toBe(SURFACE.deep);
    expect(surfaceAmount(10, SURFACE.cover)).toBe(SURFACE.deep);
    expect(SURFACE.to).toBeLessThan(TUNING.borderZoom.on);
  });
});
