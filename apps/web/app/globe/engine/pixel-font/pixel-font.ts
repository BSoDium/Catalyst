/**
 * The pixel font of the map labels (pure, unit tested; the DOM is touched only by the optional system-font fallback).
 *
 * Tiny5 (SIL OFL 1.1, `tiny5-data.ts`): 8 px em, 5 px caps, 4 px x-height, 1 px stems, drawn on a pixel grid, baked to bit
 * rows by `scripts/font/bake-pixel-font.mjs`. Text is drawn on the ART-PIXEL grid of the map (one glyph pixel = one art
 * pixel, 3 CSS px on a desktop, 2 on a phone), at whole-cell positions, in palette levels: no anti-aliasing, no stem thinner
 * than one map pixel.
 *
 * Weights: Tiny5 has a single face, so BOLD is derived on the pixel grid by a 1-cell horizontal double strike (`emboldened`):
 * every ink pixel also lights the cell to its right (unless that would close a one-pixel counter), so 1 px stems become 2 px,
 * the glyph is one column wider and the pen advance one larger (the gap between letters is kept). Pure bit arithmetic on the
 * baked rows, so it works for every glyph the module can produce (own, composed, fallback) and stays on whole cells. `measureText` and
 * `forEachInk` take the same `bold` flag, so layout and drawing cannot disagree. A cell is emitted once, whatever the weight.
 *
 * Coverage and the rules for what the font does not have (see docs/web-architecture.md, "Pixel text"):
 *  1. The font's own glyphs: Latin, Latin Extended-A/B (Nikšić, Chișinău, Łódź, Ñ, Ø, ...), Greek, Cyrillic, punctuation.
 *  2. Composed glyphs, drawn by this module in the font's style: Vietnamese letters (ế, ộ, ơ, ư, ạ, ẵ, ...): a letter that
 *     the font has (a, â, ă, e, ê, o, ô, u, ...), a horn (one extra pixel at the top right of the letter), a tone mark
 *     (acute, grave and tilde are cut out of á, à, ã of the same case; the hook above and the dot below are drawn here),
 *     stacked above the letter or above its circumflex/breve. Any other precomposed letter whose base and marks the font
 *     has is composed the same way.
 *  3. Everything else (Arabic, CJK, symbols): the system font rasterised at `FALLBACK_PX` and thresholded at 50 % coverage,
 *     the same art resolution, no grey. It is not designed on the grid, so its quality is lower (strokes can be uneven);
 *     without a DOM (tests, server) a box is drawn instead.
 */
import { stretched } from "./stretch";
import { TINY5_DATA } from "./tiny5-data";

/** One glyph: `rows` are the bitmap rows from the top, bit `w - 1 - x` of a row is the pixel at column `x`. */
export interface Glyph {
  /** Pen advance in pixels (the glyph and one pixel of space after it). */
  adv: number;
  /** Offset of the first column from the pen (can be negative: a combining mark). */
  left: number;
  /** Rows above the baseline of the first row (a lowercase letter on the baseline: 4; capitals: 5). */
  top: number;
  w: number;
  rows: readonly number[];
}

/** Rows of a capital and of a lowercase letter, AFTER the stretch (`stretch.ts`: Tiny5's own 5 and 4 rows made taller). */
export const FONT_CAP = 7;
export const FONT_X_HEIGHT = 5;
/** Rows above the baseline that every line has at least (a capital); below it: no minimum. */
export const LINE_MIN_TOP = FONT_CAP;
/** Size in px (= pixels) at which the system font is rasterised for glyphs the pixel font cannot give. */
export const FALLBACK_PX = 8;

let table: Map<number, Glyph> | null = null;

function parse(): Map<number, Glyph> {
  const m = new Map<number, Glyph>();
  for (const entry of TINY5_DATA.split(";")) {
    const [cp, adv, left, top, w, rows] = entry.split(":");
    m.set(
      parseInt(cp!, 16),
      stretched({
        adv: +adv!,
        left: +left!,
        top: +top!,
        w: +w!,
        rows: rows ? rows.split(",").map((h) => parseInt(h, 16)) : [],
      }),
    );
  }
  return m;
}

const base = () => (table ??= parse());
const composed = new Map<string, Glyph>();
const fallback = new Map<string, Glyph>();

