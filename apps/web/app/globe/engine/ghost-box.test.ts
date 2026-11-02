import { describe, expect, it } from "vitest";
import { ghostCells } from "./ghost-box";

const CELL = 2.5;
const ghost = (cx: number, cy: number, w: number, h: number) => ({ i: 0, x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2, alpha: 1 });

describe("ghost boxes as cells (#509)", () => {
  it("a box of three cells or more a side is its true box, rounded outwards, an outline", () => {
    const [g] = ghostCells([ghost(100, 100, 20, 12.5)], CELL, 400, 300);
    expect(g!.dot).toBe(false);
    expect(g!.rect).toEqual({ c0: 36, r0: 37, c1: 44, r1: 43 });
  });

  it("a smaller one is a solid dot of its real size: one cell under a cell and a half, two over, centred where it is", () => {
    const [tiny, small] = ghostCells([ghost(100, 100, 2, 2), ghost(100, 100, 5, 4)], CELL, 400, 300);
    expect(tiny!.dot).toBe(true);
    expect(tiny!.rect.c1 - tiny!.rect.c0).toBe(1);
    expect(tiny!.rect.r1 - tiny!.rect.r0).toBe(1);
    expect(small!.dot).toBe(true);
    expect(small!.rect.c1 - small!.rect.c0).toBe(2);
    expect(small!.rect.r1 - small!.rect.r0).toBe(2);
    expect(Math.abs((tiny!.rect.c0 + tiny!.rect.c1) / 2 - 100 / CELL)).toBeLessThanOrEqual(0.5);
  });

  it("a box that is wide and short is a rectangle of its own proportions, not a square", () => {
    const [g] = ghostCells([ghost(100, 100, 30, 3)], CELL, 400, 300);
    expect(g!.dot).toBe(true);
    expect(g!.rect.c1 - g!.rect.c0).toBe(12);
    expect(g!.rect.r1 - g!.rect.r0).toBe(1);
  });

  it("leaves out what is off the grid and what is as big as the screen", () => {
    expect(ghostCells([ghost(-100, 100, 20, 20), ghost(100, 5000, 20, 20), ghost(100, 100, 5000, 5000)], CELL, 400, 300)).toEqual([]);
  });
});
