import { describe, expect, it } from "vitest";
import { COVER_LEVELS, COVER_LIMITS, COVER_PALETTES, COVER_PATTERNS, coverArt, coverPaths, ditherLevel, hashSeed, seededRandom } from "./cover-art";

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
        expect([m.x, m.y, m.w, m.h].every(Number.isInteger)).toBe(true);
        expect(m.x).toBeGreaterThanOrEqual(0);
        expect(m.y).toBeGreaterThanOrEqual(0);
        expect(m.w).toBeGreaterThanOrEqual(1);
        expect(m.h).toBeGreaterThanOrEqual(1);
        expect(m.x + m.w).toBeLessThanOrEqual(24);
        expect(m.y + m.h).toBeLessThanOrEqual(14);
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
      // (a hollow square is two rectangles in one path, three bars are three)
      expect(marks.match(/M/g)?.length).toBe(art.marks.reduce((n, m) => n + (m.shape === "ring" && m.w > 2 && m.h > 2 ? 2 : m.shape === "bars" ? Math.min(3, Math.ceil(m.h / 2)) : 1), 0));
    }
  });
});

describe("the patterns", () => {
  it("are twenty-one, the checker board and the circuit traces not among them (owner, 2026-11-02: too plain)", () => {
    expect(COVER_PATTERNS).toHaveLength(21);
    expect(COVER_PATTERNS).not.toContain("checker");
    expect(COVER_PATTERNS).not.toContain("circuit");
  });

  it("survive the smallest and the largest grid", () => {
    for (const pattern of COVER_PATTERNS) {
      for (const [cols, rows] of [[4, 4], [96, 96], [4, 96], [96, 4]] as const) {
        const art = coverArt("tiny-or-huge", { pattern, cols, rows });
        expect(art.levels).toHaveLength(cols * rows);
        for (const level of art.levels) expect(level).toBeLessThan(COVER_LEVELS);
        for (const m of art.marks) {
          expect(m.x + m.w).toBeLessThanOrEqual(cols);
          expect(m.y + m.h).toBeLessThanOrEqual(rows);
        }
      }
    }
  });

  it("a forced pattern does not change the look (palettes, tones, wash, marks)", () => {
    for (const seed of SEEDS.slice(0, 30)) {
      const base = coverArt(seed);
      const forced = coverArt(seed, { pattern: base.pattern === "field" ? "rings" : "field" });
      expect(forced.palette).toBe(base.palette);
      expect(forced.second).toBe(base.second);
      expect(forced.tones).toEqual(base.tones);
      expect(forced.wash).toBe(base.wash);
      expect(forced.marks).toEqual(base.marks);
    }
  });
});

describe("the colour of the tones", () => {
  it("has a second palette that is never the first, a tone for every level, and every scheme and wash occurs", () => {
    const tones = new Set<string>();
    const washes = new Set<number>();
    for (const seed of SEEDS) {
      const a = coverArt(seed);
      expect(a.second).not.toBe(a.palette);
      expect(COVER_PALETTES).toContain(a.second);
      expect(a.tones).toHaveLength(COVER_LEVELS);
      expect(a.markPalette === a.palette || a.markPalette === a.second).toBe(true);
      tones.add(a.tones.join());
      washes.add(a.wash);
    }
    expect(tones.size).toBe(4);
    expect(washes).toEqual(new Set([0, 1, 2]));
  });

  it("is a function of the seed and the forced palette only", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      for (const palette of COVER_PALETTES) {
        const a = coverArt(seed, { palette });
        expect(coverArt(seed, { palette, pattern: "bars" }).second).toBe(a.second);
        expect(a.second).not.toBe(palette);
      }
    }
  });
});

describe("the palette of the marks", () => {
  it("is chosen by the seed, deterministically, and every palette occurs", () => {
    const seen = new Map<string, number>();
    for (const seed of SEEDS) {
      const a = coverArt(seed);
      expect(coverArt(seed).palette).toBe(a.palette);
      expect(COVER_PALETTES).toContain(a.palette);
      seen.set(a.palette, (seen.get(a.palette) ?? 0) + 1);
    }
    expect(seen.size).toBe(COVER_PALETTES.length);
    for (const n of seen.values()) expect(n).toBeGreaterThan(SEEDS.length * 0.15);
  });

  it("does not change the grid or the marks: forcing a palette gives the very same art", () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const base = coverArt(seed);
      for (const palette of COVER_PALETTES) {
        const forced = coverArt(seed, { palette });
        expect(forced.palette).toBe(palette);
        expect(Array.from(forced.levels)).toEqual(Array.from(base.levels));
        expect(forced.marks).toEqual(base.marks);
        expect(forced.pattern).toBe(base.pattern);
      }
    }
  });
});
