import { describe, expect, it } from "vitest";
import { sunPlace, type SunFrame } from "./sun-layer";

const frame = (over: Partial<SunFrame> = {}): SunFrame => ({ bufW: 400, bufH: 260, x: 300, y: 80, ahead: true, focal: 300, amount: 1, ...over });

describe("sunPlace", () => {
  it("is where the direction projects, on a whole pixel's centre", () => {
    const p = sunPlace(frame({ x: 300.7, y: 80.2 }))!;
    expect(p.x).toBe(300.5);
    expect(p.y).toBe(80.5);
  });

  it("is not drawn when the direction is behind the camera (the light's side at the opening view)", () => {
    expect(sunPlace(frame({ ahead: false }))).toBeNull();
  });

  it("is not drawn when its crown is wholly off the picture, and is when only its edge is in", () => {
    expect(sunPlace(frame({ x: 4000 }))).toBeNull();
    expect(sunPlace(frame({ x: 410 }))).not.toBeNull();
  });

  it("is a fixed angle: it grows with the camera's focal length, and has a floor", () => {
    expect(sunPlace(frame({ focal: 600 }))!.r).toBeGreaterThan(sunPlace(frame({ focal: 300 }))!.r);
    expect(sunPlace(frame({ focal: 10 }))!.r).toBeGreaterThanOrEqual(3);
  });
});
