/**
 * Boxes and labels on the art-pixel grid, shared by the Three.js globe and the street overlay (pure drawing, unit tested;
 * `PixelOverlay` is the only part that touches the DOM).
 *
 * Everything the map overlay says is drawn into a `PixelBuffer` whose cells are the art pixels of the map (`ART_PIXEL` in
 * engine/tuning.ts, the same constant both maps use), shown on a `cols x rows` canvas scaled up with
 * `image-rendering: pixelated`. So every outline, plate and glyph is whole cells at whole-cell positions, one cell thick: the
 * type has the resolution of the map and no stem is thinner than a map pixel. The text is the pixel font of
 * `pixel-font/pixel-font.ts` (Fusion Pixel 10px, OFL), one weight.
 *
 * The look is an object detector's: every place and every group is a RECTANGLE (its bounding box, one cell thick: solid corner
 * arms with dashes between them, anchored to the box's edges, one solid line when selected), whose interior is MASKED to the
 * page colour (a fill that looks like nothing: the area is outlined with its contents hidden) while the rectangle is clamped to the
 * minimum size, and hollow once it has its true size. Its LABEL is text only: no outline, no tab, on a plate of the page colour
 * with `LABEL_PAD` cells of room around the text on every side. The name and, for a group, its counter ("<N> entries") in a
 * lower colour level after a clear gap, on exactly the same baseline. Where the plate goes is `labelCandidates` (a prioritised list)
 * and engine/label-plan.ts (which of them is free).
 *
 * COLOUR is the state (`labelTones`): at rest the box and its text are the palette's `peak` level, the loudest map tone; hovered or
 * focused, the ink (the colour only: the stroke is the same dashes); selected, the ink and one uninterrupted line. The counter is a
 * level below the name, never below the AA floor of text. Levels, never opacity, say it: opacity is only the node's own fade.
 * FADES are opacity: everything a node draws (outline, interior mask, plate, text) is composited with the node's alpha over what is
 * underneath, per art cell (`PixelBuffer`), so there is no darker or lighter shade that could occlude the map at the faintest
 * step; the art-pixel grid itself is untouched (no sub-pixel position, no smoothing).
 */
import { PixelBuffer } from "./pixel-buffer";
import { peakLevel, roleLevel } from "./palette";
import { FONT_CAP, FONT_DESCENT, measureText } from "./pixel-font/pixel-font";

/** One state's palette levels: the outline, the name and the counter. */
export interface Tone {
  box: number;
  name: number;
  count: number;
}

/** Palette levels the drawing needs, from the theme's ramp length (and, for the text, the lowest level that is AA text on the page). */
export interface LabelTones {
  /** The page colour (level 0): plates and the interior mask. */
  bg: number;
  /** Neither hovered nor focused nor selected: the lower elevation. */
  rest: Tone;
  /** Hovered, focused or selected: the ink. */
  active: Tone;
}

/**
 * The tones for a ramp of `levels` levels. `textFloor` is the lowest level whose contrast with the page is AA for text
 * (`textFloorLevel` in engine/palette.ts, from the real colours); the counter is one level below the name but never below it.
 */
export function labelTones(levels: number, textFloor: number = peakLevel(levels)): LabelTones {
  const peak = roleLevel("peak", levels);
  const ink = roleLevel("ink", levels);
  const dimmer = (name: number) => Math.max(textFloor, name - 1);
  return { bg: 0, rest: { box: peak, name: peak, count: dimmer(peak) }, active: { box: ink, name: ink, count: dimmer(ink) } };
}

export interface LabelState {
  selected: boolean;
  focused: boolean;
  hover: boolean;
}

/** The text of a group's counter: "<N> entries", "1 entry" when singular. */
export const chipText = (count: number): string => `${count} ${count === 1 ? "entry" : "entries"}`;

/**
 * Geometry of a label's plate in whole cells, relative to the plate's top-left cell: the page-colour plate spans `w x h`, the name
 * starts `LABEL_PAD` cells in, on the baseline row `baseline`.
 */
export interface LabelLayout {
  /** Plate width and height, counter included. */
  w: number;
  h: number;
  /** Row of the baseline from the plate's top (the name's and the counter's: the same). */
  baseline: number;
  /** Width of the name in cells. */
  textW: number;
  /** Counter: offset of its first column from the plate's left and its text width (0 without a counter). */
  chipX: number;
  chipW: number;
}

