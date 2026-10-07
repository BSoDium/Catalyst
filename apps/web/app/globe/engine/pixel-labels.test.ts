import { describe, expect, it } from "vitest";
import { CLEAR, MIXED, PixelBuffer } from "./pixel-buffer";
import { ALPHA_STEPS, BOX_STYLE, INSIDE_MARGIN, LABEL_PAD, TEXT_GAP, chipText, dashingFor, drawBox, edgeLit, drawLabel, labelCell, labelLayout, labelTones, quantAlpha } from "./pixel-labels";
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
  it("sits just above the box's top edge, on its left edge", () => {
    const rect = { c0: 10, r0: 30, c1: 40, r1: 50 };
    const at = labelCell(rect, 9);
    expect(at).toEqual({ col: 10, row: 21, inside: false });
    expect(at.row + 9).toBe(rect.r0); // the plate's last row is the row above the edge
  });
  it("when it would leave the top of the grid it nests INSIDE the box, off the outline: the plate starts a cell inside, the text two", () => {
    const rect = { c0: 5, r0: 3, c1: 30, r1: 30 };
    const at = labelCell(rect, 9);
    expect(at.inside).toBe(true);
    // the text starts after the outline cell, the margin and the plate's own pad: never on the left edge column
    expect(at.col).toBe(rect.c0 + 1 + INSIDE_MARGIN + LABEL_PAD);
    expect(at.col).toBeGreaterThan(rect.c0 + 1);
    expect(at.col - LABEL_PAD).toBeGreaterThan(rect.c0); // the plate (the hit hull's label) is inside too
    expect(at.row).toBe(rect.r0 + 1 + INSIDE_MARGIN);
    expect(at.row).toBeGreaterThan(rect.r0);
  });
  it("a nested label's glyphs never touch the outline or the left edge, for any box position", () => {
    for (const r0 of [-4, 0, 2, 5]) {
      const rect = { c0: 12, r0, c1: 60, r1: r0 + 40 };
      const h = labelLayout("Bulgaria", "6 entries").h;
      const at = labelCell(rect, h);
      if (!at.inside) continue;
      expect(at.col - LABEL_PAD).toBe(rect.c0 + 1 + INSIDE_MARGIN);
      expect(at.col).toBeGreaterThanOrEqual(rect.c0 + 1 + INSIDE_MARGIN);
    }
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
    const b = new PixelBuffer(60, 48);
    const w = 58;
    const h = 46;
    drawBox(b, { c0: 1, r0: 1, c1: 1 + w, r1: 1 + h }, T, { alpha: 1, fillAlpha: 0 });
    const k = T.ink.toString(36);
    const d = b.dump();
    const dash = dashingFor(w, h);
    const row = (n: number) => Array.from({ length: n }, (_, i) => (edgeLit(i, n, false, dash) ? k : ".")).join("");
    expect(d[1]).toBe(`.${row(w)}.`);
    expect(d[h]).toBe(`.${row(w)}.`);
    // the left edge reads the same way down, with the same arm and gap
    expect(d.slice(1, 1 + h).map((r) => r[1]).join("")).toBe(row(h));
    // all four corner cells and the whole of each corner's arms are lit; the middle of each edge has gaps
    for (const [x, y] of [[1, 1], [w, 1], [1, h], [w, h]] as const) expect(b.get(x, y)).toBe(T.ink);
    for (let i = 0; i < dash.arm; i++) expect(b.get(1 + i, 1)).toBe(T.ink);
    expect(b.get(1 + dash.arm, 1)).toBe(CLEAR); // the first gap starts right after the arm
    expect(row(w)).toContain("."); // not a solid line
  });
  it("a dash is DASH_ON cells lit then `gap` dark, counted from the end of an arm", () => {
    const n = 100;
    const { arm, gap } = dashingFor(n, n);
    const cells = Array.from({ length: n }, (_, i) => edgeLit(i, n, false));
    for (let i = 0; i < arm; i++) expect(cells[i]).toBe(true);
    for (let i = arm; i < arm + gap; i++) expect(cells[i]).toBe(false);
    for (let i = arm + gap; i < arm + gap + BOX_STYLE.dashOn; i++) expect(cells[i]).toBe(true);
    expect(cells[arm + gap + BOX_STYLE.dashOn]).toBe(false);
  });
  it("the edge pattern is the same from both ends and anchored at the corners, at every size", () => {
    for (const n of [1, 2, 5, 8, 9, 10, 11, 14, 22, 37, 60, 120, 300]) {
      const cells = Array.from({ length: n }, (_, i) => edgeLit(i, n, false));
      expect(cells, `n=${n}`).toEqual([...cells].reverse());
      const { arm } = dashingFor(n, n);
      if (n >= 2 * arm + dashingFor(n, n).gap) for (let i = 0; i < arm; i++) expect(cells[i], `n=${n} i=${i}`).toBe(true);
      expect(Array.from({ length: n }, (_, i) => edgeLit(i, n, true)).every(Boolean)).toBe(true);
    }
  });
  it("a big box has longer arms and scarcer dashes than a small one; both stay within their limits", () => {
    const sizes = [9, 12, 20, 40, 80, 160, 400, 1000];
    const out = sizes.map((s) => dashingFor(s, s));
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.arm).toBeGreaterThanOrEqual(out[i - 1]!.arm);
      expect(out[i]!.gap).toBeGreaterThanOrEqual(out[i - 1]!.gap);
    }
    expect(out[out.length - 1]!.arm).toBeGreaterThan(out[0]!.arm);
    expect(out[out.length - 1]!.gap).toBeGreaterThan(out[0]!.gap);
    for (const { arm, gap } of out) {
      expect(arm).toBeGreaterThanOrEqual(BOX_STYLE.arm.min);
      expect(arm).toBeLessThanOrEqual(BOX_STYLE.arm.max);
      expect(gap).toBeGreaterThanOrEqual(BOX_STYLE.gap.min);
      expect(gap).toBeLessThanOrEqual(BOX_STYLE.gap.max);
    }
    // a big box's arms are noticeable (at least 12 cells) while its dashes are a small share of the edge
    const big = dashingFor(300, 300);
    expect(big.arm).toBeGreaterThanOrEqual(12);
    let lit = 0;
    for (let i = 0; i < 300; i++) if (edgeLit(i, 300, false)) lit++;
    expect(lit - 2 * big.arm).toBeLessThan(0.3 * 300); // the dashes between the arms light less than a third of the edge
  });
  it("a tiny box never has overflowing or overlapping arms: it degrades to a plain solid outline", () => {
    for (let n = 1; n <= 7; n++) expect(Array.from({ length: n }, (_, i) => edgeLit(i, n, false)).every(Boolean), `n=${n}`).toBe(true);
    // wherever it is dashed, two arms and a gap fit: the arms never overlap
    for (let n = 1; n <= 400; n++) {
      const { arm, gap } = dashingFor(n, n);
      const lit = Array.from({ length: n }, (_, i) => edgeLit(i, n, false));
      if (!lit.every(Boolean)) expect(n).toBeGreaterThanOrEqual(2 * arm + gap);
    }
    // a box that is wide and short follows its smaller side, so the four corners match
    expect(dashingFor(400, 12)).toEqual(dashingFor(12, 12));
    // drawn: a 7 x 7 box is a complete outline
    const b = new PixelBuffer(9, 9);
    drawBox(b, { c0: 1, r0: 1, c1: 8, r1: 8 }, T, { alpha: 1, fillAlpha: 0 });
    for (let i = 1; i < 8; i++) for (const [x, y] of [[i, 1], [i, 7], [1, i], [7, i]] as const) expect(b.get(x, y)).toBe(T.ink);
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
