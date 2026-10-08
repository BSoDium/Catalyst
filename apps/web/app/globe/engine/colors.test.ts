import { describe, expect, it } from "vitest";
import { outlineLevel, over, parseCssColor, themeFromTokens, type Rgb } from "./colors";
import { borderLevel, roleLevel, type Role } from "./palette";

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

describe("the washed-out map (owner 2026-10-08): floors and order of contrast against the page, 12 levels, both schemes", () => {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = (c: readonly number[]) => 0.2126 * lin(c[0]!) + 0.7152 * lin(c[1]!) + 0.0722 * lin(c[2]!);
  const ratio = (a: readonly number[], b: readonly number[]) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  for (const [name, bg, ink] of [["light", [0.984, 0.984, 0.984], [0.039, 0.039, 0.039]], ["dark", [0.039, 0.039, 0.039], [0.961, 0.961, 0.961]]] as const) {
    const t = themeFromTokens(bg as unknown as Rgb, ink as unknown as Rgb, 12);
    const at = (role: Role) => ratio(t.ramp[roleLevel(role, 12)]!, bg);
    it(`${name}: coastline and country borders are 2.5 to 3.6:1 against the page (were 5.2 / 5.5), never under the 1.5:1 floor, and the borders are the coast tone`, () => {
      expect(ratio(t.coast, bg)).toBeGreaterThan(2.5);
      expect(ratio(t.coast, bg)).toBeLessThan(3.6);
      expect(ratio(t.coast, bg)).toBeGreaterThan(1.5);
      expect(t.coast).toEqual(t.ramp[borderLevel(1, 12)]);
    });
    it(`${name}: a box at rest (peak) is at least 1.5 times the coastline's contrast, and the ink is far above both`, () => {
      expect(at("peak") / ratio(t.coast, bg)).toBeGreaterThan(1.5);
      expect(ratio(t.ink, bg)).toBeGreaterThan(at("peak") * 3);
    });
    it(`${name}: the roles keep their order of contrast, from the washed-out wash and faint tones (floor 1.07:1) up to the coast`, () => {
      const order = (["wash", "faint", "soft", "mid", "strong", "coast", "peak"] as const).map(at);
      for (let i = 1; i < order.length; i++) expect(order[i]!).toBeGreaterThan(order[i - 1]!);
      expect(at("wash")).toBeGreaterThanOrEqual(1.07); // as before the wash (1.10 light, 1.08 dark)
      expect(at("faint")).toBeGreaterThan(1.3); // the graticule
      expect(at("soft")).toBeLessThan(1.7); // water dashes, park dots: context, not content
      expect(at("strong")).toBeLessThan(ratio(t.coast, bg) * 0.85); // rivers and lakes stay under the coast
    });
  }
});
