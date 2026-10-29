import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SUN_MUSIC, loopSamples } from "./sun-music";
import { PULSE, beatEnvelope, sunPulse } from "./sun-pulse";

const beat = (n: number, within = 0.1) => SUN_MUSIC.beatOffsetSec + (n + within) * SUN_MUSIC.beatSec;

describe("the beat's shape", () => {
  it("rises fast, peaks at 1 and falls slowly, to a small share by the next beat", () => {
    const env = Array.from({ length: 101 }, (_, i) => beatEnvelope(i / 100));
    expect(Math.max(...env)).toBeCloseTo(1, 2);
    expect(env[0]).toBe(0);
    const top = env.indexOf(Math.max(...env));
    expect(top).toBeGreaterThan(0);
    expect(top).toBeLessThan(25); // (in the first quarter of the beat)
    expect(env[100]!).toBeLessThan(0.1);
    for (let i = top + 1; i < env.length; i++) expect(env[i]!).toBeLessThanOrEqual(env[i - 1]!);
  });
});

describe("the sun's pulse", () => {
  it("is the axes' rays on the first beat of the cycle and the diagonals' on the second, the halo on both", () => {
    const a = sunPulse(beat(0), 1);
    const d = sunPulse(beat(1), 1);
    expect(a.axis).toBeGreaterThan(a.diag);
    expect(d.diag).toBeGreaterThan(d.axis);
    expect(a.diag / a.axis).toBeCloseTo(PULSE.other, 5);
    expect(a.breath).toBeGreaterThan(0.8);
    expect(d.breath).toBeGreaterThan(0.8);
    // and it comes round: the third beat is the first's again
    expect(sunPulse(beat(2), 1).axis).toBeCloseTo(a.axis, 5);
  });

  it("goes with how audible the music is, and is nothing when it is not", () => {
    const full = sunPulse(beat(0), 1);
    const half = sunPulse(beat(0), 0.5);
    expect(half.breath).toBeCloseTo(full.breath / 2, 5);
    expect(sunPulse(beat(0), 0)).toEqual({ breath: 0, axis: 0, diag: 0 });
  });

  it("is faint: the largest it makes the rays, the halo and the light is a few per cent", () => {
    expect(PULSE.rays).toBeLessThanOrEqual(0.1);
    expect(PULSE.halo).toBeLessThanOrEqual(0.05);
    expect(PULSE.glow).toBeLessThanOrEqual(0.1);
  });

  it("is made for the music's own clock: a position before the first beat is still a valid phase", () => {
    const p = sunPulse(0, 1);
    for (const v of Object.values(p)) expect(v).toBeGreaterThanOrEqual(0);
  });
});

describe("the loop and the beat", () => {
  it("is a whole number of cycles long, with at least the crossfade left to overlap and less than a cycle more", () => {
    const sr = 44100;
    const n = Math.round(141.967 * sr); // (the file)
    const len = loopSamples(n, sr);
    const cycle = SUN_MUSIC.beatSec * SUN_MUSIC.cycleBeats * sr;
    expect(len / cycle).toBeCloseTo(Math.round(len / cycle), 3);
    const over = (n - len) / sr;
    expect(over).toBeGreaterThanOrEqual(SUN_MUSIC.crossfadeSec - 1e-6);
    expect(over).toBeLessThan(SUN_MUSIC.crossfadeSec + (SUN_MUSIC.beatSec * SUN_MUSIC.cycleBeats) + 1e-6);
  });

  it("leaves a piece too short for a cycle plus the crossfade as it is", () => {
    expect(loopSamples(1000, 1000)).toBe(1000);
  });
});

describe("the pulse in the picture", () => {
  it("asks for frames only while it sounds, and not under reduced motion (the renderer's `sunPulsing`)", () => {
    const src = readFileSync("app/globe/engine/renderer.ts", "utf8");
    expect(src).toMatch(/private get sunPulsing\(\): boolean \{\s*return !this\.reduced && !this\.suspended/);
    expect(src).toMatch(/const beat = this\.reduced \? null : sunMusic\.pulse\(\)/);
  });
});
