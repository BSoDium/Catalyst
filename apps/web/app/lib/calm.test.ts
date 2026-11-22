import { describe, expect, it } from "vitest";
import { calmPlace, energyOf } from "./calm";

/** A 10 x 20 picture whose top 8 rows are calm (sky) and whose lower rows are noisy (a skyline). */
const cols = 10;
const rows = 20;
const skyline = Float32Array.from({ length: cols * rows }, (_, i) => (Math.floor(i / cols) < 8 ? 0.01 : 0.4));

describe("calmPlace", () => {
  it("keeps the picture's subject in view while the map is over the sky, when that is about as calm as anywhere (a place that is all sky shows nothing of the picture)", () => {
    // (a skyline whose detail is as quiet as the sky: nothing to choose between but the subject, rows 8 to 20 of 20, whose weighted middle is at 52 % of the picture's height)
    const quiet = Float32Array.from({ length: cols * rows }, (_, i) => (Math.floor(i / cols) < 8 ? 0.01 : 0.012));
    const place = calmPlace(quiet, cols, rows, { w: 620, h: 1000 }, { w: 620, run: 470 }, { x: 0, y: 0, w: 620, h: 245 })!;
    const subjectAt = place.top + 0.52 * place.height;
    expect(subjectAt).toBeGreaterThan(0.3 * 470);
    expect(subjectAt).toBeLessThan(0.95 * 470);
  });
  it("puts the map over the sky, not over the subject, when the subject is busy (owner, 2026-11-22: Chișinău's card on a wide panel)", () => {
    const place = calmPlace(skyline, cols, rows, { w: 620, h: 1000 }, { w: 620, run: 470 }, { x: 0, y: 0, w: 620, h: 245 })!;
    expect(place.cost).toBeLessThan(0.02);
    // (the sky is the picture's first 400 px and the map's region 245 of them: the picture is no further up than that)
    expect(place.top).toBeGreaterThan(-160);
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

import { lumaOf, meanUnder } from "./calm";
describe("meanUnder", () => {
  it("is the mean of what the region covers on the picture as it is placed", () => {
    // a 2 x 2 grid, dark on top and light below, drawn 100 x 100 at (0, 0)
    const grid = [0.1, 0.1, 0.9, 0.9];
    const place = { width: 100, height: 100, left: 0, top: 0 };
    expect(meanUnder(grid, 2, 2, place, { x: 0, y: 0, w: 100, h: 50 })).toBeCloseTo(0.1, 5);
    expect(meanUnder(grid, 2, 2, place, { x: 0, y: 50, w: 100, h: 50 })).toBeCloseTo(0.9, 5);
    expect(meanUnder(grid, 2, 2, { ...place, top: -200 }, { x: 0, y: 0, w: 100, h: 50 })).toBeNull();
  });
  it("reads luminance, green most", () => {
    expect(lumaOf([0, 255, 0, 255], 1, 1)[0]).toBeGreaterThan(lumaOf([255, 0, 0, 255], 1, 1)[0]!);
  });
});
