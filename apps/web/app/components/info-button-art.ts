/**
 * The info button's picture, in art pixels (pure, unit tested; `AttributionButton` shows it on a canvas of the map's own cell
 * size, like the map's labels, and the pixel font is theirs). A one-cell outline around a lowercase "i", corners cut by a cell.
 *
 *  - rest:    page-colour plate, ink outline and glyph, a one-cell shadow below and to the right (the button stands out);
 *  - hover:   inverted (ink plate, page-colour glyph);
 *  - pressed: the button moves into its shadow (one cell down and right, no shadow), inverted;
 *  - focus:   a one-cell ring, one cell clear of the button, in the ink.
 * Every state differs from rest by whole cells and by tone, so none depends on colour alone.
 */
import type { PixelBuffer } from "~/globe/engine/pixel-buffer";
import { measureText } from "~/globe/engine/pixel-font/pixel-font";

/** Palette levels the picture uses (a level of the maps' ramp each): the page colour, the loud map tone, the full ink. */
export interface InfoTones {
  bg: number;
  shadow: number;
  ink: number;
}

/** The levels for a ramp of `levels` greys: page colour first, ink last, the loudest map tone just below it. */
export const infoTones = (levels: number): InfoTones => ({ bg: 0, shadow: levels - 2, ink: levels - 1 });

export interface InfoState {
  hover: boolean;
  pressed: boolean;
  focus: boolean;
}

export const INFO_REST: InfoState = { hover: false, pressed: false, focus: false };

/** Button size in cells, and the room around it for the ring (one cell clear, one thick) and the shadow. */
export const BOX = { w: 9, h: 10 } as const;
const MARGIN = 2;
export const INFO_CELLS = { cols: BOX.w + 2 * MARGIN + 1, rows: BOX.h + 2 * MARGIN + 1 } as const;

const GLYPH = "i";

/** Draw the button into `buf` with its top-left cell at (`col`, `row`): the canvas of `INFO_CELLS` cells when both are 0. */
export function drawInfoButton(buf: PixelBuffer, state: InfoState, tones: InfoTones, col = 0, row = 0): void {
  const inverted = state.hover || state.pressed;
  const plate = inverted ? tones.ink : tones.bg;
  const mark = inverted ? tones.bg : tones.ink;
  const x = col + MARGIN + (state.pressed ? 1 : 0);
  const y = row + MARGIN + (state.pressed ? 1 : 0);

  if (state.focus) buf.strokeRect(col, row, INFO_CELLS.cols, INFO_CELLS.rows, tones.ink);
  if (!state.pressed) {
    // the shadow: the box's footprint one cell down and right, in the loud map tone; the box covers all but an L
    fillBox(buf, x + 1, y + 1, tones.shadow);
  }
  fillBox(buf, x, y, plate);
  strokeBox(buf, x, y, tones.ink);
  const m = measureText(GLYPH);
  // centred in the box; the glyph's cap height is 5 and its dot sits above it (`top` rows above the baseline)
  buf.text(GLYPH, x + Math.floor((BOX.w - m.w) / 2), y + 1 + m.top + Math.floor((BOX.h - 2 - m.top - m.bottom) / 2), mark);
}

/** The box without its four corner cells (a one-cell chamfer). */
function fillBox(buf: PixelBuffer, x: number, y: number, level: number): void {
  buf.fillRect(x + 1, y, BOX.w - 2, BOX.h, level);
  buf.fillRect(x, y + 1, BOX.w, BOX.h - 2, level);
}

function strokeBox(buf: PixelBuffer, x: number, y: number, level: number): void {
  buf.fillRect(x + 1, y, BOX.w - 2, 1, level);
  buf.fillRect(x + 1, y + BOX.h - 1, BOX.w - 2, 1, level);
  buf.fillRect(x, y + 1, 1, BOX.h - 2, level);
  buf.fillRect(x + BOX.w - 1, y + 1, 1, BOX.h - 2, level);
}
