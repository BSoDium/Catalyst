import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SUN_MUSIC, loopSamples } from "./sun-music";
import { PULSE, beatPulse, breath, sunPulse } from "./sun-pulse";

const CYCLE = SUN_MUSIC.beatSec * SUN_MUSIC.cycleBeats;
/** `c` cycles into the music. */
const at = (c: number) => SUN_MUSIC.beatOffsetSec + c * CYCLE;

describe("a breath", () => {
  it("is a cosine: 0 at the start, 1 half way, smooth everywhere (no step between neighbours)", () => {
    expect(breath(0)).toBeCloseTo(0, 10);
    expect(breath(0.5)).toBeCloseTo(1, 10);
    expect(breath(1)).toBeCloseTo(0, 10);
    let max = 0;
    for (let i = 1; i <= 1000; i++) max = Math.max(max, Math.abs(breath(i / 1000) - breath((i - 1) / 1000)));
    expect(max).toBeLessThan(0.007);
  });
});

describe("the sun's breathing", () => {
  it("is one slow cycle: eight beats, a bit over four seconds (owner: slower, but still on the rhythm: a whole number of beats)", () => {
    expect(CYCLE).toBeGreaterThan(4);
    expect(CYCLE).toBeLessThan(5);
    expect(SUN_MUSIC.cycleBeats % 4).toBe(0);
  });

  it("has the axes' rays out as the diagonal ones are in, and the other way round half a cycle later", () => {
    const a = sunPulse(at(0.5), 1);
    const b = sunPulse(at(0), 1);
    expect(a.axis).toBeCloseTo(1, 5);
    expect(a.diag).toBeCloseTo(0, 5);
    expect(b.axis).toBeCloseTo(0, 5);
    expect(b.diag).toBeCloseTo(1, 5);
  });

  it("has the halo a quarter of a cycle behind the rays, and the lens flare dim where the rays are in", () => {
    expect(sunPulse(at(0.5), 1).breath).toBeLessThan(1);
    expect(sunPulse(at(0.5 + PULSE.haloLag), 1).breath).toBeCloseTo(1, 5);
    expect(sunPulse(at(0), 1).lens).toBeCloseTo(1, 5);
    expect(sunPulse(at(0.5), 1).lens).toBeCloseTo(0, 5);
  });

  it("goes with how audible the music is, and is nothing when it is not", () => {
    const full = sunPulse(at(0.3), 1, 0.8);
    const half = sunPulse(at(0.3), 0.5, 0.8);
    for (const k of ["amount", "breath", "axis", "diag", "lens", "grow", "jitter"] as const) expect(half[k]).toBeCloseTo(full[k] / 2, 5);
    expect(sunPulse(at(0.3), 0, 1)).toMatchObject({ amount: 0, breath: 0, axis: 0, diag: 0, lens: 0, grow: 0, jitter: 0 });
  });

  it("is drawn again (a new seed) at every cycle, and is the same seed over the whole of one", () => {
    expect(sunPulse(at(3.05), 1).seed).toBe(sunPulse(at(3.95), 1).seed);
    expect(sunPulse(at(4.05), 1).seed).not.toBe(sunPulse(at(3.95), 1).seed);
  });

  it("the rays grow with how loud the piece is, and not without it", () => {
    expect(sunPulse(at(0.2), 1, 0).grow).toBe(0);
    expect(sunPulse(at(0.2), 1, 1).grow).toBe(1);
    expect(sunPulse(at(0.2), 1, 7).grow).toBe(1);
  });

  it("takes the halo down and brings it back through the dither, never by a multiple of its tone: nothing at rest, nothing at the top of a breath", () => {
    expect(sunPulse(at(0.3), 0).amount).toBe(0);
    const top = sunPulse(at(0.5 + PULSE.haloLag), 1);
    expect(top.amount - top.breath).toBeCloseTo(0, 5); // (the shader's dip is amount - breath)
    const low = sunPulse(at(PULSE.haloLag), 1);
    expect(low.amount - low.breath).toBeCloseTo(1, 5);
    expect(PULSE.dip).toBeGreaterThan(0);
    expect(PULSE.dip).toBeLessThanOrEqual(1);
    expect(readFileSync("app/globe/engine/sun-layer.ts", "utf8")).not.toMatch(/PULSE\.glow/);
  });

  it("is soft: the most it moves the rays, the halo, the light and the grain is a couple of per cent (owner: \"waaay more subtle\")", () => {
    expect(PULSE.rays).toBeLessThanOrEqual(0.02);
    expect(PULSE.grow).toBeLessThanOrEqual(0.03);
    expect(PULSE.halo).toBeLessThanOrEqual(0.01);
    expect(PULSE.flare).toBeLessThanOrEqual(0.06);
    expect(PULSE.jitter).toBeLessThanOrEqual(0.12);
  });

  it("is not as strong at every cycle, within bounds, and never steps from one cycle to the next", () => {
    const gains = new Set<number>();
    for (let i = 0; i < 64; i++) {
      const g = sunPulse(at(i + 0.4), 1).gain;
      expect(g).toBeGreaterThanOrEqual(PULSE.gainMin - 1e-9);
      expect(g).toBeLessThanOrEqual(1 + 1e-9);
      gains.add(Math.round(g * 100));
    }
    expect(gains.size).toBeGreaterThan(10);
    for (let i = 1; i < 64; i++) expect(Math.abs(sunPulse(at(i + 1e-4), 1).gain - sunPulse(at(i - 1e-4), 1).gain)).toBeLessThan(0.01);
  });

  it("is a valid phase for a position before the first beat", () => {
    for (const v of Object.values(sunPulse(0, 1))) expect(v).toBeGreaterThanOrEqual(0);
  });
});

