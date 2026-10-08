import { describe, expect, it } from "vitest";
import { COVER_LEVELS, COVER_LIMITS, COVER_PATTERNS, coverArt, coverPaths, ditherLevel, hashSeed, seededRandom } from "./cover-art";

const SEEDS = Array.from({ length: 300 }, (_, i) => `sample-seed-${i}`);

describe("hashSeed and seededRandom", () => {
  it("hash is stable and spreads near-identical seeds", () => {
    expect(hashSeed("catalyst")).toBe(hashSeed("catalyst"));
    expect(hashSeed("a1")).not.toBe(hashSeed("a2"));
    expect(hashSeed("")).toBeGreaterThanOrEqual(0);
  });

  it("the generator is deterministic and stays in [0, 1)", () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    for (let i = 0; i < 1000; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("ditherLevel", () => {
  it("maps the ends to the ends and stays in range", () => {
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        expect(ditherLevel(0, x, y)).toBe(0);
        expect(ditherLevel(1, x, y)).toBe(COVER_LEVELS - 1);
        expect(ditherLevel(-5, x, y)).toBe(0);
        expect(ditherLevel(5, x, y)).toBe(COVER_LEVELS - 1);
      }
    }
  });

  it("a mid value mixes two neighbouring levels over a Bayer cell", () => {
    const seen = new Set<number>();
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) seen.add(ditherLevel(0.5, x, y));
    expect(seen).toEqual(new Set([1, 2]));
  });
});

describe("coverArt", () => {
  it("is deterministic: the same seed and options give the same grid", () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const a = coverArt(seed);
      const b = coverArt(seed);
      expect(a.pattern).toBe(b.pattern);
      expect(Array.from(a.levels)).toEqual(Array.from(b.levels));
      expect(a.marks).toEqual(b.marks);
    }
  });

  it("different seeds give different art", () => {
    const keys = new Set(SEEDS.map((s) => coverArt(s).levels.join("")));
    expect(keys.size).toBeGreaterThan(SEEDS.length * 0.95);
  });

  it("stays in bounds: the grid size, every level and every mark", () => {
    for (const seed of SEEDS) {
      const art = coverArt(seed, { cols: 24, rows: 14 });
      expect(art.cols).toBe(24);
      expect(art.rows).toBe(14);
      expect(art.levels).toHaveLength(24 * 14);
      for (const level of art.levels) {
        expect(level).toBeGreaterThanOrEqual(0);
        expect(level).toBeLessThan(COVER_LEVELS);
      }
      expect(art.marks.length).toBeGreaterThanOrEqual(1);
      expect(art.marks.length).toBeLessThanOrEqual(2);
      for (const m of art.marks) {
        expect(Number.isInteger(m.x) && Number.isInteger(m.y)).toBe(true);
        expect(m.x).toBeGreaterThanOrEqual(0);
        expect(m.x).toBeLessThan(24);
        expect(m.y).toBeGreaterThanOrEqual(0);
        expect(m.y).toBeLessThan(14);
      }
    }
  });

  it("clamps the size and survives hostile input", () => {
    const big = coverArt("x", { cols: 1e9, rows: -4 });
    expect(big.cols).toBe(COVER_LIMITS.maxCells);
    expect(big.rows).toBe(COVER_LIMITS.minCells);
    const nan = coverArt("x", { cols: Number.NaN });
    expect(nan.cols).toBe(COVER_LIMITS.defaultCols);
    expect(coverArt("").levels.length).toBe(COVER_LIMITS.defaultCols * COVER_LIMITS.defaultRows);
    expect(coverArt("\u{1F4A5}\u0000é").pattern).toBeTruthy();
  });

  it("reaches every pattern across seeds, and a forced pattern is honoured", () => {
    const seen = new Set(SEEDS.map((s) => coverArt(s).pattern));
    expect(seen).toEqual(new Set(COVER_PATTERNS));
    for (const pattern of COVER_PATTERNS) expect(coverArt("forced", { pattern }).pattern).toBe(pattern);
  });

  it("is never blank and never one flat tone (every pattern, many seeds)", () => {
    for (const pattern of COVER_PATTERNS) {
      let blank = 0;
      for (const seed of SEEDS.slice(0, 80)) {
        const levels = coverArt(seed, { pattern }).levels;
        if (!levels.some((l) => l > 0)) blank++;
        else expect(new Set(levels).size, `${pattern} ${seed} is flat`).toBeGreaterThanOrEqual(2);
      }
      expect(blank, `${pattern} blank covers`).toBeLessThan(8);
    }
  });
});

describe("coverPaths", () => {
  it("emits only rectangles inside the viewBox, and covers exactly the lit cells", () => {
    for (const seed of SEEDS.slice(0, 30)) {
      const art = coverArt(seed);
      const { levels, marks } = coverPaths(art);
      expect(levels).toHaveLength(COVER_LEVELS);
      expect(levels[0]).toBe("");
      let area = 0;
      for (const d of levels) {
        for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)) {
          const [x, y, w, back] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
          expect(w).toBe(back);
          expect(x + w).toBeLessThanOrEqual(art.cols);
          expect(y + 1).toBeLessThanOrEqual(art.rows);
          area += w;
        }
      }
      expect(area).toBe(art.levels.filter((l) => l > 0).length);
      expect(marks.match(/M/g)?.length).toBe(art.marks.length);
    }
  });
});
