/**
 * The pixel font of the map labels (pure, unit tested; the DOM is touched only by the optional system-font fallback).
 *
 * Fusion Pixel 10px Proportional (SIL OFL 1.1, `pixel-font-data.ts`): a 10 px em, 7 px capitals, 5 px x-height, 1 px stems, drawn on
 * a pixel grid and proportional (a letter's advance is its width plus one pixel), baked to bit rows by `scripts/font/bake-pixel-font.mjs`.
 * Text is drawn on the ART-PIXEL grid of the map (one glyph pixel = one art pixel, 2.5 CSS px on a desktop, 2 on a phone), at
 * whole-cell positions, in palette levels: no anti-aliasing, no stem thinner than one map pixel. One weight: there is no bold.
 *
 * Coverage and the rules for what the font does not have (see docs/web-architecture.md, "Pixel text"):
 *  1. The font's own glyphs: Latin (Basic, Latin-1 and about half of Extended-A: Ă ć č ě ğ ń ž ...), Greek and Cyrillic letters,
 *     general punctuation including the ellipsis.
 *  2. Composed glyphs, drawn by this module in the font's style from a letter the font has and a mark: the Latin Extended-A letters
 *     the font lacks (the caron of š and ř, the cedilla and comma below of ş ș ţ ț, the ogonek of ą ę, the ring of ů, the double acute of
 *     ő ű, the dotless ı and the dotted İ, the stroke of ł Ł, the apostrophe-like caron of ď ť ľ, the ligatures œ Œ) and Vietnamese
 *     (ế, ộ, ơ, ư, ạ, ẵ, ...): a letter that the font has (a, â, ă, e, ê, o, ô, u, ...), a horn (one extra pixel at the top right of the
 *     letter), a tone mark (acute, grave and tilde are cut out of á, à, ã of the same case; the hook above and the dot below are drawn
 *     here), stacked above the letter or above its circumflex/breve. Any other precomposed letter whose base and marks the font has is
 *     composed the same way.
 *  3. Everything else (Arabic, CJK, symbols): the system font rasterised at `FALLBACK_PX` and thresholded at 50 % coverage,
 *     the same art resolution, no grey. It is not designed on the grid, so its quality is lower (strokes can be uneven);
 *     without a DOM (tests, server) a box is drawn instead.
 */
import { PIXEL_FONT_DATA } from "./pixel-font-data";

/** One glyph: `rows` are the bitmap rows from the top, bit `w - 1 - x` of a row is the pixel at column `x`. */
export interface Glyph {
  /** Pen advance in pixels (the glyph and one pixel of space after it). */
  adv: number;
  /** Offset of the first column from the pen (can be negative: a combining mark). */
  left: number;
  /** Rows above the baseline of the first row (a lowercase letter on the baseline: 5; capitals: 7). */
  top: number;
  w: number;
  rows: readonly number[];
}

/** Rows of a capital and of a lowercase letter. */
export const FONT_CAP = 7;
export const FONT_X_HEIGHT = 5;
/** Rows below the baseline of a descender (g, j, p, q, y, the comma, the cedilla). */
export const FONT_DESCENT = 2;
/** Rows above the baseline that every line has at least (a capital); below it: no minimum. */
export const LINE_MIN_TOP = FONT_CAP;
/** Size in px (= pixels) at which the system font is rasterised for glyphs the pixel font cannot give. */
export const FALLBACK_PX = 8;

let table: Map<number, Glyph> | null = null;

