import { describe, expect, it } from "vitest";
import { brightness, labelRegion, toneOf } from "./image-tone";

describe("image tone", () => {
  it("takes the foot of what is seen of a picture that is cropped by its box", () => {
    // a tall picture in a wide box: the box shows the middle band, full width
    const r = labelRegion({ width: 1000, height: 3000 }, { width: 500, height: 200 }, 0.5);
    expect(r.x).toBe(0);
    expect(r.width).toBe(1000);
    expect(r.height).toBeCloseTo(200, 5);
    expect(r.y).toBeCloseTo(1300 + 200, 5);
    // a wide picture in a tall box: the middle, full height
    const w = labelRegion({ width: 3000, height: 1000 }, { width: 200, height: 500 }, 0.25);
    expect(w.width).toBeCloseTo(400, 5);
    expect(w.x).toBeCloseTo(1300, 5);
    expect(w.y).toBeCloseTo(750, 5);
  });
  it("is the mean brightness, and ignores what is transparent", () => {
    expect(brightness([0, 0, 0, 255, 0, 0, 0, 255])).toBe(0);
    expect(brightness([255, 255, 255, 255])).toBeCloseTo(1, 5);
    expect(brightness([255, 255, 255, 255, 0, 0, 0, 255])).toBeCloseTo(0.5, 5);
    expect(brightness([255, 255, 255, 0])).toBe(0.5);
  });
  it("is dark under the middle grey and light over it", () => {
    expect(toneOf(0.2)).toBe("dark");
    expect(toneOf(0.8)).toBe("light");
  });
});
