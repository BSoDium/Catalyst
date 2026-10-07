import { describe, expect, it } from "vitest";
import { CLEAR, MIXED, PixelBuffer } from "./pixel-buffer";
import { ALPHA_STEPS, CORNER_ARM, LABEL_PAD, TEXT_GAP, chipText, drawBox, edgeLit, drawLabel, labelCell, labelLayout, labelTones, quantAlpha } from "./pixel-labels";
import { measureText } from "./pixel-font/pixel-font";

const T = labelTones(12);
/** A theme-like ramp: dark page, light ink, 12 distinct levels. */
const RAMP = Array.from({ length: 12 }, (_, k) => [k / 11, k / 11, k / 11] as const);

describe("label geometry (whole cells)", () => {
  it("a place's plate is the bold name plus a cell of room on each side, no outline", () => {
    const m = measureText("Paris", true);
    const t = labelLayout("Paris", null);
    expect(t.w).toBe(m.w + 2 * LABEL_PAD);
    expect(t.chipW).toBe(0);
    expect(t.h).toBeGreaterThanOrEqual(m.top + m.bottom + 2 * LABEL_PAD);
    expect(t.baseline).toBe(LABEL_PAD + m.top);
    expect(Number.isInteger(t.w) && Number.isInteger(t.h)).toBe(true);
  });
  it("the name is bold: wider than the regular weight, by one cell per letter", () => {
    expect(measureText("Paris", true).w).toBe(measureText("Paris").w + 5);
    expect(labelLayout("Paris", null).textW).toBe(measureText("Paris", true).w);
  });
  it("a group's counter is a separate regular-weight run, TEXT_GAP cells after the name, and the plate is as high as the name's", () => {
    const text = "Germany";
    const chip = chipText(10);
    const t = labelLayout(text, chip);
    expect(chip).toBe("10 entries");
    expect(t.chipX).toBe(measureText(text, true).w + TEXT_GAP);
    expect(t.chipW).toBe(measureText(chip).w); // regular weight, not bold
    expect(t.w).toBe(t.chipX + t.chipW + 2 * LABEL_PAD);
    expect(t.h).toBe(labelLayout(text, null).h);
    expect(TEXT_GAP).toBeGreaterThanOrEqual(4); // the two runs read as separate blocks
  });
  it("a longer counter (publication types and other stats later) only grows the plate to the right", () => {
    const short = labelLayout("Germany", chipText(10));
    const long = labelLayout("Germany", "10 entries, 3 articles, 2 projects");
    expect(long.chipX).toBe(short.chipX);
    expect(long.w).toBeGreaterThan(short.w);
    expect(long.h).toBe(short.h);
  });
  it("singular and plural", () => {
    expect(chipText(1)).toBe("1 entry");
    expect(chipText(2)).toBe("2 entries");
    expect(chipText(146)).toBe("146 entries");
  });
  it("the name is drawn as written: lowercase stays lowercase", () => {
    expect(measureText("minimum", true).w).toBeLessThanOrEqual(measureText("MINIMUM", true).w);
  });
  it("sits just above the box's top edge, on its left edge; inside the box when it would leave the top of the grid", () => {
    const rect = { c0: 10, r0: 30, c1: 40, r1: 50 };
    const at = labelCell(rect, 9);
    expect(at).toEqual({ col: 10, row: 21, inside: false });
    expect(at.row + 9).toBe(rect.r0); // the plate's last row is the row above the edge
    expect(labelCell({ c0: 5, r0: 3, c1: 30, r1: 30 }, 9)).toEqual({ col: 5, row: 4, inside: true });
  });
});

