import { describe, expect, it } from "vitest";
import { sameView, toViewState, zoomFrom01, zoomTo01 } from "./view";

describe("zoom mapping", () => {
  it("maps min to 0 and max to 1, linearly, and round-trips", () => {
    expect(zoomTo01(1.3, 1.3, 6.5)).toBe(0);
    expect(zoomTo01(6.5, 1.3, 6.5)).toBe(1);
    expect(zoomTo01(3.9, 1.3, 6.5)).toBeCloseTo(0.5);
    expect(zoomFrom01(zoomTo01(4.2, 1.3, 6.5), 1.3, 6.5)).toBeCloseTo(4.2);
  });
  it("clamps out-of-range input from either side", () => {
    expect(zoomTo01(9, 1.3, 6.5)).toBe(1);
    expect(zoomFrom01(-3, 1.3, 6.5)).toBe(1.3);
    expect(zoomFrom01(7, 1.3, 6.5)).toBe(6.5);
  });
  it("is defined when min equals max", () => {
    expect(zoomTo01(2, 2, 2)).toBe(0);
  });
});

describe("view helpers", () => {
  it("converts a view and detects equality", () => {
    const v = toViewState({ lon: 10, lat: 20, zoom: 3.9 }, 1.3, 6.5);
    expect(v.zoom).toBeCloseTo(0.5);
    expect(sameView(v, { ...v })).toBe(true);
    expect(sameView(v, { ...v, lon: 11 })).toBe(false);
    expect(sameView(null, v)).toBe(false);
  });
});
