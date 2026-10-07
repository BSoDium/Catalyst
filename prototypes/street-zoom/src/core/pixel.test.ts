import { describe, expect, it } from "vitest";
import {
  RevealState,
  artPixelCss,
  bayer8,
  cellDevicePx,
  classify,
  ditherThreshold,
  maskCoverage,
  meanPool,
  over,
  parseCssColor,
  poolImage,
  sharpFraction,
  showsSharp,
} from "./pixel";

const OPT = { inkThreshold: 0.3, dither: true };

function image(w: number, h: number, paint: (x: number, y: number) => [number, number, number, number]) {
  const d = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(paint(x, y), (y * w + x) * 4);
  return d;
}

describe("sizes", () => {
  it("uses 3 CSS px on desktop and 2 on phones", () => {
    expect(artPixelCss(900)).toBe(3);
    expect(artPixelCss(390)).toBe(2);
  });
  it("rounds to whole device pixels", () => {
    expect(cellDevicePx(3, 2)).toBe(6);
    expect(cellDevicePx(2, 2.625)).toBe(5);
    expect(cellDevicePx(0.1, 1)).toBe(1);
  });
});

describe("bayer8", () => {
  it("is a permutation of 0..63", () => {
    const seen = new Set<number>();
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) seen.add(bayer8(x, y));
    expect(seen.size).toBe(64);
    expect(Math.min(...seen)).toBe(0);
    expect(Math.max(...seen)).toBe(63);
  });
  it("tiles every 8 cells", () => {
    expect(bayer8(9, 17)).toBe(bayer8(1, 1));
  });
  it("lights the expected share of cells for a flat tone", () => {
    for (const t of [0.1, 0.25, 0.5, 0.75]) {
      let on = 0;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (t > ditherThreshold(x, y)) on++;
      expect(Math.abs(on / 64 - t)).toBeLessThan(1 / 64 + 1e-9);
    }
  });
  it("places a 50% tone so no two horizontal neighbours are both on (checker-like dots)", () => {
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 7; x++) {
        const a = 0.5 > ditherThreshold(x, y);
        const b = 0.5 > ditherThreshold(x + 1, y);
        expect(a && b).toBe(false);
      }
    }
  });
});

describe("max pooling keeps thin lines", () => {
  // a 1-source-pixel diagonal line, 3x3 cells
  const w = 30;
  const h = 30;
  const diag = image(w, h, (x, y) => (x === y ? [1, 0, 0, 1] : [0, 0, 0, 1]));
  it("max pooling gives a connected diagonal of cells at full ink", () => {
    const { cols, rows, cells } = poolImage(diag, w, h, 3);
    for (let i = 0; i < Math.min(cols, rows); i++) expect(cells[i * cols + i]!.r).toBe(1);
    // 8-connected, and nothing else is lit
    const lit = cells.filter((c) => c.r > 0.3).length;
    expect(lit).toBe(10);
  });
  it("mean pooling would lose it (1/3 of a cell)", () => {
    const m = meanPool(diag, w, h, 3, 0);
    expect(m[0]).toBeCloseTo(1 / 3, 5);
    // below a 0.5 threshold: the line would vanish
    expect(m[0]!).toBeLessThan(0.5);
  });
  it("keeps a straight 1px line connected at any phase against the grid", () => {
    for (let phase = 0; phase < 6; phase++) {
      const horiz = image(60, 12, (_x, y) => (y === 3 + phase % 3 ? [1, 0, 0, 1] : [0, 0, 0, 1]));
      const { cols, cells } = poolImage(horiz, 60, 12, 6);
      const row = Math.floor((3 + (phase % 3)) / 6);
      for (let cx = 0; cx < cols; cx++) expect(cells[row * cols + cx]!.r).toBe(1);
    }
  });
});

