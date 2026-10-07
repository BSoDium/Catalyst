import { describe, expect, it } from "vitest";
import { GROUP_HIT, boxHit, boxHitDistance, outlineDistance, snapBox } from "./group-square";

describe("box cells", () => {
  it("the cells that contain the bounds, whole cells", () => {
    const r = snapBox(10, 20, 100, 80, 3);
    expect(r).toEqual({ c0: 3, r0: 6, c1: 34, r1: 27 });
    expect(r.c0 * 3).toBeLessThanOrEqual(10);
    expect(r.c1 * 3).toBeGreaterThanOrEqual(100);
  });
  it("at least 3 cells across, kept centred on the bounds", () => {
    const t = snapBox(100, 100, 101, 101, 3);
    expect(t.c1 - t.c0).toBe(3);
    expect(Math.abs((t.c0 + t.c1) / 2 - 100.5 / 3)).toBeLessThanOrEqual(1);
  });
  it("works at 2 px and 2.5 px cells", () => {
    for (const cell of [2, 2.5, 3]) {
      const r = snapBox(17.3, 9.9, 150.2, 60.1, cell);
      expect(r.c0 * cell).toBeLessThanOrEqual(17.3);
      expect(r.c1 * cell).toBeGreaterThanOrEqual(150.2);
      expect(Number.isInteger(r.c0) && Number.isInteger(r.r1)).toBe(true);
    }
  });
});

describe("hit area: the border band and the tab, never the interior", () => {
  const box = { x0: 100, y0: 100, x1: 400, y1: 300 };
  it("distance to the outline", () => {
    expect(outlineDistance(100, 200, 100, 100, 400, 300)).toBe(0);
    expect(outlineDistance(150, 200, 100, 100, 400, 300)).toBe(50);
    expect(outlineDistance(90, 200, 100, 100, 400, 300)).toBe(10);
  });
  it("the band is a hit, the interior is not, outside beyond the band is not", () => {
    expect(boxHit(100, 200, box, null, "mouse")).toBe(true);
    expect(boxHit(100 + GROUP_HIT.mouse.band, 200, box, null, "mouse")).toBe(true);
    expect(boxHit(100 + GROUP_HIT.mouse.band + 1, 200, box, null, "mouse")).toBe(false);
    expect(boxHitDistance(250, 200, box, null, "mouse")).toBe(Infinity);
    expect(boxHit(100 - GROUP_HIT.mouse.band - 2, 200, box, null, "mouse")).toBe(false);
  });
  it("a box inside a box stays clickable: the centre of the outer box is not a hit", () => {
    expect(boxHit(250, 200, box, null, "touch")).toBe(false);
  });
  it("the tab is a hit", () => {
    const tab = { x0: 100, y0: 70, x1: 160, y1: 100 };
    expect(boxHit(130, 85, box, tab, "mouse")).toBe(true);
    expect(boxHit(250, 85, box, tab, "mouse")).toBe(false);
  });
  it("touch bands are wider than mouse bands", () => {
    expect(GROUP_HIT.touch.band).toBeGreaterThan(GROUP_HIT.mouse.band);
  });
});