/** Whether the pixel font itself (not a composition or the fallback) has this character. */
export const hasOwnGlyph = (ch: string): boolean => base().has(ch.codePointAt(0)!);

/** Pixel at column `x`, row `y` (from the glyph's first row) of a glyph. */
export const pixelAt = (g: Glyph, x: number, y: number): boolean => y >= 0 && y < g.rows.length && x >= 0 && x < g.w && ((g.rows[y]! >> (g.w - 1 - x)) & 1) === 1;

/* -------------------------------------------------------------- composition ------------------------------------------------ */

/** A mutable bitmap with a pen-relative origin, to compose glyphs. */
interface Grid {
  /** x of the first column relative to the pen. */
  left: number;
  /** Rows above the baseline of the first row. */
  top: number;
  adv: number;
  cells: boolean[][];
}

function toGrid(g: Glyph): Grid {
  return { left: g.left, top: g.top, adv: g.adv, cells: g.rows.map((_, y) => Array.from({ length: g.w }, (__, x) => pixelAt(g, x, y))) };
}

function fromGrid(gr: Grid): Glyph {
  const cells = gr.cells;
  let first = cells.findIndex((r) => r.some(Boolean));
  if (first < 0) return { adv: gr.adv, left: 0, top: 0, w: 0, rows: [] };
  let last = cells.length - 1 - [...cells].reverse().findIndex((r) => r.some(Boolean));
  let minX = Infinity;
  let maxX = -1;
  for (const r of cells) r.forEach((v, x) => v && ((minX = Math.min(minX, x)), (maxX = Math.max(maxX, x))));
  const w = maxX - minX + 1;
  const rows = cells.slice(first, last + 1).map((r) => r.slice(minX, maxX + 1).reduce((acc, v) => (acc << 1) | (v ? 1 : 0), 0));
  return { adv: gr.adv, left: gr.left + minX, top: gr.top - first, w, rows };
}

/** Set a pixel at pen-relative column `x` and `row` rows above the baseline (the pixel occupies [row - 1, row)), growing the grid. */
function put(gr: Grid, x: number, rowAbove: number) {
  // grow up
  while (gr.top < rowAbove) {
    gr.cells.unshift(Array(gr.cells[0]?.length ?? 1).fill(false));
    gr.top++;
  }
  // grow down
  const rowIndex = gr.top - rowAbove;
  while (gr.cells.length <= rowIndex) gr.cells.push(Array(gr.cells[0]?.length ?? 1).fill(false));
  // grow left / right
  while (x < gr.left) {
    for (const r of gr.cells) r.unshift(false);
    gr.left--;
  }
  const col = x - gr.left;
  while ((gr.cells[0]?.length ?? 0) <= col) for (const r of gr.cells) r.push(false);
  gr.cells[rowIndex]![col] = true;
}

/** The ink of a glyph as pen-relative (x, rowAbove) points, rowAbove = rows above the baseline of the pixel's TOP edge. */
function points(g: Glyph): { x: number; row: number }[] {
  const out: { x: number; row: number }[] = [];
  for (let y = 0; y < g.rows.length; y++) for (let x = 0; x < g.w; x++) if (pixelAt(g, x, y)) out.push({ x: g.left + x, row: g.top - y });
  return out;
}

/** Horizontal centre of a glyph's ink. */
const centreX = (g: Glyph) => g.left + (g.w - 1) / 2;

/** The part of a precomposed glyph that is above its plain letter's top: a mark with the gap it has to the letter. */
function markAbove(withMark: string, plain: string): { x: number; row: number }[] | null {
  const a = base().get(withMark.codePointAt(0)!);
  const b = base().get(plain.codePointAt(0)!);
  if (!a || !b) return null;
  return points(a).filter((p) => p.row > b.top);
}

const TONES: Record<string, { lower: [string, string]; upper: [string, string] }> = {
  "́": { lower: ["á", "a"], upper: ["Á", "A"] },
  "̀": { lower: ["à", "a"], upper: ["À", "A"] },
  "̃": { lower: ["ã", "a"], upper: ["Ã", "A"] },
};

/**
 * The hook above (ả), hand drawn in the font's style: two pixels on the upper row and one under the right one, `rel` rows
 * above the top of the letter (one blank row between), centred on the letter's body.
 */
