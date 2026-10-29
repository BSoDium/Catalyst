import { describe, expect, it } from "vitest";
import { BASE_HIGH, BASE_HZ, BASE_LOW, DISC_EDGE, ENV_MIN, MAX_RADIUS, REST, WAVES, WAVE_RADIUS, baseRadius, envelope, outlinePoints, outlineRadius, waveRadius } from "./now-playing-wave";

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

  it("reaches in behind the disc and out to the edge of its box, and never beyond either; it is a closed polyline of finite numbers, scaled to the box it is asked for", () => {
    let lo = 100;
    let hi = 0;
    for (let i = 0; i < 600; i++) for (let j = 0; j < 72; j++) {
      const r = outlineRadius((j / 72) * TURN, i / 10, i % 7 === 0 ? 0 : 1);
      lo = Math.min(lo, r);
      hi = Math.max(hi, r);
    }
    expect(lo).toBeLessThan(DISC_EDGE + 1.5); // (its troughs are behind the disc)
    expect(lo).toBeGreaterThanOrEqual(DISC_EDGE - 1);
    expect(hi).toBeGreaterThan(MAX_RADIUS - 3);
    expect(hi).toBeLessThanOrEqual(MAX_RADIUS);
    const pts = outlinePoints(1.234, 1, 20);
    expect(pts).toHaveLength(2 * 72);
    for (const v of pts) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(20);
    }
  });

  it("stands further out the louder the music, and swells and falls back slowly (a period of several seconds)", () => {
    expect(baseRadius(0, 1)).toBeGreaterThan(baseRadius(0, 0));
    expect(baseRadius(0, 0)).toBeGreaterThanOrEqual(BASE_LOW);
    expect(baseRadius(0, 1)).toBeLessThanOrEqual(BASE_HIGH);
    expect(1 / BASE_HZ).toBeGreaterThan(5);
    expect(Math.abs(baseRadius(1 / BASE_HZ / 4, 0) - baseRadius(0, 0))).toBeGreaterThan(1);
  });
});
