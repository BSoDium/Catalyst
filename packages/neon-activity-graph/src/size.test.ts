import { describe, expect, it } from "vitest";
import { renderSize } from "./size";

describe("renderSize", () => {
  it("follows the container at the device's pixel ratio, up to 2", () => {
    expect(renderSize({ cssWidth: 1000, cssHeight: 250, devicePixelRatio: 3, lite: false })).toMatchObject({ width: 2000, height: 500, ratio: 2 });
    expect(renderSize({ cssWidth: 1000, cssHeight: 250, devicePixelRatio: 1.5, lite: false })).toMatchObject({ width: 1500, height: 375 });
  });
  it("is 1 on a lite device", () => {
    expect(renderSize({ cssWidth: 1000, cssHeight: 250, devicePixelRatio: 3, lite: true }).ratio).toBe(1);
  });
  it("scales down past the pixel budget and the texture size, keeping the aspect", () => {
    const s = renderSize({ cssWidth: 2560, cssHeight: 645, devicePixelRatio: 2, lite: false, maxPixels: 2_000_000 });
    expect(s.width * s.height).toBeLessThanOrEqual(2_000_000 * 1.01);
    expect(s.width / s.height).toBeCloseTo(2560 / 645, 1);
    expect(renderSize({ cssWidth: 6000, cssHeight: 100, devicePixelRatio: 1, lite: false, maxSize: 4096 }).width).toBeLessThanOrEqual(4096);
  });
});