const HOOK: readonly { x: number; rel: number }[] = [
  { x: -1, rel: 3 },
  { x: 0, rel: 3 },
  { x: 0, rel: 2 },
];

/** Compose a glyph for a character with a Vietnamese-style stack of marks, or null when a part is missing. */
function compose(ch: string): Glyph | null {
  const nfd = ch.normalize("NFD");
  if (nfd.length < 2 || nfd === ch) return null;
  const chars = [...nfd];
  const upper = chars[0]! !== chars[0]!.toLowerCase();
  let marks = chars.slice(1);
  // 1. the letter with its shape mark (circumflex, breve) when the font has the combination
  let letter = chars[0]!;
  for (const m of [...marks]) {
    if (m === "\u0302" || m === "\u0306") {
      const pre = (letter + m).normalize("NFC");
      if ([...pre].length !== 1 || !hasOwnGlyph(pre)) return null;
      letter = pre;
      marks = marks.filter((x) => x !== m);
    }
  }
  const g0 = base().get(letter.codePointAt(0)!);
  const plainLetter = base().get(chars[0]!.codePointAt(0)!);
  if (!g0 || !plainLetter) return null;
  const grid = toGrid(g0);
  const cx = Math.round(centreX(plainLetter));
  // 2. the horn: one pixel to the right of the letter, on its highest row that reaches the last column
  if (marks.includes("\u031b")) {
    const pts = points(g0);
    const right = Math.max(...pts.map((p) => p.x));
    put(grid, right + 1, Math.max(...pts.filter((p) => p.x === right).map((p) => p.row)));
    grid.adv = g0.adv + 1;
    marks = marks.filter((m) => m !== "\u031b");
  }
  // 3. dot below and tone marks: above the highest ink (letter, circumflex or horn), centred on the letter's body
  for (const m of marks) {
    if (m === "\u0323") {
      put(grid, cx, -1); // one blank row between the baseline and the dot
      continue;
    }
    const topNow = fromGrid(grid).top;
    let pts: { x: number; rel: number }[];
    if (m === "\u0309") pts = HOOK.map((h) => ({ ...h }));
    else if (TONES[m]) {
      const [withMark, plain] = TONES[m]![upper ? "upper" : "lower"];
      const src = markAbove(withMark, plain);
      const pg = base().get(withMark.codePointAt(0)!);
      const pl = base().get(plain.codePointAt(0)!);
      if (!src || !pg || !pl) return null;
      const c0 = centreX(pl);
      pts = src.map((p) => ({ x: Math.round(p.x - c0), rel: p.row - pl.top }));
    } else return null;
    // Stacked above a circumflex or breve the mark drops its own gap row (the shape mark already has one under it).
    const drop = g0.top > plainLetter.top ? Math.min(...pts.map((p) => p.rel)) - 1 : 0;
    for (const p of pts) put(grid, cx + p.x, topNow + p.rel - drop);
  }
  return fromGrid(grid);
}

/* -------------------------------------------------------------- fallback ---------------------------------------------------- */

function systemGlyph(ch: string): Glyph {
  // A DOM canvas is only available in a browser; tests and the server get a box.
  if (typeof document !== "undefined") {
    try {
      const c = document.createElement("canvas");
      c.width = FALLBACK_PX * 2 + 4;
      c.height = FALLBACK_PX * 2;
      const x = c.getContext("2d", { willReadFrequently: true });
      if (x) {
        x.font = `${FALLBACK_PX}px system-ui, sans-serif`;
        x.textBaseline = "alphabetic";
        const BASE_ROW = FALLBACK_PX + 4;
        x.fillStyle = "#000";
        x.fillText(ch, 2, BASE_ROW);
        const w = Math.min(c.width, Math.ceil(x.measureText(ch).width) + 4);
        const d = x.getImageData(0, 0, c.width, c.height);
        const grid: boolean[][] = [];
        for (let y = 0; y < c.height; y++) {
          const row: boolean[] = [];
          for (let xx = 0; xx < w; xx++) row.push(d.data[(y * c.width + xx) * 4 + 3]! >= 128);
          grid.push(row);
        }
        const g = fromGrid({ left: -2, top: BASE_ROW, adv: Math.max(2, Math.round(x.measureText(ch).width) + 1), cells: grid });
        if (g.rows.length) return g;
      }
    } catch {
      // fall through to the box
    }
  }
  return { adv: 5, left: 0, top: 5, w: 4, rows: [0b1111, 0b1001, 0b1001, 0b1001, 0b1111] };
}

