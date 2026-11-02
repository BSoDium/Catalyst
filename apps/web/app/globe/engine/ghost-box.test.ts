import { describe, expect, it } from "vitest";
import { ghostCells } from "./ghost-box";

const CELL = 2.5;
const ghost = (cx: number, cy: number, w: number, h: number) => ({ i: 0, x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2, alpha: 1 });

describe("ghost boxes as cells (#509)", () => {
  it("a box of three cells or more a side is its true box, rounded outwards", () => {
    const [g] = ghostCells([ghost(100, 100, 20, 12.5)], CELL, 400, 300);
    expect(g!.rect).toEqual({ c0: 36, r0: 37, c1: 44, r1: 43 });
    expect(g!.alpha).toBe(1);
  });

  it("a box under three cells on either side is not drawn (no dots)", () => {
    expect(ghostCells([ghost(100, 100, 2, 2), ghost(100, 100, 30, 3), ghost(100, 100, 7, 7)], CELL, 400, 300)).toEqual([]);
    expect(ghostCells([ghost(100, 100, 7.5, 7.5)], CELL, 400, 300)).toHaveLength(1);
  });

  it("leaves out what is off the grid and what is as big as the screen", () => {
    expect(ghostCells([ghost(-100, 100, 20, 20), ghost(100, 5000, 20, 20), ghost(100, 100, 5000, 5000)], CELL, 400, 300)).toEqual([]);
  });
});