/**
 * Clear cells between the text and the edge of its plate, on every side: above the capitals, below the descenders, left and right.
 * The plate sits flush on the box's top edge (outside) or flush inside its outline (nested), so this is also the room between the
 * box's border and the text: the label is centred in its plate and in the inner margin of a box it is nested in.
 */
export const LABEL_PAD = 3;
/** Empty cells between the name and its counter: wide enough that the two runs read as separate blocks (6 cells = 15 CSS px at 2.5 px). */
export const TEXT_GAP = 6;

const cache = new Map<string, LabelLayout>();

/** The layout of a label: `chip` is the group's counter text, "<N> entries" (null for a place). */
export function labelLayout(text: string, chip: string | null): LabelLayout {
  const key = `${chip ?? ""}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const m = measureText(text);
  const c = chip ? measureText(chip) : { w: 0, top: 0, bottom: 0 };
  // Every plate reserves the capitals above the baseline and the descenders below it, so the baseline is the same distance from the
  // box's border whatever the text (a name with a g does not sit higher than one without); a tall mark (É, Å) makes the plate taller.
  const top = Math.max(m.top, c.top, FONT_CAP);
  const bottom = Math.max(m.bottom, c.bottom, FONT_DESCENT);
  const chipX = LABEL_PAD + m.w + TEXT_GAP;
  const t: LabelLayout = {
    w: (chip ? chipX + c.w : LABEL_PAD + m.w) + LABEL_PAD,
    h: LABEL_PAD + top + bottom + LABEL_PAD,
    baseline: LABEL_PAD + top,
    textW: m.w,
    chipX,
    chipW: c.w,
  };
  if (cache.size > 4000) cache.clear();
  cache.set(key, t);
  return t;
}

/** Fewest characters (the ellipsis included) a name is truncated to. */
export const MIN_LABEL_CHARS = 6;
const TRAILING = /[\s,;:.\-–—]+$/;

/** One way to write a label: the text, the counter (or none) and its layout. */
export interface LabelVariant {
  text: string;
  chip: string | null;
  layout: LabelLayout;
}

const variantCache = new Map<string, LabelVariant[]>();

/**
 * The ways a label can be written, widest first: the whole label, without its counter, without the country that follows a place's
 * name, then the name truncated one character at a time with an ellipsis glyph, down to `MIN_LABEL_CHARS` characters (never fewer).
 * The first is what the label wants; the others are what the label plan falls back to when there is no room for it.
 */
export function labelVariants(text: string, chip: string | null): LabelVariant[] {
  const key = `${chip ?? ""}|${text}`;
  const hit = variantCache.get(key);
  if (hit) return hit;
  const seen = new Set<string>();
  const out: LabelVariant[] = [];
  const add = (t: string, c: string | null) => {
    const k = `${c ?? ""}|${t}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ text: t, chip: c, layout: labelLayout(t, c) });
  };
  add(text, chip);
  if (chip) add(text, null);
  const whole = labelLayout(text, null).w;
  // the shorter ways must really be narrower (the ellipsis is a wide glyph: cutting one letter does not shorten a label)
  const shorter = (t: string) => (labelLayout(t, null).w < whole ? add(t, null) : undefined);
  const comma = text.lastIndexOf(", ");
  if (comma >= MIN_LABEL_CHARS) shorter(text.slice(0, comma));
  const chars = Array.from(text);
  for (let n = chars.length - 1; n >= MIN_LABEL_CHARS; n--) shorter(chars.slice(0, n - 1).join("").replace(TRAILING, "") + "…");
  out.sort((a, b) => b.layout.w - a.layout.w); // stable: the whole label stays first
  if (variantCache.size > 2000) variantCache.clear();
  variantCache.set(key, out);
  return out;
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
  /** Hovered, focused or selected: the outline is the ink instead of the rest tone (the colour; the stroke does not change). */
  active?: boolean;
  /** One uninterrupted line all round (the selected box); else the four corners are solid and the rest of each edge is dashed (at rest and hovered alike). */
  solid?: boolean;
}

/**
 * The resting outline: each corner has a solid ARM along both of its edges and the rest of the edge is DASHES (`DASH_ON` cells lit, then
 * a gap), counted from the corner the edge is ANCHORED to (below). How long the arms and the gaps are depends on the box's on-screen size
 * (`dashingFor`): a big box has long, noticeable arms and scarce dashes, a small one short arms and denser dashes, a tiny one just a
 * solid outline.
 */
