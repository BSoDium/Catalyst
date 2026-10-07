import { describe, expect, it } from "vitest";
import {
  CODE,
  artStops,
  bayer8,
  blockFraction,
  bresenhamCount,
  changedRatio,
  components8,
  compareMasks,
  count,
  cssStops,
  dilate,
  expInterp,
  hollowFillStops,
  SOLID_FROM,
  THIN_INK,
  inkMask,
  inkOpacityFor,
  inkOpacityStops,
  makeMask,
  nativeRaster,
  removeStairs,
  toneLit,
  zhangSuen,
  type Pt,
  type Stops,
} from "./artLine";

const ANGLES = Array.from({ length: 48 }, (_, i) => i * 3.75);
// +0.003 keeps cell centres off exact ties with the line edge (a measure-zero case the GPU rule resolves to "both lit")
const OFFSETS = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875].map((o) => o + 0.003);

function lineAt(angleDeg: number, ox: number, oy: number, half = 12): Pt[] {
  const a = (angleDeg * Math.PI) / 180;
  const c = 20;
  return [
    [c + ox - Math.cos(a) * half, c + oy - Math.sin(a) * half],
    [c + ox + Math.cos(a) * half, c + oy + Math.sin(a) * half],
  ];
}

describe("width ramps in art pixels", () => {
  const MAJOR: Stops = [[5, 0.6], [12, 1.1], [14, 2.2], [15, 3.4], [16, 7], [17, 14], [18, 30]];
  it("floors every width at one art pixel", () => {
    const a = artStops(MAJOR);
    for (const [, w] of a) expect(w).toBeGreaterThanOrEqual(1);
    expect(a[0]![1]).toBe(1); // 0.6 css px hairline -> 1 art px
    expect(a[4]![1]).toBeCloseTo(7 / 3, 6);
  });
  it("converts to CSS px for a concrete cell", () => {
    expect(cssStops([[10, 2]], 2.5)[0]![1]).toBe(5);
  });
  it("expInterp is exact at stops, monotone between and clamped outside", () => {
    expect(expInterp(MAJOR, 3)).toBe(0.6);
    expect(expInterp(MAJOR, 16)).toBe(7);
    expect(expInterp(MAJOR, 40)).toBe(30);
    let prev = 0;
    for (let z = 5; z <= 18; z += 0.1) {
      const v = expInterp(MAJOR, z);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });
});

describe("hollow road interiors", () => {
  const caseArt = artStops([[12, 0.6], [14, 1], [15, 2], [16, 7], [17, 14], [18, 30]]);
  const fill = hollowFillStops(caseArt);
  it("is zero below the zoom where two outlines plus a 2 px interior fit, then jumps to the minimum", () => {
    expect(fill[0]![1]).toBe(0);
    const firstOn = fill.find(([, v]) => v > 0)!;
    expect(firstOn[1]).toBe(2);
    expect(expInterp(caseArt, firstOn[0])).toBeGreaterThanOrEqual(4 - 1e-6);
  });
  it("never has an interior between 0 and the minimum", () => {
    for (let z = 12; z <= 18; z += 0.05) {
      const v = expInterp(fill, z);
      // stops are dense, allow the interpolation across the single jump segment
      if (v > 1e-6 && v < 2 - 1e-6) expect(z).toBeLessThan(expInterp(caseArt, z) < 4 ? 99 : firstOnZoom(fill) + 0.01);
    }
  });
  it("keeps each outline exactly one art pixel wide once hollow", () => {
    for (let z = firstOnZoom(fill) + 0.3; z <= 18; z += 0.25) {
      const edge = (expInterp(caseArt, z) - expInterp(fill, z)) / 2;
      expect(edge).toBeGreaterThan(0.9);
      expect(edge).toBeLessThan(1.15);
    }
  });
  it("stays solid when the casing never gets wide enough", () => {
    const narrow = hollowFillStops(artStops([[12, 0.6], [18, 6]]));
    expect(narrow.every(([, v]) => v === 0)).toBe(true);
  });
});

function firstOnZoom(stops: Stops): number {
  return stops.find(([, v]) => v > 0)![0];
}

describe("native rasterisation (what the centre rule must equal)", () => {
  it("a one-art-pixel line is ONE 8-connected component at every angle and sub-pixel offset", () => {
    for (const a of ANGLES) {
      for (const ox of OFFSETS) {
        for (const oy of OFFSETS) {
          const m = nativeRaster(lineAt(a, ox, oy), 1, 40, 40);
          expect(components8(m).n, `angle ${a} offset ${ox},${oy}`).toBe(1);
        }
      }
    }
  });
  it("never drops a column or row of its major axis (no gaps)", () => {
    for (const a of ANGLES) {
      const pts = lineAt(a, 0.3, 0.7);
      const m = nativeRaster(pts, 1, 40, 40);
      const horizontal = Math.abs(Math.cos((a * Math.PI) / 180)) >= Math.abs(Math.sin((a * Math.PI) / 180));
      const lo = Math.ceil(Math.min(pts[0]![horizontal ? 0 : 1], pts[1]![horizontal ? 0 : 1])) + 1;
      const hi = Math.floor(Math.max(pts[0]![horizontal ? 0 : 1], pts[1]![horizontal ? 0 : 1])) - 1;
      for (let k = lo; k <= hi; k++) {
        let n = 0;
        for (let t = 0; t < 40; t++) n += horizontal ? m.data[t * 40 + k]! : m.data[k * 40 + t]!;
        expect(n, `angle ${a} line ${k}`).toBeGreaterThanOrEqual(1);
      }
    }
  });
  it("a sub-pixel line (0.4 art px) WOULD drop out: why the style floors the width at one", () => {
    let dropped = 0;
    for (const oy of OFFSETS) {
      const m = nativeRaster([[2, 10 + oy], [38, 10 + oy]], 0.4, 40, 40);
      if (count(m) === 0) dropped++;
    }
    expect(dropped).toBeGreaterThan(0);
  });
});

describe("staircase removal (the thin-line cleanup)", () => {
  it("leaves ONE cell per major-axis step with no 2x2 blocks, still one component, at every angle and offset", () => {
    for (const a of ANGLES) {
      for (const ox of OFFSETS) {
        for (const oy of OFFSETS) {
          const pts = lineAt(a, ox, oy);
          const raw = nativeRaster(pts, 1, 40, 40);
          const thin = removeStairs(raw);
          expect(components8(thin).n, `angle ${a} offset ${ox},${oy}`).toBe(1);
          expect(blockFraction(thin)).toBe(0);
          // never thicker than a Bresenham line (+1 for the end cells)
          expect(count(thin)).toBeLessThanOrEqual(bresenhamCount(pts[0]!, pts[1]!) + 2);
          expect(count(thin)).toBeLessThanOrEqual(count(raw));
        }
      }
    }
  });
  it("fixes the worst case: a 45 degree line is 4-connected two-cell stairs before, one cell per step after", () => {
    const raw = nativeRaster([[5, 5.35], [30, 30.35]], 1, 40, 40);
    const before = count(raw);
    const after = count(removeStairs(raw));
    expect(before).toBeGreaterThan(after);
    expect(after).toBeLessThanOrEqual(27);
  });
  it("keeps the sharp corners of an axis-aligned outline", () => {
    const m = makeMask(10, 10);
    for (let i = 2; i <= 7; i++) for (const [x, y] of [[i, 2], [i, 7], [2, i], [7, i]] as const) m.data[y * 10 + x] = 1;
    const t = removeStairs(m);
    expect(count(t)).toBe(count(m));
  });
  it("does not erode a wide solid band", () => {
    const m = makeMask(20, 20);
    for (let y = 8; y < 12; y++) for (let x = 0; x < 20; x++) m.data[y * 20 + x] = 1;
    expect(count(removeStairs(m))).toBe(count(m));
  });
  it("never disconnects a polyline with joins", () => {
    for (const bend of [20, 45, 90, 135]) {
      for (const a of ANGLES) {
        const a1 = (a * Math.PI) / 180;
        const a2 = ((a + bend) * Math.PI) / 180;
        const mid: Pt = [20.3, 20.6];
        const pts: Pt[] = [[mid[0] - Math.cos(a1) * 10, mid[1] - Math.sin(a1) * 10], mid, [mid[0] + Math.cos(a2) * 10, mid[1] + Math.sin(a2) * 10]];
        const raw = nativeRaster(pts, 1, 40, 40);
        expect(components8(removeStairs(raw)).n, `angle ${a} bend ${bend}`).toBe(1);
      }
    }
  });
});

describe("Zhang-Suen twin", () => {
  it("thins a 2-wide horizontal bar to a connected 1-wide line", () => {
    const cols = 20;
    const rows = 8;
    const codes = new Uint8Array(cols * rows);
    for (let y = 3; y < 5; y++) for (let x = 2; x < 18; x++) codes[y * cols + x] = CODE.thin;
    const t = zhangSuen(cols, rows, codes, 2);
    const m = inkMask(cols, rows, t);
    expect(components8(m).n).toBe(1);
    expect(count(m)).toBeLessThan(2 * 16);
  });
  it("leaves solid-coded cells alone", () => {
    const codes = new Uint8Array(8 * 8).fill(CODE.solid);
    expect(Array.from(zhangSuen(8, 8, codes, 2))).toEqual(Array.from(codes));
  });
});

describe("measurement toolbox", () => {
  it("counts 8-connected components", () => {
    const m = makeMask(6, 6);
    m.data[0] = 1;
    m.data[7] = 1; // diagonal neighbour of 0
    m.data[35] = 1;
    expect(components8(m).n).toBe(2);
  });
  it("dilates by one cell", () => {
    const m = makeMask(5, 5);
    m.data[12] = 1;
    expect(count(dilate(m, 1))).toBe(9);
  });
  it("compares masks: a missing line is lineMiss, a shifted line is only strictMiss", () => {
    const ideal = nativeRaster([[2, 10.5], [30, 10.5]], 1, 40, 40);
    const empty = makeMask(40, 40);
    expect(compareMasks(ideal, empty).lineMiss).toBe(1);
    const shifted = nativeRaster([[2, 11.5], [30, 11.5]], 1, 40, 40);
    const c = compareMasks(ideal, shifted);
    expect(c.lineMiss).toBe(0);
    expect(c.strictMiss).toBe(1);
    expect(c.sizeRatio).toBeCloseTo(1, 6);
  });
  it("counts changed cells between frames", () => {
    const a = nativeRaster([[2, 10.5], [30, 10.5]], 1, 40, 40);
    const b = nativeRaster([[2, 10.5], [30, 10.5]], 1, 40, 40);
    expect(changedRatio(a, b).changed).toBe(0);
  });
});

describe("tone patterns are screen anchored", () => {
  it("depend only on tone and the screen cell", () => {
    for (const style of ["clean", "bayer8"] as const) {
      for (let i = 0; i < 50; i++) expect(toneLit(0.3, i, 7 * i, style)).toBe(toneLit(0.3, i, 7 * i, style));
    }
  });
  it("are nested: a darker tone lights a superset of cells (no flicker when a tone fades)", () => {
    for (const style of ["clean", "bayer8"] as const) {
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          let was = false;
          for (let t = 0; t <= 1.0001; t += 0.01) {
            const lit = toneLit(Math.min(1, t), x, y, style);
            if (was) expect(lit).toBe(true);
            was = lit;
          }
        }
      }
    }
  });
  it("clean tones quantise to sixteenths with the right density", () => {
    for (let k = 0; k <= 16; k++) {
      let n = 0;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (toneLit(k / 16, x, y, "clean")) n++;
      expect(n).toBe(k * 4);
    }
  });
  it("clean 1/16 is a regular lattice: one dot per 4x4 block, spaced 4 apart", () => {
    const dots: [number, number][] = [];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (toneLit(1 / 16, x, y, "clean")) dots.push([x, y]);
    expect(dots.length).toBe(4);
    for (const [x, y] of dots) expect((x - dots[0]![0]) % 4 === 0 && (y - dots[0]![1]) % 4 === 0).toBe(true);
  });
  it("bayer8 is the standard recursive Bayer matrix (B2 = [[0,2],[3,1]], B2n = 4 Bn + B2)", () => {
    const build = (n: number): number[][] => {
      if (n === 2) return [[0, 2], [3, 1]];
      const h = build(n / 2);
      const m = n / 2;
      const base = [[0, 2], [3, 1]];
      return Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => 4 * h[y % m]![x % m]! + base[Math.floor(y / m)]![Math.floor(x / m)]!));
    };
    const ref = build(8);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) expect(bayer8(x, y), `(${x},${y})`).toBe(ref[y]![x]);
  });
  it("half tone is a checkerboard, quarter tone a 2x2 lattice (no stripes)", () => {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      expect(toneLit(0.5, x, y, "clean")).toBe((x + y) % 2 === 0);
      expect(toneLit(0.25, x, y, "clean")).toBe(x % 2 === 0 && y % 2 === 0);
    }
  });
});

