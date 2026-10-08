import { describe, expect, it } from "vitest";
import { HIT, convexHull, distanceToHull, isBigBox, nodeHull, outlineDistance, pickNode, targetDistance, type Rect, type Target } from "./hit-area";

// A small box (25 px) at (100, 100) with a label plate much wider than it, sitting just above its top edge.
const box: Rect = { x0: 100, y0: 100, x1: 125, y1: 125 };
const plate: Rect = { x0: 97.5, y0: 75, x1: 197.5, y1: 100 };

const target = (id: number, b: Rect, p: Rect | null, extra: Partial<Target> = {}): Target => ({ id, box: b, plate: p, alpha: 1, priority: 50, big: false, slug: `n${id}`, ...extra });

describe("convex hull", () => {
  it("of a box and a wider label has 6 corners: the notch under the label is filled", () => {
    const hull = nodeHull(box, plate);
    expect(hull).toHaveLength(6);
    // the box's bottom-right corner is joined to the label's bottom-right corner by a slanted edge
    expect(distanceToHull(140, 105, hull)).toBe(0); // in the triangle (125, 100) (197.5, 100) (125, 125)
    expect(distanceToHull(124, 120, hull)).toBe(0);
  });
  it("drops collinear and interior points", () => {
    const h = convexHull([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 5, y: 5 },
    ]);
    expect(h).toHaveLength(4);
  });
  it("without a label it is the box", () => {
    const hull = nodeHull(box, null);
    expect(hull).toHaveLength(4);
    expect(distanceToHull(112, 112, hull)).toBe(0);
    expect(distanceToHull(130, 112, hull)).toBe(5);
  });
});

describe("hit test of the hull", () => {
  const hull = nodeHull(box, plate);
  it("contains the box (interior included), the label and the gap between them", () => {
    expect(distanceToHull(112, 112, hull)).toBe(0); // the box's interior
    expect(distanceToHull(150, 88, hull)).toBe(0); // the label
    expect(distanceToHull(180, 101, hull)).toBe(0); // the triangle under the label's right end, right of the box
    expect(distanceToHull(124.9, 124.9, hull)).toBe(0);
  });
  it("is the real hull, not the bounding box: the far corner under the label is outside", () => {
    // (190, 120) is right of the slanted edge from (125, 125) to (197.5, 100)
    expect(distanceToHull(190, 120, hull)).toBeGreaterThan(5);
    // (160, 112): the edge at x = 160 is at y = 125 - 25 * (35 / 72.5) = 112.9, so this point is just above it, inside
    expect(distanceToHull(160, 112, hull)).toBe(0);
    expect(distanceToHull(160, 114, hull)).toBeGreaterThan(0);
  });
  it("distance is measured to the nearest edge", () => {
    expect(distanceToHull(90, 112, hull)).toBeCloseTo(8.657, 3); // left of the box: the hull's left side slants from the label's corner to the box's
    expect(distanceToHull(150, 70, hull)).toBe(5); // above the label
  });
  it("the corner of the hull is a point distance, not an axis distance", () => {
    expect(distanceToHull(200, 70, hull)).toBeCloseTo(Math.hypot(2.5, 5), 6);
  });
});

