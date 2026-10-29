import { describe, expect, it } from "vitest";
import { SUN } from "./moon";
import { easeTouch, flarePlace, haloClear, rayStart, sunCrescent, sunRise, type FlareFrame } from "./sun-flare";

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

describe("haloClear", () => {
  it("is 1, nothing dimmed, until the sun's disc first touches the limb", () => {
    expect(haloClear(Infinity)).toBe(1);
    expect(haloClear(50)).toBe(1);
    expect(haloClear(SUN.fade.to)).toBe(1);
  });
  it("is 0 once the sun's centre is well behind the limb", () => {
    expect(haloClear(-SUN.fade.from)).toBe(0);
    expect(haloClear(-10)).toBe(0);
  });
  it("fades between the first contact and the full sunset, and never rises as the sun sets", () => {
    expect(haloClear(0)).toBeGreaterThan(0.05);
    expect(haloClear(0)).toBeLessThan(0.95);
    let last = 1;
    for (let i = 10; i >= -4; i -= 0.5) {
      const v = haloClear(i);
      expect(v).toBeLessThanOrEqual(last + 1e-9);
      last = v;
    }
  });
});

describe("sunRise", () => {
  const limb = Math.asin(1 / 4);
  it("is infinite when the sun is on the far side of the view axis", () => {
    expect(sunRise(-0.2, 4)).toBe(Infinity);
  });
  it("is the angle outside the limb: 0 on it, positive outside, negative behind", () => {
    expect(sunRise(Math.cos(limb), 4)).toBeCloseTo(0, 6);
    expect(sunRise(Math.cos(limb + 0.1), 4)).toBeCloseTo(0.1, 6);
    expect(sunRise(Math.cos(limb - 0.1), 4)).toBeCloseTo(-0.1, 6);
  });
});

describe("sunCrescent", () => {
  it("is the whole disc, in place, for a sun clear of the limb", () => {
    expect(sunCrescent(Infinity)).toEqual({ area: 1, shift: 0, width: 1 });
    expect(sunCrescent(1)).toEqual({ area: 1, shift: 0, width: 1 });
  });
  it("is nothing for a sun wholly behind it", () => {
    const c = sunCrescent(-1);
    expect(c.area).toBe(0);
    expect(c.width).toBe(0);
    expect(sunCrescent(-3).area).toBe(0);
  });
  it("is a half disc, whose centre of mass is 4/(3 pi) of a radius out, with the limb through the centre", () => {
    const c = sunCrescent(0);
    expect(c.area).toBeCloseTo(0.5, 6);
    expect(c.shift).toBeCloseTo(4 / (3 * Math.PI), 6);
    expect(c.width).toBe(1);
  });
  it("keeps the sun's own width until the limb reaches the centre, then the crescent's", () => {
    for (const r of [0.9, 0.5, 0.1, 0]) expect(sunCrescent(r).width).toBe(1);
    expect(sunCrescent(-0.6).width).toBeCloseTo(0.8, 6);
    expect(sunCrescent(-0.9).width).toBeLessThan(0.5);
  });
  it("loses its light steadily as the planet covers it, and its centre moves out to the crescent's", () => {
    let area = 1;
    let shift = 0;
    for (let r = 1; r >= -1; r -= 0.1) {
      const c = sunCrescent(r);
      expect(c.area).toBeLessThanOrEqual(area + 1e-9);
      expect(c.shift).toBeGreaterThanOrEqual(shift - 1e-9);
      area = c.area;
      shift = c.shift;
    }
  });
  it("leaves a crescent's centre of mass inside the visible part: past the limb, and not beyond the disc", () => {
    for (const r of [0.8, 0.3, -0.3, -0.8]) {
      const c = sunCrescent(r);
      expect(c.shift).toBeGreaterThan(-r);
      expect(c.shift).toBeLessThanOrEqual(1);
    }
  });
});

describe("rayStart", () => {
  it("is the sun's own radius while it is clear, and follows what is left of it as the planet covers it, so that the rays always reach it", () => {
    expect(rayStart(10, 1, 1, 0.8)).toBe(10);
    // touched: the flat disc, `disc` of the crescent's width
    expect(rayStart(10, 0.5, 1, 0.8)).toBeCloseTo(8, 9);
    // shrinking with the crescent: never farther out than the disc, never under a pixel
    let last = Infinity;
    for (let rise = -1; rise <= 1; rise += 0.1) {
      const c = sunCrescent(-rise);
      const start = rayStart(10, c.area, c.width, 0.8);
      expect(start).toBeLessThanOrEqual(10);
      expect(start).toBeGreaterThanOrEqual(1);
      expect(start).toBeLessThanOrEqual(Math.max(1, 10 * c.width) + 1e-9);
      last = Math.min(last, start);
    }
    expect(last).toBe(1);
  });
});

describe("flarePlace, the light page's fade", () => {
  it("keeps the flare to the sun's last pixels when rays follow it (rayDim), and dims them with it", () => {
    const p = flarePlace(frame({ visible: 0.05, rayDim: 1 }))!;
    expect(p).not.toBeNull();
    expect(p.ray).toBeCloseTo(p.str, 9);
    expect(flarePlace(frame({ visible: 0.0005, rayDim: 1 }))).toBeNull();
  });
  it("cuts the dark page's flare at 1% of the sun as before (its rays do not dim)", () => {
    expect(flarePlace(frame({ visible: 0.005 }))).toBeNull();
    expect(flarePlace(frame({ visible: 0.05 }))).not.toBeNull();
  });
});

describe("the disc the planet makes of the sun, eased in time", () => {
  it("comes in and goes with the clock, not with the frame: a limb that crosses the sun in two frames leaves it nearly clear", () => {
    // two 16 ms frames of the planet touching it, then clear again
    let t = 0;
    t = easeTouch(t, 1, 0.016);
    t = easeTouch(t, 1, 0.016);
    expect(t).toBeLessThan(0.3);
    t = easeTouch(t, 0, 0.016);
    expect(t).toBeLessThan(0.3);
    // held for half a second it is whole, and it goes in about as long
    let held = 0;
    for (let i = 0; i < 30; i++) held = easeTouch(held, 1, 0.016);
    expect(held).toBeGreaterThan(0.95);
    let gone = held;
    for (let i = 0; i < 60; i++) gone = easeTouch(gone, 0, 0.016);
    expect(gone).toBeLessThan(0.05);
  });
  it("does not move without time, and is where it was asked to be after a long one", () => {
    expect(easeTouch(0.4, 1, 0)).toBe(0.4);
    expect(easeTouch(0, 1, 10)).toBeCloseTo(1, 5);
    expect(easeTouch(1, 0, 10)).toBeCloseTo(0, 5);
  });
});
