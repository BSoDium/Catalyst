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
import { chipText } from "./label-text";
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

export { chipText };

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
  /** How open the box is, 0 (a closed rectangle: it is at its floor size) to 1 (arms and dashes in full; the default): `boxOpenness`. */
  open?: number;
}

/**
 * The resting outline: each corner has a solid ARM along both of its edges and the rest of the edge is DASHES (`DASH_ON` cells lit, then
 * a gap), counted from the corner the edge is ANCHORED to (below). How long the arms and the gaps are depends on the box's on-screen size
 * (`dashingFor`): a big box has long, noticeable arms and scarce dashes, a small one short arms and denser dashes, and a box at its floor
 * size (`LOD.minBoxCells`) is a plain closed rectangle that OPENS into this look as its true size grows (`BOX_STYLE.open`, `boxOpenness`).
 */
export const BOX_STYLE = {
  /** Cells lit in every dash. */
  dashOn: 2,
  /** Corner arm in cells: `frac` of the box's smaller side, between `min` and `max`. */
  arm: { frac: 0.1, min: 3, max: 14 },
  /** Gap between dashes in cells: `frac` of the box's smaller side, between `min` and `max`. */
  gap: { frac: 0.035, min: 2, max: 9 },
  /**
   * How the box opens (2026-10-13, owner: a city's box at its floor size should be a rectangle that splits into corners and dashes as it grows).
   * The box's TRUE size, as a multiple of its floor size, goes from `from` (the gap is 0: a closed rectangle, whatever the arm) to `to` (the full
   * look): the gap grows from 0 to its full value on a straight line and is rounded to whole cells, so the rectangle gets a one cell notch in
   * the middle of each edge, then a wider one, then its dashes. A corner arm that is at least half of the side with no gap IS a rectangle, so
   * there is no pop: the picture changes by a cell at a time, and only where the size crosses a threshold.
   */
  open: { from: 1, to: 2 },
  /**
   * A LOPSIDED box (2026-10-20, owner: a very wide and short box, or a narrow and tall one, was drawn as a plain closed rectangle, because its short
   * side sets the arms and how open it is): when the long side is at least this many times the short one, the two short sides are solid and the two
   * long ones are dashed like the edges of a big box (arm and gap by the long side, fully open). The dashes say "not selected"; two edges that long
   * are never corners.
   */
  lopsided: 3,
} as const;

/** How one box is dashed: arm length and gap, in cells. */
export interface Dashing {
  arm: number;
  gap: number;
}

const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

/**
 * How open a box is, 0 (a closed rectangle: its true size is at its floor or under) to 1 (the full corner-and-dash look): from the box's TRUE
 * size (the SMALLER of its width and height as projected, before the floor is applied: the arms and the gaps are sized by the short side) against the
 * floor size, both in px. Monotone and
 * continuous in the size. Not a function of the snapped box, so a floor-sized box that breathes by a cell while the globe turns keeps one look.
 */
export function boxOpenness(truePx: number, floorPx: number): number {
  if (!(floorPx > 0) || !Number.isFinite(truePx)) return 1;
  const { from, to } = BOX_STYLE.open;
  return Math.max(0, Math.min(1, (truePx / floorPx - from) / (to - from)));
}

/**
 * The arm and gap of a box of `w x h` cells (by the smaller side: both axes share them, so the four corners match) at openness `open` (0..1,
 * `boxOpenness`; 1 by default: the full look). The arm is the one of the full look (it does not show while the gap is 0), the gap runs from 0
 * to the full look's on a straight line, in whole cells: non-decreasing in the size, and 0 gives a closed rectangle.
 */
