import { describe, expect, it } from "vitest";
import { lonLatToVec3 } from "../../engine/geo";
import { capReach, viewCap } from "./view-cap";

const cap = (lon: number, lat: number, rho: number) => ({ u: lonLatToVec3(lon, lat), rho });

describe("the cap of a map view", () => {
  const view = viewCap([21, 52], [[20, 51], [22, 51], [20, 53], [22, 53], [21, 51], [21, 53], [20, 52], [22, 52]])!;

  it("holds the points round it, with a margin", () => {
    expect(view.rho).toBeGreaterThan(0.0205);
    expect(view.rho).toBeLessThan(0.03);
  });

  it("lets through a leg that is in the view, and one that only touches it", () => {
    expect(capReach(view, cap(21, 52, 0.001))).toBe(true);
    expect(capReach(view, cap(24.5, 52, 0.02))).toBe(true);
  });

  it("takes out a leg that is far from it, on this side of the planet and the other", () => {
    expect(capReach(view, cap(106, 10, 0.3))).toBe(false);
    expect(capReach(view, cap(-159, -52, 0.3))).toBe(false);
  });

  it("keeps a leg that spans the planet (a cap of pi reaches everything)", () => {
    expect(capReach(view, cap(-159, -52, Math.PI))).toBe(true);
  });

  it("is no cap, so nothing is culled, when a point round the view is not a number (the view reaches past the planet's edge)", () => {
    expect(viewCap([21, 52], [[20, 51], [Number.NaN, 53]])).toBeNull();
    expect(viewCap([21, 52], [null])).toBeNull();
    expect(viewCap([Number.NaN, 52], [])).toBeNull();
  });
});
