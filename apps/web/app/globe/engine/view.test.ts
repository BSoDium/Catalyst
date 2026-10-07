import { describe, expect, it } from "vitest";
import { fromViewState, sameView, toViewState, zoomFrom01, zoomTo01 } from "./view";

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

  it("carries street scale as extra levels beyond the globe's maximum, and only then", () => {
    const g = toViewState({ lon: 1, lat: 2, zoom: 5 }, 1.3, 6.5);
    expect(g.street).toBeUndefined();
    const s = toViewState({ lon: 1, lat: 2, zoom: 12.5 }, 1.3, 6.5);
    expect(s.zoom).toBe(1);
    expect(s.street).toBeCloseTo(6);
    expect(fromViewState(s, 1.3, 6.5).zoom).toBeCloseTo(12.5);
    expect(fromViewState(g, 1.3, 6.5).zoom).toBeCloseTo(5);
    expect(sameView(s, { ...s })).toBe(true);
    expect(sameView(s, { ...s, street: 6.1 })).toBe(false);
    expect(sameView({ lon: 0, lat: 0, zoom: 1 }, { lon: 0, lat: 0, zoom: 1, street: 0 })).toBe(true);
  });
});
