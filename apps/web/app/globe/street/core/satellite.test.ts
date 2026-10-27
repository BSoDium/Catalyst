import { describe, expect, it } from "vitest";
import { PATTERN } from "./palette";
import { classifySatellite, isSea, satelliteLevel, satelliteLevels } from "./satellite";

describe("the satellite ground", () => {
  it("reads blue as sea (the page's colour), and bright bluish white (ice) as ground", () => {
    expect(isSea(10, 40, 90)).toBe(true);
    expect(isSea(235, 240, 250)).toBe(false);
    expect(satelliteLevel(10, 40, 90)).toBe(0);
  });
  it("gives the darker ground the louder level, in whole steps, every tone above the page's colour", () => {
    const [dark, mid, light] = satelliteLevels();
    expect(dark).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(light);
    expect(light).toBeGreaterThan(0);
    expect(satelliteLevel(20, 40, 15)).toBe(dark);
    expect(satelliteLevel(55, 60, 40)).toBe(mid);
    expect(satelliteLevel(120, 100, 80)).toBe(light);
    expect(satelliteLevel(10, 40, 90)).toBe(0);
  });
  it("writes the fill encoding: R = G = 0, B = chessboard pattern x 16 + level (0 for the sea), opaque", () => {
    const px = new Uint8ClampedArray([20, 40, 15, 255, 10, 40, 90, 255]);
    classifySatellite(px);
    const [dark] = satelliteLevels();
    expect([...px]).toEqual([0, 0, PATTERN.checker * 16 + dark, 255, 0, 0, 0, 255]);
  });
});
