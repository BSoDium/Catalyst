import { describe, expect, it } from "vitest";
import { calmPlace, energyOf } from "./calm";

/** A 10 x 20 picture whose top 8 rows are calm (sky) and whose lower rows are noisy (a skyline). */
const cols = 10;
const rows = 20;
const skyline = Float32Array.from({ length: cols * rows }, (_, i) => (Math.floor(i / cols) < 8 ? 0.01 : 0.4));

describe("calmPlace", () => {
  it("puts the map's region on the sky of a tall picture, whatever its size", () => {
    const place = calmPlace(skyline, cols, rows, { w: 620, h: 1000 }, { w: 620, run: 470 }, { x: 0, y: 0, w: 620, h: 245 })!;
    expect(place.cost).toBeLessThan(0.05);
    // (the sky is 40 % of the picture, 400 px at this size: the map's 245 px are inside it wherever it is put)
    expect(-place.top + 245).toBeLessThanOrEqual(place.height * 0.4 + 0.5);
    expect(place.width).toBeGreaterThanOrEqual(620);
    expect(place.height).toBeGreaterThanOrEqual(470);
  });
  it("covers the layer at every place it picks", () => {
    for (const region of [{ x: 0, y: 0, w: 300, h: 200 }, { x: 320, y: 0, w: 300, h: 300 }]) {
      const p = calmPlace(skyline, cols, rows, { w: 620, h: 1000 }, { w: 620, run: 470 }, region)!;
      expect(p.left).toBeLessThanOrEqual(0.001);
      expect(p.top).toBeLessThanOrEqual(0.001);
      expect(p.left + p.width).toBeGreaterThanOrEqual(619.9);
      expect(p.top + p.height).toBeGreaterThanOrEqual(469.9);
    }
  });
  it("centres a picture that has nothing to choose between", () => {
    const flat = new Float32Array(cols * rows).fill(0.1);
    const p = calmPlace(flat, cols, rows, { w: 620, h: 1000 }, { w: 620, run: 470 }, { x: 0, y: 0, w: 620, h: 245 })!;
    expect(p.top).toBeCloseTo(-(p.height - 470) / 2, 0);
  });
  it("is null for a picture it cannot read", () => {
    expect(calmPlace(new Float32Array(2), cols, rows, { w: 1, h: 1 }, { w: 1, run: 1 }, { x: 0, y: 0, w: 1, h: 1 })).toBeNull();
  });
});

describe("energyOf", () => {
  it("is nothing on a flat picture and something at an edge", () => {
    const rgba = new Uint8ClampedArray(4 * 4 * 4).fill(128);
    expect(Math.max(...energyOf(rgba, 4, 4))).toBe(0);
    for (let i = 0; i < 4; i++) for (let c = 2; c < 4; c++) rgba.set([255, 255, 255, 255], (i * 4 + c) * 4);
    expect(Math.max(...energyOf(rgba, 4, 4))).toBeGreaterThan(0.1);
  });
});
