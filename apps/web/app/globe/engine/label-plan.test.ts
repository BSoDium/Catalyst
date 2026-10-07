import { describe, expect, it } from "vitest";
import { pickNode } from "./hit-area";
import { labelInvariant, planLabels, type PlanItem } from "./label-plan";
import { LOD } from "./lod-tree";

const item = (key: string, x: number, y: number, extra: Partial<PlanItem> = {}): PlanItem => ({ alpha: 1, forced: false, score: 80, plate: { x0: x, y0: y, x1: x + 40, y1: y + 10 }, key, ...extra });

describe("which labels are drawn (regression: Houston and New York on the world view)", () => {
  it("an isolated place is labelled however low its priority: there is no zoom-dependent floor", () => {
    // Two lone places with the default priority 50 (score 80 with the place bonus), nothing near them: both have their name.
    const plan = planLabels([item("houston", 100, 100, { score: 80 }), item("new-york", 200, 80, { score: 80 }), item("tiny", 300, 300, { score: -20 })]);
    expect(plan.map((p) => p.labelled)).toEqual([true, true, true]);
    expect(plan.every((p) => !p.dimmed && p.alpha === 1)).toBe(true);
  });
  it("two plates that would overlap: the better one is labelled, the other is dimmed, never a nameless full-opacity box", () => {
    const plan = planLabels([item("a", 100, 100, { score: 80 }), item("b", 120, 104, { score: 120 })]);
    expect(plan[1]).toEqual({ labelled: true, dimmed: false, alpha: 1 });
    expect(plan[0]!.labelled).toBe(false);
    expect(plan[0]!.dimmed).toBe(true);
    expect(plan[0]!.alpha).toBeLessThanOrEqual(LOD.unlabelledAlpha);
    expect(labelInvariant(plan)).toBe(true);
  });
  it("a plate a cell away still collides (one cell of clearance), two cells away does not", () => {
    expect(planLabels([item("a", 100, 100), item("b", 141, 100, { score: 10 })])[1]!.labelled).toBe(false);
    expect(planLabels([item("a", 100, 100), item("b", 142, 100, { score: 10 })])[1]!.labelled).toBe(true);
  });
  it("the hovered, focused or selected node is always labelled, ahead of the others", () => {
    const plan = planLabels([item("a", 100, 100, { score: 500 }), item("b", 110, 100, { forced: true, score: 1000 })]);
    expect(plan[1]!.labelled).toBe(true);
    expect(plan[0]!.dimmed).toBe(true);
  });
  it("the order of the nodes does not change the result", () => {
    const a = item("a", 100, 100, { score: 80 });
    const b = item("b", 110, 100, { score: 80 });
    const one = planLabels([a, b]);
    const two = planLabels([b, a]);
    expect(one[0]!.labelled).toBe(two[1]!.labelled);
    expect(one[1]!.labelled).toBe(two[0]!.labelled);
  });
  it("a node that is already faint keeps its own opacity when it loses a label (no jump up)", () => {
    const plan = planLabels([item("a", 100, 100, { score: 120 }), item("b", 105, 100, { alpha: 0.2, score: 80 })]);
    expect(plan[1]!.alpha).toBe(0.2);
  });
  it("a node too faint to draw is neither labelled nor dimmed", () => {
    const plan = planLabels([item("a", 100, 100, { alpha: LOD.labelAlphaMin / 2 })]);
    expect(plan[0]).toEqual({ labelled: false, dimmed: false, alpha: LOD.labelAlphaMin / 2 });
    expect(labelInvariant(plan)).toBe(true);
  });
  it("a dimmed box is still clickable: its target is the box alone, and it is picked at its own opacity", () => {
    const box = { x0: 100, y0: 100, x1: 125, y1: 125 };
    const dimmed = { id: 1, box, plate: null, alpha: 1, priority: 50, big: false, slug: "a" };
    expect(pickNode([dimmed], 112, 112, "mouse", LOD.pickAlphaMin)).toBe(1);
    expect(pickNode([dimmed], 128, 112, "mouse", LOD.pickAlphaMin)).toBe(1); // within the slop
    expect(pickNode([dimmed], 140, 112, "mouse", LOD.pickAlphaMin)).toBe(-1);
  });
});
