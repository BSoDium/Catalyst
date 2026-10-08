import { describe, expect, it } from "vitest";
import { pickNode } from "./hit-area";
import { CLEARANCE, UPGRADE_MARGIN, boxesToAvoid, planLabels, pxUnits, type PlanItem, type PlanResult } from "./label-plan";
import { LOD } from "./lod-tree";
import { SPOT, chipText, labelVariants } from "./pixel-labels";

const GRID = { cols: 600, rows: 400 };
/** A box of `w x h` cells at (x, y) with a label. */
const item = (key: string, x: number, y: number, extra: Partial<PlanItem> & { name?: string; chip?: string | null; w?: number; h?: number } = {}): PlanItem => {
  const { name = "Name", chip = null, w = 40, h = 30, ...rest } = extra;
  return { score: 80, area: w * h, key, rect: { c0: x, r0: y, c1: x + w, r1: y + h }, variants: labelVariants(name, chip).map((v) => v.layout), prev: null, ...rest };
};
const overlaps = (a: PlanResult, b: PlanResult, pad = 0) => a.x - pad < b.x + b.w && a.x + a.w + pad > b.x && a.y - pad < b.y + b.h && a.y + a.h + pad > b.y;

describe("every drawn box has its label: there is no label that loses and no dimmed box", () => {
  it("every item gets a plate, however crowded", () => {
    const items = Array.from({ length: 40 }, (_, k) => item(`n${k}`, 200 + (k % 5) * 6, 150 + Math.floor(k / 5) * 5, { name: "A rather long name here", w: 14, h: 12 }));
    const plan = planLabels(items, GRID);
    expect(plan.length).toBe(40);
    for (const p of plan) {
      expect(p.w).toBeGreaterThan(0);
      expect(p.x >= 0 && p.y >= 0 && p.x + p.w <= GRID.cols && p.y + p.h <= GRID.rows).toBe(true);
    }
  });
  it("an isolated box gets the first position: above its top-left corner, whole", () => {
    const plan = planLabels([item("a", 200, 200, { name: "Houston", chip: chipText(4) })], GRID);
    expect(plan[0]).toMatchObject({ cand: SPOT.aboveLeft, variant: 0, overlap: false, x: 200 });
    expect(plan[0]!.y + plan[0]!.h).toBe(200);
  });
  it("a neighbour's label in the way moves the label to the next free position instead of dropping it", () => {
    const a = item("a", 200, 200, { score: 120, name: "Alpha Beta Gamma" });
    const b = item("b", 210, 205, { score: 80, name: "Delta Epsilon" });
    const plan = planLabels([a, b], GRID);
    expect(plan[0]!.cand).toBe(SPOT.aboveLeft);
    expect(plan[1]!.cand).not.toBe(SPOT.aboveLeft);
    expect(plan[1]!.variant).toBe(0); // still whole: another position was free
    expect(plan[1]!.overlap).toBe(false);
    expect(overlaps(plan[0]!, plan[1]!, CLEARANCE)).toBe(false);
  });
  it("placed in priority order: the better one gets the first position, whatever the order of the input", () => {
    const a = item("a", 200, 200, { score: 80 });
    const b = item("b", 210, 205, { score: 120 });
    const one = planLabels([a, b], GRID);
    const two = planLabels([b, a], GRID);
    expect(one[1]!.cand).toBe(SPOT.aboveLeft);
    expect(one[0]!.cand).not.toBe(SPOT.aboveLeft);
    expect(two[0]!).toEqual(one[1]!);
    expect(two[1]!).toEqual(one[0]!);
  });
  it("equal scores: the bigger box first, then the key", () => {
    const small = item("a", 200, 200, { w: 20, h: 20 });
    const big = item("b", 205, 205, { w: 60, h: 60 });
    const plan = planLabels([small, big], GRID);
    expect(plan[1]!.cand).toBe(SPOT.aboveLeft);
    const x = item("x", 200, 200);
    const y = item("y", 205, 205);
    expect(planLabels([x, y], GRID)[0]!.cand).toBe(SPOT.aboveLeft);
  });
  it("with no room above (the top of the grid) the label nests inside the box", () => {
    const plan = planLabels([item("a", 100, 3, { w: 200, h: 100, name: "Bulgaria" })], GRID);
    expect(plan[0]!.cand).toBe(SPOT.insideTopLeft);
    expect(plan[0]!.inside).toBe(true);
  });
  it("when no position is free the label is shortened: the counter first, then the name with an ellipsis", () => {
    // a row of boxes whose labels fill the space on every side: only a shorter label fits
    const items: PlanItem[] = [];
    for (let k = 0; k < 9; k++) items.push(item(`n${k}`, 40 + (k % 3) * 55, 60 + Math.floor(k / 3) * 55, { w: 12, h: 12, name: "Western Europe", chip: chipText(6), score: 100 - k }));
    const plan = planLabels(items, { cols: 190, rows: 200 });
    const shortened = plan.filter((p) => p.variant > 0);
    expect(shortened.length).toBeGreaterThan(0);
    for (const p of plan) expect(p.w).toBeGreaterThan(0);
  });
  it("the last resort draws it anyway, on top, and never below six characters", () => {
    // a grid so small that nothing is free next to the first label: the second is drawn over it, as short as it can be
    const a = item("a", 5, 18, { score: 120, name: "Western Europe", w: 12, h: 12 });
    const b = item("b", 10, 18, { score: 80, name: "Eastern Europe", w: 12, h: 12 });
    const plan = planLabels([a, b], { cols: 100, rows: 40 });
    expect(plan[0]!.overlap).toBe(false);
    expect(plan[1]!.overlap).toBe(true);
    const v = labelVariants("Eastern Europe", null)[plan[1]!.variant]!;
    expect(Array.from(v.text).length).toBeGreaterThanOrEqual(6);
    expect(plan[1]!.x >= 0 && plan[1]!.y >= 0 && plan[1]!.x + plan[1]!.w <= 100 && plan[1]!.y + plan[1]!.h <= 40).toBe(true);
  });
  it("a selected node (boosted score) is placed first, ahead of a stronger neighbour", () => {
    const a = item("a", 200, 200, { score: 500, name: "A long name that will want room" });
    const b = item("b", 210, 205, { score: 1000 + 80, name: "Selected Place", chip: chipText(3) });
    const plan = planLabels([a, b], GRID);
    expect(plan[1]).toMatchObject({ cand: SPOT.aboveLeft, variant: 0, overlap: false });
    expect(overlaps(plan[0]!, plan[1]!)).toBe(false);
  });
  it("the plan has no state input but the items: hovering does not exist for it (a hovered label is written longer by the host, around its slot)", () => {
    const items = Array.from({ length: 12 }, (_, k) => item(`n${k}`, 100 + ((k * 37) % 300), 80 + ((k * 53) % 200), { name: `Place ${k}` }));
    expect(planLabels(items, GRID)).toEqual(planLabels(items.map((t) => ({ ...t })), GRID));
  });
  it("deterministic: the same input gives the same plan", () => {
    const items = Array.from({ length: 25 }, (_, k) => item(`n${k}`, 100 + ((k * 37) % 400), 80 + ((k * 53) % 250), { name: `Place number ${k}`, score: 50 + (k % 7) }));
    expect(planLabels(items, GRID)).toEqual(planLabels(items, GRID));
  });
});

