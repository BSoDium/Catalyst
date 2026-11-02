import { EXTRA_PATTERNS, extraLevels, type ExtraPattern } from "./cover-patterns";

/**
 * Generative cover art for entries without an image (docs/design-system.md, "Generative cover art"). A pure function of a
 * seed string: the same seed always gives the same grid, on the server and in the browser, so there is no hydration
 * mismatch and no stored asset. The result is a small grid of cells with four tonal levels (0 = empty .. 3 = ink) produced by
 * one of twenty-one patterns (an ordered (Bayer) dither of a field, or drawn cells), the tones' hues (the ink's, or the seed's
 * palettes'), a faint wash, and one or two accent marks. `coverPaths` turns it into SVG path data with
 * horizontal runs merged, which keeps the markup tiny. No randomness other than the seeded generator, no Date, no DOM.
 */

export const COVER_PATTERNS = ["field", "bars", "rings", "stream", "lattice", ...EXTRA_PATTERNS] as const;
export type CoverPattern = (typeof COVER_PATTERNS)[number];

/** The palettes a cover's marks can be drawn in (`--palette-<name>`, the 600 step; docs/design-tokens.md, "Palettes"). */
export const COVER_PALETTES = ["blue", "green", "ocre", "violet"] as const;
export type CoverPalette = (typeof COVER_PALETTES)[number];

/** Number of tonal levels (0 .. COVER_LEVELS - 1). */
export const COVER_LEVELS = 4;

export const COVER_LIMITS = { minCells: 4, maxCells: 96, defaultCols: 32, defaultRows: 18 } as const;

export interface CoverArt {
  seed: string;
  pattern: CoverPattern;
  cols: number;
  rows: number;
  /** Row-major, `rows * cols` entries, each in `0 .. COVER_LEVELS - 1`. */
  levels: Uint8Array;
  /** One or two accent motifs, inside the grid. */
  marks: readonly CoverMark[];
  /** The palette the seed chose, for the tones that take a hue (and the marks, unless the scheme gives them the second); forced by the option. Chosen apart from the grid, so forcing it changes nothing else. */
  palette: CoverPalette;
  /** The second palette (never the first), for the tones and marks of a two-hue scheme. */
  second: CoverPalette;
  /** The hue of each tone (index 1 .. COVER_LEVELS - 1; 0 is empty): the ink's own, the first palette (`a`) or the second (`b`). */
  tones: readonly CoverTone[];
  /** The palette of the marks. */
  markPalette: CoverPalette;
  /** A faint wash of the first palette over the whole cover: 0 none, 1 faint, 2 a little stronger. */
  wash: 0 | 1 | 2;
}

export type CoverTone = "ink" | "a" | "b";
export type CoverMarkShape = "square" | "bar" | "ring" | "bars";
/** An accent motif: a cell, a bar, a hollow square or three bars, `w` by `h` cells from (`x`, `y`). */
export interface CoverMark {
  x: number;
  y: number;
  w: number;
  h: number;
  shape: CoverMarkShape;
}

/** How the tones take their hues, and whether the cover has a wash and the marks the second hue (`tones` are for levels 1, 2 and 3). */
const SCHEMES: readonly { tones: readonly [CoverTone, CoverTone, CoverTone]; wash: 0 | 2 | "maybe"; markSecond: boolean }[] = [
  { tones: ["a", "ink", "a"], wash: "maybe", markSecond: false },
  { tones: ["a", "b", "a"], wash: "maybe", markSecond: true },
  { tones: ["ink", "ink", "a"], wash: "maybe", markSecond: false },
  { tones: ["b", "a", "b"], wash: 2, markSecond: true },
  { tones: ["a", "ink", "a"], wash: 2, markSecond: false },
];

export interface CoverArtOptions {
  cols?: number;
  rows?: number;
  /** Force a pattern; by default the seed picks one. */
  pattern?: CoverPattern;
  /** Force a palette for the marks; by default the seed picks one. */
  palette?: CoverPalette;
}

