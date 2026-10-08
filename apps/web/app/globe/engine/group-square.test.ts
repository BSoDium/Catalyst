import { describe, expect, it } from "vitest";
import { snapBox } from "./group-square";

describe("box cells", () => {
  it("the cells that contain the bounds, whole cells", () => {
    const r = snapBox(10, 20, 100, 80, 3);
    expect(r).toEqual({ c0: 3, r0: 6, c1: 34, r1: 27 });
    expect(r.c0 * 3).toBeLessThanOrEqual(10);
    expect(r.c1 * 3).toBeGreaterThanOrEqual(100);
  });
  it("at least 3 cells across, kept centred on the bounds", () => {
    const t = snapBox(100, 100, 101, 101, 3);
    expect(t.c1 - t.c0).toBe(3);
    expect(Math.abs((t.c0 + t.c1) / 2 - 100.5 / 3)).toBeLessThanOrEqual(1);
  });
  it("works at 2 px and 2.5 px cells", () => {
    for (const cell of [2, 2.5, 3]) {
      const r = snapBox(17.3, 9.9, 150.2, 60.1, cell);
      expect(r.c0 * cell).toBeLessThanOrEqual(17.3);
      expect(r.c1 * cell).toBeGreaterThanOrEqual(150.2);
      expect(Number.isInteger(r.c0) && Number.isInteger(r.r1)).toBe(true);
    }
  });
});
