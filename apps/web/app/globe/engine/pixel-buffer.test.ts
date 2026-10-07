import { describe, expect, it } from "vitest";
import { CLEAR, MIXED, PixelBuffer } from "./pixel-buffer";

const RAMP = [
  [0, 0, 0],
  [0.2, 0.2, 0.2],
  [1, 1, 1],
] as const;

describe("PixelBuffer", () => {
  it("starts transparent, clips, and tracks the dirty box", () => {
    const b = new PixelBuffer(10, 6);
    expect(b.count()).toBe(0);
    expect(b.dirty).toBe(false);
    b.set(-1, 0, 3);
    b.set(10, 0, 3);
    b.set(3, 2, 5);
    b.set(6, 4, 7);
    expect(b.count()).toBe(2);
    expect([b.minX, b.maxX, b.minY, b.maxY]).toEqual([3, 6, 2, 4]);
    b.clearDirty();
    expect(b.count()).toBe(0);
  });
  it("a rectangle outline is one cell thick and a dotted one lights every other cell", () => {
    const b = new PixelBuffer(8, 6);
    b.strokeRect(1, 1, 6, 4, 4);
    expect(b.dump()).toEqual(["........", ".444444.", ".4....4.", ".4....4.", ".444444.", "........"]);
    const d = new PixelBuffer(8, 6);
    d.strokeRect(0, 0, 7, 5, 2, true);
    expect(d.get(0, 0)).toBe(2);
    expect(d.get(1, 0)).toBe(CLEAR);
    expect(d.get(2, 0)).toBe(2);
  });
  it("a line includes both ends and is 8-connected, one cell per step on the major axis", () => {
    for (const [x0, y0, x1, y1] of [[0, 0, 9, 3], [9, 3, 0, 0], [2, 8, 2, 1], [0, 5, 11, 5], [3, 1, 8, 9]] as const) {
      const b = new PixelBuffer(14, 12);
      b.line(x0, y0, x1, y1, 1);
      expect(b.get(x0, y0)).toBe(1);
      expect(b.get(x1, y1)).toBe(1);
      expect(b.count()).toBe(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) + 1);
    }
  });
  it("fills and clears only the dirty box", () => {
    const b = new PixelBuffer(20, 10);
    b.fillRect(2, 2, 5, 3, 6);
    expect(b.count()).toBe(15);
    b.clearDirty();
    b.resetDirty();
    b.set(0, 0, 1);
    b.clearDirty();
    expect(b.count()).toBe(0);
  });
  it("text lands on whole cells at the baseline and only in the given level", () => {
    const b = new PixelBuffer(30, 12);
    b.text("Hi", 2, 8, 9);
    const seen = new Set<number>();
    for (let y = 0; y < 12; y++) for (let x = 0; x < 30; x++) seen.add(b.get(x, y));
    expect([...seen].sort((p, q) => p - q)).toEqual([9, CLEAR]);
    expect(b.get(2, 7)).toBe(9); // the foot of the H stem is the row above the baseline row
    expect(b.get(2, 1)).toBe(9); // top of the H: 7 rows
    expect(b.get(2, 0)).toBe(CLEAR);
  });
  it("bold text is the regular one double struck: a 2-cell stem, each cell written once", () => {
    const regular = new PixelBuffer(30, 12);
    const bold = new PixelBuffer(30, 12);
    regular.text("H", 2, 8, 9);
    bold.text("H", 2, 8, 9, 1, true);
    for (let y = 0; y < 12; y++) for (let x = 0; x < 30; x++) if (regular.get(x, y) === 9) expect(bold.get(x, y), `${x},${y}`).toBe(9);
    expect(bold.get(2, 7)).toBe(9);
    expect(bold.get(3, 7)).toBe(9); // the stem is 2 cells
    expect(bold.count()).toBeGreaterThan(regular.count());
    // translucent bold: no cell is written twice (it would come out more opaque than its neighbours)
    const faint = new PixelBuffer(30, 12);
    faint.text("Hà Nội", 1, 8, 9, 0.4, true);
    for (let y = 0; y < 12; y++) for (let x = 0; x < 30; x++) if (faint.get(x, y) !== CLEAR) expect(faint.alphaAt(x, y)).toBeCloseTo(0.4, 2);
  });
});

describe("opacity: alpha-blended per art cell, over what the buffer holds", () => {
  it("an opaque write replaces, a translucent one on an empty cell keeps its own opacity and colour", () => {
    const b = new PixelBuffer(4, 1);
    b.setRamp(RAMP);
    b.set(0, 0, 2);
    b.set(1, 0, 2, 0.25);
    expect(b.get(0, 0)).toBe(2);
    expect(b.alphaAt(0, 0)).toBe(1);
    expect(b.get(1, 0)).toBe(2);
    expect(b.alphaAt(1, 0)).toBeCloseTo(0.25, 2);
    expect(b.get(2, 0)).toBe(CLEAR);
  });
  it("zero opacity writes nothing", () => {
    const b = new PixelBuffer(2, 1);
    b.set(0, 0, 2, 0);
    b.fillRect(0, 0, 2, 1, 2, 0);
    expect(b.count()).toBe(0);
    expect(b.dirty).toBe(false);
  });
  it("a translucent mark over an opaque one is the straight 'over' blend: the cell stays opaque and its colour is the mix", () => {
    const b = new PixelBuffer(1, 1);
    b.setRamp(RAMP);
    b.set(0, 0, 0); // black
    b.set(0, 0, 2, 0.5); // white at 50 %
    expect(b.alphaAt(0, 0)).toBe(1);
    expect(b.get(0, 0)).toBe(MIXED);
    const rgb = b.data[0]! & 0xff; // grey 128 = half way
    expect(rgb).toBeGreaterThanOrEqual(127);
    expect(rgb).toBeLessThanOrEqual(129);
  });
  it("two translucent marks compose to 1 - (1 - a)(1 - b) opacity, so fading nodes stack like layers", () => {
    const b = new PixelBuffer(1, 1);
    b.setRamp(RAMP);
    b.set(0, 0, 2, 0.5);
    b.set(0, 0, 2, 0.5);
    expect(b.alphaAt(0, 0)).toBeCloseTo(0.75, 2);
    expect(b.get(0, 0)).toBe(2); // same level: still exactly that level
  });
  it("what a theme ramp says is what is stored: levels are looked up in the ramp", () => {
    const b = new PixelBuffer(2, 1);
    b.setRamp(RAMP);
    b.set(0, 0, 1);
    expect(b.data[0]! & 0xff).toBe(51); // 0.2 * 255
    expect(b.get(0, 0)).toBe(1);
  });
});