describe("stable between frames: the previous choice is kept with hysteresis", () => {
  it("a label whose previous choice is still free keeps it unless a better one is free with room to spare", () => {
    const keep = planLabels([item("a", 200, 200, { prev: { variant: 0, cand: SPOT.aboveLeft, dx: 0, dy: -30 } })], GRID)[0]!;
    expect(keep.cand).toBe(SPOT.aboveLeft);
    const up = planLabels([item("a", 200, 200, { prev: { variant: 0, cand: SPOT.belowLeft, dx: 0, dy: 0 } })], GRID)[0]!;
    expect(up.cand).toBe(SPOT.aboveLeft); // nothing in the way: the better position wins
  });
  it("it moves to the better position only when that one is free with UPGRADE_MARGIN cells to spare", () => {
    const prev = { variant: 0, cand: SPOT.aboveRight, dx: 0, dy: 0 };
    const plateW = labelVariants("Mine", null)[0]!.layout.w;
    // a wide box (so the positions are far apart) and a blocker whose own label lands on the same rows, `gap` cells right of where the above-left plate ends
    const run = (gap: number) => planLabels([item("blocker", 200 + plateW + gap, 200, { score: 500, name: "Mine" }), item("mine", 200, 200, { w: 300, prev, name: "Mine" })], GRID)[1]!;
    expect(run(CLEARANCE).cand).toBe(SPOT.aboveRight); // free, but not by enough: it stays
    expect(run(CLEARANCE + UPGRADE_MARGIN - 1).cand).toBe(SPOT.aboveRight);
    expect(run(CLEARANCE + UPGRADE_MARGIN).cand).toBe(SPOT.aboveLeft); // free with room to spare: it moves
    const fresh = planLabels([item("blocker", 200 + plateW + CLEARANCE, 200, { score: 500, name: "Mine" }), item("mine", 200, 200, { w: 300, name: "Mine" })], GRID)[1]!;
    expect(fresh.cand).toBe(SPOT.aboveLeft); // without the memory, the first free position at once
  });
  it("a previous choice that is no longer free is replaced at once", () => {
    const blockerBelow = item("blocker", 200, 232, { score: 500, name: "Under", w: 40, h: 20 });
    const mine = item("mine", 200, 200, { prev: { variant: 0, cand: SPOT.belowLeft, dx: 0, dy: 0 } });
    // the blocker's label (above its box, at y ~ 232 - h) lands on mine's below-left plate
    const plan = planLabels([blockerBelow, mine], GRID);
    expect(plan[1]!.cand).not.toBe(SPOT.belowLeft);
    expect(overlaps(plan[0]!, plan[1]!, CLEARANCE)).toBe(false);
  });
  it("a shortened label is made whole again as soon as there is room, not kept forever", () => {
    const whole = item("a", 200, 200, { name: "Western Europe", chip: chipText(6), prev: { variant: 2, cand: SPOT.aboveLeft, dx: 0, dy: -30 } });
    expect(planLabels([whole], GRID)[0]!.variant).toBe(0);
  });
  it("frame to frame the same input with its own output as the memory gives the same plan (no hopping)", () => {
    const items = Array.from({ length: 30 }, (_, k) => item(`n${k}`, 100 + ((k * 41) % 420), 70 + ((k * 59) % 280), { name: `Somewhere ${k}`, chip: k % 3 ? null : chipText(k), score: 50 + (k % 5) }));
    const first = planLabels(items, GRID);
    const second = planLabels(
      items.map((t, n) => ({ ...t, prev: { variant: first[n]!.variant, cand: first[n]!.cand, dx: first[n]!.x - t.rect.c0, dy: first[n]!.y - t.rect.r0 } })),
      GRID,
    );
    expect(second).toEqual(first);
  });
});

