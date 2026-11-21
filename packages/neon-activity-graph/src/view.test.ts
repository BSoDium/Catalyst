import { describe, expect, it } from "vitest";
import { placeholderTiles, slabFor, stripShifts } from "./view";

describe("slabFor", () => {
  it("lays the weeks in equal strips one behind the other", () => {
    const s = slabFor(53, 3);
    expect(s.width).toBeGreaterThanOrEqual(18 * 1.12);
    expect(s.at(0, 0).z).toBeLessThan(s.at(18, 0).z);
    expect(s.rects).toHaveLength(3);
  });
  it("staggers the strips so that, seen by the camera, they stand straight over one another", () => {
    const s = slabFor(53, 4);
    // (the camera's screen x of a point is proportional to -x + 0.3 z for the direction (-0.3, 0.5, -1): the first day of each strip has the same one)
    const sx = (week: number) => {
      const c = s.at(week, 0);
      return -c.x + 0.3 * c.z;
    };
    for (const week of [14, 28, 42]) expect(sx(week)).toBeCloseTo(sx(0), 1);
  });
  it("is not staggered with one strip", () => {
    const s = slabFor(53, 1);
    expect(s.width).toBeCloseTo(53 * 1.12);
  });
});

describe("placeholderTiles", () => {
  it("draws every day once, in a box that has the aspect asked for", () => {
    const p = placeholderTiles(53, 1, 3.97);
    expect(p.d.match(/M/g)).toHaveLength(53 * 7);
    const [, , w, h] = p.viewBox.split(" ").map(Number) as [number, number, number, number];
    expect(w / h).toBeCloseTo(3.97, 2);
    expect(p.d).not.toContain("NaN");
  });
});

describe("stripShifts", () => {
  it("moves a strip whose weight is on its left to the right, and the other way round", () => {
    // (53 weeks in 4 strips of 14, the last of 11: strip 0 is heavy on its first weeks, strip 1 on its last, the others even)
    const w = (week: number, _day: number) => (week < 14 ? (week < 4 ? 5 : 1) : week < 28 ? (week - 14 > 9 ? 5 : 1) : 1);
    const s = stripShifts(53, 4, w);
    expect(s[0]).toBeGreaterThan(0);
    expect(s[1]).toBeLessThan(0);
  });
  it("moves a shorter last strip to the right, to the middle of a full one", () => {
    const s = stripShifts(53, 4, () => 1);
    expect(s[0]).toBeCloseTo(0);
    expect(s[3]).toBeGreaterThan(1);
  });
  it("is zero for one strip and never more than 3 weeks", () => {
    expect(stripShifts(53, 1, () => 1)).toEqual([0]);
    expect(Math.max(...stripShifts(53, 4, (week) => (week < 3 ? 1000 : 0.01)).map(Math.abs))).toBeLessThanOrEqual(3);
  });
  it("keeps every strip inside the slab's width when given to slabFor", () => {
    const s = slabFor(53, 4, [2, -1, 0, 3]);
    for (const r of s.rects) {
      expect(r.x0).toBeGreaterThanOrEqual(0);
      expect(r.x1).toBeLessThanOrEqual(s.width + 1e-9);
    }
  });
});