describe("classify", () => {
  const base = { r: 0, g: 0, b: 0, aMin: 1, aMax: 1 };
  it("outside the globe disc is background", () => {
    expect(classify({ ...base, aMin: 0, aMax: 0, r: 1 }, 0, 0, OPT)).toBe("none");
  });
  it("R is hard ink regardless of dither position", () => {
    for (let x = 0; x < 8; x++) expect(classify({ ...base, r: 0.5 }, x, 3, OPT)).toBe("fg");
  });
  it("cells straddling the disc edge are the limb (muted)", () => {
    expect(classify({ ...base, aMin: 0, aMax: 1 }, 2, 2, OPT)).toBe("muted");
  });
  it("B tone beats G tone", () => {
    expect(classify({ ...base, g: 1, b: 1 }, 5, 5, OPT)).toBe("muted");
  });
  it("a 50% G tone lights about half of a flat area", () => {
    let on = 0;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (classify({ ...base, g: 0.5 }, x, y, OPT) === "fg") on++;
    expect(on).toBe(128);
  });
  it("with dither off, tones use a plain half threshold", () => {
    const o = { ...OPT, dither: false };
    expect(classify({ ...base, g: 0.6 }, 0, 0, o)).toBe("fg");
    expect(classify({ ...base, g: 0.4 }, 0, 0, o)).toBe("none");
  });
});

describe("focus mask and dissolve", () => {
  it("is 1 inside, 0 outside, monotonic in between", () => {
    expect(maskCoverage(10, 100, 40)).toBe(1);
    expect(maskCoverage(200, 100, 40)).toBe(0);
    let prev = 1;
    for (let d = 100; d <= 140; d += 5) {
      const c = maskCoverage(d, 100, 40);
      expect(c).toBeLessThanOrEqual(prev);
      prev = c;
    }
    expect(maskCoverage(5, 0, 10)).toBe(0);
  });
  it("sharp fraction grows monotonically with coverage and matches it", () => {
    let prev = -1;
    for (let c = 0; c <= 1.0001; c += 0.05) {
      const f = sharpFraction(Math.min(1, c));
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
    expect(sharpFraction(0)).toBe(0);
    expect(sharpFraction(1)).toBe(1);
    expect(Math.abs(sharpFraction(0.5) - 0.5)).toBeLessThan(0.02);
  });
  it("a cell stays sharp once revealed as coverage rises (no flicker)", () => {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      let was = false;
      for (let c = 0; c <= 1; c += 0.02) {
        const s = showsSharp(c, x, y);
        if (was) expect(s).toBe(true);
        was = s;
      }
    }
  });
});

describe("RevealState", () => {
  it("eases to the target over the duration", () => {
    const r = new RevealState(500);
    r.set(1);
    expect(r.animating).toBe(true);
    r.step(250);
    expect(r.value).toBeCloseTo(0.5);
    r.step(1000);
    expect(r.value).toBe(1);
    expect(r.animating).toBe(false);
  });
  it("jumps under reduced motion", () => {
    const r = new RevealState(500, true);
    r.set(1);
    expect(r.value).toBe(1);
    expect(r.animating).toBe(false);
  });
});

describe("colours", () => {
  it("parses the forms Chrome and CSS give", () => {
    expect(parseCssColor("rgb(251, 251, 251)")).toEqual([251 / 255, 251 / 255, 251 / 255, 1]);
    expect(parseCssColor("rgb(0 0 0 / 0.14)")[3]).toBeCloseTo(0.14);
    expect(parseCssColor("rgba(255, 255, 255, 0.16)")[3]).toBeCloseTo(0.16);
    expect(parseCssColor("#0a0a0a")[0]).toBeCloseTo(10 / 255);
    expect(parseCssColor("#fff8")[3]).toBeCloseTo(0x88 / 255);
    expect(parseCssColor("color(srgb 1 0.5 0 / 0.5)")).toEqual([1, 0.5, 0, 0.5]);
    expect(() => parseCssColor("banana")).toThrow();
  });
  it("composes a translucent token over the page colour", () => {
    expect(over([0, 0, 0, 0.5], [1, 1, 1])).toEqual([0.5, 0.5, 0.5]);
  });
});
