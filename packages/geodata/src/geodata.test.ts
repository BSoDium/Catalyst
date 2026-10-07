import { describe, expect, it } from "vitest";
import { decodePolylines, encodePolylines, loadBorders, loadCoastlines, polylinesToMultiLineString } from "./index";

describe("format", () => {
  it("round-trips quantised polylines", () => {
    const raw = { lines: [[[-9.14, 38.72], [-9.14, 38.72], [2.35, 48.86], [135.77, 35.01]], [[0, 0]]] };
    const dec = decodePolylines(encodePolylines(raw, 100));
    expect(dec.offsets.length).toBe(2); // degenerate single-point line dropped, duplicate removed
    expect(Array.from(dec.offsets)).toEqual([0, 3]);
    expect(dec.positions[0]).toBeCloseTo(-9.14, 5);
    expect(dec.positions[5]).toBeCloseTo(35.01, 5);
    expect(polylinesToMultiLineString(dec)[0]).toHaveLength(3);
  });
});

describe("datasets", () => {
  it("coastlines are plausible and in range", async () => {
    const c = await loadCoastlines();
    expect(c.offsets.length - 1).toBeGreaterThan(50);
    for (let i = 0; i < c.positions.length; i += 2) {
      expect(Math.abs(c.positions[i]!)).toBeLessThanOrEqual(180);
      expect(Math.abs(c.positions[i + 1]!)).toBeLessThanOrEqual(90);
    }
  });
  it("has no artificial antimeridian or pole edges", async () => {
    for (const p of [await loadCoastlines(), await loadBorders()]) {
      for (let l = 0; l < p.offsets.length - 1; l++) {
        for (let v = p.offsets[l]!; v < p.offsets[l + 1]! - 1; v++) {
          const [a, b] = [p.positions[v * 2]!, p.positions[(v + 1) * 2]!];
          expect(Math.abs(a - b)).toBeLessThan(180); // no wrap-around jumps
          expect(Math.abs(a) >= 179.9999 && Math.abs(b) >= 179.9999).toBe(false);
        }
      }
    }
  });
  it("borders load", async () => {
    const b = await loadBorders();
    expect(b.offsets.length - 1).toBeGreaterThan(100);
  });
});
