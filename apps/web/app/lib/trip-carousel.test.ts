import { describe, expect, it } from "vitest";
import { growth, widest } from "./photo-carousel";
import { PEEK, lastTrip, tripKeylines, tripLayout, tripStep } from "./trip-carousel";

describe("the trip carousel's geometry", () => {
  const wide = tripKeylines(592);
  const narrow = tripKeylines(390);
  it("is one card across the whole row on a phone, and a large card with a good part of the next on a wide row", () => {
    expect(narrow.single).toBe(true);
    expect(narrow.large).toBe(narrow.width);
    expect(tripLayout(0, 3, narrow)[0]).toEqual({ x: 0, w: 390 });
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
  it("stops where the LAST card is the large one, on a phone and on a wide row", () => {
    for (const k of [wide, narrow]) {
      expect(lastTrip(3, k)).toBe(2);
      const boxes = tripLayout(lastTrip(3, k), 3, k);
      expect(boxes[2]!.w).toBe(k.large);
      expect(boxes[2]!.x + boxes[2]!.w).toBeLessThanOrEqual(k.width + 1);
    }
    // (a wide row's last step: the card before is the medium one, at the left of the last, and the row is full)
    const end = tripLayout(2, 3, wide);
    expect(end[1]!.w).toBe(wide.medium);
    expect(end[2]!.x).toBeGreaterThanOrEqual(end[1]!.x + end[1]!.w);
    expect(growth(end[2]!.w, wide)).toBe(1);
    // (on the way there the two trade their sizes, never overlapping)
    for (const t of [1, 1.25, 1.5, 1.75, 2]) {
      const b = tripLayout(t, 3, wide);
      expect(b[2]!.x).toBeGreaterThanOrEqual(b[1]!.x + b[1]!.w - 0.5);
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

import { BLEED, tripBleed } from "./trip-carousel";
describe("the cards at the edges of a wide row", () => {
  const k = tripKeylines(900);
  it("run on past the right edge at rest, and the last one does not at the end", () => {
    const boxes = tripLayout(0, 6, k);
    expect(tripBleed(boxes[2]!, 2, 0, 6, k).right).toBe(BLEED);
    expect(tripBleed(boxes[0]!, 0, 0, 6, k)).toEqual({ left: 0, right: 0 });
    const end = lastTrip(6, k);
    const last = tripLayout(end, 6, k);
    expect(tripBleed(last[5]!, 5, end, 6, k).right).toBe(0);
  });
  it("run on past the left edge once the row has moved, and not on a phone", () => {
    const boxes = tripLayout(1, 6, k);
    expect(tripBleed(boxes[0]!, 0, 1, 6, k).left).toBe(BLEED);
    const phone = tripKeylines(400);
    expect(tripBleed(tripLayout(1, 6, phone)[0]!, 0, 1, 6, phone)).toEqual({ left: 0, right: 0 });
  });
});

describe("a card's bleed gives way to its neighbour", () => {
  const k = tripKeylines(900);
  it("never runs under the card beside it: the sum of what a card takes past its side stays outside the neighbour", () => {
    for (let t = 0; t <= lastTrip(8, k); t += 0.05) {
      const boxes = tripLayout(t, 8, k);
      boxes.forEach((b, i) => {
        const bl = tripBleed(b, i, t, 8, k, boxes[i - 1], boxes[i + 1]);
        const next = boxes[i + 1];
        if (next && next.w >= k.small) expect(bl.right).toBe(0);
        const prev = boxes[i - 1];
        if (prev && prev.w >= k.small) expect(bl.left).toBe(0);
      });
    }
  });
});
