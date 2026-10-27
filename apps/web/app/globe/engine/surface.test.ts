import { describe, expect, it } from "vitest";
import { SURFACE, surfaceCoverage } from "./surface";

describe("the land's picture", () => {
  it("is a stipple of about half the land's pixels, and the interlude adds a little", () => {
    expect(surfaceCoverage(0)).toBeCloseTo(SURFACE.cover);
    expect(surfaceCoverage(1)).toBeCloseTo(SURFACE.cover + SURFACE.egg);
    expect(surfaceCoverage(1)).toBeLessThan(1);
  });
  it("is a stipple, never solid: the old-school texture is the same at every zoom", () => {
    expect(SURFACE.cover).toBeLessThan(1);
    expect(surfaceCoverage(-1)).toBeCloseTo(SURFACE.cover);
  });
});