export const BOX_STYLE = {
  /** Cells lit in every dash. */
  dashOn: 2,
  /** Corner arm in cells: `frac` of the box's smaller side, between `min` and `max`. */
  arm: { frac: 0.1, min: 3, max: 14 },
  /** Gap between dashes in cells: `frac` of the box's smaller side, between `min` and `max`. */
  gap: { frac: 0.035, min: 2, max: 9 },
} as const;

/** How one box is dashed: arm length and gap, in cells. */
export interface Dashing {
  arm: number;
  gap: number;
}

const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

/** The arm and gap of a box of `w x h` cells (by the smaller side: both axes share them, so the four corners match). */
export function dashingFor(w: number, h: number): Dashing {
  const side = Math.min(w, h);
  return { arm: clampInt(side * BOX_STYLE.arm.frac, BOX_STYLE.arm.min, BOX_STYLE.arm.max), gap: clampInt(side * BOX_STYLE.gap.frac, BOX_STYLE.gap.min, BOX_STYLE.gap.max) };
}

/**
 * Whether cell `i` of an edge of `n` cells is part of the line, counting from the edge's ANCHOR (cell 0): the arm at the anchor, then
 * the dashes (a gap, `DASH_ON` lit, a gap ...), and the arm at the far end. The pattern starts at the anchor, so it does not move when the
 * edge grows or shrinks: only the far end does (the dashes near it, and the far arm, follow the end). `drawBox` anchors the top edge at
 * its left corner, the bottom edge at its right corner, the left edge at its top and the right edge at its bottom: the box is
 * rotationally symmetric and each side keeps its dashes while the box is resized. An edge too short to hold two arms and a gap between them is
 * solid (the arms never overflow or overlap: a tiny box degrades to a plain outline).
 */
export function edgeLit(i: number, n: number, solid: boolean, dash: Dashing = dashingFor(n, n)): boolean {
  if (solid || n < 2 * dash.arm + dash.gap) return true;
  if (i < dash.arm || i >= n - dash.arm) return true;
  return (i - dash.arm) % (BOX_STYLE.dashOn + dash.gap) >= dash.gap;
}

/**
 * A box: a one-cell outline around the cells of `rect` and, inside it, the interior mask in the page colour. The outline is the rest
 * tone, or the ink when `active`. At rest and hovered the four corners are solid and the rest of each edge is dashed (a map of boxes is
 * quiet; `dashingFor` sizes the arms and the gaps by the box's size, and `edgeLit` anchors each edge to one corner); selected (`solid`) it is
 * one uninterrupted line. It is one cell thick in every state: nothing doubles. The mask stops short of the outline, so a translucent
 * outline is composited over the map exactly like an opaque one is.
 */
export function drawBox(buf: PixelBuffer, rect: CellRect, tones: LabelTones, style: BoxStyle): void {
  const w = rect.c1 - rect.c0;
  const h = rect.r1 - rect.r0;
  if (style.fillAlpha > 0) buf.fillRect(rect.c0 + 1, rect.r0 + 1, w - 2, h - 2, tones.bg, style.fillAlpha);
  const solid = !!style.solid;
  const level = (style.active ? tones.active : tones.rest).box;
  const dash = dashingFor(w, h);
  for (let i = 0; i < w; i++) {
    if (edgeLit(i, w, solid, dash)) buf.set(rect.c0 + i, rect.r0, level, style.alpha); // top: anchored at its left corner
    if (h > 1 && edgeLit(w - 1 - i, w, solid, dash)) buf.set(rect.c0 + i, rect.r1 - 1, level, style.alpha); // bottom: at its right corner
  }
  for (let j = 1; j < h - 1; j++) {
    if (edgeLit(j, h, solid, dash)) buf.set(rect.c0, rect.r0 + j, level, style.alpha); // left: at its top
    if (w > 1 && edgeLit(h - 1 - j, h, solid, dash)) buf.set(rect.c1 - 1, rect.r0 + j, level, style.alpha); // right: at its bottom
  }
}

/**
 * Draw a label whose plate's top-left cell is (`x`, `y`): the page-colour plate (no outline), the name in the state's name level and, for a
 * group, the counter a level below it, on the SAME baseline. All of it at opacity `alpha`.
 */