describe("pickNode", () => {
  const t = [target(1, box, plate)];
  it("a click on the label, the box or the gap picks the node; the slop adds a few px; beyond it nothing", () => {
    expect(pickNode(t, 150, 88, "mouse", 0.3)).toBe(1);
    expect(pickNode(t, 112, 112, "mouse", 0.3)).toBe(1);
    expect(pickNode(t, 180, 101, "mouse", 0.3)).toBe(1);
    expect(pickNode(t, 300, 112, "mouse", 0.3)).toBe(-1);
    expect(pickNode(t, 150, 75 - HIT.slop.mouse, "mouse", 0.3)).toBe(1);
    expect(pickNode(t, 150, 75 - HIT.slop.mouse - 1, "mouse", 0.3)).toBe(-1);
  });
  it("touch has a larger slop", () => {
    expect(HIT.slop.touch).toBeGreaterThan(HIT.slop.mouse);
    expect(pickNode(t, 150, 75 - HIT.slop.touch, "touch", 0.3)).toBe(1);
    expect(pickNode(t, 150, 75 - HIT.slop.mouse - 1, "touch", 0.3)).toBe(1);
  });
  it("a touch target is at least 44 px across the box and its slop", () => {
    const small = { x0: 100, y0: 100, x1: 122.5, y1: 122.5 };
    expect(small.x1 - small.x0 + 2 * HIT.slop.touch).toBeGreaterThanOrEqual(44);
  });
  it("a node that is almost faded out is not a target", () => {
    expect(pickNode([target(1, box, plate, { alpha: 0.2 })], 112, 112, "mouse", 0.3)).toBe(-1);
  });
  it("the innermost target wins: a place inside a group, the group elsewhere inside its box", () => {
    const group = target(1, { x0: 0, y0: 100, x1: 400, y1: 400 }, { x0: -2.5, y0: 75, x1: 150, y1: 100 }, { slug: "group" });
    const place = target(2, { x0: 100, y0: 200, x1: 125, y1: 225 }, { x0: 97.5, y0: 175, x1: 160, y1: 200 }, { slug: "place" });
    expect(pickNode([group, place], 110, 210, "mouse", 0.3)).toBe(2);
    expect(pickNode([place, group], 110, 210, "mouse", 0.3)).toBe(2);
    expect(pickNode([group, place], 300, 300, "mouse", 0.3)).toBe(1);
    expect(pickNode([group, place], 130, 180, "mouse", 0.3)).toBe(2); // the place's label, over the group's interior
  });
  it("overlapping neighbours: inside beats near, and a click between two goes to the nearest", () => {
    const a = target(1, { x0: 0, y0: 100, x1: 25, y1: 125 }, null);
    const b = target(2, { x0: 30, y0: 100, x1: 55, y1: 125 }, null);
    expect(pickNode([a, b], 26, 110, "mouse", 0.3)).toBe(1); // 1 px from a, 4 px from b, within the slop of both
    expect(pickNode([a, b], 29, 110, "mouse", 0.3)).toBe(2);
    expect(pickNode([a, b], 10, 110, "mouse", 0.3)).toBe(1);
    expect(pickNode([b, a], 26, 110, "mouse", 0.3)).toBe(1); // the order of the nodes does not matter
  });
  it("a tie goes to the higher priority, then the slug", () => {
    const a = target(1, box, null, { priority: 10, slug: "a" });
    const b = target(2, box, null, { priority: 90, slug: "b" });
    expect(pickNode([a, b], 112, 112, "mouse", 0.3)).toBe(2);
    expect(pickNode([target(1, box, null, { slug: "b" }), target(2, box, null, { slug: "a" })], 112, 112, "mouse", 0.3)).toBe(2);
  });
});

describe("a big box has no interior target", () => {
  const big: Rect = { x0: 100, y0: 100, x1: 700, y1: 600 };
  const label: Rect = { x0: 97.5, y0: 75, x1: 200, y1: 100 };
  const t = target(1, big, label, { big: true });
  it("is big above the fraction of the map's smaller side", () => {
    expect(isBigBox(big, 900)).toBe(true);
    expect(isBigBox(big, 1600)).toBe(false);
    expect(isBigBox(box, 900)).toBe(false);
  });
  it("its border band and its label are targets, the inside of the map is not", () => {
    expect(pickNode([t], 400, 350, "mouse", 0.3)).toBe(-1);
    expect(pickNode([t], 100 + HIT.band.mouse, 350, "mouse", 0.3)).toBe(1);
    expect(pickNode([t], 400, 100, "mouse", 0.3)).toBe(1);
    expect(pickNode([t], 150, 88, "mouse", 0.3)).toBe(1);
    expect(targetDistance(400, 350, t, "mouse")).toBe(250 - HIT.band.mouse);
  });
  it("a place inside it stays a target", () => {
    const inner = target(2, { x0: 300, y0: 300, x1: 325, y1: 325 }, null);
    expect(pickNode([t, inner], 310, 310, "mouse", 0.3)).toBe(2);
  });
});

describe("outline distance", () => {
  it("is 0 on the outline and grows both ways", () => {
    const r = { x0: 100, y0: 100, x1: 400, y1: 300 };
    expect(outlineDistance(100, 200, r)).toBe(0);
    expect(outlineDistance(150, 200, r)).toBe(50);
    expect(outlineDistance(90, 200, r)).toBe(10);
  });
});