/** 32-bit FNV-1a with a final avalanche, so near-identical seeds ("a1", "a2") spread. */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** mulberry32: a small, fast seeded generator returning floats in [0, 1). */
export function seededRandom(state: number): () => number {
  let a = state >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Ordered dither of a value in [0, 1] to `COVER_LEVELS` levels at cell (x, y). */
export function ditherLevel(value: number, x: number, y: number): number {
  const threshold = (BAYER4[y & 3]![x & 3]! + 0.5) / 16;
  const scaled = clamp01(value) * (COVER_LEVELS - 1);
  const base = Math.floor(scaled);
  const level = base + (scaled - base > threshold ? 1 : 0);
  return Math.min(COVER_LEVELS - 1, level);
}

function clampCells(n: number | undefined, fallback: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return Math.min(COVER_LIMITS.maxCells, Math.max(COVER_LIMITS.minCells, Math.round(n)));
}

type Rng = () => number;
type Field = (x: number, y: number) => number;

/** Soft blobs plus a slow wave: a smooth field in [0, 1] that the dither turns into stipple. */
function fieldPattern(cols: number, rows: number, rng: Rng): Field {
  const blobs = Array.from({ length: 3 + Math.floor(rng() * 3) }, () => ({
    cx: rng() * cols,
    cy: rng() * rows,
    s: (0.12 + rng() * 0.28) * Math.max(cols, rows),
    a: 0.4 + rng() * 0.6,
  }));
  const kx = (0.5 + rng() * 1.5) * ((Math.PI * 2) / cols);
  const ky = (0.5 + rng() * 1.5) * ((Math.PI * 2) / rows);
  const phase = rng() * Math.PI * 2;
  return (x, y) => {
    let v = 0.15 * Math.sin(x * kx + y * ky + phase);
    for (const b of blobs) v += b.a * Math.exp(-((x - b.cx) ** 2 + (y - b.cy) ** 2) / (2 * b.s * b.s));
    return Math.min(0.72, clamp01(v * 0.6));
  };
}

/** Columns of a spectrum: heights from a smoothed walk, brightest at the peak. */
function barsPattern(cols: number, rows: number, rng: Rng): Field {
  const heights: number[] = [];
  let h = 0.3 + rng() * 0.5;
  for (let x = 0; x < cols; x++) {
    h = clamp01(h + (rng() - 0.5) * 0.45);
    heights.push(0.12 + h * 0.88);
  }
  return (x, y) => {
    const up = (rows - 1 - y + 0.5) / rows;
    const top = heights[Math.min(cols - 1, Math.max(0, Math.floor(x)))]!;
    return up > top ? 0 : 0.25 + 0.75 * (up / top);
  };
}

/** Concentric contours around a seeded focus. */
function ringsPattern(cols: number, rows: number, rng: Rng): Field {
  const fx = rng() * cols;
  const fy = rng() * rows;
  const freq = 2 + rng() * 3;
  const phase = rng() * Math.PI * 2;
  const reach = Math.hypot(cols, rows) * 0.7;
  return (x, y) => {
    const d = Math.hypot(x - fx, (y - fy) * 1.8) / reach;
    return clamp01((0.5 + 0.5 * Math.cos(d * freq * Math.PI * 2 + phase)) * (1 - d * 0.6));
  };
}

/** Runs of cells per row, like a data stream or a barcode: some rows empty, some dense. */
function streamLevels(cols: number, rows: number, rng: Rng, out: Uint8Array): void {
  for (let y = 0; y < rows; y++) {
    const density = rng();
    if (density < 0.22) continue;
    let x = Math.floor(rng() * 6);
    while (x < cols) {
      const run = 1 + Math.floor(rng() * (2 + density * 8));
      const level = 1 + Math.floor(rng() * (COVER_LEVELS - 1));
      for (let i = 0; i < run && x + i < cols; i++) out[y * cols + x + i] = level;
      x += run + 1 + Math.floor(rng() * 6 * (1.2 - density));
    }
  }
}

/** A sparse lattice of nodes, some grown into crosses (registration marks). */
function latticeLevels(cols: number, rows: number, rng: Rng, out: Uint8Array): void {
  const step = 3 + Math.floor(rng() * 3);
  const ox = Math.floor(rng() * step);
  const oy = Math.floor(rng() * step);
  const set = (x: number, y: number, level: number) => {
    if (x >= 0 && y >= 0 && x < cols && y < rows) out[y * cols + x] = Math.max(out[y * cols + x]!, level);
  };
  for (let y = oy; y < rows; y += step) {
    for (let x = ox; x < cols; x += step) {
      const roll = rng();
      if (roll < 0.3) continue;
      set(x, y, roll > 0.85 ? 3 : 2);
      if (roll > 0.7) {
        set(x - 1, y, 1);
        set(x + 1, y, 1);
        set(x, y - 1, 1);
        set(x, y + 1, 1);
      }
    }
  }
}

/** Level cells of a pattern drawn by this file (the first five). */
function baseLevels(pattern: CoverPattern, cols: number, rows: number, rng: Rng, levels: Uint8Array): void {
  if (pattern === "stream") streamLevels(cols, rows, rng, levels);
  else if (pattern === "lattice") latticeLevels(cols, rows, rng, levels);
  else {
    const field = pattern === "field" ? fieldPattern(cols, rows, rng) : pattern === "bars" ? barsPattern(cols, rows, rng) : ringsPattern(cols, rows, rng);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) levels[y * cols + x] = ditherLevel(field(x, y), x, y);
  }
}

