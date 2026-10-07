import { describe, expect, it } from "vitest";
import { CODE } from "./art-line";
import { LEVEL_SCALE, PATTERN, buildPalette, codeOf, fillColor, lineColor } from "./palette";
import { MAX_LEVELS, PALETTE_LEVELS, ROLES, borderLevel, buildRamp, mixOklab, peakLevel, rampLevel, roleLevel, srgbToOklab } from "../../engine/palette";
import { decodeLevel, decodePattern } from "../style/probe";
import { TUNING } from "../../engine/tuning";

const light = { background: [0.984, 0.984, 0.984], ink: [0.039, 0.039, 0.039] } as const;
const dark = { background: [0.039, 0.039, 0.039], ink: [0.96, 0.96, 0.96] } as const;

describe("palette ramp", () => {
  it("has the configured number of levels, page colour first and ink last, in both themes", () => {
    for (const t of [light, dark]) {
      const r = buildRamp(t.background, t.ink);
      expect(r.length).toBe(PALETTE_LEVELS);
      expect(r[0]).toEqual(t.background);
      expect(r[r.length - 1]).toEqual(t.ink);
    }
  });
  it("steps monotonically in OKLab lightness from the background to the peak, never shrinking on a light page, equal on a dark one", () => {
    for (const n of [4, 6, 8, 10, 12]) {
      for (const t of [light, dark]) {
        const r = buildRamp(t.background, t.ink, n);
        const L = r.map((c) => srgbToOklab(c)[0]);
        const dir = Math.sign(L[n - 1]! - L[0]!);
        const steps = L.slice(1, n - 1).map((v, i) => (v - L[i]!) * dir);
        for (const s of steps) expect(s).toBeGreaterThan(0);
        for (let i = 1; i < steps.length; i++) expect(steps[i]!).toBeGreaterThanOrEqual(steps[i - 1]! - 1e-4);
        // the first step is a real, visible step (at least 2 % of lightness) even with 12 levels
        expect(steps[0]!).toBeGreaterThan(0.02);
      }
    }
  });
  it("keeps the map well below the ink: the peak level is at most 70 % of the way to the ink, markers and labels keep the full ink", () => {
    for (const n of [4, 8, 12]) {
      for (const t of [light, dark]) {
        const r = buildRamp(t.background, t.ink, n);
        const L = r.map((c) => srgbToOklab(c)[0]);
        const share = (L[n - 2]! - L[0]!) / (L[n - 1]! - L[0]!);
        expect(share).toBeGreaterThan(0.4);
        expect(share).toBeLessThan(0.7);
        expect(r[n - 1]).toEqual(t.ink);
      }
    }
  });
  it("interpolates perceptually, not in sRGB: the middle of black and white is lighter than 50% grey", () => {
    const mid = mixOklab([0, 0, 0], [1, 1, 1], 0.5);
    expect(mid[0]).toBeGreaterThan(0.38);
    expect(mid[0]).toBeLessThan(0.5);
  });
});

describe("roles", () => {
  it("resolve to ordered, in-range levels for every count: bg 0, ink last, everything else between", () => {
    for (let n = 3; n <= MAX_LEVELS; n++) {
      let prev = -1;
      for (const role of ROLES) {
        const l = roleLevel(role, n);
        expect(l, `${role} n=${n}`).toBeGreaterThanOrEqual(prev);
        expect(l).toBeLessThan(n);
        prev = l;
      }
      expect(roleLevel("bg", n)).toBe(0);
      expect(roleLevel("ink", n)).toBe(n - 1);
      for (const role of ["wash", "faint", "soft", "mid", "strong", "peak"] as const) {
        expect(roleLevel(role, n)).toBeGreaterThanOrEqual(1);
        expect(roleLevel(role, n)).toBeLessThanOrEqual(n - 2);
      }
      expect(roleLevel("peak", n)).toBe(peakLevel(n));
    }
  });
  it("keeps the seven tones distinct once there are enough levels, and the ink alone above the map", () => {
    expect(new Set((["wash", "faint", "soft", "mid", "strong", "peak", "ink"] as const).map((r) => roleLevel(r, PALETTE_LEVELS))).size).toBe(7);
    expect(roleLevel("ink", PALETTE_LEVELS) - roleLevel("peak", PALETTE_LEVELS)).toBe(1);
  });
});

describe("fade ramp", () => {
  it("steps through every level from the faintest to the final one, never skipping", () => {
    for (const final of [1, 2, 5, 9]) {
      expect(rampLevel(0, final)).toBe(0);
      expect(rampLevel(1e-9, final)).toBe(1);
      expect(rampLevel(1, final)).toBe(final);
      let prev = 0;
      for (let t = 0; t <= 1; t += 0.001) {
        const l = rampLevel(t, final);
        expect(l - prev).toBeGreaterThanOrEqual(0);
        expect(l - prev).toBeLessThanOrEqual(1);
        prev = l;
      }
    }
  });
});

describe("level encoding", () => {
  it("round-trips through the style colours and the pass maths (G / R for lines, pattern x 16 + level in B for fills)", () => {
    for (let l = 1; l < MAX_LEVELS; l++) {
      const [, g] = /rgb\(255,(\d+),0\)/.exec(lineColor(l))!.map(Number);
      for (const r of [0.75, 1, 0.4]) expect(Math.floor((((g! / 255) * r) / r) * LEVEL_SCALE + 0.5)).toBe(l);
      for (const pat of Object.keys(PATTERN) as (keyof typeof PATTERN)[]) {
        const c = fillColor(l, pat);
        const [, rr, gg, bb] = /rgb\((\d+),(\d+),(\d+)\)/.exec(c)!.map(Number);
        expect([rr, gg]).toEqual([0, 0]); // a line drawn over a fill can never pollute its own level
        expect(bb! & 15).toBe(l);
        expect(bb! >> 4).toBe(PATTERN[pat]);
        expect(decodeLevel(c)).toBe(l);
        expect(decodePattern(c)).toBe(PATTERN[pat]);
      }
    }
  });
  it("builds the pass palette for a theme", () => {
    const p = buildPalette(light, 6);
    expect(p.rgb.length).toBe(6);
    expect(p.limbLevel).toBe(roleLevel("soft", 6));
  });
  it("reports class codes: lines keep thin / solid whatever their level, other lit cells are fills", () => {
    expect(codeOf(3, 1)).toBe(CODE.thin);
    expect(codeOf(1, 2)).toBe(CODE.solid);
    expect(codeOf(2, 0)).toBe(CODE.tone);
    expect(codeOf(0, 0)).toBe(CODE.none);
  });
});

describe("globe borders ease in through the levels (never a dither, both ways)", () => {
  for (const n of [4, 6, 8, 10]) {
    it(`n=${n}: not drawn below the start, the faintest level above it, the peak level (below the ink) from the end, one level at a time`, () => {
      const b = TUNING.borderZoom;
      expect(borderLevel(b.start - 0.5, n, b)).toBe(0);
      expect(borderLevel(b.start, n, b)).toBe(0);
      expect(borderLevel(b.start + 1e-6, n, b)).toBe(1);
      expect(borderLevel(b.end, n, b)).toBe(n - 2);
      expect(borderLevel(b.end + 2, n, b)).toBe(n - 2);
      let prev = 0;
      for (let z = b.start - 0.1; z <= b.end + 0.1; z += 0.002) {
        const l = borderLevel(z, n, b);
        expect(l - prev).toBeGreaterThanOrEqual(0);
        expect(l - prev).toBeLessThanOrEqual(1);
        prev = l;
      }
    });
  }
});