function parse(): Map<number, Glyph> {
  const m = new Map<number, Glyph>();
  for (const entry of PIXEL_FONT_DATA.split(";")) {
    const [cp, adv, left, top, w, rows] = entry.split(":");
    m.set(parseInt(cp!, 16), {
      adv: +adv!,
      left: +left!,
      top: +top!,
      w: +w!,
      rows: rows ? rows.split(",").map((h) => parseInt(h, 16)) : [],
    });
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

/**
 * The marks that are cut out of a precomposed donor letter of the font (the donor with the mark, and the plain letter it is built on),
 * per case: what is above the plain letter's top is the mark, with the gap it has to the letter. The marks sit above the highest ink
 * of the letter they are put on.
 */
const ABOVE: Record<string, { lower: [string, string]; upper: [string, string] }> = {
  "\u0301": { lower: ["á", "a"], upper: ["Á", "A"] }, // acute
  "\u0300": { lower: ["à", "a"], upper: ["À", "A"] }, // grave
  "\u0303": { lower: ["ã", "a"], upper: ["Ã", "A"] }, // tilde
  "\u0302": { lower: ["â", "a"], upper: ["Â", "A"] }, // circumflex
  "\u0306": { lower: ["ă", "a"], upper: ["Ă", "A"] }, // breve
  "\u030c": { lower: ["č", "c"], upper: ["Č", "C"] }, // caron
  "\u030a": { lower: ["å", "a"], upper: ["Å", "A"] }, // ring
  "\u0307": { lower: ["ċ", "c"], upper: ["Ċ", "C"] }, // dot above
};

/** The marks below the letter, cut out of a donor in the same way (what is under the donor's baseline): the cedilla, and the comma below that looks like it at this size. */
const BELOW: Record<string, [string, string]> = {
  "\u0327": ["ç", "c"],
  "\u0326": ["ç", "c"],
};

/** The caron on d, t and l is drawn as a small stroke to the right of the letter, like an apostrophe (ď ť ľ). */
const CARON_STROKE = new Set(["d", "t", "l", "D", "T", "L"]);

/**
 * The hook above (ả), hand drawn in the font's style: two pixels on the upper row and one under the right one, `rel` rows
 * above the top of the letter (one blank row between), centred on the letter's body.
 */
const HOOK: readonly { x: number; rel: number }[] = [
  { x: -1, rel: 3 },
  { x: 0, rel: 3 },
  { x: 0, rel: 2 },
];

/** The part of a precomposed glyph that is below its baseline (a cedilla), pen-relative. */
function markBelow(withMark: string): { x: number; row: number }[] | null {
  const a = base().get(withMark.codePointAt(0)!);
  return a ? points(a).filter((p) => p.row <= 0) : null;
}

/** Cyrillic letters the font lacks that are the same shape as a Latin letter of it (Ukrainian і ї, Serbian ј ѕ). */
const LOOKALIKE: Record<string, string> = { І: "I", і: "i", Ї: "Ï", ї: "ï", Ј: "J", ј: "j", Ѕ: "S", ѕ: "s" };
/** ... and the ones that are a Latin letter turned round (Ukrainian є Є). */
const MIRRORED: Record<string, string> = { Є: "C", є: "c" };

/** Glyphs that are not a letter plus a mark: drawn from other glyphs of the font. Null when a part is missing. */
function special(ch: string): Glyph | null {
  const get = (c: string) => base().get(c.codePointAt(0)!);
  if (LOOKALIKE[ch]) return get(LOOKALIKE[ch]!) ?? null;
  if (MIRRORED[ch]) {
    const g = get(MIRRORED[ch]!);
    if (!g) return null;
    // flipped left to right inside its own width (the pen position of the ink mirrors with it: the letters here have a 1-pixel margin on the right)
    const rows = g.rows.map((r) => {
      let out = 0;
      for (let x = 0; x < g.w; x++) if ((r >> x) & 1) out |= 1 << (g.w - 1 - x);
      return out;
    });
    return { ...g, rows };
  }
  switch (ch) {
    case "Ґ":
    case "ґ": {
      // Г and г with the upturn: one pixel above the right end of the bar
      const g = get(ch === "Ґ" ? "Г" : "г");
      if (!g) return null;
      const grid = toGrid(g);
      put(grid, g.left + g.w - 1, g.top + 1);
      return fromGrid(grid);
    }
    case "ı": {
      // dotless i: the body of the i, without its dot
      const i = get("i");
      if (!i) return null;
      const grid = toGrid(i);
      return fromGrid({ ...grid, top: FONT_X_HEIGHT, cells: grid.cells.slice(i.top - FONT_X_HEIGHT) });
    }
    case "ł":
    case "Ł": {
      // the stroke of the Polish l: the letter with a short diagonal through its stem (two pixels either side of it)
      const l = get(ch === "ł" ? "l" : "L");
      if (!l) return null;
      const grid = toGrid(l);
      const row = Math.round(l.top / 2);
      if (ch === "ł") {
        put(grid, l.left, row); // the stem of the l is its second column
        put(grid, l.left + 2, row + 1);
      } else {
        put(grid, l.left + 1, row); // the stem of the L is its first column: the stroke goes to its right
        put(grid, l.left + 2, row + 1);
      }
      return fromGrid(grid);
    }
    case "œ":
    case "Œ":
    case "ĳ":
    case "Ĳ": {
      // ligatures: the two letters, the second starting on the first's last column
      const [first, second] = ch === "œ" ? ["o", "e"] : ch === "Œ" ? ["O", "E"] : ch === "ĳ" ? ["i", "j"] : ["I", "J"];
      const a = get(first!);
      const b = get(second!);
      if (!a || !b) return null;
      const join = ch === "œ" || ch === "Œ" ? a.adv - 1 : a.adv;
      const grid = toGrid(a);
      for (const p of points(b)) put(grid, p.x + join, p.row);
      grid.adv = join + b.adv;
      return fromGrid(grid);
    }
    default:
      return null;
  }
}

/** Compose a glyph for a character from a letter and its marks (Latin diacritics, Vietnamese stacks), or null when a part is missing. */
function compose(ch: string): Glyph | null {
  const sp = special(ch);
  if (sp) return sp;
  const nfd = ch.normalize("NFD");
  if (nfd.length < 2 || nfd === ch) return null;
  const chars = [...nfd];
  const upper = chars[0]! !== chars[0]!.toLowerCase();
  let marks = chars.slice(1);
  // 1. the letter with its shape mark (circumflex, breve) when the font has the combination: the tone marks of Vietnamese stack above it
  let letter = chars[0]!;
  for (const m of [...marks]) {
    if (m === "\u0302" || m === "\u0306") {
      const pre = (letter + m).normalize("NFC");
      if ([...pre].length !== 1 || !hasOwnGlyph(pre)) continue; // else it is a plain mark, below
      letter = pre;
      marks = marks.filter((x) => x !== m);
    }
  }
  const g0 = base().get(letter.codePointAt(0)!);
  const plainLetter = base().get(chars[0]!.codePointAt(0)!);
  if (!g0 || !plainLetter) return null;
  const grid = toGrid(g0);
  const cxExact = centreX(plainLetter);
  const cx = Math.round(cxExact);
  // 2. the horn: one pixel to the right of the letter, on its highest row that reaches the last column
  if (marks.includes("\u031b")) {
    const pts = points(g0);
    const right = Math.max(...pts.map((p) => p.x));
    put(grid, right + 1, Math.max(...pts.filter((p) => p.x === right).map((p) => p.row)));
    grid.adv = g0.adv + 1;
    marks = marks.filter((m) => m !== "\u031b");
  }
  // 3. below: the dot (Vietnamese), the cedilla and comma (a donor's), the ogonek (drawn here)
  const right = Math.max(...points(g0).map((p) => p.x));
  for (const m of [...marks]) {
    if (m === "\u0323") put(grid, cx, -1); // one blank row between the baseline and the dot
    else if (m === "\u0328") {
      put(grid, right, 0);
      put(grid, right - 1, -1);
    } else if (BELOW[m]) {
      const src = markBelow(BELOW[m]![0]);
      const donor = base().get(BELOW[m]![1].codePointAt(0)!);
      if (!src || !donor || !src.length) return null;
      const c0 = centreX(donor);
      for (const p of src) put(grid, Math.round(cxExact + p.x - c0), p.row);
    } else continue;
    marks = marks.filter((x) => x !== m);
  }
  // 4. above: the caron of d, t, l as a stroke, the others cut out of a donor, the hook drawn here; each above the highest ink
  for (const m of marks) {
    const topNow = fromGrid(grid).top;
    let pts: { x: number; rel: number }[];
    if (m === "\u030c" && CARON_STROKE.has(chars[0]!)) {
      // two pixels at the top of the letter, a blank column right of its ink (like the apostrophe of the font)
      put(grid, right + 2, topNow);
      put(grid, right + 2, topNow - 1);
      grid.adv = Math.max(grid.adv, right + 4);
      continue;
    }
    if (m === "\u0309") pts = HOOK.map((h) => ({ x: cx + h.x, rel: h.rel }));
    else if (m === "\u030b") {
      // double acute: two acutes side by side
      const [withMark, plain] = ABOVE["\u0301"]![upper ? "upper" : "lower"];
      const src = markAbove(withMark, plain);
      const pl = base().get(plain.codePointAt(0)!);
      if (!src || !pl) return null;
      const c0 = centreX(pl);
      pts = src.flatMap((p) => [-1, 1].map((d) => ({ x: Math.round(cxExact + p.x - c0) + d, rel: p.row - pl.top })));
    } else if (ABOVE[m]) {
      const [withMark, plain] = ABOVE[m]![upper ? "upper" : "lower"];
      const src = markAbove(withMark, plain);
      const pl = base().get(plain.codePointAt(0)!);
      if (!src || !pl) return null;
      const c0 = centreX(pl);
      pts = src.map((p) => ({ x: Math.round(cxExact + p.x - c0), rel: p.row - pl.top }));
    } else return null;
    // Stacked above a circumflex or breve the mark drops its own gap row (the shape mark already has one under it).
    const drop = g0.top > plainLetter.top ? Math.min(...pts.map((p) => p.rel)) - 1 : 0;
    for (const p of pts) put(grid, p.x, topNow + p.rel - drop);
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

/** Size of a line of text in pixels. */
export function measureText(text: string): TextMetrics {
  const hit = metricsCache.get(text);
  if (hit) return hit;
  let pen = 0;
  let right = 0;
  let top = LINE_MIN_TOP;
  let bottom = 0;
  for (const ch of text) {
    const g = glyphFor(ch);
    if (g.rows.length) {
      right = Math.max(right, pen + g.left + g.w);
      top = Math.max(top, g.top);
      bottom = Math.max(bottom, g.rows.length - g.top);
    }
    pen += g.adv;
  }
  const m = { w: Math.max(right, 0), top, bottom };
  if (metricsCache.size > 2000) metricsCache.clear();
  metricsCache.set(text, m);
  return m;
}

/** Call `put(x, y)` for every ink pixel of `text`, with the pen at column `x0` and the baseline at row `baseline`. */
export function forEachInk(text: string, x0: number, baseline: number, put: (x: number, y: number) => void): void {
  let pen = x0;
  for (const ch of text) {
    const g = glyphFor(ch);
    for (let y = 0; y < g.rows.length; y++) {
      const row = g.rows[y]!;
      if (row === 0) continue;
      for (let x = 0; x < g.w; x++) if ((row >> (g.w - 1 - x)) & 1) put(pen + g.left + x, baseline - g.top + y);
    }
    pen += g.adv;
  }
}
