import { describe, expect, it } from "vitest";
import { carouselLayout, growth, keylines, lastPosition, stepOf, widest, widthAt } from "./photo-carousel";

const k = keylines(600);
const sum = (items: { x: number; w: number }[]) => items.reduce((n, i) => n + i.w, 0);

describe("photo carousel geometry", () => {
  it("has a small, a large and a medium picture that fill the row from the gutter, the large one a little wider than the medium", () => {
    expect(k.small + k.large + k.medium + 2 * k.gap + k.gutter).toBe(600);
    expect(k.large).toBeGreaterThan(k.medium);
    expect(k.medium).toBeGreaterThan(k.small * 2);
    expect(keylines(560).small).toBe(89);
  });
  it("goes from nothing to small, large, medium, small and nothing along the row", () => {
    expect([-2, -1, 0, 1, 2, 3].map((u) => widthAt(u, k))).toEqual([0, k.small, k.large, k.medium, k.small, 0]);
    expect(widthAt(-0.5, k)).toBeCloseTo((k.small + k.large) / 2);
    expect(widthAt(0.5, k)).toBeCloseTo((k.large + k.medium) / 2);
  });
  it("fills the row to its right edge at the start, with the gutter at the left, and the small picture cut off by the edge", () => {
    const items = carouselLayout(0, 6, k);
    expect(items[0]).toEqual({ x: 24, w: k.large });
    expect(items[2]!.x + items[2]!.w).toBe(600);
  });
  it("never leaves a hole at the right while the row moves", () => {
    for (let t = 0; t <= 6; t += 0.25) {
      const items = carouselLayout(t, 8, k).filter((i) => i.w > 0);
      const last = items[items.length - 1]!;
      expect(last.x + last.w, `t=${t}`).toBeGreaterThanOrEqual(600 - 24 - 0.5);
      expect(carouselLayout(t, 8, k).find((i) => i.w > 0)!.x, `t=${t}`).toBeLessThanOrEqual(24);
    }
  });
  it("shrinks the leftmost and grows the rightmost as the row moves, the gutter at the left going", () => {
    const from = carouselLayout(0, 6, k);
    const to = carouselLayout(0.5, 6, k);
    expect(to[0]!.w).toBeLessThan(from[0]!.w);
    expect(to[3]!.w).toBeGreaterThan(from[3]!.w);
    // the gutter at the left goes as the row moves: by the first picture's being small it is at the edge
    expect(to[0]!.x).toBe(12);
    expect(carouselLayout(1, 6, k)[0]!.x).toBe(0);
    expect(carouselLayout(2.5, 6, k)[0]!.x).toBe(0);
  });
  it("stops where the last two pictures are the expanded ones, the last a gutter from the right edge, and goes no further", () => {
    expect(lastPosition(6, k)).toBe(4);
    const end = carouselLayout(4, 6, k);
    expect(end[5]!.x + end[5]!.w).toBeCloseTo(600 - 24, 0);
    expect(end[4]!.w).toBeCloseTo(k.large, 0);
    expect(end[5]!.w).toBeCloseTo(k.medium, 0);
    expect(carouselLayout(5, 6, k)).toEqual(end);
    expect(carouselLayout(99, 6, k)).toEqual(end);
    // no picture is wider than the widest, so none shows a bar at its side
    for (let t = 0; t <= 6; t += 0.25) for (const item of carouselLayout(t, 6, k)) expect(item.w).toBeLessThanOrEqual(widest(k) + 0.001);
  });
  it("clamps the position, and shares the row between the gutters for one or two pictures", () => {
    expect(carouselLayout(-3, 6, k)).toEqual(carouselLayout(0, 6, k));
    const two = carouselLayout(0, 2, k);
    expect(two[0]!.x).toBe(24);
    expect(two[1]!.x + two[1]!.w).toBe(600 - 24);
    expect(carouselLayout(5, 2, k)).toEqual(two);
    expect(sum(carouselLayout(0, 1, k))).toBe(600 - 48);
  });
  it("shows one picture at a time on a narrow row, edge to edge at rest, the next growing from nothing as the row moves", () => {
    const phone = keylines(390);
    expect(phone.single).toBe(true);
    expect(keylines(600).single).toBe(false);
    expect(phone.large).toBe(390);
    expect(lastPosition(5, phone)).toBe(4);
    expect(stepOf(phone)).toBe(phone.large + phone.gap);
    const first = carouselLayout(0, 5, phone);
    expect(first[0]).toEqual({ x: 0, w: 390 });
    expect(first[1]!.x).toBeGreaterThanOrEqual(390);
    const half = carouselLayout(0.5, 5, phone);
    expect(half[0]!.w).toBeCloseTo(195, 0);
    expect(half[1]!.w).toBeCloseTo(195, 0);
    // the two that share the row fill it (the gap apart)
    for (let t = 0; t <= 4; t += 0.25) {
      const [a, b] = carouselLayout(t, 5, phone).filter((i) => i.w >= 1);
      expect(Math.min(a!.x + a!.w + (b ? phone.gap : 0) + (b?.w ?? 0), 390 + phone.gap), `t=${t}`).toBeGreaterThanOrEqual(389);
    }
    const last = carouselLayout(4, 5, phone);
    expect(last[4]!.x).toBeCloseTo(0, 1);
    expect(last[4]!.w).toBe(390);
    expect(last[3]!.w).toBeLessThan(1);
    // two pictures scroll too, and the position is clamped
    expect(carouselLayout(9, 2, phone)[1]!.w).toBe(390);
  });
  it("counts a small picture as no growth and the widest as all of it", () => {
    expect(growth(k.small, k)).toBe(0);
    expect(growth(widest(k), k)).toBe(1);
  });
});
