import { describe, expect, it } from "vitest";
import { CLEAR, MIXED, PixelBuffer } from "./pixel-buffer";
import { ALPHA_STEPS, LABEL_PAD, TEXT_GAP, chipText, drawBox, drawLabel, labelCell, labelLayout, labelTones, quantAlpha } from "./pixel-labels";
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
    drawBox(b, rect, T, { alpha: 1, fillAlpha: 0 });
    const k = T.ink.toString(36);
    expect(b.dump()).toEqual(["..........", `.${k.repeat(7)}..`, `.${k}.....${k}..`, `.${k}.....${k}..`, `.${k}.....${k}..`, `.${k.repeat(7)}..`, "..........", ".........."]);
  });
  it("a masked box (clamped to the minimum) has the PAGE colour inside a one-cell ink outline: it reads as an area, empty", () => {
    const b = new PixelBuffer(8, 6);
    drawBox(b, { c0: 1, r0: 1, c1: 7, r1: 5 }, T, { alpha: 1, fillAlpha: 1 });
    const k = T.ink.toString(36);
    expect(b.dump()).toEqual(["........", `.${k.repeat(6)}.`, `.${k}0000${k}.`, `.${k}0000${k}.`, `.${k.repeat(6)}.`, "........"]);
  });
  it("the selected, focused or hovered box has a second ring just inside the first", () => {
    const b = new PixelBuffer(12, 10);
    drawBox(b, { c0: 1, r0: 1, c1: 11, r1: 9 }, T, { alpha: 1, fillAlpha: 1, ring: true });
    const k = T.ink.toString(36);
    expect(b.dump()[1]).toBe(`.${k.repeat(10)}.`);
    expect(b.dump()[2]).toBe(`.${k}${k.repeat(8)}${k}.`);
    expect(b.dump()[3]).toBe(`.${k}${k}000000${k}${k}.`);
  });
  it("a fade is opacity, not shade: every outline cell is the ink colour at the node's alpha, whatever the alpha", () => {
    for (const a of [1 / 64, 0.1, 0.25, 0.5, 0.9, 1]) {
      const b = new PixelBuffer(10, 8);
      b.setRamp(RAMP);
      drawBox(b, rect, T, { alpha: a, fillAlpha: a });
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
    drawBox(b, rect, T, { alpha: 0.5, fillAlpha: 0.5 });
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