export function dashingFor(w: number, h: number, open = 1): Dashing {
  const side = Math.min(w, h);
  const gapFull = clampInt(side * BOX_STYLE.gap.frac, BOX_STYLE.gap.min, BOX_STYLE.gap.max);
  const o = Math.max(0, Math.min(1, open));
  return { arm: clampInt(side * BOX_STYLE.arm.frac, BOX_STYLE.arm.min, BOX_STYLE.arm.max), gap: o >= 1 ? gapFull : Math.round(gapFull * o) };
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
 * quiet; `dashingFor` sizes the arms and the gaps by the box's size and how far it has opened from its floor, and `edgeLit` anchors each edge to one corner); selected (`solid`) it is
 * one uninterrupted line. It is one cell thick in every state: nothing doubles. The mask stops short of the outline, so a translucent
 * outline is composited over the map exactly like an opaque one is.
 */
export function drawBox(buf: PixelBuffer, rect: CellRect, tones: LabelTones, style: BoxStyle): void {
  const w = rect.c1 - rect.c0;
  const h = rect.r1 - rect.r0;
  if (style.fillAlpha > 0) buf.fillRect(rect.c0 + 1, rect.r0 + 1, w - 2, h - 2, tones.bg, style.fillAlpha);
  const solid = !!style.solid;
  const level = (style.active ? tones.active : tones.rest).box;
  // A lopsided box: the short sides are solid, the long ones dashed as a big box's are (`BOX_STYLE.lopsided`); else the one look for all four.
  const wide = w >= BOX_STYLE.lopsided * h && w >= 2 * BOX_STYLE.arm.min + 2 * BOX_STYLE.gap.min + BOX_STYLE.dashOn; // (an edge too short to hold two arms and a dash stays as it is)
  const tall = h >= BOX_STYLE.lopsided * w && h >= 2 * BOX_STYLE.arm.min + 2 * BOX_STYLE.gap.min + BOX_STYLE.dashOn;
  const dash = wide || tall ? dashingFor(Math.max(w, h), Math.max(w, h)) : dashingFor(w, h, style.open ?? 1);
  const solidH = solid || tall; // the top and the bottom are the short sides of a tall box
  const solidV = solid || wide;
  for (let i = 0; i < w; i++) {
    if (edgeLit(i, w, solidH, dash)) buf.set(rect.c0 + i, rect.r0, level, style.alpha); // top: anchored at its left corner
    if (h > 1 && edgeLit(w - 1 - i, w, solidH, dash)) buf.set(rect.c0 + i, rect.r1 - 1, level, style.alpha); // bottom: at its right corner
  }
  for (let j = 1; j < h - 1; j++) {
    if (edgeLit(j, h, solidV, dash)) buf.set(rect.c0, rect.r0 + j, level, style.alpha); // left: at its top
    if (w > 1 && edgeLit(h - 1 - j, h, solidV, dash)) buf.set(rect.c1 - 1, rect.r0 + j, level, style.alpha); // right: at its bottom
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

/** A place for a label's plate: the corner of its top-left, whether it is inside the box, and which candidate it is (`SPOT`, the priority and the identity kept between frames). */
export interface LabelSpot {
  id: number;
  x: number;
  y: number;
  inside: boolean;
}

/**
 * The candidate positions, in priority order: the ids are stable, so a frame can say "same as last time", and a lower id is a better
 * position (the planner ranks by it). ONE anchor is preferred everywhere: outside, above the box's top-left corner, so a visitor learns
 * where to look; when that does not fit (the box is at the top of the screen, a neighbour's plate is there) the label goes inside the
 * box's top-left corner (the same corner, the other side of the line); the other places (right-aligned above, shifted along the top
 * edge, the other inner corners, below, beside) are the last resorts, in that order.
 */
export const SPOT = {
  aboveLeft: 0,
  aboveVisibleLeft: 1,
  insideTopLeft: 2,
  aboveRight: 3,
  aboveVisibleRight: 4,
  aboveShift: 5, // 5, 6, 7
  insideTopRight: 8,
  insideBottomLeft: 9,
  insideBottomRight: 10,
  belowLeft: 11,
  belowRight: 12,
  belowShift: 13, // 13, 14, 15
  left: 16,
  right: 17,
} as const;
/** Number of candidate ids. */
export const SPOT_COUNT = 18;

/**
 * Units of the geometry. The positions are unit-free: whole cells for the pixel text (`inset` 1 cell, the default) or CSS px for the
 * DOM labels of the boxes (engine/label-plan.ts: `inset` the thickness of the box's outline, `quant` the step the shifted positions snap to).
 */
export interface SpotUnits {
  /** How far a nested plate sits inside the outline (the outline's thickness). Default 1. */
  inset?: number;
  /** Positions along the edges are multiples of this from the visible left edge. Default 1; 0: exact (a label that follows its box smoothly). */
  quant?: number;
  /** Clear room between a plate outside the box and the box's outline (above, below, left, right). Default 0 (the pixel text is flush). */
  gap?: number;
  /** How far a plate aligned with a box edge sticks out past it, so that the TEXT (which has padding inside its plate) lines up with the edge. Default 0. */
  bleed?: number;
  /** The same for a plate beside its box (`left`, `right`): its top sticks out this far above the box's top edge. Default 0. */
  bleedY?: number;
  /** A plate that would stick out of the grid is pulled back inside it (it slides along its box's edge, or stays at the screen's edge over the box) instead of being refused: the position of a label that is kept while its box moves. */
  slide?: boolean;
  /**
   * The art-pixel lattice: every position is a whole number of `cell` from (`ox`, `oy`) (the grid's own origin), so a plate moves only in
   * whole art cells, in lockstep with the box it is anchored to (which is on the same lattice). A plate above or to the left of its box, and
   * one nested against its bottom or right edge, is rounded DOWN (away from the box: the clear room is never smaller than asked for), the
   * others to the nearest cell. Absent: the positions are exact (the pixel text, tests).
   */
  lattice?: Lattice;
}

/**
 * How far the CARD moves when its label is selected, in units of the plate's bleed: the plate of a label at rest hangs outside its box's edge so
 * that the text is flush with it (`bleed`); the selected label is a card whose plate is flush with the box instead, so it moves towards the box
 * by exactly what hung out. A left-aligned plate (above or below, at the box's left edge) moves right, a right-aligned one left, one beside its
 * box down (its top is flush with the box's top edge); a nested one, or one shifted along an edge, is where it is (no edge to align with).
 * The drawn plate (DOM transform) and the plate the hit hull and the plan reserve both come from this one function.
 */
export function selectedShift(id: number, bleed: number, bleedY: number): { dx: number; dy: number } {
  switch (id) {
    case SPOT.aboveLeft:
    case SPOT.aboveVisibleLeft:
    case SPOT.belowLeft:
      return { dx: bleed, dy: 0 };
    case SPOT.aboveRight:
    case SPOT.aboveVisibleRight:
    case SPOT.belowRight:
      return { dx: -bleed, dy: 0 };
    case SPOT.left:
    case SPOT.right:
      return { dx: 0, dy: bleedY };
    default:
      return { dx: 0, dy: 0 };
  }
}

/**
 * How far the CARD actually moves when its label is selected: `selectedShift`'s nominal move, limited to what was really hanging out. A plate that
 * was held on the screen by the clamp or slid back by `spotAt` at the screen's edge (a box at x = 3 has a plate at 0, not at 3 - bleed) is already
 * nearer its box's edge than `bleed`, and moving it by the whole `bleed` would leave the card that much off the box. `plate`: where the plate is (its
 * top-left corner) and its width; `box`: the box's rectangle, in the same units.
 */
export function selectedShiftAt(id: number, bleed: number, bleedY: number, plate: { x: number; y: number; w: number }, box: { c0: number; c1: number; r0: number; r1?: number }): { dx: number; dy: number } {
  const s = selectedShift(id, bleed, bleedY);
  if (s.dx > 0) return { dx: Math.max(0, Math.min(s.dx, box.c0 - plate.x)), dy: 0 };
  if (s.dx < 0) return { dx: Math.min(0, Math.max(s.dx, box.c1 - plate.w - plate.x)), dy: 0 };
  if (s.dy > 0) return { dx: 0, dy: Math.max(0, Math.min(s.dy, box.r0 - plate.y)) };
  return s;
}

/** The art-pixel grid as a lattice of positions: `cell` CSS px, with a lattice point at (`ox`, `oy`). */
export interface Lattice {
  cell: number;
  ox: number;
  oy: number;
}

const EPS = 1e-6;
/** `v` on the lattice of step `cell` through `origin`: rounded down when `down`, else to the nearest point. */
export function snapToLattice(v: number, origin: number, cell: number, down = false): number {
  const k = (v - origin) / cell;
  return origin + (down ? Math.floor(k + EPS) : Math.round(k)) * cell;
}

/** `v` clamped to `lo .. hi`, on the lattice (`origin`, `cell`) when there is one: the nearest lattice point inside the range (the range itself when it holds none). */
export function clampOn(v: number, lo: number, hi: number, origin?: number, cell?: number): number {
  const r = Math.max(lo, Math.min(hi, v));
  if (origin === undefined || cell === undefined || r === v) return r;
  const k = (r - origin) / cell;
  const inside = r === lo ? origin + Math.ceil(k - EPS) * cell : origin + Math.floor(k + EPS) * cell;
  return inside >= lo - EPS && inside <= hi + EPS ? inside : r;
}

/** The plate `x, y, w, h` overlaps the box `rect` (its outline is the ring along the rectangle's edge, so any overlap covers an arm or a dash). */
export function coversBox(x: number, y: number, w: number, h: number, rect: CellRect): boolean {
  return x < rect.c1 && x + w > rect.c0 && y < rect.r1 && y + h > rect.r0;
}

/**
 * The padding that hangs outside the box's edge never takes the plate off the screen: against the screen's edge the plate stays on it (the text is
 * then up to `bleed` from the box's edge, which is itself at the screen's edge). The one function of this clamp: the planner (`spotAt`) and the cut
 * of the hierarchy (engine/lod-tree.ts `plateAt`) both call it, so the cut keeps the above-left and above-right slots of a box within `bleed` of the edge.
 */
export function holdBleedOnScreen(id: number, x: number, w: number, width: number, bleed: number): number {
  if (!(bleed > 0)) return x;
  if (id === SPOT.aboveLeft || id === SPOT.aboveVisibleLeft || id === SPOT.belowLeft) return Math.max(x, 0);
  if (id === SPOT.aboveRight || id === SPOT.aboveVisibleRight || id === SPOT.belowRight) return Math.min(x, width - w);
  return x;
}

/**
 * The place of candidate `id` for a plate of `w x h` around `rect` (the same function for a position remembered from an earlier frame and for
 * the list below), or false when it is not available: the plate would leave the grid, a nested one does not fit inside the box, or the
 * edge is too short to shift along. `out` receives the corner and whether it is nested. Positions are relative to the VISIBLE part of the box
 * where its corners are off the grid.
 */
export function spotAt(id: number, rect: CellRect, w: number, h: number, grid: GridSize, units: SpotUnits, out: { x: number; y: number; inside: boolean }): boolean {
  const inset = units.inset ?? 1;
  const quant = units.quant ?? 1; // (0 is exact, not the default)
  const gap = units.gap ?? 0;
  const bleed = units.bleed ?? 0;
  const bleedY = units.bleedY ?? 0;
  const lat = units.lattice;
  // which way a coordinate is rounded on the lattice: down (away from the box) for plates above or beside it
  let downX = false;
  let downY = false;
  const xl = Math.max(rect.c0, 0);
  const xr = Math.min(rect.c1, grid.cols);
  const yt = Math.max(rect.r0, 0);
  const yb = Math.min(rect.r1, grid.rows);
  let x = 0;
  let y = 0;
  let inside = false;
  switch (id) {
    case SPOT.aboveLeft:
      x = rect.c0 - bleed;
      y = rect.r0 - h - gap;
      downY = true;
      break;
    case SPOT.aboveRight:
      x = rect.c1 - w + bleed;
      y = rect.r0 - h - gap;
      downY = true;
      break;
    case SPOT.aboveVisibleLeft:
      x = xl - bleed;
      y = rect.r0 - h - gap;
      downY = true;
      break;
    case SPOT.aboveVisibleRight:
      x = xr - w + bleed;
      y = rect.r0 - h - gap;
      downY = true;
      break;
    case SPOT.insideTopLeft:
    case SPOT.insideBottomLeft:
    case SPOT.insideTopRight:
    case SPOT.insideBottomRight:
      if (!(xr - xl - 2 * inset >= w && yb - yt - 2 * inset >= h)) return false; // the plate has to fit inside the outline
      inside = true;
      x = id === SPOT.insideTopLeft || id === SPOT.insideBottomLeft ? xl + inset : xr - inset - w;
      y = id === SPOT.insideTopLeft || id === SPOT.insideTopRight ? yt + inset : yb - inset - h;
      downX = id === SPOT.insideTopRight || id === SPOT.insideBottomRight;
      downY = id === SPOT.insideBottomLeft || id === SPOT.insideBottomRight;
      break;
    case SPOT.belowLeft:
      x = rect.c0 - bleed;
      y = rect.r1 + gap;
      break;
    case SPOT.belowRight:
      x = rect.c1 - w + bleed;
      y = rect.r1 + gap;
      break;
    case SPOT.left:
      x = rect.c0 - w - gap;
      y = rect.r0 - bleedY;
      downX = true;
      break;
    case SPOT.right:
      x = rect.c1 + gap;
      y = rect.r0 - bleedY;
      break;
    default: {
      const k = id >= SPOT.belowShift ? id - SPOT.belowShift : id - SPOT.aboveShift;
      if (k < 0 || k > 2) return false;
      const span = xr - w - xl;
      if (!(span > 2 * inset)) return false;
      x = xl + (quant > 0 ? Math.round((span * (k + 1)) / 4 / quant) * quant : (span * (k + 1)) / 4);
      y = id >= SPOT.belowShift ? rect.r1 + gap : rect.r0 - h - gap;
      downY = id < SPOT.belowShift;
    }
  }
  x = holdBleedOnScreen(id, x, w, grid.cols, bleed);
  if (lat) {
    x = snapToLattice(x, lat.ox, lat.cell, downX);
    y = snapToLattice(y, lat.oy, lat.cell, downY);
  }
  if (units.slide && w <= grid.cols) x = clampOn(x, 0, grid.cols - w, lat?.ox, lat?.cell);
  if (units.slide && !inside && h <= grid.rows) y = clampOn(y, 0, grid.rows - h, lat?.oy, lat?.cell); // a plate above a box that is near the top of the screen slides back on screen...
  // ...but never over its own box's outline: a plate that is not nested and would cover the box (the slide pulled it over the edge) is not a position, the label takes another slot
  if (!inside && coversBox(x, y, w, h, rect)) return false;
  if (x < 0 || y < 0 || x + w > grid.cols || y + h > grid.rows) return false;
  out.x = x;
  out.y = y;
  out.inside = inside;
  return true;
}

/**
 * The places a label plate of `w x h` can go for a box, in priority order, each entirely on the grid (a position that would leave it
 * is not a candidate) and never over the box's own outline (`coversBox`): above the box's top-left corner (the one anchor: flush on the
 * edge, left-aligned), the same above the visible part of the top edge when the corner is off screen, nested inside the box's top-left
 * corner (flush inside the outline, so the text has room to the border on both sides: only when the plate fits inside), then, as
 * last resorts, above the top-right corner, shifted along the top edge (a quarter, a half and three quarters of the way), nested in the
 * other inner corners, below, to the left and to the right. Positions are relative to the VISIBLE part of the box where its corners are
 * off the grid, so a big box zoomed into always has a label on screen. Two ids that land on the same place are one candidate (the first id).
 */
export function labelCandidates(rect: CellRect, w: number, h: number, grid: GridSize, units: SpotUnits = {}): LabelSpot[] {
  const out: LabelSpot[] = [];
  const seen = new Set<number>();
  const at = { x: 0, y: 0, inside: false };
  for (let id = 0; id < SPOT_COUNT; id++) {
    if (!spotAt(id, rect, w, h, grid, units, at)) continue;
    const key = Math.round(at.x * 4) * 262144 + Math.round(at.y * 4);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id, x: at.x, y: at.y, inside: at.inside });
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
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
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
   * frame's cells are cleared, `draw` paints the new ones, and the image is uploaded whole. Returns whether it drew.
   */
  frame(signature: number, draw: (buf: PixelBuffer) => void): boolean {
    if (signature === this.signature) {
      this.skipped++;
      return false;
    }
    this.signature = signature;
    const b = this.buf;
    if (!this.ctx || !this.image || b.cols === 0) return false;
    b.clearDirty();
    b.resetDirty();
    draw(b);
    this.upload();
    this.drawn++;
    return true;
  }

  /**
   * The whole image, every time it changes. It was the changed rectangle only (a dirty-rect `putImageData`), and on Chrome for Android, whose 2D canvas is GPU-backed,
   * stale cells of boxes from earlier frames stayed behind as faint, partial outlines (a Pixel 7, 2026-10-26; not on a desktop). The canvas is a few tens of thousands of
   * cells and only redrawn when a box changed, so the whole of it costs nothing, and there is no region to get wrong. The buffer's own dirty box (`PixelBuffer`) is still
   * what the clearing of the last frame reads.
   */
  private upload() {
    this.ctx!.putImageData(this.image!, 0, 0);
  }

  dispose(): void {
    this.canvas.remove();
    this.image = null;
  }
}

/** A cheap hash step (FNV-1a over 32-bit integers) for frame signatures. */
export const hashStep = (h: number, v: number): number => Math.imul((h ^ (v | 0)) >>> 0, 16777619) >>> 0;
export const HASH_SEED = 2166136261;
