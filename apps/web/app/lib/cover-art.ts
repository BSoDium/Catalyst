/**
 * Generative cover art for entries without an image (docs/design-system.md, "Generative cover art"). A pure function of a
 * seed string: the same seed always gives the same grid, on the server and in the browser, so there is no hydration
 * mismatch and no stored asset. The result is a small grid of cells with four tonal levels (0 = empty .. 3 = ink) produced by
 * an ordered (Bayer) dither of a field, plus one or two accent marks. `coverPaths` turns it into SVG path data with
 * horizontal runs merged, which keeps the markup tiny. No randomness other than the seeded generator, no Date, no DOM.
 */

export const COVER_PATTERNS = ["field", "bars", "rings", "stream", "lattice"] as const;
export type CoverPattern = (typeof COVER_PATTERNS)[number];

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
  /** One or two accent cells (drawn in the signal colour), inside the grid. */
  marks: readonly { x: number; y: number }[];
}

export interface CoverArtOptions {
  cols?: number;
  rows?: number;
  /** Force a pattern; by default the seed picks one. */
  pattern?: CoverPattern;
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

export function coverArt(seed: string, options: CoverArtOptions = {}): CoverArt {
  const cols = clampCells(options.cols, COVER_LIMITS.defaultCols);
  const rows = clampCells(options.rows, COVER_LIMITS.defaultRows);
  const rng = seededRandom(hashSeed(seed));
  // The pattern roll is always consumed, so forcing a pattern does not change the rest of the stream.
  const roll = rng();
  const pattern = options.pattern ?? COVER_PATTERNS[Math.floor(roll * COVER_PATTERNS.length)]!;
  const levels = new Uint8Array(cols * rows);

  if (pattern === "stream") streamLevels(cols, rows, rng, levels);
  else if (pattern === "lattice") latticeLevels(cols, rows, rng, levels);
  else {
    const field = pattern === "field" ? fieldPattern(cols, rows, rng) : pattern === "bars" ? barsPattern(cols, rows, rng) : ringsPattern(cols, rows, rng);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) levels[y * cols + x] = ditherLevel(field(x, y), x, y);
  }

  const markCount = 1 + Math.floor(rng() * 2);
  const marks = Array.from({ length: markCount }, () => ({ x: Math.floor(rng() * cols), y: Math.floor(rng() * rows) }));
  return { seed, pattern, cols, rows, levels, marks };
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
  const marks = art.marks.map((m) => `M${m.x} ${m.y}h1v1h-1z`).join("");
  return { levels, marks };
}