describe("the beat", () => {
  it("is 1 on every beat and 0 half way between, smooth, and the same on every beat of the piece", () => {
    for (const n of [0, 1, 7, 100]) {
      expect(beatPulse(SUN_MUSIC.beatOffsetSec + n * SUN_MUSIC.beatSec)).toBeCloseTo(1, 6);
      expect(beatPulse(SUN_MUSIC.beatOffsetSec + (n + 0.5) * SUN_MUSIC.beatSec)).toBeCloseTo(0, 6);
    }
    let max = 0;
    for (let i = 1; i <= 1000; i++) max = Math.max(max, Math.abs(beatPulse((i / 1000) * 5) - beatPulse(((i - 1) / 1000) * 5)));
    expect(max).toBeLessThan(0.05);
  });

  it("is a whole number of beats to the sun's cycle, so that the two stay in step", () => {
    expect(Number.isInteger(SUN_MUSIC.cycleBeats)).toBe(true);
  });
});

describe("the loop and the cycle", () => {
  it("is a whole number of cycles long, with at least the crossfade left to overlap and less than a cycle more", () => {
    const sr = 44100;
    const n = Math.round(141.967 * sr); // (the file)
    const len = loopSamples(n, sr);
    expect(len / (CYCLE * sr)).toBeCloseTo(Math.round(len / (CYCLE * sr)), 3);
    const over = (n - len) / sr;
    expect(over).toBeGreaterThanOrEqual(SUN_MUSIC.crossfadeSec - 1e-6);
    expect(over).toBeLessThan(SUN_MUSIC.crossfadeSec + CYCLE + 1e-6);
  });

  it("leaves a piece too short for a cycle plus the crossfade as it is", () => {
    expect(loopSamples(1000, 1000)).toBe(1000);
  });
});

describe("the breathing in the picture", () => {
  it("asks for frames only while it sounds, and not under reduced motion (the renderer's `sunPulsing`), and dims the flare's ghosts", () => {
    const src = readFileSync("app/globe/engine/renderer.ts", "utf8");
    expect(src).toMatch(/private get sunPulsing\(\): boolean \{\s*return !this\.reduced && !this\.suspended/);
    expect(src).toMatch(/const beat = this\.reduced \? null : sunMusic\.pulse\(\)/);
    expect(readFileSync("app/globe/engine/sun-flare.ts", "utf8")).toMatch(/uStr!\.value = p\.str \* \(1 - PULSE\.flare/);
  });
});
