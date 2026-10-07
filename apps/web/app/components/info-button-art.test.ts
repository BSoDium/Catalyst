import { describe, expect, it } from "vitest";
import { PixelBuffer } from "~/globe/engine/pixel-buffer";
import { BOX, INFO_CELLS, INFO_REST, drawInfoButton, infoTones, type InfoState } from "./info-button-art";

const tones = infoTones(12); // bg 0, shadow 10, ink 11
const draw = (state: Partial<InfoState> = {}) => {
  const buf = new PixelBuffer(INFO_CELLS.cols, INFO_CELLS.rows);
  drawInfoButton(buf, { ...INFO_REST, ...state }, tones);
  return buf;
};
const at = (buf: PixelBuffer, x: number, y: number) => buf.get(x, y);

describe("info button art", () => {
  it("draws inside its canvas: nothing is clipped, even focused and pressed", () => {
    for (const state of [{}, { hover: true }, { pressed: true }, { focus: true, pressed: true }]) {
      const buf = new PixelBuffer(INFO_CELLS.cols + 20, INFO_CELLS.rows + 20);
      drawInfoButton(buf, { ...INFO_REST, ...state }, tones, 10, 10);
      expect(buf.minX).toBeGreaterThanOrEqual(10);
      expect(buf.minY).toBeGreaterThanOrEqual(10);
      expect(buf.maxX).toBeLessThan(10 + INFO_CELLS.cols);
      expect(buf.maxY).toBeLessThan(10 + INFO_CELLS.rows);
    }
  });

  it("rest: ink outline and glyph on a page-colour plate, with a shadow, no ring", () => {
    const rows = draw().dump();
    expect(rows.join("\n")).toMatchInlineSnapshot(`
      "..............
      ..............
      ...bbbbbbb....
      ..b0000000b...
      ..b000b000ba..
      ..b0000000ba..
      ..b000b000ba..
      ..b000b000ba..
      ..b000b000ba..
      ..b000b000ba..
      ..b0000000ba..
      ...bbbbbbbaa..
      ....aaaaaaa...
      ..............
      .............."
    `);
  });

  it("the glyph is an i: a dot, a gap, a four-cell stem, centred in the box", () => {
    const buf = draw();
    const cx = 2 + Math.floor(BOX.w / 2);
    const column = Array.from({ length: BOX.h }, (_, j) => at(buf, cx, 2 + j));
    // outline, plate, dot, gap, stem x4, plate, outline
    expect(column.map((v) => (v === tones.ink ? "#" : "."))).toEqual(["#", ".", "#", ".", "#", "#", "#", "#", ".", "#"]);
  });

  it("hover and pressed invert the plate and the glyph", () => {
    for (const state of [{ hover: true }, { pressed: true }]) {
      const buf = draw(state);
      const o = state.pressed ? 3 : 2;
      expect(at(buf, o + 4, o + 4)).toBe(tones.bg); // the stem, page colour on ink
      expect(at(buf, o + 2, o + 5)).toBe(tones.ink); // plate
    }
  });

  it("pressed moves one cell into the shadow and drops it", () => {
    const rest = draw();
    const pressed = draw({ pressed: true });
    expect(at(rest, 2 + BOX.w, 2 + 3)).toBe(tones.shadow); // shadow, right of the box
    expect(at(pressed, 2 + BOX.w, 2 + 3)).not.toBe(tones.shadow);
    expect(at(pressed, 3, 4)).toBe(tones.ink); // the outline's left edge moved right and down
    expect(at(pressed, 2, 4)).toBe(255);
  });

  it("focus adds a one-cell ring clear of the button, whole canvas", () => {
    const buf = draw({ focus: true });
    for (let x = 0; x < INFO_CELLS.cols; x++) {
      expect(at(buf, x, 0)).toBe(tones.ink);
      expect(at(buf, x, INFO_CELLS.rows - 1)).toBe(tones.ink);
    }
    expect(at(buf, 1, 5)).toBe(255); // the clear cell between ring and button
    expect(draw().count()).toBeLessThan(buf.count());
  });

  it("every state differs from rest", () => {
    const rest = draw().dump().join();
    for (const state of [{ hover: true }, { pressed: true }, { focus: true }]) expect(draw(state).dump().join()).not.toBe(rest);
  });
});
