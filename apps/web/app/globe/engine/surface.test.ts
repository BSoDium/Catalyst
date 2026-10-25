import { describe, expect, it } from "vitest";
import { SURFACE, surfaceCoverage, surfaceFade } from "./surface";
import { TUNING } from "./tuning";

describe("the land's picture", () => {
  it("is whole at the resting view and below it, a stipple of about half the land's pixels, and the interlude adds a little", () => {
    expect(surfaceFade(0)).toBe(1);
    expect(surfaceFade(-1)).toBe(1);
    expect(surfaceCoverage(0)).toBeCloseTo(SURFACE.cover);
    expect(surfaceCoverage(1)).toBeCloseTo(SURFACE.cover + SURFACE.egg);
    expect(surfaceCoverage(1)).toBeLessThan(1);
  });
  it("thins out smoothly with the zoom only over the last stretch, and is gone where the borders come on", () => {
    let last = 1;
    for (let z = SURFACE.from; z <= SURFACE.to; z += 0.1) {
      const s = surfaceFade(z);
      expect(s).toBeLessThanOrEqual(last + 1e-9);
      last = s;
    }
    expect(surfaceFade(SURFACE.to)).toBe(0);
    expect(SURFACE.to).toBeLessThan(TUNING.borderZoom.on);
  });
});
