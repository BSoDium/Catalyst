import { describe, expect, it } from "vitest";
import { coverRatio, layoutAllTiers, layoutMasonry, masonryItemVars, masonryListVars, RATIO_FALLBACK, RATIO_MAX, RATIO_MIN } from "./masonry";

describe("coverRatio", () => {
  it("is height over width from the contract, so a portrait is above 1 and a landscape below", () => {
    expect(coverRatio({ width: 1920, height: 2560 })).toBeCloseTo(4 / 3, 5);
    expect(coverRatio({ width: 1920, height: 1080 })).toBeCloseTo(0.5625, 5);
  });
  it("falls back to 3:4 without a usable size and clamps the extremes", () => {
    expect(coverRatio(undefined)).toBe(RATIO_FALLBACK);
    expect(coverRatio({ width: 100 })).toBe(RATIO_FALLBACK);
    expect(coverRatio({ width: 0, height: 10 })).toBe(RATIO_FALLBACK);
    expect(coverRatio({ width: 4000, height: 100 })).toBe(RATIO_MIN);
    expect(coverRatio({ width: 100, height: 4000 })).toBe(RATIO_MAX);
  });
});

describe("layoutMasonry", () => {
  const mix = [1.33, 0.56, 1.6, 0.56, 1, 1.33, 0.5, 1.6];
  it("puts everything in one column when there is one", () => {
    const l = layoutMasonry(mix, 1);
    expect(l.slots.every((s) => s.column === 0)).toBe(true);
    expect(l.slots.map((s) => s.above)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(l.totals[0]!.count).toBe(8);
  });
  it("fills the first row left to right, then goes to the shortest column (reading order)", () => {
    const l = layoutMasonry(mix, 3);
    expect(l.slots.slice(0, 3).map((s) => s.column)).toEqual([0, 1, 2]);
    // the second picture (0.56) is the shortest column: the 4th goes under it
    expect(l.slots[3]!.column).toBe(1);
  });
  it("keeps every picture exactly once and the sums consistent", () => {
    for (const cols of [1, 2, 3, 4]) {
      const l = layoutMasonry(mix, cols);
      expect(l.slots).toHaveLength(mix.length);
      expect(l.totals.reduce((n, t) => n + t.count, 0)).toBe(mix.length);
      expect(l.totals.reduce((n, t) => n + t.ratio, 0)).toBeCloseTo(mix.reduce((a, b) => a + b, 0), 6);
      for (const [i, s] of l.slots.entries()) {
        const before = l.slots.slice(0, i).filter((o) => o.column === s.column);
        expect(s.above).toBe(before.length);
      }
    }
  });
  it("keeps columns level: the tallest and the shortest differ by less than the tallest picture", () => {
    const l = layoutMasonry(mix, 3);
    const h = l.totals.map((t) => t.ratio + 0.3 * t.count);
    expect(Math.max(...h) - Math.min(...h)).toBeLessThan(1.6 + 0.3);
  });
  it("is deterministic and survives no pictures and more columns than pictures", () => {
    expect(layoutMasonry(mix, 4)).toEqual(layoutMasonry(mix, 4));
    expect(layoutMasonry([], 3).slots).toEqual([]);
    expect(layoutMasonry([1.2], 4).slots[0]).toEqual({ column: 0, above: 0, ratioAbove: 0 });
  });
});

describe("custom properties", () => {
  it("carry the ratio and, for the four tiers, the column, the count above and the ratio above", () => {
    const layouts = layoutAllTiers([1.33, 0.56, 1]);
    const v = masonryItemVars(0.56, layouts, 1);
    expect(v["--ratio"]).toBe(0.56);
    expect(v["--aspect"]).toBeCloseTo(1.7857, 3);
    expect(v["--c1"]).toBe(0);
    expect(v["--n1"]).toBe(1);
    expect(v["--r1"]).toBe(1.33);
    expect(v["--c2"]).toBe(1);
    expect(v["--n2"]).toBe(0);
    for (const tier of [1, 2, 3, 4]) for (const k of ["c", "n", "r"]) expect(v).toHaveProperty(`--${k}${tier}`);
  });
  it("give the wall one height per tier: the tallest column, less the last gap", () => {
    const h = masonryListVars(layoutAllTiers([1, 1]));
    expect(Object.keys(h)).toEqual(["--h1", "--h2", "--h3", "--h4"]);
    expect(h["--h1"]).toBe("calc(max(calc(2 * var(--colw) + 2 * var(--slot))) - var(--gap))");
    expect(h["--h2"]).toContain("max(calc(1 * var(--colw) + 1 * var(--slot)), calc(1 * var(--colw) + 1 * var(--slot)))");
    expect(masonryListVars(layoutAllTiers([]))["--h3"]).toBe("0px");
  });
});

describe("layoutAllTiers with extra tiles", () => {
  it("adds the extra tiles to a tier only where it asks for them", () => {
    const layouts = layoutAllTiers([1, 1], (columns) => (columns >= 2 ? [0.75, 0.75] : []));
    expect(layouts[0]!.slots).toHaveLength(2);
    expect(layouts[1]!.slots).toHaveLength(4);
    expect(layouts[3]!.slots).toHaveLength(4);
  });
  it("leaves out the variables of a tile a tier does not carry", () => {
    const layouts = layoutAllTiers([1], (columns) => (columns >= 2 ? [0.75] : []));
    const vars = masonryItemVars(0.75, layouts, 1);
    expect(vars["--c1"]).toBeUndefined();
    expect(vars["--c2"]).toBeDefined();
  });
});
