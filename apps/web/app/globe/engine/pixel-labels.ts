/**
 * Boxes and labels on the art-pixel grid, shared by the Three.js globe and the street overlay (pure drawing, unit tested;
 * `PixelOverlay` is the only part that touches the DOM).
 *
 * Everything the map overlay says is drawn into a `PixelBuffer` whose cells are the art pixels of the map (`ART_PIXEL` in
 * engine/tuning.ts, the same constant both maps use), shown on a `cols x rows` canvas scaled up with
 * `image-rendering: pixelated`. So every outline, plate and glyph is whole cells at whole-cell positions, one cell thick: the
 * type has the resolution of the map and no stem is thinner than a map pixel. The text is the pixel font of
 * `pixel-font/pixel-font.ts` (Tiny5, OFL).
 *
 * The look is an object detector's: every place and every group is a RECTANGLE (its bounding box, one cell thick, in the full
 * ink: solid corner arms with dashes between them at rest, one solid line when hovered, focused or selected), whose interior is MASKED to the page colour (a fill that looks like nothing: the area is outlined with its contents
 * hidden) while the rectangle is clamped to the minimum size, and hollow once it has its true size. Its LABEL is text only: no
 * outline, no tab. It sits just above the rectangle's top edge, left-justified on the rectangle's left edge, on a plate of the
 * page colour (one cell of room around the text, so nothing shows behind it): the name in the BOLD weight and, for a group,
 * its counter ("<N> entries") in the normal weight after a clear gap, on exactly the same baseline. The counter is a separate
 * text run on purpose: it will grow into publication types and other stats.
 *
 * Contrast: rectangles and text are the full foreground ink at full opacity, in both themes (not a map grey). FADES are
 * opacity: everything a node draws (outline, interior mask, plate, text) is composited with the node's alpha over what is
 * underneath, per art cell (`PixelBuffer`), so there is no darker or lighter shade that could occlude the map at the faintest
 * step; the art-pixel grid itself is untouched (no sub-pixel position, no smoothing).
 */
import { PixelBuffer } from "./pixel-buffer";
import { measureText } from "./pixel-font/pixel-font";

/** Palette levels the drawing needs, from the theme's ramp length. */
export interface LabelTones {
  /** The page colour (level 0): plates and the interior mask. */
  bg: number;
  /** The full ink (the last level): rectangles and text. */
  ink: number;
  /** The loudest map level (`peak`), below the ink. */
  text: number;
}

export function labelTones(levels: number): LabelTones {
  return { bg: 0, ink: levels - 1, text: levels - 2 };
}

export interface LabelState {
  selected: boolean;
  focused: boolean;
  hover: boolean;
}

export const NO_STATE: LabelState = { selected: false, focused: false, hover: false };

/** The text of a group's counter: "<N> entries", "1 entry" when singular. */
export const chipText = (count: number): string => `${count} ${count === 1 ? "entry" : "entries"}`;

/**
 * Geometry of a label in whole cells, relative to the label's anchor: the box's left edge column and the row of the plate's top.
 * The plate (page colour) spans columns `-PAD .. w - PAD - 1`; the name starts at column 0 of the anchor.
 */
export interface LabelLayout {
  /** Plate width and height, counter included. */
  w: number;
  h: number;
  /** Cell offset of the baseline from the plate's top (the name's and the counter's: the same). */
  baseline: number;
  /** Width of the name's (bold) text in cells. */
  textW: number;
  /** Counter: offset of its first column from the anchor and its text width (0 without a counter). */
  chipX: number;
  chipW: number;
}

/** One cell of plate around the text on each side. */
export const LABEL_PAD = 1;
/** Empty cells between the name and its counter: wide enough that the two runs, one bold and one regular, read as separate blocks (5 cells = 12.5 CSS px at 2.5 px). */
export const TEXT_GAP = 5;
/** Rows every label reserves above the baseline (a capital, the dot of an i: both 7 since the type was made taller) and below it (descenders), so plates of plain text are all the same height and sit the same way on the box. */
const MIN_TOP = 7;
const MIN_BOTTOM = 1;

const cache = new Map<string, LabelLayout>();

