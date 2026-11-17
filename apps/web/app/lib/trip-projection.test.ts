import { describe, expect, it } from "vitest";
import { AZIMUTHAL_LIMIT, frameOf } from "./trip-projection";

describe("the trip poster's projection", () => {
  const box = [0, 0, 360, 300, 26] as const;
  it("is azimuthal for a trip that stays near its middle and puts the trip inside the box", () => {
    const pts = [{ lon: 2.3, lat: 48.8 }, { lon: 16.4, lat: 48.2 }, { lon: 14.3, lat: 46.6 }, { lon: -1.5, lat: 43.6 }];
    const f = frameOf(pts, ...box);
    expect(f.azimuthal).toBe(true);
    for (const p of pts) {
      const q = f.at(p.lon, p.lat)!;
      expect(q.x).toBeGreaterThanOrEqual(25.9);
      expect(q.x).toBeLessThanOrEqual(334.1);
      expect(q.y).toBeGreaterThanOrEqual(25.9);
      expect(q.y).toBeLessThanOrEqual(274.1);
    }
  });
  it("does not stretch the north: a degree of longitude at 60° is about half a degree of latitude, as on the globe", () => {
    const f = frameOf([{ lon: 0, lat: 55 }, { lon: 10, lat: 65 }], ...box);
    const a = f.at(0, 60)!;
    const dx = f.at(2, 60)!.x - a.x;
    const dy = a.y - f.at(0, 62)!.y;
    expect(dx / dy).toBeGreaterThan(0.45);
    expect(dx / dy).toBeLessThan(0.58);
  });
  it("falls back to the plate carree for a trip that reaches the far side, and the far side has no point", () => {
    const wide = frameOf([{ lon: -120, lat: 40 }, { lon: 100, lat: -30 }], ...box);
    expect(wide.azimuthal).toBe(false);
    expect(wide.at(0, 0)).not.toBeNull();
    const near = frameOf([{ lon: 0, lat: 0 }, { lon: 10, lat: 0 }], ...box);
    expect(near.at(185, 0)).toBeNull();
    expect(AZIMUTHAL_LIMIT).toBeLessThan(180);
  });
  it("keeps a trip inside one city a map of a few kilometres", () => {
    const f = frameOf([{ lon: 2.35, lat: 48.85 }], ...box);
    expect(f.at(2.35, 48.85)).not.toBeNull();
  });
});
