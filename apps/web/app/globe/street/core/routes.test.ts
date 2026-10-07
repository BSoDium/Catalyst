import { describe, expect, it } from "vitest";
import { angularDistance } from "../../engine/geo";
import { greatCircle, routeFeatures, splitAtAntimeridian } from "./routes";

describe("greatCircle", () => {
  it("keeps both ends exact and steps at most `step` degrees", () => {
    const pts = greatCircle([2.35, 48.86], [139.69, 35.68], 0.5);
    expect(pts[0]).toEqual([2.35, 48.86]);
    expect(pts[pts.length - 1]).toEqual([139.69, 35.68]);
    for (let i = 1; i < pts.length; i++) {
      const d = (angularDistance(pts[i - 1]![0], pts[i - 1]![1], pts[i]![0], pts[i]![1]) * 180) / Math.PI;
      expect(d).toBeLessThanOrEqual(0.5 + 1e-6);
    }
    // the middle of the Paris-Tokyo great circle is far north of the straight lon/lat line
    const mid = pts[Math.floor(pts.length / 2)]!;
    expect(mid[1]).toBeGreaterThan(55);
  });
  it("handles identical and antipodal-ish points without NaN", () => {
    expect(greatCircle([10, 10], [10, 10])).toEqual([[10, 10], [10, 10]]);
    for (const p of greatCircle([0, 0], [179.9, 0.1], 5)) expect(p.every(Number.isFinite)).toBe(true);
  });
});

describe("splitAtAntimeridian", () => {
  it("leaves a line that does not cross it alone", () => {
    expect(splitAtAntimeridian([[10, 0], [20, 5]])).toEqual([[[10, 0], [20, 5]]]);
  });
  it("splits an eastward crossing onto both edges at the interpolated latitude", () => {
    const parts = splitAtAntimeridian([[170, 0], [-170, 20]]);
    expect(parts).toHaveLength(2);
    expect(parts[0]![parts[0]!.length - 1]).toEqual([180, 10]);
    expect(parts[1]![0]).toEqual([-180, 10]);
    expect(parts[1]![1]).toEqual([-170, 20]);
  });
  it("splits a westward crossing too", () => {
    const parts = splitAtAntimeridian([[-175, -10], [175, 10]]);
    expect(parts).toHaveLength(2);
    expect(parts[0]![1]).toEqual([-180, 0]);
    expect(parts[1]![0]).toEqual([180, 0]);
  });
});

describe("routeFeatures", () => {
  const route = { id: "r1", title: "Route", points: [{ lat: 10.78, lon: 106.7 }, { lat: 16.46, lon: 107.59 }, { lat: 21.03, lon: 105.85 }] };
  it("makes one feature per route with at least two stops, through every stop in order", () => {
    const fc = routeFeatures([route, { id: "lonely", title: "x", points: [{ lat: 0, lon: 0 }] }, { id: "none", title: "y", points: [] }]);
    expect(fc.features).toHaveLength(1);
    const f = fc.features[0]!;
    expect(f.properties).toEqual({ id: "r1" });
    const line = f.geometry.coordinates[0]!;
    expect(line[0]).toEqual([106.7, 10.78]);
    expect(line[line.length - 1]).toEqual([105.85, 21.03]);
    expect(line).toContainEqual([107.59, 16.46]);
  });
  it("draws nothing for no routes", () => {
    expect(routeFeatures([]).features).toEqual([]);
  });
});
