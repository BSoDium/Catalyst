import { describe, expect, it } from "vitest";
import { flarePlace, planetClear, type FlareFrame } from "./sun-flare";

const frame = (over: Partial<FlareFrame> = {}): FlareFrame => ({ bufW: 400, bufH: 260, x: 300, y: 80, ahead: true, amount: 1, visible: 1, ...over });

describe("flarePlace", () => {
  it("puts the sun on a whole pixel's centre and measures sizes by the short side", () => {
    const p = flarePlace(frame({ x: 300.7, y: 80.2 }))!;
    expect(p.sx).toBe(300.5);
    expect(p.sy).toBe(80.5);
    expect(p.unit).toBe(260);
  });
  it("is not there when the sun is behind the camera, away with the night, or hidden by the planet", () => {
    expect(flarePlace(frame({ ahead: false }))).toBeNull();
    expect(flarePlace(frame({ amount: 0 }))).toBeNull();
    expect(flarePlace(frame({ visible: 0 }))).toBeNull();
  });
  it("fades as the sun leaves the picture and is gone well outside it", () => {
    expect(flarePlace(frame({ x: 400, y: 130 }))!.str).toBeGreaterThan(flarePlace(frame({ x: 480, y: 130 }))!.str);
    expect(flarePlace(frame({ x: 2000 }))).toBeNull();
  });
  it("fades as the sun comes to the middle of the picture", () => {
    expect(flarePlace(frame({ x: 200, y: 130 }))).toBeNull();
    expect(flarePlace(frame({ x: 210, y: 135 }))).toBeNull();
    expect(flarePlace(frame({ x: 320, y: 130 }))!.str).toBeGreaterThan(0.5);
  });
  it("scales with how much of the sun the planet leaves", () => {
    expect(flarePlace(frame({ visible: 0.5 }))!.str).toBeCloseTo(flarePlace(frame())!.str * 0.5, 5);
  });
});

describe("planetClear", () => {
  it("is 1 when the sun is on the far side of the view axis, or well outside the limb", () => {
    expect(planetClear(-0.5, 4)).toBe(1);
    expect(planetClear(Math.cos(0.6), 4)).toBe(1);
  });
  it("is 0 behind the planet's disc", () => {
    expect(planetClear(1, 4)).toBe(0);
    expect(planetClear(Math.cos(0.1), 4)).toBe(0);
  });
  it("has the limb at the planet's angular radius", () => {
    const limb = Math.asin(1 / 4);
    expect(planetClear(Math.cos(limb), 4)).toBeGreaterThan(0.4);
    expect(planetClear(Math.cos(limb), 4)).toBeLessThan(0.6);
  });
});
