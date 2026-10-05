import { describe, expect, it } from "vitest";
import { placeLabels, snapToCell } from "./labelPlace";

const vp = { w: 800, h: 600 };
const c = (id: string, x: number, y: number, priority = 1, extra = {}) => ({ id, x, y, w: 80, h: 16, priority, ...extra });

describe("placeLabels", () => {
  it("puts a lone label up and right of its anchor", () => {
    const [p] = placeLabels([c("a", 400, 300)], vp);
    expect(p!.left).toBeGreaterThan(400);
    expect(p!.top).toBeLessThan(300);
  });
  it("falls back to another side near the viewport edge", () => {
    const [p] = placeLabels([c("a", 790, 300)], vp);
    expect(p!.left + 80).toBeLessThanOrEqual(796);
    expect(p!.left).toBeLessThan(790);
  });
  it("drops the lower-priority label of two that cannot both fit, keeps pinned ones", () => {
    const out = placeLabels([c("hi", 400, 300, 9), c("lo", 405, 302, 1)], vp, { gap: 22 });
    expect(out.map((o) => o.id)).toContain("hi");
    const pinned = placeLabels([c("hi", 400, 300, 9), c("pin", 405, 302, 0, { pinned: true })], vp);
    expect(pinned.map((o) => o.id)).toEqual(expect.arrayContaining(["hi", "pin"]));
    expect(pinned[0]!.id).toBe("pin");
  });
  it("never overlaps placed labels", () => {
    const cands = Array.from({ length: 40 }, (_, i) => c(`p${i}`, 60 + (i % 8) * 90, 80 + Math.floor(i / 8) * 90, i));
    const out = placeLabels(cands, vp);
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]!, b = out[j]!;
        const sep = a.left + 80 <= b.left || b.left + 80 <= a.left || a.top + 16 <= b.top || b.top + 16 <= a.top;
        expect(sep).toBe(true);
      }
  });
  it("is deterministic", () => {
    const cands = [c("a", 100, 100, 1), c("b", 120, 110, 1), c("c", 500, 400, 5)];
    expect(placeLabels(cands, vp)).toEqual(placeLabels([...cands].reverse(), vp));
  });
});

describe("snapToCell", () => {
  it("lands on cell centres", () => {
    expect(snapToCell(10, 3)).toBe(10.5);
    expect(snapToCell(9, 3)).toBe(10.5);
    expect(snapToCell(8.99, 3)).toBe(7.5);
  });
});
