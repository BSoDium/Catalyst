/**
 * Measurement toolbox of the line rules: grids of ink cells, 8-connected components, the staircase remover (CPU twin
 * of the pass), the reference rasteriser ("native" drawing on the coarse grid) and comparison metrics. Used by the unit
 * tests and the browser regression gate (`harness/`, scripts/street/lines.mjs); never imported by the street engine.
 */
import { CODE } from "./art-line";

export interface Mask {
  cols: number;
  rows: number;
  /** 1 = ink */
  data: Uint8Array;
}

export const makeMask = (cols: number, rows: number): Mask => ({ cols, rows, data: new Uint8Array(cols * rows) });
export const at = (m: Mask, x: number, y: number): number => (x < 0 || y < 0 || x >= m.cols || y >= m.rows ? 0 : m.data[y * m.cols + x]!);

/** Mask of cells whose class code is ink (thin or solid). */
export function inkMask(cols: number, rows: number, codes: ArrayLike<number>): Mask {
  const m = makeMask(cols, rows);
  for (let i = 0; i < m.data.length; i++) m.data[i] = codes[i] === CODE.thin || codes[i] === CODE.solid ? 1 : 0;
  return m;
}

export function count(m: Mask): number {
  let n = 0;
  for (let i = 0; i < m.data.length; i++) n += m.data[i]!;
  return n;
}

/** Chebyshev dilation by `r` cells. */
export function dilate(m: Mask, r = 1): Mask {
  const out = makeMask(m.cols, m.rows);
  for (let y = 0; y < m.rows; y++) {
    for (let x = 0; x < m.cols; x++) {
      if (!m.data[y * m.cols + x]) continue;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < m.cols && ny < m.rows) out.data[ny * m.cols + nx] = 1;
        }
      }
    }
  }
  return out;
}

/** 8-connected components. Returns the label image (0 = background) and the number of components. */
export function components8(m: Mask): { labels: Int32Array; n: number; sizes: number[] } {
  const labels = new Int32Array(m.data.length);
  const sizes: number[] = [0];
  let n = 0;
  const stack: number[] = [];
  for (let i = 0; i < m.data.length; i++) {
    if (!m.data[i] || labels[i]) continue;
    n++;
    let size = 0;
    stack.push(i);
    labels[i] = n;
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const px = p % m.cols;
      const py = (p - px) / m.cols;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = px + dx;
          const ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= m.cols || ny >= m.rows) continue;
          const q = ny * m.cols + nx;
          if (m.data[q] && !labels[q]) {
            labels[q] = n;
            stack.push(q);
          }
        }
      }
    }
    sizes.push(size);
  }
  return { labels, n, sizes };
}

/** Number of ink cells that sit inside a fully inked 2x2 block, as a fraction of all ink cells (0 for 1 px lines). */
export function blockFraction(m: Mask): number {
  let inBlock = 0;
  let total = 0;
  for (let y = 0; y < m.rows; y++) {
    for (let x = 0; x < m.cols; x++) {
      if (!at(m, x, y)) continue;
      total++;
      const tl = at(m, x - 1, y - 1) && at(m, x, y - 1) && at(m, x - 1, y);
      const tr = at(m, x + 1, y - 1) && at(m, x, y - 1) && at(m, x + 1, y);
      const bl = at(m, x - 1, y + 1) && at(m, x, y + 1) && at(m, x - 1, y);
      const br = at(m, x + 1, y + 1) && at(m, x, y + 1) && at(m, x + 1, y);
      if (tl || tr || bl || br) inBlock++;
    }
  }
  return total ? inBlock / total : 0;
}

/**
 * CPU twin of the staircase pass (FRAG_THIN in gl/pixel-pass.ts). A one-pixel line sampled at cell centres is
 * 4-connected (two cells per step) at some angles, worst at 45 degrees. Sub-pass 0 removes a cell that is the LEFT
 * corner of such a stair; sub-pass 1 does the same for RIGHT corners that are still redundant. Every removal keeps
 * 8-connectivity.
 */
