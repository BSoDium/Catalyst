import { describe, expect, it } from "vitest";
import { DEFAULT_COLORS } from "./graph";
import { clampTone, oklchToSrgb, parseColor, sameColor, srgbToOklch, TONE_RANGE } from "./color";

const lch = (hex: string) => srgbToOklch(parseColor(hex));

describe("OKLCH conversion", () => {
  it("round-trips", () => {
    for (const hex of ["#3ddc6a", "#5aa9ff", "#ff3b6b", "#808080", "#ffd60a"]) {
      const back = oklchToSrgb(lch(hex))!;
      const orig = parseColor(hex);
      back.forEach((v, i) => expect(v).toBeCloseTo(orig[i]!, 2));
    }
  });
});

describe("clampTone", () => {
  const hues = Array.from({ length: 12 }, (_, i) => i * 30);
  const at = (L: number, h: number) => {
    let rgb: [number, number, number] | null = null;
    for (let c = 0.15; !rgb; c -= 0.01) rgb = oklchToSrgb({ l: L, c: Math.max(0, c), h });
    return `#${rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
  };
  it("brings the lightness of any colour into the range, whatever its hue", () => {
    for (const h of hues) for (const L of [0.2, 0.5, 0.9]) {
      const [, high] = clampTone(at(L, h));
      const out = lch(high);
      expect(out.l).toBeGreaterThanOrEqual(TONE_RANGE.lMin - 0.02);
      expect(out.l).toBeLessThanOrEqual(TONE_RANGE.lMax + 0.02);
      expect(out.c).toBeLessThanOrEqual(TONE_RANGE.cMax + 0.01);
    }
  });
  it("keeps the hue of a chromatic colour", () => {
    for (const h of hues) {
      const src = lch(at(0.5, h));
      const out = lch(clampTone(at(0.5, h))[1]);
      const d = Math.abs(((out.h - src.h + 540) % 360) - 180);
      expect(d).toBeLessThan(6);
    }
  });
  it("makes the quiet tone darker than the busy one, and never black", () => {
    for (const h of hues) for (const L of [0.05, 0.5, 0.95]) {
      const [low, high] = clampTone(at(L, h));
      expect(lch(low).l).toBeLessThan(lch(high).l);
      expect(lch(low).l).toBeGreaterThan(0.4);
    }
  });
  it("leaves a grey grey", () => {
    for (const g of ["#000000", "#808080", "#ffffff"]) expect(lch(clampTone(g)[1]).c).toBeLessThan(0.04);
  });
  it("is stable: clamping twice changes nothing visible", () => {
    for (const h of hues) {
      const once = clampTone(at(0.9, h))[1];
      const twice = clampTone(once)[1];
      expect(lch(twice).l).toBeCloseTo(lch(once).l, 1);
    }
  });
  it("accepts numbers", () => {
    expect(clampTone(0x3ddc6a)).toEqual(clampTone("#3ddc6a"));
  });
});

describe("the default colours take the tuned path", () => {
  it("are recognised however they are written, and nothing near them is", () => {
    for (const layer of ["top", "bottom"] as const) for (const theme of ["light", "dark"] as const) {
      const [low, high] = DEFAULT_COLORS[layer][theme];
      const asHex = (n: number | string) => (typeof n === "number" ? `#${n.toString(16).padStart(6, "0")}` : n);
      expect(sameColor(low, asHex(low))).toBe(true);
      expect(sameColor(high, asHex(high))).toBe(true);
      expect(sameColor(high, low)).toBe(false);
    }
    expect(sameColor("#3ddc6a", 0x0fbf3e)).toBe(false);
  });
});