/** The accent motifs: a cell, a bar, a hollow square or three bars, kept inside the grid. */
function drawMarks(rng: Rng, cols: number, rows: number): CoverMark[] {
  const shapes: readonly CoverMarkShape[] = ["square", "bar", "ring", "bars"];
  return Array.from({ length: 1 + Math.floor(rng() * 2) }, () => {
    const shape = shapes[Math.floor(rng() * shapes.length)]!;
    const w = Math.min(cols, shape === "bar" ? 6 + Math.floor(rng() * 8) : shape === "bars" ? 7 : 3 + Math.floor(rng() * 5));
    const h = Math.min(rows, shape === "bar" ? 1 + Math.floor(rng() * 2) : shape === "bars" ? 5 : w);
    return { x: Math.floor(rng() * (cols - w + 1)), y: Math.floor(rng() * (rows - h + 1)), w, h, shape };
  });
}

export function coverArt(seed: string, options: CoverArtOptions = {}): CoverArt {
  const cols = clampCells(options.cols, COVER_LIMITS.defaultCols);
  const rows = clampCells(options.rows, COVER_LIMITS.defaultRows);
  const rng = seededRandom(hashSeed(seed));
  // The pattern roll is always consumed, so forcing a pattern does not change the rest of the stream.
  const roll = rng();
  const pattern = options.pattern ?? COVER_PATTERNS[Math.floor(roll * COVER_PATTERNS.length)]!;
  const levels = new Uint8Array(cols * rows);

  if ((EXTRA_PATTERNS as readonly string[]).includes(pattern)) {
    const dither = (field: (x: number, y: number) => number) => {
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) levels[y * cols + x] = ditherLevel(field(x, y), x, y);
    };
    extraLevels(pattern as ExtraPattern, { cols, rows, rng, levels, dither });
  } else baseLevels(pattern, cols, rows, rng, levels);

  // The form and the look come from generators of their own: a forced pattern or palette changes nothing else.
  const form = seededRandom(hashSeed(`${seed}|form`));
  // (one in five is turned up a tone, the empty ground the lightest and the ink the empty: a permutation, so a cover is never made flat by it)
  if (form() < 0.22) for (let i = 0; i < levels.length; i++) levels[i] = (levels[i]! + 1) % COVER_LEVELS;
  // (one in five is mirrored left to right, when its left half is not one flat tone: that would make the whole of it flat)
  if (form() < 0.2) {
    const half = Math.floor(cols / 2);
    const left = new Set<number>();
    for (let y = 0; y < rows; y++) for (let x = 0; x < half; x++) left.add(levels[y * cols + x]!);
    if (left.size > 1) for (let y = 0; y < rows; y++) for (let x = 0; x < half; x++) levels[y * cols + (cols - 1 - x)] = levels[y * cols + x]!;
  }

  const look = seededRandom(hashSeed(`${seed}|look`));
  const paletteRoll = look();
  const palette = options.palette ?? COVER_PALETTES[Math.floor(paletteRoll * COVER_PALETTES.length)]!;
  const secondRoll = look();
  const second = COVER_PALETTES[(COVER_PALETTES.indexOf(palette) + 1 + Math.floor(secondRoll * (COVER_PALETTES.length - 1))) % COVER_PALETTES.length]!;
  const scheme = SCHEMES[Math.floor(look() * SCHEMES.length)]!;
  const washRoll = look();
  const wash = scheme.wash === "maybe" ? (washRoll < 0.3 ? 1 : 0) : scheme.wash;
  const marks = drawMarks(look, cols, rows);
  return { seed, pattern, cols, rows, levels, marks, palette, second, tones: ["ink", ...scheme.tones], markPalette: scheme.markSecond ? second : palette, wash };
}

/** A motif's path: a rectangle, a hollow one (an outer rectangle and an inner one the other way round), or three bars two cells apart. */
function markPath({ x, y, w, h, shape }: CoverMark): string {
  if (shape === "ring" && w > 2 && h > 2) return `M${x} ${y}h${w}v${h}h-${w}zM${x + 1} ${y + 1}v${h - 2}h${w - 2}v${2 - h}z`;
  if (shape === "bars") return [0, 2, 4].map((i) => (y + i < y + h ? `M${x} ${y + i}h${w}v1h-${w}z` : "")).join("");
  return `M${x} ${y}h${w}v${h}h-${w}z`;
}

/**
 * SVG path data per level (index 1 .. COVER_LEVELS - 1; index 0 is empty and never drawn) with horizontal runs merged into
 * single rectangles, in cell units (a `viewBox` of `0 0 cols rows`). Plus `marks` for the accent cells.
 */
export function coverPaths(art: CoverArt): { levels: string[]; marks: string } {
  const levels = Array.from({ length: COVER_LEVELS }, () => "");
  for (let y = 0; y < art.rows; y++) {
    let x = 0;
    while (x < art.cols) {
      const level = art.levels[y * art.cols + x]!;
      let end = x + 1;
      while (end < art.cols && art.levels[y * art.cols + end] === level) end++;
      if (level > 0) levels[level] += `M${x} ${y}h${end - x}v1h${x - end}z`;
      x = end;
    }
  }
  const marks = art.marks.map(markPath).join("");
  return { levels, marks };
}
