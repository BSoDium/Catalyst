import { describe, expect, it } from "vitest";
import { TUNING } from "../../engine/tuning";
import { EasedValue, cellCssFor, cellDevicePx, maskCoverage, revealRadiusDevice, sharpFraction, showsSharp } from "./pixel";

describe("sizes follow the globe's tuning", () => {
  it("is ART_PIXEL: 2.5 CSS px on desktop at an even DPR (5 device px at DPR 2), 2 below 520 px, always whole device pixels", () => {
    expect(cellCssFor(1440, 900, 2)).toBe(2.5);
    expect(cellCssFor(390, 844, 3)).toBe(2);
    expect(cellCssFor(1440, 900, 1)).toBe(2); // 2.5 is not a whole device pixel at DPR 1: ties go down, never coarser
    expect(cellCssFor(1440, 900, 4)).toBe(2.5);
    for (const dpr of [1, 1.25, 1.5, 2, 2.625, 3, 4]) {
      const cell = cellCssFor(1440, 900, dpr);
      expect(Number.isInteger(Math.round(cell * dpr * 1e6) / 1e6)).toBe(true);
    }
    expect(cellDevicePx(3, 2)).toBe(6);
    expect(cellDevicePx(2.5, 2)).toBe(5);
    expect(cellDevicePx(2, 2.625)).toBe(5);
    expect(cellDevicePx(0.1, 1)).toBe(1);
  });
  it("is exactly the globe's value for a grid of viewports and DPRs (no divergence)", () => {
    for (const [w, h] of [[1440, 900], [1280, 800], [390, 844], [520, 700], [519, 700], [360, 640]] as const) {
      for (const dpr of [1, 1.25, 1.5, 2, 2.625, 3]) expect(cellCssFor(w, h, dpr)).toBe(TUNING.pixelSize(Math.min(w, h), dpr));
    }
  });
});

describe("focus mask", () => {
  it("is 1 inside, 0 beyond radius + feather, monotone between", () => {
    expect(maskCoverage(0, 100, 40)).toBe(1);
    expect(maskCoverage(100, 100, 40)).toBe(1);
    expect(maskCoverage(140, 100, 40)).toBe(0);
    let prev = 1;
    for (let d = 100; d <= 140; d += 2) {
      const c = maskCoverage(d, 100, 40);
      expect(c).toBeLessThanOrEqual(prev + 1e-12);
      prev = c;
    }
    expect(maskCoverage(10, 0, 5)).toBe(0);
    expect(maskCoverage(10, 20, 0)).toBe(1);
    expect(maskCoverage(30, 20, 0)).toBe(0);
  });
  it("reveals a growing share of cells with coverage, and a revealed cell never flips back", () => {
    let prev = -1;
    for (let c = 0; c <= 1.0001; c += 0.05) {
      const f = sharpFraction(Math.min(1, c));
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
    expect(sharpFraction(0)).toBe(0);
    expect(sharpFraction(1)).toBe(1 - 0); // threshold (b + 0.5) / 64 < 1 for every cell
    expect(Math.abs(sharpFraction(0.5) - 0.5)).toBeLessThan(1 / 64 + 1e-9);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      let on = false;
      for (let c = 0; c <= 1; c += 0.01) {
        const s = showsSharp(c, x, y);
        if (on) expect(s).toBe(true);
        on = s;
      }
    }
  });
  it("reveal radius is capped on large screens and proportional on small ones", () => {
    expect(revealRadiusDevice(2880, 1800, 2)).toBe(280 * 2);
    expect(revealRadiusDevice(1170, 2532, 3)).toBeCloseTo(0.34 * 390 * 3, 6);
  });
});

describe("EasedValue", () => {
  it("moves linearly in time, displays smoothstepped, and stops at the target", () => {
    const v = new EasedValue(500);
    v.set(1);
    expect(v.animating).toBe(true);
    v.step(250);
    expect(v.value).toBeCloseTo(0.5, 12);
    expect(v.eased).toBeCloseTo(0.5, 12);
    v.step(1000);
    expect(v.value).toBe(1);
    expect(v.animating).toBe(false);
    v.set(0);
    v.step(100);
    expect(v.value).toBeCloseTo(0.8, 12);
  });
  it("is instant under reduced motion, and for a zero duration (static dissolve: the pattern never animates)", () => {
    const v = new EasedValue(500, true);
    v.set(0.7);
    expect(v.value).toBe(0.7);
    expect(v.animating).toBe(false);
    const w = new EasedValue(500);
    w.set(1, 0);
    expect(w.value).toBe(1);
  });
  it("clamps targets", () => {
    const v = new EasedValue(100, true);
    v.set(4);
    expect(v.value).toBe(1);
    v.set(-1);
    expect(v.value).toBe(0);
  });
});