export function drawLabel(buf: PixelBuffer, x: number, y: number, text: string, chip: string | null, layout: LabelLayout, alpha: number, tones: LabelTones, active: boolean): void {
  const tone = active ? tones.active : tones.rest;
  buf.fillRect(x, y, layout.w, layout.h, tones.bg, alpha);
  buf.text(text, x + LABEL_PAD, y + layout.baseline, tone.name, alpha);
  if (chip && layout.chipW) buf.text(chip, x + layout.chipX, y + layout.baseline, tone.count, alpha);
}

/** The grid a label has to fit in. */
export interface GridSize {
  cols: number;
  rows: number;
}

/** A place for a label's plate: the cell of its top-left corner, whether it is inside the box, and which candidate it is (`SPOT`, the priority and the identity kept between frames). */
export interface LabelSpot {
  id: number;
  x: number;
  y: number;
  inside: boolean;
}

/** The candidate positions, in priority order: the ids are stable, so a frame can say "same as last time". */
export const SPOT = {
  aboveLeft: 0,
  aboveRight: 1,
  aboveVisibleLeft: 2,
  aboveVisibleRight: 3,
  insideTopLeft: 4,
  insideBottomLeft: 5,
  insideTopRight: 6,
  insideBottomRight: 7,
  belowLeft: 8,
  belowRight: 9,
  left: 10,
  right: 11,
  aboveShift: 12, // 12, 13, 14
  belowShift: 15, // 15, 16, 17
} as const;

/**
 * The places a label plate of `w x h` cells can go for a box, in priority order, each entirely on the grid (a position that would leave it
 * is not a candidate): above the box's top-left corner (the first choice: flush on the edge, left-aligned), above its top-right corner,
 * above the visible part of the top edge when the corner is off screen, nested inside the box in each of its inner corners (flush inside the
 * outline, so the text has `LABEL_PAD` cells of room to the border on both sides: only when the plate fits inside), below, to the left and to the
 * right of the box, and shifted along the top and the bottom edges (a quarter, a half and three quarters of the way). Positions are
 * relative to the VISIBLE part of the box where its corners are off the grid, so a big box zoomed into always has a label on screen.
 */
export function labelCandidates(rect: CellRect, w: number, h: number, grid: GridSize): LabelSpot[] {
  const xl = Math.max(rect.c0, 0);
  const xr = Math.min(rect.c1, grid.cols);
  const yt = Math.max(rect.r0, 0);
  const yb = Math.min(rect.r1, grid.rows);
  const out: LabelSpot[] = [];
  const seen = new Set<number>();
  const add = (id: number, x: number, y: number, inside = false) => {
    if (x < 0 || y < 0 || x + w > grid.cols || y + h > grid.rows) return;
    const key = x * 65536 + y;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ id, x, y, inside });
  };
  const fits = xr - xl - 2 >= w && yb - yt - 2 >= h;
  add(SPOT.aboveLeft, rect.c0, rect.r0 - h);
  add(SPOT.aboveRight, rect.c1 - w, rect.r0 - h);
  add(SPOT.aboveVisibleLeft, xl, rect.r0 - h);
  add(SPOT.aboveVisibleRight, xr - w, rect.r0 - h);
  if (fits) {
    add(SPOT.insideTopLeft, xl + 1, yt + 1, true);
    add(SPOT.insideBottomLeft, xl + 1, yb - 1 - h, true);
    add(SPOT.insideTopRight, xr - 1 - w, yt + 1, true);
    add(SPOT.insideBottomRight, xr - 1 - w, yb - 1 - h, true);
  }
  add(SPOT.belowLeft, rect.c0, rect.r1);
  add(SPOT.belowRight, rect.c1 - w, rect.r1);
  add(SPOT.left, rect.c0 - w, rect.r0);
  add(SPOT.right, rect.c1, rect.r0);
  const span = xr - w - xl;
  if (span > 2) {
    for (let k = 0; k < 3; k++) {
      const x = xl + Math.round((span * (k + 1)) / 4);
      add(SPOT.aboveShift + k, x, rect.r0 - h);
    }
    for (let k = 0; k < 3; k++) {
      const x = xl + Math.round((span * (k + 1)) / 4);
      add(SPOT.belowShift + k, x, rect.r1);
    }
  }
  return out;
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