/** The layout of a label: `chip` is the group's counter text, "<N> entries" (null for a place). */
export function labelLayout(text: string, chip: string | null): LabelLayout {
  const key = `${chip ?? ""}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const m = measureText(text, true);
  const c = chip ? measureText(chip) : { w: 0, top: 0, bottom: 0 };
  const top = Math.max(m.top, c.top, MIN_TOP);
  const bottom = Math.max(m.bottom, c.bottom, MIN_BOTTOM);
  const textW = m.w;
  const chipX = textW + TEXT_GAP;
  const t: LabelLayout = {
    w: (chip ? chipX + c.w : textW) + 2 * LABEL_PAD,
    h: top + bottom + 2 * LABEL_PAD,
    baseline: LABEL_PAD + top,
    textW,
    chipX,
    chipW: c.w,
  };
  if (cache.size > 4000) cache.clear();
  cache.set(key, t);
  return t;
}

/** Opacity steps: node opacities are quantised to 1/`ALPHA_STEPS` for drawing and for the frame signature (finer than the eye tells apart, coarse enough that a slow fade is not redrawn for nothing). */
export const ALPHA_STEPS = 64;
export const quantAlpha = (a: number): number => Math.round(Math.min(1, Math.max(0, a)) * ALPHA_STEPS) / ALPHA_STEPS;

/** A rectangle in whole cells: columns `c0 .. c1 - 1`, rows `r0 .. r1 - 1`. */
export interface CellRect {
  c0: number;
  r0: number;
  c1: number;
  r1: number;
}

/** How a box is drawn. */
export interface BoxStyle {
  /** Opacity of the outline (0..1): the node's fade. */
  alpha: number;
  /** Opacity of the interior mask (0..1; 0 = hollow): the page colour over what is inside, so the area looks empty. */
  fillAlpha: number;
  /** One uninterrupted line all round (the hovered, focused or selected box); else the four corners are solid and the rest of each edge is dashed. */
  solid?: boolean;
}

/** The resting outline: each corner has an arm of this many solid cells along both of its edges, the rest of the edge is dashes. */
export const CORNER_ARM = 3;
/** Dashes between the corner arms: this many cells lit, then this many dark, counted from the end of an arm (so a dash pattern is anchored at the corners and does not slide when the box grows). */
export const DASH_ON = 2;
export const DASH_OFF = 2;

/** Whether cell `i` of an edge of `n` cells is part of the line: the corner arms and, when `solid`, everything; else the dashes between the arms. Symmetric: the edge reads the same from both ends. */
export function edgeLit(i: number, n: number, solid: boolean): boolean {
  if (solid) return true;
  const d = Math.min(i, n - 1 - i); // distance from the nearest corner
  if (d < CORNER_ARM) return true;
  return (d - CORNER_ARM) % (DASH_ON + DASH_OFF) >= DASH_OFF;
}

/**
 * A box: a one-cell outline in the ink around the cells of `rect` and, inside it, the interior mask in the page colour. At rest
 * the four corners are solid and the rest of each edge is dashed (so a map of boxes is quiet); hovered, focused or selected
 * (`solid`) it is one uninterrupted line. It is one cell thick in every state: nothing doubles. The mask stops short of the
 * outline, so a translucent outline is composited over the map exactly like an opaque one is.
 */
export function drawBox(buf: PixelBuffer, rect: CellRect, tones: LabelTones, style: BoxStyle): void {
  const w = rect.c1 - rect.c0;
  const h = rect.r1 - rect.r0;
  if (style.fillAlpha > 0) buf.fillRect(rect.c0 + 1, rect.r0 + 1, w - 2, h - 2, tones.bg, style.fillAlpha);
  const solid = !!style.solid;
  for (let i = 0; i < w; i++) {
    if (!edgeLit(i, w, solid)) continue;
    buf.set(rect.c0 + i, rect.r0, tones.ink, style.alpha);
    if (h > 1) buf.set(rect.c0 + i, rect.r1 - 1, tones.ink, style.alpha);
  }
  for (let j = 1; j < h - 1; j++) {
    if (!edgeLit(j, h, solid)) continue;
    buf.set(rect.c0, rect.r0 + j, tones.ink, style.alpha);
    if (w > 1) buf.set(rect.c1 - 1, rect.r0 + j, tones.ink, style.alpha);
  }
}

/**
 * Draw a label whose anchor is column `col` (the box's left edge) and whose plate's top row is `row`: the page-colour plate
 * (no outline), the name in the ink and the bold weight and, for a group, the counter in the ink and the normal weight, on the
 * SAME baseline. All of it at opacity `alpha`.
 */
export function drawLabel(buf: PixelBuffer, col: number, row: number, text: string, chip: string | null, layout: LabelLayout, alpha: number, tones: LabelTones): void {
  buf.fillRect(col - LABEL_PAD, row, layout.w, layout.h, tones.bg, alpha);
  buf.text(text, col, row + layout.baseline, tones.ink, alpha, true);
  if (chip && layout.chipW) buf.text(chip, col + layout.chipX, row + layout.baseline, tones.ink, alpha);
}

/**
 * Where the label (`h` cells high) of a box goes: its plate's last row is the row just above the box's top edge, the anchor
 * on the box's left edge; inside the box (below the top edge) when it would leave the top of the grid.
 */
export function labelCell(rect: CellRect, h: number): { col: number; row: number; inside: boolean } {
  const row = rect.r0 - h;
  return row >= 0 ? { col: rect.c0, row, inside: false } : { col: rect.c0, row: rect.r0 + 1, inside: true };
}

/* ------------------------------------------------------------------------------------------------------------------ DOM */

/** The canvas that shows a `PixelBuffer`: `cols x rows` pixels, scaled up by `cell` CSS px each with nearest-neighbour. */
export class PixelOverlay {
  readonly canvas: HTMLCanvasElement;
  readonly buf = new PixelBuffer();
  private ctx: CanvasRenderingContext2D | null;
  private image: ImageData | null = null;
  private signature = NaN;
  private prev = { minX: 1, maxX: 0, minY: 1, maxY: 0 };
  /** Frames drawn and skipped since creation (checks and tests). */
  drawn = 0;
  skipped = 0;
  private left = 0;
  private top = 0;
  private cell = 3;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("aria-hidden", "true");
    Object.assign(this.canvas.style, {
      position: "absolute",
      left: "0",
      top: "0",
      imageRendering: "pixelated",
      pointerEvents: "none",
      userSelect: "none",
    } satisfies Partial<CSSStyleDeclaration>);
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: false });
    parent.append(this.canvas);
  }

  /** Grid: `cols x rows` cells of `cell` CSS px, the top-left of cell (0, 0) at (`left`, `top`) CSS px of the parent. */
  layout(cols: number, rows: number, cell: number, left: number, top: number): void {
    if (cols === this.buf.cols && rows === this.buf.rows && cell === this.cell && left === this.left && top === this.top) return;
    this.cell = cell;
    this.left = left;
    this.top = top;
    if (cols !== this.buf.cols || rows !== this.buf.rows) {
      this.buf.resize(cols, rows);
      this.canvas.width = cols;
      this.canvas.height = rows;
      // The buffer's words ARE the image's pixels (straight RGBA), so a frame is uploaded without a conversion pass.
      this.image = this.ctx ? new ImageData(new Uint8ClampedArray(this.buf.data.buffer), cols, rows) : null;
      this.prev = { minX: 1, maxX: 0, minY: 1, maxY: 0 };
    }
    Object.assign(this.canvas.style, {
      width: `${cols * cell}px`,
      height: `${rows * cell}px`,
      left: `${left}px`,
      top: `${top}px`,
    } satisfies Partial<CSSStyleDeclaration>);
    this.signature = NaN; // redraw
  }

  /** The palette: one `[r, g, b]` (0..1) per level, page colour first and ink last. */
  setRamp(ramp: readonly (readonly [number, number, number])[]): void {
    this.buf.setRamp(ramp);
    this.signature = NaN;
  }

  /** Force the next `frame` to redraw (the content changed in a way the signature does not see). */
  invalidate(): void {
    this.signature = NaN;
  }

  /**
   * Draw a frame: when `signature` equals the last frame's nothing is touched (the boxes did not change); else the previous
   * frame's cells are cleared, `draw` paints the new ones, and only the changed region is uploaded. Returns whether it drew.
   */
  frame(signature: number, draw: (buf: PixelBuffer) => void): boolean {
    if (signature === this.signature) {
      this.skipped++;
      return false;
    }
    this.signature = signature;
    const b = this.buf;
    if (!this.ctx || !this.image || b.cols === 0) return false;
    this.prev = { minX: b.minX, maxX: b.maxX, minY: b.minY, maxY: b.maxY };
    b.clearDirty();
    b.resetDirty();
    draw(b);
    this.upload();
    this.drawn++;
    return true;
  }

  private upload() {
    const b = this.buf;
    const p = this.prev;
    const hasPrev = p.minX <= p.maxX;
    if (!b.dirty && !hasPrev) return;
    const x0 = Math.min(b.dirty ? b.minX : Infinity, hasPrev ? p.minX : Infinity);
    const x1 = Math.max(b.dirty ? b.maxX : -1, hasPrev ? p.maxX : -1);
    const y0 = Math.min(b.dirty ? b.minY : Infinity, hasPrev ? p.minY : Infinity);
    const y1 = Math.max(b.dirty ? b.maxY : -1, hasPrev ? p.maxY : -1);
    this.ctx!.putImageData(this.image!, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  }

  dispose(): void {
    this.canvas.remove();
    this.image = null;
  }
}

/** A cheap hash step (FNV-1a over 32-bit integers) for frame signatures. */
export const hashStep = (h: number, v: number): number => Math.imul((h ^ (v | 0)) >>> 0, 16777619) >>> 0;
export const HASH_SEED = 2166136261;
