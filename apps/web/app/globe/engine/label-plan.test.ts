import { describe, expect, it } from "vitest";
import { pickNode } from "./hit-area";
import { planLabels, type PlanItem } from "./label-plan";
import { LOD } from "./lod-tree";

const item = (key: string, x: number, y: number, extra: Partial<PlanItem> = {}): PlanItem => ({ forced: false, score: 80, plate: { x0: x, y0: y, x1: x + 40, y1: y + 10 }, key, held: false, parented: false, ...extra });

describe("which labels are drawn (regression: Houston and New York on the world view)", () => {
  it("an isolated place is labelled however low its priority: there is no zoom-dependent floor", () => {
    const plan = planLabels([item("houston", 100, 100, { score: 80 }), item("new-york", 200, 80, { score: 80 }), item("tiny", 300, 300, { score: -20 })]);
    expect(plan).toEqual([
      { labelled: true, dimmed: false },
      { labelled: true, dimmed: false },
      { labelled: true, dimmed: false },
    ]);
  });
  it("two plates that would overlap: the better one is labelled, the other is not", () => {
    const plan = planLabels([item("a", 100, 100, { score: 80 }), item("b", 120, 104, { score: 120 })]);
    expect(plan[1]).toEqual({ labelled: true, dimmed: false });
    expect(plan[0]!.labelled).toBe(false);
  });
  it("a plate a cell away still collides (one cell of clearance), two cells away does not", () => {
    expect(planLabels([item("a", 100, 100), item("b", 141, 100, { score: 10 })])[1]!.labelled).toBe(false);
    expect(planLabels([item("a", 100, 100), item("b", 142, 100, { score: 10 })])[1]!.labelled).toBe(true);
  });
  it("the hovered, focused or selected node is always labelled, ahead of the others", () => {
    const plan = planLabels([item("a", 100, 100, { score: 500 }), item("b", 110, 100, { forced: true, score: 1000 })]);
    expect(plan[1]!.labelled).toBe(true);
    expect(plan[0]!.labelled).toBe(false);
  });
  it("the order of the nodes does not change the result", () => {
    const a = item("a", 100, 100, { score: 80 });
    const b = item("b", 110, 100, { score: 80 });
    const one = planLabels([a, b]);
    const two = planLabels([b, a]);
    expect(one[0]!.labelled).toBe(two[1]!.labelled);
    expect(one[1]!.labelled).toBe(two[0]!.labelled);
  });
  it("hysteresis: a label that is drawn keeps its place against a challenger up to `labelHold` better, not against a much better one", () => {
    const hold = LOD.labelHold;
    const near = planLabels([item("a", 100, 100, { score: 80, held: true }), item("b", 110, 100, { score: 80 + hold - 1 })]);
    expect(near.map((p) => p.labelled)).toEqual([true, false]);
    const far = planLabels([item("a", 100, 100, { score: 80, held: true }), item("b", 110, 100, { score: 80 + hold + 1 })]);
    expect(far.map((p) => p.labelled)).toEqual([false, true]);
    // and it does not depend on a camera: the same input, the same answer
    expect(planLabels([item("a", 100, 100, { score: 80, held: true }), item("b", 110, 100, { score: 80 + hold - 1 })])).toEqual(near);
  });
});

describe("the dim of a box that lost its label is binary and needs a drawn group above it", () => {
  it("a loser with no drawn ancestor is NOT dimmed (regression: London at low opacity while its parent group was not drawn)", () => {
    const plan = planLabels([item("paris", 100, 100, { score: 120 }), item("london", 105, 100, { score: 80, parented: false })]);
    expect(plan[1]).toEqual({ labelled: false, dimmed: false });
  });
  it("a loser inside a drawn group is dimmed", () => {
    const plan = planLabels([item("a", 100, 100, { score: 120, parented: true }), item("b", 105, 100, { score: 80, parented: true })]);
    expect(plan[1]).toEqual({ labelled: false, dimmed: true });
    expect(plan[0]).toEqual({ labelled: true, dimmed: false });
  });
  it("a labelled node is never dimmed, parented or not", () => {
    expect(planLabels([item("a", 100, 100, { parented: true })])[0]).toEqual({ labelled: true, dimmed: false });
  });
  it("a dimmed or nameless box is still clickable: its target is the box alone, and it is picked at its own opacity", () => {
    const box = { x0: 100, y0: 100, x1: 125, y1: 125 };
    const nameless = { id: 1, box, plate: null, alpha: 1, priority: 50, big: false, slug: "a" };
    expect(pickNode([nameless], 112, 112, "mouse", LOD.pickAlphaMin)).toBe(1);
    expect(pickNode([nameless], 128, 112, "mouse", LOD.pickAlphaMin)).toBe(1); // within the slop
    expect(pickNode([nameless], 140, 112, "mouse", LOD.pickAlphaMin)).toBe(-1);
  });
});
