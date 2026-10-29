import { describe, expect, it } from "vitest";
import { ENV_MIN, REST, WAVES, WAVE_RADIUS, envelope, outlinePoints, outlineRadius, waveRadius } from "./now-playing-wave";

const TURN = 2 * Math.PI;

describe("the disc's wavy outline", () => {
  it("never turns: the lobes' nodes stay where they are whatever the time (a standing wave, nothing travels)", () => {
    const ring = { lobes: 4, lobes2: 8, hz: 1.3, hz2: 2, amp: 2, phase: 0 };
    for (const t of [0, 0.37, 5.1]) for (let k = 0; k < 8; k++) expect(Math.abs(waveRadius(ring, (k * Math.PI) / 4, t, 1) - WAVE_RADIUS)).toBeLessThan(1e-9);
  });

  it("is slow enough to be followed, and still a vibration: each wave swells and dips at one to three hertz", () => {
    for (const w of WAVES) for (const hz of [w.hz, w.hz2]) {
      expect(hz).toBeGreaterThanOrEqual(1);
      expect(hz).toBeLessThanOrEqual(3);
    }
  });

  it("stands at different heights round the ring and over time: one side tall and the other low, then the other way (the envelope)", () => {
    let lo = 1;
    let hi = 0;
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) for (let j = 0; j < 36; j++) {
      const e = envelope((j / 36) * TURN, i / 20);
      lo = Math.min(lo, e);
      hi = Math.max(hi, e);
    }
    expect(lo).toBeGreaterThanOrEqual(ENV_MIN - 1e-9);
    expect(hi).toBeLessThanOrEqual(1 + 1e-9);
    expect(hi / lo).toBeGreaterThan(3);
    for (let j = 0; j < 36; j++) seen.add(Math.round(envelope((j / 36) * TURN, 1.7) * 20));
    expect(seen.size).toBeGreaterThan(5);
    for (let i = 1; i < 400; i++) expect(Math.abs(envelope(1, i / 20) - envelope(1, (i - 1) / 20))).toBeLessThan(0.1); // (smooth: no jumps)
  });

  it("vibrates: the line moves with time, at several hertz", () => {
    const ring = WAVES[0]!;
    const a = Math.PI / (2 * ring.lobes);
    const rs = Array.from({ length: 200 }, (_, i) => waveRadius(ring, a, i / 200, 1));
    expect(Math.max(...rs) - Math.min(...rs)).toBeGreaterThan(ring.amp);
    
  });

  it("swings with the music's level: more when it is loud, and still at REST of it when it is silent or unknown", () => {
    const ring = WAVES[0]!;
    const swing = (level: number) => {
      let m = 0;
      for (let i = 0; i < 400; i++) for (let j = 0; j < 40; j++) m = Math.max(m, Math.abs(waveRadius(ring, (j / 40) * TURN, i / 100, level) - WAVE_RADIUS));
      return m;
    };
    expect(swing(0)).toBeGreaterThan(0);
    expect(swing(1) / swing(0)).toBeCloseTo(1 / REST, 1);
    expect(swing(0.5)).toBeGreaterThan(swing(0));
    expect(swing(7)).toBeCloseTo(swing(1), 6);
  });

  it("stays in its box with room to spare (the disc's own radius is about 33 of its 100 units), and is a closed polyline of finite numbers, scaled to the box it is asked for", () => {
    const ampSum = WAVES.reduce((n, w) => n + w.amp * 1.6, 0);
    expect(WAVE_RADIUS + ampSum).toBeLessThan(50);
    expect(WAVE_RADIUS - ampSum).toBeGreaterThan(34);
    for (let i = 0; i < 100; i++) expect(outlineRadius((i / 100) * TURN, i * 0.07, 1)).toBeLessThan(50);
    const pts = outlinePoints(1.234, 1, 20);
    expect(pts).toHaveLength(2 * 72);
    for (const v of pts) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(20);
    }
  });
});
