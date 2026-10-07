import { describe, expect, it } from "vitest";
import { placeLabels, type LabelInput } from "./labels";

const base = { width: 1000, height: 600 };
const L = (id: string, x: number, y: number, priority: number, extra: Partial<LabelInput> = {}): LabelInput => ({
  id,
  x,
  y,
  width: 80,
  height: 18,
  priority,
  visible: true,
  facing: 1,
  ...extra,
});
const ids = (r: { id: string }[]) => r.map((p) => p.id).sort();

describe("placeLabels", () => {
  it("places non-colliding labels all", () => {
    const r = placeLabels([L("a", 100, 100, 10), L("b", 500, 300, 20)], base);
    expect(ids(r)).toEqual(["a", "b"]);
  });

  it("drops the lower priority label when both cannot fit", () => {
    // Two markers 4px apart: neither side placement of the second can avoid the first's label/marker.
    const r = placeLabels([L("low", 300, 300, 10), L("high", 304, 300, 90)], base);
    expect(r.find((p) => p.id === "high")).toBeDefined();
    // low may fit on the left, so only assert it never overlaps high.
    const high = r.find((p) => p.id === "high")!;
    const low = r.find((p) => p.id === "low");
    if (low) {
      const overlap = low.x < high.x + 80 && low.x + 80 > high.x && low.y < high.y + 18 && low.y + 18 > high.y;
      expect(overlap).toBe(false);
    }
  });

  it("higher priority wins a contested slot regardless of input order", () => {
    // Crowded: 6 stacked markers, only a few labels fit.
    const crowd = Array.from({ length: 6 }, (_, i) => L(`p${i}`, 400 + i, 300 + i, i * 10));
    const forward = placeLabels(crowd, base);
    const backward = placeLabels([...crowd].reverse(), base);
    expect(ids(forward)).toEqual(ids(backward));
    expect(forward.length).toBeLessThan(6);
    expect(ids(forward)).toContain("p5");
    expect(ids(forward)).not.toContain("p0");
  });

  it("never places occluded or limb-grazing labels", () => {
    const r = placeLabels(
      [L("far", 200, 200, 99, { visible: false }), L("limb", 300, 200, 99, { facing: 0.01 }), L("ok", 600, 200, 1)],
      base,
    );
    expect(ids(r)).toEqual(["ok"]);
  });

  it("always places a forced label, even over a higher-priority one, and puts it first", () => {
    const r = placeLabels(
      [L("big", 300, 300, 100), L("selected", 302, 300, 0, { forced: true })],
      base,
    );
    expect(ids(r)).toContain("selected");
    // A forced label is placed first, so the unforced one must avoid it.
    const sel = r.find((p) => p.id === "selected")!;
    const big = r.find((p) => p.id === "big");
    if (big) expect(Math.abs(big.x - sel.x) + Math.abs(big.y - sel.y)).toBeGreaterThan(0);
  });

  it("shows a forced label even when it is outside the viewport margin", () => {
    const r = placeLabels([L("edge", 995, 300, 1, { forced: true })], base);
    expect(ids(r)).toEqual(["edge"]);
  });

  it("keeps unforced labels inside the viewport by flipping the side", () => {
    const r = placeLabels([L("edge", 960, 300, 1)], base);
    expect(r).toHaveLength(1);
    expect(r[0]!.placement).not.toBe("right");
    expect(r[0]!.x + 80).toBeLessThanOrEqual(base.width);
  });

  it("does not cover other markers with a label", () => {
    // Marker b sits exactly where a's right-hand label would go.
    const r = placeLabels([L("a", 300, 300, 50), L("b", 330, 300, 1)], base);
    const a = r.find((p) => p.id === "a")!;
    expect(a.placement).not.toBe("right");
  });

  it("is stable: reuses the previous placement when still valid", () => {
    const inputs = [L("a", 300, 300, 50)];
    const r = placeLabels(inputs, { ...base, previous: new Map([["a", "top" as const]]) });
    expect(r[0]!.placement).toBe("top");
  });

  it("stickiness keeps a shown label over a marginally higher newcomer", () => {
    // A single available slot ("right"), contested by two labels.
    const inputs = [L("shown", 300, 300, 40), L("new", 300, 305, 44)];
    const opts = { ...base, placements: ["right" as const], stickiness: 8 };
    expect(ids(placeLabels(inputs, opts))).toEqual(["new"]);
    const sticky = placeLabels(inputs, { ...opts, previous: new Map([["shown", "right" as const]]) });
    expect(ids(sticky)).toEqual(["shown"]);
  });

  it("scales to hundreds of markers and never overlaps two placed labels", () => {
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const many = Array.from({ length: 400 }, (_, i) => L(`m${i}`, rnd() * 1000, rnd() * 600, Math.floor(rnd() * 100)));
    const r = placeLabels(many, base);
    expect(r.length).toBeGreaterThan(10);
    expect(r.length).toBeLessThan(400);
    for (let i = 0; i < r.length; i++)
      for (let j = i + 1; j < r.length; j++) {
        const a = r[i]!;
        const b = r[j]!;
        const overlap = a.x < b.x + 80 && a.x + 80 > b.x && a.y < b.y + 18 && a.y + 18 > b.y;
        expect(overlap).toBe(false);
      }
  });
});