export function removeStairs(m: Mask, iterations = 1): Mask {
  let cur = makeMask(m.cols, m.rows);
  cur.data.set(m.data);
  for (let it = 0; it < iterations * 2; it++) {
    const next = makeMask(m.cols, m.rows);
    next.data.set(cur.data);
    const sub = it & 1;
    for (let y = 0; y < m.rows; y++) {
      for (let x = 0; x < m.cols; x++) {
        if (!at(cur, x, y)) continue;
        const N = at(cur, x, y - 1), S = at(cur, x, y + 1), E = at(cur, x + 1, y), W = at(cur, x - 1, y);
        const NE = at(cur, x + 1, y - 1), NW = at(cur, x - 1, y - 1), SE = at(cur, x + 1, y + 1), SW = at(cur, x - 1, y + 1);
        const rm =
          sub === 0
            ? E === 1 && W === 0 && ((N === 1 && S === 0 && SW === 0 && (NW === 1 || SE === 1)) || (S === 1 && N === 0 && NW === 0 && (SW === 1 || NE === 1)))
            : W === 1 && E === 0 && ((N === 1 && S === 0 && SE === 0 && (NE === 1 || SW === 1)) || (S === 1 && N === 0 && NE === 0 && (SE === 1 || NW === 1)));
        if (rm) next.data[y * m.cols + x] = 0;
      }
    }
    cur = next;
  }
  return cur;
}

export type Pt = readonly [number, number];

function distToSegment(px: number, py: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

/**
 * Native rasterisation of a polyline of `width` art px (coordinates in art px, cell (i, j) has its centre at
 * (i + 0.5, j + 0.5)): a cell is ink iff its centre is within width / 2 of the line. This is what "drawn natively on
 * the coarse grid" means for the centre rule of the pass, and the reference the tests compare against.
 */
export function nativeRaster(poly: readonly Pt[], width: number, cols: number, rows: number): Mask {
  const m = makeMask(cols, rows);
  const r = width / 2;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let d = Infinity;
      for (let i = 0; i < poly.length - 1; i++) d = Math.min(d, distToSegment(x + 0.5, y + 0.5, poly[i]!, poly[i + 1]!));
      if (d <= r) m.data[y * cols + x] = 1;
    }
  }
  return m;
}

/** Number of cells a one-pixel line occupies: one per step along its major axis (Bresenham). */
export function bresenhamCount(a: Pt, b: Pt): number {
  return Math.max(Math.abs(Math.round(b[0] - a[0])), Math.abs(Math.round(b[1] - a[1]))) + 1;
}

export interface MaskCompare {
  ideal: number;
  out: number;
  /** ideal cells with no output ink at all within one cell (a line that is really missing there) */
  lineMiss: number;
  /** ideal cells that are not ink in the output, cell for cell */
  strictMiss: number;
  /** output cells with no ideal ink within one cell (spurious) */
  spurious: number;
  /** out / ideal: > 1 means thicker than the reference */
  sizeRatio: number;
}

/** Compare an output ink mask with the ideal one. All fractions are 0..1 of the relevant total (0 if empty). */
export function compareMasks(ideal: Mask, out: Mask): MaskCompare {
  const di = dilate(ideal, 1);
  const dout = dilate(out, 1);
  let lm = 0;
  let sm = 0;
  let sp = 0;
  const ni = count(ideal);
  const no = count(out);
  for (let i = 0; i < ideal.data.length; i++) {
    if (ideal.data[i]) {
      if (!out.data[i]) sm++;
      if (!dout.data[i]) lm++;
    }
    if (out.data[i] && !di.data[i]) sp++;
  }
  return {
    ideal: ni,
    out: no,
    lineMiss: ni ? lm / ni : 0,
    strictMiss: ni ? sm / ni : 0,
    spurious: no ? sp / no : 0,
    sizeRatio: ni ? no / ni : 0,
  };
}

/** Number of cells that differ between two consecutive frames, and the ink count of the first. */
export function changedRatio(a: Mask, b: Mask): { changed: number; ink: number } {
  let c = 0;
  let ink = 0;
  for (let i = 0; i < a.data.length; i++) {
    if (a.data[i] !== b.data[i]) c++;
    ink += a.data[i]!;
  }
  return { changed: c, ink };
}
