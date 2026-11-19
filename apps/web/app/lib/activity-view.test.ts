import { describe, expect, it } from "vitest";
import { placeholderTiles, slabFor } from "./activity-view";

describe("slabFor", () => {
  it("lays the weeks in equal strips one behind the other", () => {
    const s = slabFor(53, 3);
    expect(s.width).toBeCloseTo(18 * 1.12);
    expect(s.at(0, 0).z).toBeLessThan(s.at(18, 0).z);
    expect(s.at(18, 0).x).toBeCloseTo(s.at(0, 0).x);
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
