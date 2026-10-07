import { describe, expect, it } from "vitest";
import { labelPriorityFloor, placeLabels, snapToCell, type Candidate, type Side } from "./label-place";

const vp = { w: 800, h: 600 };
const c = (id: string, x: number, y: number, priority = 1, extra: Partial<Candidate> = {}): Candidate => ({ id, x, y, w: 80, h: 16, priority, ...extra });

describe("placeLabels", () => {
  it("puts a lone label up and right of its anchor", () => {
    const [p] = placeLabels([c("a", 400, 300)], vp);
    expect(p!.side).toBe("ne");
    expect(p!.left).toBeGreaterThan(400);
    expect(p!.top).toBeLessThan(300);
  });
  it("falls back to another side near the viewport edge", () => {
    const [p] = placeLabels([c("a", 790, 300)], vp);
    expect(p!.left + 80).toBeLessThanOrEqual(796);
    expect(p!.left).toBeLessThan(790);
  });
  it("drops the lower-priority label of two that cannot both fit; forced ones are always shown, first", () => {
    const out = placeLabels([c("hi", 400, 300, 9), c("lo", 405, 302, 1)], vp, { gap: 22 });
    expect(out.map((o) => o.id)).toContain("hi");
    const pinned = placeLabels([c("hi", 400, 300, 9), c("pin", 405, 302, 0, { forced: true })], vp);
    expect(pinned.map((o) => o.id)).toEqual(expect.arrayContaining(["hi", "pin"]));
    expect(pinned[0]!.id).toBe("pin");
  });
  it("shows a forced label even in a corner where nothing fits", () => {
    const [p] = placeLabels([c("f", 2, 2, 0, { forced: true })], vp);
    expect(p!.id).toBe("f");
  });
  it("never overlaps placed labels, and never covers another marker", () => {
    const cands = Array.from({ length: 60 }, (_, i) => c(`p${i}`, 60 + (i % 8) * 90, 80 + Math.floor(i / 8) * 70, i));
    const out = placeLabels(cands, vp);
    expect(out.length).toBeGreaterThan(10);
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]!, b = out[j]!;
        expect(a.left + 80 <= b.left || b.left + 80 <= a.left || a.top + 16 <= b.top || b.top + 16 <= a.top).toBe(true);
      }
      for (const m of cands) {
        if (m.id === out[i]!.id) continue;
        const o = out[i]!;
        const hit = m.x > o.left && m.x < o.left + 80 && m.y > o.top && m.y < o.top + 16;
        expect(hit, `${o.id} covers marker ${m.id}`).toBe(false);
      }
    }
  });
  it("is deterministic and independent of input order", () => {
    const cands = [c("a", 100, 100, 1), c("b", 120, 110, 1), c("c", 500, 400, 5)];
    expect(placeLabels(cands, vp)).toEqual(placeLabels([...cands].reverse(), vp));
  });
  it("keeps the previous side while it still fits, and favours labels that were shown (no flicker)", () => {
    const previous = new Map<string, Side>([["a", "sw"]]);
    const [p] = placeLabels([c("a", 400, 300)], vp, { previous });
    expect(p!.side).toBe("sw");
    // two equal-priority labels competing for the same spot: the one shown last time keeps it
    const rival = [c("a", 400, 300, 5), c("b", 410, 304, 5)];
    expect(placeLabels(rival, vp, { previous: new Map([["b", "ne"]]) })[0]!.id).toBe("b");
    expect(placeLabels(rival, vp)[0]!.id).toBe("a");
  });
});

describe("obstacles", () => {
  it("a marker without a label still keeps other labels off it", () => {
    const out = placeLabels([c("a", 400, 300, 5)], vp, { obstacles: [{ id: "x", x: 422, y: 278 }] });
    const p = out[0]!;
    expect(p.side).not.toBe("ne");
  });
});

describe("snapToCell", () => {
  it("lands on cell centres", () => {
    expect(snapToCell(10, 3)).toBe(10.5);
    expect(snapToCell(9, 3)).toBe(10.5);
    expect(snapToCell(8.99, 3)).toBe(7.5);
  });
});

describe("labelPriorityFloor", () => {
  it("falls linearly from 60 to 0 over the zoom range", () => {
    expect(labelPriorityFloor(2, 2, 8)).toBe(60);
    expect(labelPriorityFloor(5, 2, 8)).toBe(30);
    expect(labelPriorityFloor(9, 2, 8)).toBe(0);
  });
});
