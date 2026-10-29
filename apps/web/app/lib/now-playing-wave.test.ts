import { describe, expect, it } from "vitest";
import { REST, WAVES, WAVE_RADIUS, outlinePoints, outlineRadius, waveRadius } from "./now-playing-wave";

const TURN = 2 * Math.PI;

describe("the disc's wavy outline", () => {
  it("never turns: the same lobes are in the same places whatever the time (a standing wave, nothing travels)", () => {
    for (const ring of WAVES) for (const t of [0, 0.37, 5.1]) {
      // (a node of the first wave, where the second is also still: the radius there is the mean)
      expect(Math.abs(waveRadius(ring, 0, t, 1) - WAVE_RADIUS - ring.amp * 0.6 * Math.sin(ring.phase) * Math.cos(TURN * ring.hz2 * t + 1.3))).toBeLessThan(1e-9);
    }
  });

  it("vibrates: the line moves with time, at several hertz", () => {
    const ring = WAVES[0]!;
    const a = Math.PI / (2 * ring.lobes);
    const rs = Array.from({ length: 200 }, (_, i) => waveRadius(ring, a, i / 200, 1));
    expect(Math.max(...rs) - Math.min(...rs)).toBeGreaterThan(ring.amp);
    expect(Math.min(...WAVES.map((w) => Math.min(w.hz, w.hz2)))).toBeGreaterThanOrEqual(2);
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

  it("stays in its box with room to spare (the disc's own radius is about 34 of its 100 units), and is a closed polyline of finite numbers, scaled to the box it is asked for", () => {
    const ampSum = WAVES.reduce((n, w) => n + w.amp * 1.6, 0);
    expect(WAVE_RADIUS + ampSum).toBeLessThan(50);
    expect(WAVE_RADIUS - ampSum).toBeGreaterThan(40);
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
