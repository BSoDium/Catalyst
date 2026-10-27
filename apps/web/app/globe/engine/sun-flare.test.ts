import { describe, expect, it } from "vitest";
import { SUN } from "./moon";
import { flarePlace, haloClear, planetClear, type FlareFrame } from "./sun-flare";

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
    expect(flarePlace(frame({ x: 380, y: 130 }))!.str).toBeGreaterThan(flarePlace(frame({ x: 430, y: 130 }))!.str);
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

describe("haloClear", () => {
  const reach = ((SUN.angularDeg * Math.PI) / 180) * SUN.halo;
  const limb = Math.asin(1 / 4);
  const at = (outside: number) => haloClear(Math.cos(limb + outside), 4, reach);
  it("is 1 for a sun on the far side of the view axis, or far outside the limb", () => {
    expect(haloClear(-0.5, 4, reach)).toBe(1);
    expect(at(reach)).toBe(1);
  });
  it("is 0 once the sun's centre is well behind the planet", () => {
    expect(haloClear(1, 4, reach)).toBe(0);
    expect(at(-reach)).toBe(0);
  });
  it("fades the halo over a wide span, far wider than the ring's hair", () => {
    const mid = at(reach * 0.2);
    expect(mid).toBeGreaterThan(0.05);
    expect(mid).toBeLessThan(0.95);
    // the halo has begun to go while the planet's own hair (`planetClear`) still leaves all of the sun
    expect(planetClear(Math.cos(limb + reach * 0.2), 4)).toBe(1);
    // and a good share of it is still there with the sun's centre on the limb itself
    expect(at(0)).toBeGreaterThan(0.3);
  });
  it("never rises as the sun sets", () => {
    let last = 1;
    for (let i = 8; i >= -2; i--) {
      const v = at((reach * i) / 8);
      expect(v).toBeLessThanOrEqual(last + 1e-9);
      last = v;
    }
  });
});
