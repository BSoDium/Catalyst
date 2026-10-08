import { describe, expect, it } from "vitest";
import { outlineLevel, over, parseCssColor, themeFromTokens, type Rgb } from "./colors";

describe("parseCssColor", () => {
  it("parses computed rgb() and rgba()", () => {
    expect(parseCssColor("rgb(251, 251, 251)")).toEqual({ rgb: [251 / 255, 251 / 255, 251 / 255], a: 1 });
    expect(parseCssColor("rgba(0, 0, 0, 0.14)")?.a).toBeCloseTo(0.14);
  });
  it("parses the space syntax with a slash alpha", () => {
    const c = parseCssColor("rgb(255 255 255 / 0.45)");
    expect(c?.rgb).toEqual([1, 1, 1]);
    expect(c?.a).toBeCloseTo(0.45);
    expect(parseCssColor("rgb(0 0 0 / 40%)")?.a).toBeCloseTo(0.4);
  });
  it("parses color(srgb ...) and hex", () => {
    expect(parseCssColor("color(srgb 1 0.5 0 / 0.5)")).toEqual({ rgb: [1, 0.5, 0], a: 0.5 });
    expect(parseCssColor("#0a0a0a")?.rgb[0]).toBeCloseTo(10 / 255);
    expect(parseCssColor("#fff")?.rgb).toEqual([1, 1, 1]);
  });
  it("returns null for what it does not understand", () => {
    expect(parseCssColor("oklch(0.5 0.1 200)")).toBeNull();
    expect(parseCssColor("")).toBeNull();
    expect(parseCssColor("rgb(a, b, c)")).toBeNull();
  });
});

describe("over", () => {
  it("composites translucent ink onto a fill", () => {
    const r = over({ rgb: [0, 0, 0], a: 0.5 }, [1, 1, 1]);
    expect(r[0]).toBeCloseTo(0.5);
    expect(over({ rgb: [0.2, 0.3, 0.4], a: 1 }, [1, 1, 1])).toEqual([0.2, 0.3, 0.4]);
  });
});

describe("the horizon outline of the globe", () => {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = (c: readonly number[]) => 0.2126 * lin(c[0]!) + 0.7152 * lin(c[1]!) + 0.0722 * lin(c[2]!);
  const ratio = (a: readonly number[], b: readonly number[]) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  for (const [name, bg, ink] of [["light", [0.984, 0.984, 0.984], [0.039, 0.039, 0.039]], ["dark", [0.039, 0.039, 0.039], [0.961, 0.961, 0.961]]] as const) {
    it(`${name}: the outline is one level fainter than the graticule (was faint, 1.42:1), still visible against the page (floor 1.2:1)`, () => {
      const t = themeFromTokens(bg as unknown as Rgb, ink as unknown as Rgb, 12);
      expect(t.outline).toEqual(t.ramp[outlineLevel(12)]);
      expect(outlineLevel(12)).toBe(2);
      expect(t.outline).not.toEqual(t.grid);
      expect(ratio(t.outline, bg)).toBeLessThan(ratio(t.grid, bg));
      expect(ratio(t.outline, bg)).toBeGreaterThan(1.2);
      expect(ratio(t.outline, bg)).toBeLessThan(1.3);
    });
    it(`${name}: at any palette size the outline is a map level, never the page colour, never above the graticule`, () => {
      for (const n of [3, 4, 6, 8, 10, 12]) {
        const t = themeFromTokens(bg as unknown as Rgb, ink as unknown as Rgb, n);
        expect(outlineLevel(n)).toBeGreaterThanOrEqual(1);
        expect(ratio(t.outline, bg)).toBeGreaterThan(1);
        expect(ratio(t.outline, bg)).toBeLessThanOrEqual(ratio(t.grid, bg) + 1e-9);
      }
    });
  }
});
