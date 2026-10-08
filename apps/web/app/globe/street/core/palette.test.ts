import { describe, expect, it } from "vitest";
import { CODE } from "./art-line";
import { LEVEL_SCALE, PATTERN, buildPalette, codeOf, fillColor, lineColor } from "./palette";
import { BOX_CONTRAST, BOX_CONTRAST_DARK, MAP_CONTRAST, MAP_CONTRAST_DARK, MAX_LEVELS, PALETTE_LEVELS, ROLES, bordersWanted, borderLevel, buildRamp, contrastRatio, coastLevel, mixOklab, peakLevel, rampLevel, roleLevel, srgbToOklab } from "../../engine/palette";
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
  it("steps monotonically in OKLab lightness from the background to the peak; up to the faint level the steps never shrink on a light page (equal on a dark one), then the map stretch rises evenly or faster up to the coast, and the peak (the box at rest) is a clear step above it", () => {
    for (const n of [4, 6, 8, 10, 12]) {
      for (const t of [light, dark]) {
        const r = buildRamp(t.background, t.ink, n);
        const L = r.map((c) => srgbToOklab(c)[0]);
        const dir = Math.sign(L[n - 1]! - L[0]!);
        const steps = L.slice(1, n - 1).map((v, i) => (v - L[i]!) * dir);
        for (const s of steps) expect(s).toBeGreaterThan(0);
        const faint = roleLevel("faint", n);
        for (let i = 1; i < Math.min(steps.length, faint); i++) expect(steps[i]!).toBeGreaterThanOrEqual(steps[i - 1]! - 1e-4);
        // the first step is a real, visible step (at least 2 % of lightness) even with 12 levels
        expect(steps[0]!).toBeGreaterThan(0.02);
        // the stretch between the faint level and the coast does not shrink (MAP_RAMP_EXP >= 1), and the peak is above the coast by more than any step of it
        const map = steps.slice(faint, Math.max(faint, coastLevel(n))); // steps[i] is level i + 1 over level i: the steps above the faint level up to the coast
        for (let i = 1; i < map.length; i++) expect(map[i]!).toBeGreaterThanOrEqual(map[i - 1]! - 1e-4);
        if (n >= 10) expect(steps[steps.length - 1]!).toBeGreaterThan(Math.max(...map, 0));
      }
    }
  });
  it("keeps the map well below the ink: the peak level (the box at rest) is BOX_CONTRAST of the way to the ink, the coast level (coastlines, borders) MAP_CONTRAST, far under it; markers and labels keep the full ink", () => {
    for (const n of [4, 8, 12]) {
      for (const [t, map, box] of [[light, MAP_CONTRAST, BOX_CONTRAST], [dark, MAP_CONTRAST_DARK, BOX_CONTRAST_DARK]] as [typeof light | typeof dark, number, number][]) {
        const r = buildRamp(t.background, t.ink, n);
        const L = r.map((c) => srgbToOklab(c)[0]);
        const share = (k: number) => (L[k]! - L[0]!) / (L[n - 1]! - L[0]!);
        expect(share(n - 2)).toBeGreaterThan(0.4);
        expect(share(n - 2)).toBeLessThan(0.7);
        expect(share(n - 2)).toBeCloseTo(box, 2);
        expect(share(coastLevel(n))).toBeLessThanOrEqual(share(n - 2) + 1e-9);
        if (n >= 6) {
          expect(share(coastLevel(n))).toBeCloseTo(map, 2);
          expect(share(coastLevel(n))).toBeLessThan(share(n - 2) - 0.08);
        }
        expect(r[n - 1]).toEqual(t.ink);
      }
    }
  });
  it("the wash of 2026-10-08: the 12-level coast is about 40 % less contrasty than the box at rest was (3.1:1 against 5.2:1 light, 3.2:1 against 5.5:1 dark), above the 1.5:1 floor; the box did not move", () => {
    for (const [t, boxOld] of [[light, 5.23], [dark, 5.51]] as [typeof light | typeof dark, number][]) {
      const r = buildRamp(t.background, t.ink, 12);
      const coast = contrastRatio(r[coastLevel(12)]!, r[0]!);
      const box = contrastRatio(r[peakLevel(12)]!, r[0]!);
      expect(box).toBeCloseTo(boxOld, 1);
      expect(coast).toBeGreaterThan(1.5);
      expect(coast).toBeGreaterThan(boxOld * 0.55);
      expect(coast).toBeLessThan(boxOld * 0.65);
      expect(box / coast).toBeGreaterThan(1.5); // a box at rest stands clearly above the coastline
    }
  });
  it("the faint end is untouched by the wash (the graticule, the horizon outline, the sky and the dimmest roads live there): levels 1 to 3 keep their 2026-10-08 colours", () => {
    const sample = (t: typeof light | typeof dark, ks: number[]) => ks.map((k) => Math.round(buildRamp(t.background, t.ink, 12)[k]![0] * 255));
    expect(sample(light, [1, 2, 3])).toEqual([240, 227, 213]);
    expect(sample(dark, [1, 2, 3])).toEqual([20, 31, 43]);
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
      for (const role of ["wash", "faint", "soft", "mid", "strong", "coast", "peak"] as const) {
        expect(roleLevel(role, n)).toBeGreaterThanOrEqual(1);
        expect(roleLevel(role, n)).toBeLessThanOrEqual(n - 2);
      }
      expect(roleLevel("peak", n)).toBe(peakLevel(n));
      expect(roleLevel("coast", n)).toBe(coastLevel(n));
      expect(roleLevel("coast", n)).toBeLessThanOrEqual(roleLevel("peak", n));
      if (n >= 4) expect(roleLevel("coast", n)).toBeLessThan(roleLevel("peak", n));
    }
  });
  it("keeps the eight tones distinct once there are enough levels, the coast one under the peak (the box at rest), and the ink alone above the map", () => {
    expect(new Set((["wash", "faint", "soft", "mid", "strong", "coast", "peak", "ink"] as const).map((r) => roleLevel(r, PALETTE_LEVELS))).size).toBe(8);
    expect(roleLevel("peak", PALETTE_LEVELS) - roleLevel("coast", PALETTE_LEVELS)).toBe(1);
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

describe("globe borders: on or off by zoom, a timed tone ramp between (never a dither, never a resting grey)", () => {
  const b = TUNING.borderZoom;
  for (const n of [4, 6, 8, 10]) {
    it(`n=${n}: not drawn at fade 0, the faintest level just above it, the coast level (below the box's peak and the ink) at 1, one level at a time`, () => {
      expect(borderLevel(0, n)).toBe(0);
      expect(borderLevel(1e-6, n)).toBe(1);
      expect(borderLevel(1, n)).toBe(coastLevel(n));
      expect(borderLevel(1, n)).toBe(Math.max(1, n - 3));
      let prev = 0;
      for (let v = 0; v <= 1; v += 0.002) {
        const l = borderLevel(v, n);
        expect(l - prev).toBeGreaterThanOrEqual(0);
        expect(l - prev).toBeLessThanOrEqual(1);
        prev = l;
      }
    });
  }
  it("the zoom decides on or off with a hysteresis band", () => {
    expect(bordersWanted(false, b.on - 1, b)).toBe(false);
    expect(bordersWanted(false, b.on + 1, b)).toBe(true);
    expect(bordersWanted(false, b.on, b)).toBe(false); // zooming in: the band counts against
    expect(bordersWanted(true, b.on, b)).toBe(true); // zooming out: so it does
    expect(bordersWanted(true, b.on - b.band, b)).toBe(false);
    let on = false;
    let flips = 0;
    for (let k = 0; k < 100; k++) {
      const next = bordersWanted(on, b.on + (k % 2 ? 0.03 : -0.03), b);
      if (next !== on) flips++;
      on = next;
    }
    expect(flips).toBe(0);
  });
});