describe("boxes: full ink outline, opacity for fades", () => {
  const rect = { c0: 1, r0: 1, c1: 8, r1: 6 };
  it("a hollow box is a one-cell outline in the full ink, nothing inside", () => {
    const b = new PixelBuffer(10, 8);
    drawBox(b, rect, T, { alpha: 1, fillAlpha: 0, solid: true });
    const k = T.ink.toString(36);
    expect(b.dump()).toEqual(["..........", `.${k.repeat(7)}..`, `.${k}.....${k}..`, `.${k}.....${k}..`, `.${k}.....${k}..`, `.${k.repeat(7)}..`, "..........", ".........."]);
  });
  it("a masked box (clamped to the minimum) has the PAGE colour inside a one-cell ink outline: it reads as an area, empty", () => {
    const b = new PixelBuffer(8, 6);
    drawBox(b, { c0: 1, r0: 1, c1: 7, r1: 5 }, T, { alpha: 1, fillAlpha: 1, solid: true });
    const k = T.ink.toString(36);
    expect(b.dump()).toEqual(["........", `.${k.repeat(6)}.`, `.${k}0000${k}.`, `.${k}0000${k}.`, `.${k.repeat(6)}.`, "........"]);
  });
  it("at rest the four corners are solid and the rest of each edge is dashed", () => {
    const b = new PixelBuffer(24, 16);
    drawBox(b, { c0: 1, r0: 1, c1: 23, r1: 15 }, T, { alpha: 1, fillAlpha: 0 });
    const k = T.ink.toString(36);
    const d = b.dump();
    // 22 cells across: an arm of 3, then off off on on off off, the two middle cells meeting in one longer dash, mirrored
    const row = (n: number) => Array.from({ length: n }, (_, i) => (edgeLit(i, n, false) ? k : ".")).join("");
    expect(row(22)).toBe(`${k.repeat(CORNER_ARM)}..${k.repeat(2)}..${k.repeat(4)}..${k.repeat(2)}..${k.repeat(CORNER_ARM)}`);
    expect(d[1]).toBe(`.${row(22)}.`);
    expect(d[14]).toBe(`.${row(22)}.`);
    // the left edge of 14 rows reads the same way down
    expect(d.slice(1, 15).map((r) => r[1]).join("")).toBe(row(14));
    // all four corner cells and the whole of each corner's arms are lit; the middle of each edge has gaps
    for (const [x, y] of [[1, 1], [22, 1], [1, 14], [22, 14]] as const) expect(b.get(x, y)).toBe(T.ink);
    expect(b.get(5, 1)).toBe(CLEAR);
    expect(b.get(12, 14)).not.toBe(CLEAR);
    expect(b.get(1, 4)).toBe(CLEAR);
  });
  it("the edge pattern is the same from both ends and anchored at the corners", () => {
    for (const n of [9, 10, 11, 14, 22, 37]) {
      const cells = Array.from({ length: n }, (_, i) => edgeLit(i, n, false));
      expect(cells).toEqual([...cells].reverse());
      for (let i = 0; i < Math.min(CORNER_ARM, n); i++) expect(cells[i]).toBe(true);
      expect(Array.from({ length: n }, (_, i) => edgeLit(i, n, true)).every(Boolean)).toBe(true);
    }
    // a minimum box (9 cells) is four corner brackets
    expect(Array.from({ length: 9 }, (_, i) => edgeLit(i, 9, false)).filter(Boolean)).toHaveLength(2 * CORNER_ARM);
  });
  it("the selected, focused or hovered box is one uninterrupted line, one cell thick: no ring, no doubling", () => {
    const b = new PixelBuffer(12, 10);
    drawBox(b, { c0: 1, r0: 1, c1: 11, r1: 9 }, T, { alpha: 1, fillAlpha: 1, solid: true });
    const k = T.ink.toString(36);
    const d = b.dump();
    expect(d[1]).toBe(`.${k.repeat(10)}.`);
    expect(d[2]).toBe(`.${k}${"0".repeat(8)}${k}.`); // the mask starts right inside the outline
    expect(d[8]).toBe(`.${k.repeat(10)}.`);
    for (let y = 1; y < 9; y++) {
      expect(d[y]![1]).toBe(k);
      expect(d[y]![10]).toBe(k);
    }
  });
  it("a fade is opacity, not shade: every outline cell is the ink colour at the node's alpha, whatever the alpha", () => {
    for (const a of [1 / 64, 0.1, 0.25, 0.5, 0.9, 1]) {
      const b = new PixelBuffer(10, 8);
      b.setRamp(RAMP);
      drawBox(b, rect, T, { alpha: a, fillAlpha: a, solid: true });
      let cells = 0;
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 10; x++) {
          const level = b.get(x, y);
          if (level === CLEAR) continue;
          cells++;
          const outline = x === 1 || x === 7 || y === 1 || y === 5;
          expect(level, `${x},${y} at ${a}`).toBe(outline ? T.ink : 0); // the ink, or the page colour of the mask: never an intermediate grey
          expect(b.alphaAt(x, y)).toBeCloseTo(a, 2); // so the lower the alpha the less it hides: no minimum shade that occludes
        }
      expect(cells).toBe(7 * 5);
    }
  });
  it("the mask stops at the outline: outline cells are composited over the map alone, interior cells over the map alone", () => {
    const b = new PixelBuffer(10, 8);
    drawBox(b, rect, T, { alpha: 0.5, fillAlpha: 0.5, solid: true });
    expect(b.alphaAt(1, 1)).toBeCloseTo(0.5, 2); // a corner: one write, not two
    expect(b.alphaAt(4, 3)).toBeCloseTo(0.5, 2);
  });
  it("the alpha is quantised to 1/ALPHA_STEPS", () => {
    expect(quantAlpha(0)).toBe(0);
    expect(quantAlpha(1)).toBe(1);
    expect(quantAlpha(0.5)).toBe(0.5);
    expect(quantAlpha(1.2)).toBe(1);
    expect(quantAlpha(0.3) * ALPHA_STEPS).toBeCloseTo(Math.round(0.3 * ALPHA_STEPS), 9);
  });
});