describe("a box is always a target, labelled or not", () => {
  it("a box with no label plate (the target is the box alone) is still picked, at its own opacity", () => {
    const box = { x0: 100, y0: 100, x1: 125, y1: 125 };
    const nameless = { id: 1, box, plate: null, alpha: 1, priority: 50, big: false, slug: "a" };
    expect(pickNode([nameless], 112, 112, "mouse", LOD.pickAlphaMin)).toBe(1);
    expect(pickNode([nameless], 128, 112, "mouse", LOD.pickAlphaMin)).toBe(1); // within the slop
    expect(pickNode([nameless], 140, 112, "mouse", LOD.pickAlphaMin)).toBe(-1);
  });
  it("the hull follows a label that is not above the box: a plate below it is part of the target", () => {
    const box = { x0: 100, y0: 100, x1: 125, y1: 125 };
    const plate = { x0: 100, y0: 125, x1: 190, y1: 150 };
    const t = { id: 2, box, plate, alpha: 1, priority: 50, big: false, slug: "b" };
    expect(pickNode([t], 150, 138, "mouse", LOD.pickAlphaMin)).toBe(2);
  });
});

describe("a label keeps clear of the other nodes' boxes (PlanItem.avoid, boxesToAvoid)", () => {
  const PX = { cols: 1440, rows: 900 };
  const rect = { c0: 600, r0: 400, c1: 623, r1: 423 };
  const variants = labelVariants("Valencia", null).map((v) => v.layout);
  it("the planner takes the first position that touches none of the rectangles it is told to avoid; with none left, the first position of the wording", () => {
    const free = planLabels([{ score: 1, area: 1, key: "p", rect, variants, prev: null }], PX, pxUnits(2.5))[0]!;
    expect(free.cand).toBe(0);
    const avoid = [{ x0: free.x - 5, y0: free.y - 5, x1: free.x + free.w + 5, y1: free.y + free.h + 5 }];
    const moved = planLabels([{ score: 1, area: 1, key: "p", rect, variants, prev: null, avoid }], PX, pxUnits(2.5))[0]!;
    expect(moved.overlap).toBe(false);
    expect(moved.cand).not.toBe(0);
    expect(moved.x < avoid[0]!.x1 && moved.x + moved.w > avoid[0]!.x0 && moved.y < avoid[0]!.y1 && moved.y + moved.h > avoid[0]!.y0).toBe(false);
    // a wall of rectangles all around: no position keeps clear of them, the first one is taken all the same (not a last resort: it is over no plate, and the label is not shortened)
    const wall = [{ x0: 0, y0: 0, x1: 1440, y1: 900 }];
    const walled = planLabels([{ score: 1, area: 1, key: "p", rect, variants, prev: null, avoid: wall }], PX, pxUnits(2.5))[0]!;
    expect(walled.overlap).toBe(false);
    expect(walled.cand).toBe(free.cand);
    expect(walled.variant).toBe(0);
  });
  it("boxesToAvoid: the other boxes within reach of a node's own box, never its own", () => {
    const boxes = [
      { x0: 100, y0: 100, x1: 130, y1: 130 },
      { x0: 160, y0: 100, x1: 190, y1: 130 }, // 30 px to the right
      { x0: 600, y0: 600, x1: 630, y1: 630 }, // far
    ];
    expect(boxesToAvoid(boxes, 0, 50)).toEqual([boxes[1]]);
    expect(boxesToAvoid(boxes, 0, 10)).toEqual([]);
    expect(boxesToAvoid(boxes, 2, 50)).toEqual([]);
    expect(boxesToAvoid(boxes, 1, 1000)).toEqual([boxes[0], boxes[2]]);
  });
});