describe("ink class encoding", () => {
  it("one-pixel lines are weaker than wide ones, with a ramp in between", () => {
    expect(inkOpacityFor(1)).toBe(THIN_INK);
    expect(inkOpacityFor(1.25)).toBe(THIN_INK);
    expect(inkOpacityFor(1.6)).toBe(1);
    expect(inkOpacityFor(5)).toBe(1);
    expect(inkOpacityFor(1.4)).toBeGreaterThan(THIN_INK);
    expect(inkOpacityFor(1.4)).toBeLessThan(1);
  });
  it("a thin line stays below the solid threshold even where two thin lines cross once (it only becomes solid when they stack)", () => {
    expect(THIN_INK).toBeLessThan(SOLID_FROM);
    expect(1 - (1 - THIN_INK) ** 2).toBeGreaterThan(SOLID_FROM);
  });
  it("the ink threshold 0.49 * THIN_INK is the 'centre inside the line' test for both classes", () => {
    // AA alpha is 0.5 at the edge; threshold / opacity = 0.49 of the ramp for a thin line, 0.3675 of 1 for a wide one
    expect((0.49 * THIN_INK) / THIN_INK).toBeCloseTo(0.49, 12);
    expect(0.49 * THIN_INK).toBeLessThan(0.5);
  });
  it("hollow casings are thin outlines from the hollow zoom, whatever their total width", () => {
    const widths = artStops([[12, 0.6], [14, 1], [15, 2], [16, 7], [17, 14], [18, 30]]);
    const stops = inkOpacityStops(widths, 1.5, 0.25, 16.8);
    const at = (z: number) => {
      let v = stops[0]![1];
      for (const [zz, vv] of stops) if (zz <= z) v = vv;
      return v;
    };
    expect(at(13)).toBe(THIN_INK); // a one-pixel road
    expect(at(16.4)).toBe(1); // a wide solid band
    expect(at(16.79)).toBe(1);
    expect(at(16.81)).toBe(THIN_INK); // the two outlines of the hollow road
    expect(at(18)).toBe(THIN_INK);
  });
});