/** The glyph for a character: the font's own, else composed, else the system font thresholded (see the header). */
export function glyphFor(ch: string): Glyph {
  const own = base().get(ch.codePointAt(0)!);
  if (own) return own;
  let g = composed.get(ch);
  if (g) return g;
  const c = compose(ch);
  if (c) {
    composed.set(ch, c);
    return c;
  }
  g = fallback.get(ch);
  if (!g) {
    g = systemGlyph(ch);
    fallback.set(ch, g);
  }
  return g;
}

/** True when `ch` is drawn with the thresholded system font (the lower-quality rule 3). */
export const usesFallback = (ch: string): boolean => !hasOwnGlyph(ch) && compose(ch) === null;

/**
 * The bold face of a glyph: a 1-cell horizontal double strike that keeps one-pixel gaps open. Every ink pixel also lights the
 * cell to its right, EXCEPT when that cell is a one-pixel gap between two inks (`#.#` stays `#.##`, not `####`): a plain
 * smear fills the counters of o, e, a, u at this size and the bold name turns into blobs. One column wider, advance + 1.
 */
export function emboldened(g: Glyph): Glyph {
  if (!g.rows.length) return { ...g, adv: g.adv + 1 };
  const w = g.w;
  const rows = g.rows.map((r) => {
    let out = 0;
    const ink = (x: number) => x >= 0 && x < w && ((r >> (w - 1 - x)) & 1) === 1;
    for (let x = 0; x <= w; x++) {
      const lit = ink(x) || (ink(x - 1) && !(!ink(x) && ink(x + 1)));
      if (lit) out |= 1 << (w - x); // column x of the (w + 1)-wide glyph
    }
    return out;
  });
  return { adv: g.adv + 1, left: g.left, top: g.top, w: w + 1, rows };
}

const boldCache = new Map<string, Glyph>();

/** `glyphFor` in the requested weight. */
export function glyphWeight(ch: string, bold: boolean): Glyph {
  if (!bold) return glyphFor(ch);
  let g = boldCache.get(ch);
  if (!g) {
    g = emboldened(glyphFor(ch));
    boldCache.set(ch, g);
  }
  return g;
}

/* -------------------------------------------------------------- layout ------------------------------------------------------ */

export interface TextMetrics {
  /** Width in pixels (ink extent, without the trailing space). */
  w: number;
  /** Rows above the baseline (at least `LINE_MIN_TOP`). */
  top: number;
  /** Rows below the baseline (0 when no glyph descends). */
  bottom: number;
}

const metricsCache = new Map<string, TextMetrics>();

/** Size of a line of text in pixels (`bold`: the double-struck weight, one column wider per letter). */
export function measureText(text: string, bold = false): TextMetrics {
  const key = bold ? `b|${text}` : text;
  const hit = metricsCache.get(key);
  if (hit) return hit;
  let pen = 0;
  let right = 0;
  let top = LINE_MIN_TOP;
  let bottom = 0;
  for (const ch of text) {
    const g = glyphWeight(ch, bold);
    if (g.rows.length) {
      right = Math.max(right, pen + g.left + g.w);
      top = Math.max(top, g.top);
      bottom = Math.max(bottom, g.rows.length - g.top);
    }
    pen += g.adv;
  }
  const m = { w: Math.max(right, 0), top, bottom };
  if (metricsCache.size > 2000) metricsCache.clear();
  metricsCache.set(key, m);
  return m;
}

/** Call `put(x, y)` for every ink pixel of `text`, with the pen at column `x0` and the baseline at row `baseline`. */
export function forEachInk(text: string, x0: number, baseline: number, put: (x: number, y: number) => void, bold = false): void {
  let pen = x0;
  for (const ch of text) {
    const g = glyphWeight(ch, bold);
    for (let y = 0; y < g.rows.length; y++) {
      const row = g.rows[y]!;
      if (row === 0) continue;
      for (let x = 0; x < g.w; x++) if ((row >> (g.w - 1 - x)) & 1) put(pen + g.left + x, baseline - g.top + y);
    }
    pen += g.adv;
  }
}
