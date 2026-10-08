import { describe, expect, it } from "vitest";
import { CLEAR, MIXED, PixelBuffer } from "./pixel-buffer";
import { ALPHA_STEPS, BOX_STYLE, LABEL_PAD, MIN_LABEL_CHARS, SPOT, TEXT_GAP, chipText, dashingFor, drawBox, drawLabel, edgeLit, labelCandidates, labelLayout, labelTones, labelVariants, quantAlpha } from "./pixel-labels";
import { FONT_CAP, FONT_DESCENT, measureText } from "./pixel-font/pixel-font";
import { buildRamp, textFloorLevel } from "./palette";

const T = labelTones(12);
/** A theme-like ramp: dark page, light ink, 12 distinct levels. */
const RAMP = Array.from({ length: 12 }, (_, k) => [k / 11, k / 11, k / 11] as const);
const INK = T.active.box;
const PEAK = T.rest.box;

describe("label geometry (whole cells)", () => {
  it("a place's plate is the name plus LABEL_PAD cells of room on every side, no outline", () => {
    const m = measureText("Paris");
    const t = labelLayout("Paris", null);
    expect(t.w).toBe(m.w + 2 * LABEL_PAD);
    expect(t.chipW).toBe(0);
    expect(t.h).toBe(LABEL_PAD + Math.max(m.top, FONT_CAP) + FONT_DESCENT + LABEL_PAD);
    expect(t.baseline).toBe(LABEL_PAD + Math.max(m.top, FONT_CAP));
    expect(Number.isInteger(t.w) && Number.isInteger(t.h)).toBe(true);
  });
  it("the room below the text is the same whatever the text: the descender rows and LABEL_PAD, so the baseline is a fixed distance from the border", () => {
    for (const name of ["Paris", "Gyg", "Tromsø"]) {
      const t = labelLayout(name, null);
      expect(t.h - t.baseline, name).toBe(FONT_DESCENT + LABEL_PAD);
    }
    expect(LABEL_PAD).toBeGreaterThanOrEqual(2); // more than the 1 cell the first version had
  });
  it("a group's counter is a separate run, TEXT_GAP cells after the name, and the plate is as high as the name's", () => {
    const text = "Germany";
    const chip = chipText(10);
    const t = labelLayout(text, chip);
    expect(chip).toBe("10 entries");
    expect(t.chipX).toBe(LABEL_PAD + measureText(text).w + TEXT_GAP);
    expect(t.chipW).toBe(measureText(chip).w);
    expect(t.w).toBe(t.chipX + t.chipW + LABEL_PAD);
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
    expect(measureText("minimum").w).toBeLessThanOrEqual(measureText("MINIMUM").w);
  });
});

describe("shorter ways of writing a label: the counter first, then the country, then an ellipsis, never below MIN_LABEL_CHARS", () => {
  it("a group's whole label comes first, then the name alone, then truncations, each narrower than the one before", () => {
    const v = labelVariants("Western Europe", chipText(6));
    expect(v[0]).toMatchObject({ text: "Western Europe", chip: "6 entries" });
    expect(v[1]).toMatchObject({ text: "Western Europe", chip: null });
    expect(v[2]!.text.endsWith("…")).toBe(true);
    for (let i = 1; i < v.length; i++) expect(v[i]!.layout.w).toBeLessThanOrEqual(v[i - 1]!.layout.w);
  });
  it("a truncation is always narrower than the whole name: the ellipsis is a wide glyph, so cutting a letter or two does not count", () => {
    const v = labelVariants("Moscow, Russia", null);
    expect(v[0]!.text).toBe("Moscow, Russia");
    for (const x of v.slice(1)) expect(x.layout.w).toBeLessThan(v[0]!.layout.w);
  });
  it("a place alone in its country can lose the country before it is truncated further", () => {
    const v = labelVariants("Bogotá, Colombia", null).map((x) => x.text);
    expect(v).toContain("Bogotá");
  });
  it("truncation keeps at least MIN_LABEL_CHARS characters, the ellipsis included, and a short name is never truncated", () => {
    const v = labelVariants("Ho Chi Minh City", null);
    const shortest = v[v.length - 1]!.text;
    expect(Array.from(shortest).length).toBe(MIN_LABEL_CHARS);
    for (const x of v) expect(Array.from(x.text).length).toBeGreaterThanOrEqual(MIN_LABEL_CHARS);
    expect(labelVariants("Paris", null).map((x) => x.text)).toEqual(["Paris"]);
    expect(labelVariants("Agadir", null).length).toBe(1);
  });
  it("a name is cut before a trailing comma or space: 'London,' never ends a truncation", () => {
    for (const x of labelVariants("London, United Kingdom", null)) expect(x.text).not.toMatch(/[,\s]…$/);
  });
});

