import { describe, expect, it } from "vitest";
import { fromWorldPx, snapCenter, worldPx } from "./snap";

describe("pan snapping", () => {
  it("world pixels round trip", () => {
    for (const [lon, lat, z] of [[106.7, 10.78, 14.5], [-9.14, 38.72, 16], [2.35, 48.85, 13]] as const) {
      const p = worldPx(lon, lat, z);
      const q = fromWorldPx(p.x, p.y, z);
      expect(q.lon).toBeCloseTo(lon, 9);
      expect(q.lat).toBeCloseTo(lat, 9);
    }
  });

  it("lands on the grid, within half a cell, and is idempotent", () => {
    const cell = 3;
    const z = 14.5;
    for (let i = 0; i < 50; i++) {
      const lon = 106.7 + i * 0.000037;
      const lat = 10.77 + i * 0.000021;
      const s = snapCenter(lon, lat, z, cell);
      const a = worldPx(lon, lat, z);
      const b = worldPx(s.lon, s.lat, z);
      expect(Math.abs(b.x - a.x)).toBeLessThanOrEqual(cell / 2 + 1e-6);
      expect(Math.abs(b.y - a.y)).toBeLessThanOrEqual(cell / 2 + 1e-6);
      expect(b.x / cell).toBeCloseTo(Math.round(b.x / cell), 5);
      expect(b.y / cell).toBeCloseTo(Math.round(b.y / cell), 5);
      const t = snapCenter(s.lon, s.lat, z, cell);
      expect(t.lon).toBeCloseTo(s.lon, 10);
      expect(t.lat).toBeCloseTo(s.lat, 10);
    }
  });

  it("a pan of k cells moves the snapped centre by exactly k cells", () => {
    const cell = 3;
    const z = 15;
    const a = worldPx(2.3, 48.8, z);
    const s0 = worldPx(...(Object.values(snapCenter(2.3, 48.8, z, cell)) as [number, number]), z);
    for (const frac of [0.1, 0.4, 0.77]) {
      for (const k of [1, 2, 5]) {
        const m = fromWorldPx(a.x + k * cell + frac, a.y, z);
        const s1 = worldPx(...(Object.values(snapCenter(m.lon, m.lat, z, cell)) as [number, number]), z);
        expect(Math.abs((s1.x - s0.x) / cell - Math.round((s1.x - s0.x) / cell))).toBeLessThan(1e-6);
      }
    }
  });
});
