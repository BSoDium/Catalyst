import { describe, expect, it } from "vitest";
import { cutoutOf, rawCutoutOf, subjectPlace } from "./cutout";

const layer = { w: 400, run: 470 };
const image = { w: 800, h: 1000 };

describe("subjectPlace", () => {
  it("always covers the layer", () => {
    for (const cx of [0, 0.3, 0.5, 1]) {
      for (const cy of [0, 0.5, 0.9, 1]) {
        const p = subjectPlace({ cx, top: cy }, image, layer, { x: 120, y: 390 });
        expect(p.left).toBeLessThanOrEqual(0);
        expect(p.top).toBeLessThanOrEqual(0);
        expect(p.left + p.width).toBeGreaterThanOrEqual(layer.w - 1e-6);
        expect(p.top + p.height).toBeGreaterThanOrEqual(layer.run - 1e-6);
      }
    }
  });

  it("brings the subject to the target when the picture has room", () => {
    const p = subjectPlace({ cx: 0.5, top: 0.5 }, { w: 400, h: 1500 }, layer, { x: 120, y: 390 });
    expect(p.left + 0.5 * p.width).toBeCloseTo(120, 3);
    expect(p.top + 0.5 * p.height).toBeCloseTo(390, 3);
  });

  it("gets as close as it can when it has no room, without leaving the layer uncovered", () => {
    const p = subjectPlace({ cx: 0.95, top: 0.05 }, { w: 400, h: 470 }, layer, { x: 120, y: 390 });
    expect(p.left).toBeLessThanOrEqual(0);
    expect(p.left + p.width).toBeGreaterThanOrEqual(layer.w - 1e-6);
  });
});

describe("cutoutOf", () => {
  it("knows nothing of a picture that has no cutout", () => {
    expect(rawCutoutOf("/media/none.webp")).toBeUndefined();
    expect(cutoutOf("/media/none.webp")).toBeUndefined();
  });
});