describe("where a label can go (candidates)", () => {
  const grid = { cols: 400, rows: 300 };
  const rect = { c0: 100, r0: 100, c1: 160, r1: 150 };
  const w = 50;
  const h = 16;
  it("the first choice is above the box's top-left corner: flush on its top edge and its left edge", () => {
    const c = labelCandidates(rect, w, h, grid);
    expect(c[0]).toEqual({ id: SPOT.aboveLeft, x: 100, y: 100 - h, inside: false });
    expect(c[0]!.y + h).toBe(rect.r0); // the plate's last row is the row above the edge
  });
  it("candidates come in priority order and each is entirely on the grid", () => {
    const c = labelCandidates(rect, w, h, grid);
    for (let i = 1; i < c.length; i++) expect(c[i]!.id).toBeGreaterThan(c[i - 1]!.id);
    for (const s of c) expect(s.x >= 0 && s.y >= 0 && s.x + w <= grid.cols && s.y + h <= grid.rows, `${s.id}`).toBe(true);
    const ids = c.map((s) => s.id);
    for (const id of [SPOT.aboveLeft, SPOT.aboveRight, SPOT.belowLeft, SPOT.left, SPOT.right]) expect(ids, `${id}`).toContain(id);
    expect(ids.some((id) => id >= SPOT.aboveShift)).toBe(true);
  });
  it("a nested label is flush inside the outline, so its text is LABEL_PAD cells from the border on the top and on the left: the same room as above", () => {
    const big = { c0: 100, r0: 100, c1: 300, r1: 250 };
    const all = labelCandidates(big, w, h, grid);
    const tl = all.find((s) => s.id === SPOT.insideTopLeft)!;
    expect(tl.inside).toBe(true);
    expect(tl.x).toBe(big.c0 + 1);
    expect(tl.y).toBe(big.r0 + 1);
    const bl = all.find((s) => s.id === SPOT.insideBottomLeft)!;
    expect(bl.y + h).toBe(big.r1 - 1);
    // drawn: the first glyph column is LABEL_PAD cells from the border's inner side
    const layout = labelLayout("Bulgaria", null);
    const b = new PixelBuffer(60, 40);
    drawLabel(b, 1, 1, "Bulgaria", null, layout, 1, T, false);
    let minX = 99;
    for (let y = 0; y < 40; y++) for (let x = 0; x < 60; x++) if (b.get(x, y) === T.rest.name) minX = Math.min(minX, x);
    expect(minX - 1).toBe(LABEL_PAD);
  });
  it("a plate that does not fit inside the box is not nested, and one that would leave the grid is not offered", () => {
    const tiny = { c0: 100, r0: 100, c1: 112, r1: 112 };
    expect(labelCandidates(tiny, w, h, grid).some((s) => s.inside)).toBe(false);
    const top = { c0: 20, r0: 4, c1: 200, r1: 80 }; // no room above
    const ids = labelCandidates(top, w, h, grid).map((s) => s.id);
    expect(ids).not.toContain(SPOT.aboveLeft);
    expect(ids).toContain(SPOT.insideTopLeft);
  });
  it("a box with its left corner off the screen offers the visible part of its top edge", () => {
    const off = { c0: -50, r0: 100, c1: 150, r1: 200 };
    const c = labelCandidates(off, w, h, grid);
    expect(c.find((s) => s.id === SPOT.aboveLeft)).toBeUndefined();
    expect(c.find((s) => s.id === SPOT.aboveVisibleLeft)).toMatchObject({ x: 0, y: 100 - h });
  });
});

