import { describe, expect, it } from "vitest";
import { placeholderTiles, slabFor } from "./view";

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
