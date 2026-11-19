import { describe, expect, it } from "vitest";
import { AZIMUTHAL_LIMIT, REGION_SPAN, frameOf } from "./trip-projection";

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
  it("is a world map for a trip across the globe: no disc edge, a seam far from the trip, a point everywhere", () => {
    const wide = frameOf([{ lon: 0, lat: 80 }, { lon: 0, lat: -80 }, { lon: 120, lat: 0 }, { lon: -120, lat: 0 }], ...box);
    expect(wide.azimuthal).toBe(false);
    expect(wide.at(0, 0)).not.toBeNull();
    expect(wide.at(185, 0)).not.toBeNull();
    const near = frameOf([{ lon: 0, lat: 0 }, { lon: 10, lat: 0 }], ...box);
    expect(near.azimuthal).toBe(true);
    expect(near.at(185, 0)).toBeNull();
    expect(AZIMUTHAL_LIMIT).toBeLessThan(180);
  });
  it("does not show the globe's edge for Paris to Patagonia on a wide poster, and breaks a line over the seam", () => {
    const pts = [{ lon: 2.3, lat: 48.8 }, { lon: -68, lat: -54 }, { lon: -70, lat: -33 }];
    const f = frameOf(pts, 0, 0, 436, 230, 26, { w: 436, h: 380 });
    expect(f.azimuthal).toBe(false);
    for (const p of pts) expect(f.at(p.lon, p.lat)).not.toBeNull();
    expect(f.cuts(179, -179)).toBe(false); // (the seam is at the other side of the globe from the trip, not at the antimeridian)
    expect(f.cuts(145, 150)).toBe(true);
  });
  it("keeps a trip over the antimeridian whole", () => {
    const f = frameOf([{ lon: 170, lat: 0 }, { lon: -170, lat: 10 }, { lon: 179, lat: 5 }], ...box);
    const a = f.at(170, 0)!;
    const b = f.at(-170, 10)!;
    expect(Math.abs(a.x - b.x)).toBeLessThan(box[2]);
  });
  it("keeps a trip inside one city a map of a few kilometres", () => {
    const f = frameOf([{ lon: 2.35, lat: 48.85 }], ...box);
    expect(f.at(2.35, 48.85)).not.toBeNull();
  });
  it("keeps a continent's trip azimuthal in a wide, short box, where the world map would stretch its land (South America)", () => {
    const pts = [{ lon: -77, lat: -12 }, { lon: -68, lat: -16 }, { lon: -66, lat: -22 }, { lon: -60, lat: -32 }, { lon: -58.4, lat: -34.6 }];
    const f = frameOf(pts, 0, 0, 620, 190, 26, { w: 620, h: 470 });
    expect(f.azimuthal).toBe(true);
    expect(REGION_SPAN).toBeGreaterThanOrEqual(45);
    // (a degree of latitude and a degree of longitude at the equator are as long as each other, as on the globe)
    const a = f.at(-60, 0)!;
    const dx = f.at(-59, 0)!.x - a.x;
    const dy = a.y - f.at(-60, 1)!.y;
    expect(dx / dy).toBeGreaterThan(0.9);
    expect(dx / dy).toBeLessThan(1.1);
  });
});
