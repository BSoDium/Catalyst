import { describe, expect, it } from "vitest";
import { carouselGeometry, carouselLayout, fullWidths, growth, peekWidths, widthAt } from "./photo-carousel";

const geo = carouselGeometry(600);

describe("photo carousel geometry", () => {
  it("has a peek of a sixth of the row, between 56 and 120 px", () => {
    expect(carouselGeometry(600).peek).toBe(100);
    expect(carouselGeometry(200).peek).toBe(56);
    expect(carouselGeometry(1200).peek).toBe(120);
  });
  it("grows a picture from nothing to a peek to its full width, and shrinks it away at the left", () => {
    expect([2, 1.5, 1, 0.5, 0, -0.5, -1].map((d) => widthAt(d, 400, 100))).toEqual([0, 50, 100, 250, 400, 200, 0]);
  });
  it("makes the first picture as wide as the row allows less the gutter, the gap and the peek, and the last one less two gutters", () => {
    const [first, last] = [fullWidths([3, 3], 400, geo)[0]!, fullWidths([3, 3], 400, geo)[1]!];
    expect(first).toBe(600 - 24 - 6 - 100);
    expect(last).toBe(600 - 24 - 24);
    expect(fullWidths([0.5, 0.5], 400, geo)).toEqual([200, 200]);
  });
  it("keeps the gutter at the left, the peek of the next picture at the right edge, and the width in focus whole", () => {
    const fulls = fullWidths([1.5, 1.5, 1.5], 400, geo);
    const [a, b] = carouselLayout(0, fulls, geo);
    expect(a).toEqual({ x: 24, w: fulls[0] });
    expect(b!.x + b!.w).toBe(600);
  });
  it("shrinks the leftmost and grows the rightmost as the row moves, with no height in it", () => {
    const fulls = fullWidths([1.5, 1.5, 1.5, 1.5], 400, geo);
    const from = carouselLayout(0, fulls, geo);
    const to = carouselLayout(0.5, fulls, geo);
    expect(to[0]!.w).toBeLessThan(from[0]!.w);
    expect(to[1]!.w).toBeGreaterThan(from[1]!.w);
    expect(to[2]!.w).toBeGreaterThan(from[2]!.w);
    expect(to[0]!.x).toBe(24);
  });
  it("clamps the position to the first and the last picture", () => {
    const fulls = fullWidths([1.5, 1.5], 400, geo);
    expect(carouselLayout(-3, fulls, geo)).toEqual(carouselLayout(0, fulls, geo));
    expect(carouselLayout(9, fulls, geo)).toEqual(carouselLayout(1, fulls, geo));
    expect(carouselLayout(1, fulls, geo)[1]).toEqual({ x: 24, w: fulls[1] });
  });
  it("counts a peek as no growth and a full width as all of it", () => {
    expect(growth(100, 400, 100)).toBe(0);
    expect(growth(400, 400, 100)).toBe(1);
    expect(growth(250, 400, 100)).toBeCloseTo(0.5, 1);
  });
  it("lets the next picture fill what the one in focus leaves of the row, so it always bleeds off the right edge", () => {
    const fulls = fullWidths([0.8, 1.5, 1.5], 400, geo); // a narrow first picture (320 px) leaves 230 px of the 600
    expect(peekWidths(fulls, geo)[1]).toBe(600 - 24 - 6 - 320);
    const [a, b] = carouselLayout(0, fulls, geo);
    expect(b!.x + b!.w).toBe(600);
    expect(a!.w).toBe(320);
  });
});