describe("boxes: palette levels for state, opacity for fades", () => {
  const rect = { c0: 1, r0: 1, c1: 8, r1: 6 };
  it("a selected box is one solid line one cell thick in the ink, nothing inside", () => {
    const b = new PixelBuffer(10, 8);
    drawBox(b, rect, T, { alpha: 1, fillAlpha: 0, solid: true, active: true });
    const k = INK.toString(36);
    expect(b.dump()).toEqual(["..........", `.${k.repeat(7)}..`, `.${k}.....${k}..`, `.${k}.....${k}..`, `.${k}.....${k}..`, `.${k.repeat(7)}..`, "..........", ".........."]);
  });
  it("a masked box (clamped to the minimum) has the PAGE colour inside a one-cell outline: it reads as an area, empty", () => {
    const b = new PixelBuffer(8, 6);
    drawBox(b, { c0: 1, r0: 1, c1: 7, r1: 5 }, T, { alpha: 1, fillAlpha: 1, solid: true, active: true });
    const k = INK.toString(36);
    expect(b.dump()).toEqual(["........", `.${k.repeat(6)}.`, `.${k}0000${k}.`, `.${k}0000${k}.`, `.${k.repeat(6)}.`, "........"]);
  });
  it("COLOUR is the state: at rest the outline is the peak level, hovered or focused the ink with the same dashes; selected adds the solid line", () => {
    const draw = (style: { active?: boolean; solid?: boolean }) => {
      const b = new PixelBuffer(62, 50);
      drawBox(b, { c0: 1, r0: 1, c1: 61, r1: 49 }, T, { alpha: 1, fillAlpha: 0, ...style });
      return b;
    };
    const rest = draw({});
    const hover = draw({ active: true });
    const selected = draw({ active: true, solid: true });
    const cells = (b: PixelBuffer) => {
      const lit: string[] = [];
      for (let y = 0; y < 50; y++) for (let x = 0; x < 62; x++) if (b.get(x, y) !== CLEAR) lit.push(`${x},${y}`);
      return lit;
    };
    expect(cells(hover)).toEqual(cells(rest)); // hover changes the colour only, not the stroke
    expect(cells(selected).length).toBeGreaterThan(cells(rest).length); // selection also changes the stroke
    for (const c of cells(rest)) {
      const [x, y] = c.split(",").map(Number);
      expect(rest.get(x!, y!)).toBe(PEAK);
      expect(hover.get(x!, y!)).toBe(INK);
      expect(selected.get(x!, y!)).toBe(INK);
    }
    expect(PEAK).toBeLessThan(INK); // lower elevation at rest
    expect(PEAK).toBe(10); // a level of the palette, not an opacity
  });
  it("at rest the four corners are solid and the rest of each edge is dashed, each edge counted from its own anchor", () => {
    const b = new PixelBuffer(60, 48);
    const w = 58;
    const h = 46;
    drawBox(b, { c0: 1, r0: 1, c1: 1 + w, r1: 1 + h }, T, { alpha: 1, fillAlpha: 0 });
    const k = PEAK.toString(36);
    const d = b.dump();
    const dash = dashingFor(w, h);
    const row = (n: number) => Array.from({ length: n }, (_, i) => (edgeLit(i, n, false, dash) ? k : ".")).join("");
    const rev = (s: string) => [...s].reverse().join("");
    expect(d[1]).toBe(`.${row(w)}.`); // top: counted from its left corner
    expect(d[h]).toBe(`.${rev(row(w))}.`); // bottom: counted from its right corner
    expect(d.slice(1, 1 + h).map((r) => r[1]).join("")).toBe(row(h)); // left: from its top
    expect(d.slice(1, 1 + h).map((r) => r[w]).join("")).toBe(rev(row(h))); // right: from its bottom
    for (const [x, y] of [[1, 1], [w, 1], [1, h], [w, h]] as const) expect(b.get(x, y)).toBe(PEAK);
    for (let i = 0; i < dash.arm; i++) expect(b.get(1 + i, 1)).toBe(PEAK);
    expect(b.get(1 + dash.arm, 1)).toBe(CLEAR); // the first gap starts right after the arm
    expect(row(w)).toContain("."); // not a solid line
  });
  it("a dash is DASH_ON cells lit then `gap` dark, counted from the end of an arm, with an arm at the far end", () => {
    const n = 100;
    const { arm, gap } = dashingFor(n, n);
    const cells = Array.from({ length: n }, (_, i) => edgeLit(i, n, false));
    for (let i = 0; i < arm; i++) expect(cells[i]).toBe(true);
    for (let i = arm; i < arm + gap; i++) expect(cells[i]).toBe(false);
    for (let i = arm + gap; i < arm + gap + BOX_STYLE.dashOn; i++) expect(cells[i]).toBe(true);
    expect(cells[arm + gap + BOX_STYLE.dashOn]).toBe(false);
    for (let i = n - arm; i < n; i++) expect(cells[i]).toBe(true);
  });
  it("DASH ORIGIN: the pattern is anchored to the edge's start: resizing by 1..N cells changes only the far end", () => {
    const dash = { arm: 6, gap: 3 };
    for (const n of [30, 41, 60, 97]) {
      const a = Array.from({ length: n }, (_, i) => edgeLit(i, n, false, dash));
      for (let k = 1; k <= 12; k++) {
        const b = Array.from({ length: n + k }, (_, i) => edgeLit(i, n + k, false, dash));
        for (let i = 0; i < n - dash.arm; i++) expect(b[i], `n=${n} +${k} i=${i}`).toBe(a[i]); // the dashes do not slide
      }
    }
  });
  it("drawn: top and left keep their dashes when the box grows from its bottom-right, bottom and right when it grows from its top-left", () => {
    const draw = (c0: number, r0: number, c1: number, r1: number) => {
      const b = new PixelBuffer(130, 140);
      drawBox(b, { c0, r0, c1, r1 }, T, { alpha: 1, fillAlpha: 0 });
      return b;
    };
    // sizes inside one band of dashingFor (the same arm and gap): the smaller side is 56..64
    const dash = dashingFor(56, 100);
    for (const s of [56, 60, 64]) expect(dashingFor(s, 100)).toEqual(dash);
    const base = draw(5, 5, 5 + 56, 5 + 100);
    for (let k = 1; k <= 8; k++) {
      const wider = draw(5, 5, 5 + 56 + k, 5 + 100); // the right edge moves: the top edge's near part stays
      for (let x = 5; x < 5 + 56 - dash.arm; x++) expect(wider.get(x, 5), `top x=${x} +${k}`).toBe(base.get(x, 5));
      const left = draw(5 - k, 5, 5 + 56, 5 + 100); // the left edge moves: the bottom edge, anchored at its right corner, keeps its dashes
      for (let x = 5 + 55; x >= 5 + dash.arm; x--) expect(left.get(x, 5 + 99), `bottom x=${x} -${k}`).toBe(base.get(x, 5 + 99));
      const taller = draw(5, 5, 5 + 56, 5 + 100 + k); // the bottom moves: the left edge, anchored at its top, keeps its dashes
      for (let y = 5; y < 5 + 100 - dash.arm; y++) expect(taller.get(5, y), `left y=${y} +${k}`).toBe(base.get(5, y));
      const higher = draw(5, 5 - k, 5 + 56, 5 + 100); // the top moves: the right edge, anchored at its bottom, keeps its dashes
      for (let y = 5 + 99; y >= 5 + dash.arm; y--) expect(higher.get(5 + 55, y), `right y=${y} -${k}`).toBe(base.get(5 + 55, y));
    }
  });
  it("the whole outline is rotationally symmetric: turned half a turn it is the same", () => {
    for (const [w, h] of [[58, 46], [40, 90], [23, 31], [9, 9], [120, 70]] as const) {
      const b = new PixelBuffer(w + 2, h + 2);
      drawBox(b, { c0: 1, r0: 1, c1: 1 + w, r1: 1 + h }, T, { alpha: 1, fillAlpha: 0 });
      const d = b.dump();
      const turned = [...d].reverse().map((r) => [...r].reverse().join(""));
      expect(turned, `${w}x${h}`).toEqual(d);
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
    for (const { arm, gap } of out) {
      expect(arm).toBeGreaterThanOrEqual(BOX_STYLE.arm.min);
      expect(arm).toBeLessThanOrEqual(BOX_STYLE.arm.max);
      expect(gap).toBeGreaterThanOrEqual(BOX_STYLE.gap.min);
      expect(gap).toBeLessThanOrEqual(BOX_STYLE.gap.max);
    }
    const big = dashingFor(300, 300);
    expect(big.arm).toBeGreaterThanOrEqual(12);
    let lit = 0;
    for (let i = 0; i < 300; i++) if (edgeLit(i, 300, false)) lit++;
    expect(lit - 2 * big.arm).toBeLessThan(0.3 * 300);
  });
  it("a tiny box never has overflowing or overlapping arms: it degrades to a plain solid outline", () => {
    for (let n = 1; n <= 7; n++) expect(Array.from({ length: n }, (_, i) => edgeLit(i, n, false)).every(Boolean), `n=${n}`).toBe(true);
    for (let n = 1; n <= 400; n++) {
      const { arm, gap } = dashingFor(n, n);
      const lit = Array.from({ length: n }, (_, i) => edgeLit(i, n, false));
      if (!lit.every(Boolean)) expect(n).toBeGreaterThanOrEqual(2 * arm + gap);
    }
    expect(dashingFor(400, 12)).toEqual(dashingFor(12, 12));
    const b = new PixelBuffer(9, 9);
    drawBox(b, { c0: 1, r0: 1, c1: 8, r1: 8 }, T, { alpha: 1, fillAlpha: 0 });
    for (let i = 1; i < 8; i++) for (const [x, y] of [[i, 1], [i, 7], [1, i], [7, i]] as const) expect(b.get(x, y)).toBe(PEAK);
  });
  it("the selected box is one uninterrupted line, one cell thick: no ring, no doubling", () => {
    const b = new PixelBuffer(12, 10);
    drawBox(b, { c0: 1, r0: 1, c1: 11, r1: 9 }, T, { alpha: 1, fillAlpha: 1, solid: true, active: true });
    const k = INK.toString(36);
    const d = b.dump();
    expect(d[1]).toBe(`.${k.repeat(10)}.`);
    expect(d[2]).toBe(`.${k}${"0".repeat(8)}${k}.`);
    expect(d[8]).toBe(`.${k.repeat(10)}.`);
    for (let y = 1; y < 9; y++) {
      expect(d[y]![1]).toBe(k);
      expect(d[y]![10]).toBe(k);
    }
  });
  it("a fade is opacity, not shade: every outline cell is one level at the node's alpha, whatever the alpha", () => {
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
          expect(level, `${x},${y} at ${a}`).toBe(outline ? PEAK : 0);
          expect(b.alphaAt(x, y)).toBeCloseTo(a, 2);
        }
      expect(cells).toBe(7 * 5);
    }
  });
  it("the mask stops at the outline: outline cells are composited over the map alone, interior cells over the map alone", () => {
    const b = new PixelBuffer(10, 8);
    drawBox(b, rect, T, { alpha: 0.5, fillAlpha: 0.5, solid: true });
    expect(b.alphaAt(1, 1)).toBeCloseTo(0.5, 2);
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

describe("tones: palette levels, AA text, a counter below the name", () => {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = (c: readonly number[]) => 0.2126 * lin(c[0]!) + 0.7152 * lin(c[1]!) + 0.0722 * lin(c[2]!);
  const contrast = (a: readonly number[], b: readonly number[]) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  for (const [name, bg, fg] of [["light", [0.984, 0.984, 0.984], [0.039, 0.039, 0.039]], ["dark", [0.039, 0.039, 0.039], [0.961, 0.961, 0.961]]] as const) {
    it(`${name}: every state's text and outline are AA / 3:1 over the page, rest is lower than active, the counter is below the name`, () => {
      const ramp = buildRamp(bg as unknown as [number, number, number], fg as unknown as [number, number, number]);
      const tones = labelTones(ramp.length, textFloorLevel(ramp));
      for (const tone of [tones.rest, tones.active]) {
        expect(contrast(ramp[tone.name]!, ramp[0]!)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(ramp[tone.count]!, ramp[0]!)).toBeGreaterThanOrEqual(4.5); // the counter is text too
        expect(contrast(ramp[tone.box]!, ramp[0]!)).toBeGreaterThanOrEqual(3);
        expect(tone.count).toBeLessThanOrEqual(tone.name);
      }
      expect(tones.rest.box).toBeLessThan(tones.active.box);
      expect(tones.rest.name).toBeLessThan(tones.active.name);
      expect(tones.active.count).toBeLessThan(tones.active.name); // dimmer than the name
      expect(tones.rest.name).toBe(tones.rest.box); // the label follows the box
      expect(tones.active.name).toBe(tones.active.box);
    });
  }
});

describe("labels: one weight, a dimmer counter", () => {
  const draw = (name: string, chip: string | null, alpha = 1, active = false) => {
    const layout = labelLayout(name, chip);
    const buf = new PixelBuffer(layout.w + 6, layout.h + 4);
    drawLabel(buf, 3, 2, name, chip, layout, alpha, T, active);
    return { buf, layout };
  };
  it("the plate is the page colour, exactly the plate's cells, no outline of any kind", () => {
    const { buf, layout } = draw("Paris", null);
    for (let y = 0; y < buf.rows; y++)
      for (let x = 0; x < buf.cols; x++) {
        const inside = x >= 3 && y >= 2 && x < 3 + layout.w && y < 2 + layout.h;
        expect(buf.get(x, y) === CLEAR, `${x},${y}`).toBe(!inside);
      }
    expect(buf.get(3, 2)).toBe(0);
  });
  it("the text is centred in its plate: LABEL_PAD clear cells on the left, on the right and above the capitals", () => {
    const { buf, layout } = draw("Paris", null);
    let minX = 99;
    let maxX = -1;
    let minY = 99;
    for (let y = 2; y < 2 + layout.h; y++)
      for (let x = 3; x < 3 + layout.w; x++)
        if (buf.get(x, y) === T.rest.name) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
        }
    expect(minX - 3).toBe(LABEL_PAD);
    expect(3 + layout.w - 1 - maxX).toBe(LABEL_PAD);
    expect(minY - 2).toBe(LABEL_PAD);
  });
  it("the counter is a level below the name where the AA floor allows (else the same); active: the ink and the peak", () => {
    const tones = labelTones(12, 9);
    expect(tones.rest.count).toBe(tones.rest.name - 1);
    const l = labelLayout("Germany", chipText(10));
    const b = new PixelBuffer(120, 30);
    drawLabel(b, 0, 0, "Germany", chipText(10), l, 1, tones, false);
    const seen = new Set<number>();
    for (let y = 0; y < 30; y++) for (let x = 0; x < 120; x++) seen.add(b.get(x, y));
    expect(seen.has(tones.rest.name)).toBe(true);
    expect(seen.has(tones.rest.count)).toBe(true);
    const act = draw("Germany", chipText(10), 1, true).buf;
    const levels = new Set<number>();
    for (let y = 0; y < act.rows; y++) for (let x = 0; x < act.cols; x++) levels.add(act.get(x, y));
    expect(levels.has(T.active.name)).toBe(true);
    expect(levels.has(T.active.count)).toBe(true);
    expect(T.active.count).toBeLessThan(T.active.name);
  });
  it("the counter has no plate of its own: the gap between the runs is the page-colour plate, TEXT_GAP cells wide", () => {
    const text = "Germany";
    const { buf, layout } = draw(text, chipText(10));
    const nameEnd = 3 + LABEL_PAD + layout.textW;
    for (let x = nameEnd; x < nameEnd + TEXT_GAP; x++) for (let y = 2; y < 2 + layout.h; y++) expect(buf.get(x, y), `${x},${y}`).toBe(0);
    let first = -1;
    for (let x = nameEnd; x < buf.cols && first < 0; x++) for (let y = 2; y < 2 + layout.h; y++) if (buf.get(x, y) === T.rest.count) first = x;
    expect(first - 3).toBeGreaterThanOrEqual(layout.chipX);
    expect(first - 3).toBeLessThanOrEqual(layout.chipX + 2);
  });
  it("the name and the counter share one baseline", () => {
    const { buf, layout } = draw("Ill", chipText(2));
    const lastRow = 2 + layout.baseline - 1;
    let lastName = -1;
    let lastCount = -1;
    for (let yy = 2; yy < 2 + layout.h; yy++)
      for (let xx = 3; xx < buf.cols; xx++) {
        if (buf.get(xx, yy) === T.rest.count && xx >= 3 + layout.chipX) lastCount = Math.max(lastCount, yy);
        if (buf.get(xx, yy) === T.rest.name && xx < 3 + layout.chipX) lastName = Math.max(lastName, yy);
      }
    expect(lastCount).toBe(lastRow);
    expect(lastName).toBe(lastRow);
  });
  it("fades with opacity: plate and text are at the node's alpha, in page colour and palette levels, never another level", () => {
    for (const a of [1 / 64, 0.3, 0.7]) {
      const { buf, layout } = draw("Nikšić", chipText(3), a);
      buf.setRamp(RAMP);
      for (let y = 2; y < 2 + layout.h; y++)
        for (let x = 3; x < 3 + layout.w; x++) {
          const cell = buf.get(x, y);
          expect([0, T.rest.name, T.rest.count, MIXED]).toContain(cell);
          expect(buf.alphaAt(x, y)).toBeGreaterThanOrEqual(a - 0.01);
        }
    }
  });
  it("only palette levels are ever drawn at full opacity (no grey between)", () => {
    const { buf } = draw("Nikšić", chipText(3));
    for (let y = 0; y < buf.rows; y++) for (let x = 0; x < buf.cols; x++) expect([0, T.rest.name, T.rest.count, CLEAR]).toContain(buf.get(x, y));
  });
});