describe("labels: no chip, bold name, regular counter", () => {
  const draw = (name: string, chip: string | null, alpha = 1) => {
    const layout = labelLayout(name, chip);
    const buf = new PixelBuffer(layout.w + 6, layout.h + 4);
    drawLabel(buf, 3, 2, name, chip, layout, alpha, T);
    return { buf, layout };
  };
  it("the plate is the page colour, exactly the plate's cells, no outline of any kind", () => {
    const { buf, layout } = draw("Paris", null);
    for (let y = 0; y < buf.rows; y++)
      for (let x = 0; x < buf.cols; x++) {
        const inside = x >= 3 - LABEL_PAD && y >= 2 && x < 3 - LABEL_PAD + layout.w && y < 2 + layout.h;
        expect(buf.get(x, y) === CLEAR, `${x},${y}`).toBe(!inside);
      }
    expect(buf.get(3 - LABEL_PAD, 2)).toBe(0); // the corner is plate, not an outline
  });
  it("the text is the full ink (not a map grey) and there is no inverted chip: only ink and the page colour appear", () => {
    const { buf } = draw("Germany", chipText(10));
    const seen = new Set<number>();
    for (let y = 0; y < buf.rows; y++) for (let x = 0; x < buf.cols; x++) seen.add(buf.get(x, y));
    expect([...seen].sort((a, b) => a - b)).toEqual([0, T.ink, CLEAR]);
  });
  it("the counter has no plate of its own: the gap between the runs is the page-colour plate, TEXT_GAP cells wide", () => {
    const text = "Germany";
    const { buf, layout } = draw(text, chipText(10));
    const nameEnd = 3 + layout.textW;
    for (let x = nameEnd; x < nameEnd + TEXT_GAP; x++) for (let y = 2; y < 2 + layout.h; y++) expect(buf.get(x, y), `${x},${y}`).toBe(0);
    // the first column of the counter is where `chipX` says
    let first = -1;
    for (let x = nameEnd; x < buf.cols && first < 0; x++) for (let y = 2; y < 2 + layout.h; y++) if (buf.get(x, y) === T.ink) first = x;
    expect(first - 3).toBeGreaterThanOrEqual(layout.chipX);
    expect(first - 3).toBeLessThanOrEqual(layout.chipX + 1);
  });
  it("the name is bold (a 2-cell stem) and the counter regular (1-cell stem), on exactly the same baseline", () => {
    const { buf, layout } = draw("Ill", chipText(2));
    const base = 2 + layout.baseline; // first row below the baseline
    // "Ill": the first l's stem columns at the baseline's last row
    const stemRow = base - 1;
    const inkRun = (x0: number) => {
      let n = 0;
      for (let x = x0; buf.get(x, stemRow) === T.ink; x++) n++;
      return n;
    };
    // find the "I" glyph: a bold stem is 2 cells wide
    let x = 3;
    while (buf.get(x, stemRow) !== T.ink) x++;
    expect(inkRun(x)).toBeGreaterThanOrEqual(2);
    // the counter's "1" is a regular glyph and ends on the same baseline row
    let lastInk = -1;
    for (let yy = 2; yy < 2 + layout.h; yy++) for (let xx = 3 + layout.chipX; xx < buf.cols; xx++) if (buf.get(xx, yy) === T.ink) lastInk = Math.max(lastInk, yy);
    expect(lastInk).toBe(stemRow);
  });
  it("fades with opacity: plate and text are at the node's alpha, in the page colour and the ink, never another level", () => {
    for (const a of [1 / 64, 0.3, 0.7]) {
      const { buf, layout } = draw("Nikšić", chipText(3), a);
      buf.setRamp(RAMP);
      for (let y = 2; y < 2 + layout.h; y++)
        for (let x = 3 - LABEL_PAD; x < 3 - LABEL_PAD + layout.w; x++) {
          const cell = buf.get(x, y);
          expect(cell === 0 || cell === T.ink || cell === MIXED, `${x},${y}`).toBe(true);
          expect(buf.alphaAt(x, y)).toBeGreaterThanOrEqual(a - 0.01);
        }
    }
  });
  it("only palette levels are ever drawn at full opacity (no grey between)", () => {
    const { buf } = draw("Nikšić", chipText(3));
    for (let y = 0; y < buf.rows; y++) for (let x = 0; x < buf.cols; x++) expect([0, T.ink, CLEAR]).toContain(buf.get(x, y));
  });
});
