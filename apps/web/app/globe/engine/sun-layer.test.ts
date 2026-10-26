import { describe, expect, it } from "vitest";
import { sunPlace, type SunFrame } from "./sun-layer";

const frame = (over: Partial<SunFrame> = {}): SunFrame => ({ bufW: 400, bufH: 260, cx: 200, cy: 130, radius: 80, dir: [0.79, 0.24, 0.56], amount: 1, ...over });

describe("sunPlace", () => {
  it("puts the sun on the side the light comes from, above the planet's middle, off its disc", () => {
    const p = sunPlace(frame());
    expect(p.x).toBeGreaterThan(200 + 80);
    expect(p.y).toBeGreaterThan(130);
    expect(Math.hypot(p.x - 200, p.y - 130)).toBeGreaterThan(80);
  });

  it("is on a whole pixel's centre", () => {
    const p = sunPlace(frame());
    expect(p.x % 1).toBe(0.5);
    expect(p.y % 1).toBe(0.5);
  });

  it("stays inside the picture, with its crown's start clear of the edge", () => {
    for (const dir of [[1, 0, 0], [0, 1, 0], [-1, 0, 0], [0, -1, 0], [0, 0, 1]] as const) {
      const p = sunPlace(frame({ dir: [...dir], radius: 200 }));
      expect(p.x).toBeGreaterThanOrEqual(p.r);
      expect(p.x).toBeLessThanOrEqual(400 - p.r);
      expect(p.y).toBeGreaterThanOrEqual(p.r);
      expect(p.y).toBeLessThanOrEqual(260 - p.r);
    }
  });

  it("grows with the planet, and has a floor", () => {
    expect(sunPlace(frame({ radius: 160 })).r).toBeGreaterThan(sunPlace(frame({ radius: 80 })).r);
    expect(sunPlace(frame({ radius: 4 })).r).toBeGreaterThanOrEqual(5);
  });
});
