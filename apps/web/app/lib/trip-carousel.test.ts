import { describe, expect, it } from "vitest";
import { growth, widest } from "./photo-carousel";
import { PEEK, lastTrip, tripKeylines, tripLayout, tripStep } from "./trip-carousel";

describe("the trip carousel's geometry", () => {
  const wide = tripKeylines(592);
  const narrow = tripKeylines(390);
  it("is a large card with the edge of the next on a phone, and with a good part of the next on a wide row", () => {
    expect(narrow.single).toBe(false);
    expect(narrow.large).toBeGreaterThan(250);
    expect(narrow.large + narrow.gutter + narrow.gap).toBeLessThan(narrow.width);
    expect(wide.single).toBe(false);
    expect(wide.medium).toBeGreaterThanOrEqual(PEEK.medium);
    expect(wide.large).toBeGreaterThanOrEqual(300); // a poster with its figures needs the room
  });
  it("at rest the first card is the large one at the gutter, the next one's edge shows and the row is full", () => {
    const boxes = tripLayout(0, 3, wide);
    expect(boxes[0]).toEqual({ x: wide.gutter, w: wide.large });
    expect(boxes[1]!.w).toBe(wide.medium);
    expect(boxes[1]!.x + boxes[1]!.w).toBeLessThanOrEqual(wide.width);
    // the card is as large as it gets: growth 1; the edge of the next is as small as a visible card gets
    expect(growth(boxes[0]!.w, wide)).toBe(1);
    expect(growth(boxes[1]!.w, wide)).toBeLessThan(0.7);
  });
  it("stops where the LAST card is the large one on a phone, and where the last two are the large and the medium on a wide row", () => {
    for (const k of [wide, narrow]) {
      const boxes = tripLayout(lastTrip(3, k), 3, k);
      expect(boxes[2]!.w).toBe(k === narrow ? k.large : k.medium);
      expect(boxes[2]!.x + boxes[2]!.w).toBeLessThanOrEqual(k.width + 1);
    }
    // (a very wide row fills with the large and the medium card: the medium one is never wider than the large one, so the first card is the one in front at rest)
    const huge = tripKeylines(1256);
    expect(huge.medium).toBeLessThanOrEqual(huge.large);
    expect(growth(tripLayout(0, 3, huge)[0]!.w, huge)).toBe(1);
  });
  it("a card grows as the row moves to it and shrinks as it moves on, and the scroll step is the photographs'", () => {
    const at = (t: number) => tripLayout(t, 3, wide).map((b) => b.w);
    expect(at(0.5)[1]!).toBeGreaterThan(at(0)[1]!);
    expect(at(0.5)[0]!).toBeLessThan(at(0)[0]!);
    expect(widest(wide)).toBe(wide.large);
    expect(tripStep(wide)).toBeGreaterThan(0);
  });
});
