import { describe, expect, it } from "vitest";
import { BOX_PAD_CELLS, boxPath, cardPlace, moonBox, scramble } from "./moon-overlay";

describe("cardPlace", () => {
  const W = 412;
  const H = 915;
  const card = { w: 230, h: 110 };
  const box = (x: number, y: number) => ({ x, y, w: 40, h: 40 });

  it("hangs above the box's top-left corner, its text flush with the box's left edge", () => {
    const p = cardPlace(box(100, 400), card.w, card.h, W, H);
    expect(p.side).toBe("above");
    expect(p.x).toBe(100 - 6);
    expect(p.y + card.h).toBeLessThan(400);
  });

  it("goes below the box where there is no room above", () => {
    const p = cardPlace(box(200, 30), card.w, card.h, W, H);
    expect(p.side).toBe("below");
    expect(p.y).toBeGreaterThan(30 + 40);
  });

  it("stays inside the window sideways", () => {
    const right = cardPlace(box(390, 400), card.w, card.h, W, H);
    expect(right.x + card.w).toBeLessThanOrEqual(W - 8);
    const left = cardPlace(box(2, 400), card.w, card.h, W, H);
    expect(left.x).toBeGreaterThanOrEqual(8);
  });
});

describe("moonBox", () => {
  it("is whole cells: the disc's cells and the clear room, whatever the sub-cell position", () => {
    const b = moonBox({ col: 100.3, row: 50.7, rad: 4.2, visible: null, cell: 2.5, left: 0, top: 0 });
    expect(b).toEqual({ c0: 96 - BOX_PAD_CELLS, r0: 46 - BOX_PAD_CELLS, c1: 105 + BOX_PAD_CELLS, r1: 55 + BOX_PAD_CELLS });
    for (const v of Object.values(b)) expect(Number.isInteger(v)).toBe(true);
  });
});

describe("moonBox, occluded", () => {
  it("fits the visible part of the moon, not all of it", () => {
    const whole = moonBox({ col: 100, row: 50, rad: 10, visible: null, cell: 2.5, left: 0, top: 0 });
    const part = moonBox({ col: 100, row: 50, rad: 10, visible: { x0: 90, y0: 40, x1: 100, y1: 60 }, cell: 2.5, left: 0, top: 0 });
    expect(part.c1).toBeLessThan(whole.c1);
    expect(part.c0).toBe(whole.c0);
  });
});

describe("boxPath", () => {
  /** The lit cells of a path of one-cell-thick runs. */
  const cells = (d: string) => {
    const lit = new Set<string>();
    for (const m of d.matchAll(/M(\d+) (\d+)h(-?\d+)v(-?\d+)(?:h-?\d+)?z?/g)) {
      const [x, y, a, b] = [+m[1]!, +m[2]!, +m[3]!, +m[4]!];
      if (m[0].includes("v1h")) for (let i = 0; i < a; i++) lit.add(`${x + i},${y}`);
      else for (let j = 0; j < b; j++) lit.add(`${x},${y + j}`);
    }
    return lit;
  };

  it("has solid corners and gaps between them, on a 16 cell box", () => {
    const lit = cells(boxPath(16, 16));
    for (const [c, r] of [[0, 0], [15, 0], [0, 15], [15, 15], [1, 0], [0, 1], [14, 15], [15, 14]]) expect(lit.has(`${c},${r}`)).toBe(true);
    expect(lit.has("5,5")).toBe(false); // hollow
    expect(lit.size).toBeLessThan(4 * 15); // dashed, not a closed line
  });

  it("never lights a cell outside the box", () => {
    for (const c of cells(boxPath(16, 18))) {
      const [x, y] = c.split(",").map(Number);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(16);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(18);
    }
  });
});

describe("scramble", () => {
  const text = "Take a trip back";
  const rand = () => 0.5;

  it("keeps the length and the spaces, so the words wrap where the real ones do", () => {
    const out = scramble(text, 0, rand);
    expect(out).toHaveLength(text.length);
    expect([...out].map((c) => c === " ")).toEqual([...text].map((c) => c === " "));
    expect(out).not.toBe(text);
  });

  it("clears from the start as it is revealed, and is the text itself at 1", () => {
    const half = scramble(text, 0.5, rand);
    expect(half.slice(0, 8)).toBe(text.slice(0, 8));
    expect(half.slice(8)).not.toBe(text.slice(8));
    expect(scramble(text, 1, rand)).toBe(text);
  });
});
