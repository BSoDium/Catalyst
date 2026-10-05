/**
 * Pure logic of the "old LCD" line rules (docs/pixel-line-rules.md). Everything here has a GLSL twin in
 * `gl/pixelPass.ts` or is a definition the style and the tests share:
 *
 *  - width ramps expressed in ART pixels with a hard floor of one art pixel, and the hollow-road interior derived
 *    from the casing so the edge lines are exactly one art pixel wide;
 *  - the reference rasteriser (cells whose centre lies inside the line) that the pass must equal;
 *  - 8-connected components, Zhang-Suen thinning, dilation: the measurement toolbox;
 *  - tone patterns that depend only on the screen cell (never on the world).
 */

/** Class codes stored in the art texture. Twin of `CODE` in gl/pixelPass.ts. */
export const CODE = { none: 0, thin: 1, solid: 2, tone: 3, muted: 4 } as const;

export type Stops = readonly (readonly [number, number])[];

/** The CSS-px nominal design unit of one art pixel (3 on desktop). Nominal widths are authored against it. */
export const DESIGN_CELL_CSS = 3;

/** MapLibre `interpolate exponential` between stops, clamped outside (same maths as the style expression). */
export function expInterp(stops: Stops, z: number, base = 1.5): number {
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  if (z <= first[0]) return first[1];
  if (z >= last[0]) return last[1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [z0, v0] = stops[i]!;
    const [z1, v1] = stops[i + 1]!;
    if (z >= z0 && z <= z1) {
      const t = base === 1 ? (z - z0) / (z1 - z0) : (Math.pow(base, z - z0) - 1) / (Math.pow(base, z1 - z0) - 1);
      return v0 + (v1 - v0) * t;
    }
  }
  return last[1];
}

/** Nominal CSS-px stops to art-pixel stops with a floor: no line is ever thinner than `minArt` art pixels. */
export function artStops(cssStops: Stops, minArt = 1, designCell = DESIGN_CELL_CSS): Stops {
  return cssStops.map(([z, w]) => [z, Math.max(minArt, w / designCell)] as const);
}

/** Art-pixel stops to CSS-px stops for a concrete cell size (a whole number of device px / dpr). */
export function cssStops(art: Stops, cellCss: number): Stops {
  return art.map(([z, w]) => [z, w * cellCss] as const);
}

/**
 * Ink strength encodes the line class for the pass: a line that is meant to be ONE art pixel wide is painted at
 * `THIN_INK` (R = 0.75), a wider line at full strength (R = 1). The pass thins only cells below `SOLID_FROM`, so the
 * staircase cleanup can never eat a deliberately wide road. The ink threshold of the pass is `0.49 * THIN_INK`, which
 * is the same "pixel centre inside the line" test for both classes.
 */
export const THIN_INK = 0.75;
export const SOLID_FROM = 0.9;
/** art-pixel widths up to this are one-pixel lines; from `WIDE_FROM` they are wide lines; ramp in between */
export const THIN_UP_TO = 1.25;
export const WIDE_FROM = 1.6;

/** Ink opacity for a line of this width (art px). */
export function inkOpacityFor(widthArt: number): number {
  if (widthArt <= THIN_UP_TO) return THIN_INK;
  if (widthArt >= WIDE_FROM) return 1;
  return THIN_INK + ((1 - THIN_INK) * (widthArt - THIN_UP_TO)) / (WIDE_FROM - THIN_UP_TO);
}

/**
 * Ink opacity stops over zoom for a width ramp, sampled densely so the class switch follows the width.
 * `hollowFrom`: from this zoom the casing is only the two one-pixel OUTLINES of a hollow road (the interior is
 * erased), so it is a thin-line class again whatever the total road width.
 */
export function inkOpacityStops(widthArt: Stops, base = 1.5, step = 0.25, hollowFrom: number | null = null): Stops {
  const z0 = widthArt[0]![0];
  const z1 = widthArt[widthArt.length - 1]![0];
  const out: [number, number][] = [];
  for (let z = z0; z < z1 + 1e-9; z += step) {
    const hollow = hollowFrom !== null && z >= hollowFrom;
    out.push([Math.round(z * 1000) / 1000, hollow ? THIN_INK : inkOpacityFor(expInterp(widthArt, z, base))]);
  }
  if (hollowFrom !== null && hollowFrom > z0 && hollowFrom < z1) {
    // make the switch sharp at the hollow zoom, not one sample later
    out.push([hollowFrom - 1e-3, inkOpacityFor(expInterp(widthArt, hollowFrom - 1e-3, base))], [hollowFrom, THIN_INK]);
    out.sort((a, b) => a[0] - b[0]);
  }
  return out;
}

export interface HollowOptions {
  /** width in art px of each outline of a hollow road */
  edge?: number;
  /** smallest interior that keeps the two outlines apart at every angle and offset (they merge at 45 degrees below ~2) */
  minInterior?: number;
  base?: number;
  step?: number;
  maxZoom?: number;
}

/**
 * Width (art px) of the erasing interior of a hollow road whose casing follows `caseArt`.
 * Rule: a road is hollow only when its casing is wide enough for two outlines plus a visible interior
 * (2 * edge + minInterior = 4 art px); then the outlines are exactly `edge` wide. Below that it stays one solid line.
 * Returns dense stops (so the exponential interpolation of the style tracks `case - 2 * edge` closely) including the
 * jump from 0 to `minInterior` at the zoom where the casing reaches 4 art px.
 */
export function hollowFillStops(caseArt: Stops, o: HollowOptions = {}): Stops {
  const edge = o.edge ?? 1;
  const minInt = o.minInterior ?? 2;
  const base = o.base ?? 1.5;
  const step = o.step ?? 0.25;
  const zMin = caseArt[0]![0];
  const zMax = o.maxZoom ?? caseArt[caseArt.length - 1]![0];
  const need = 2 * edge + minInt;
  const out: [number, number][] = [];
  // find the zoom where the casing reaches `need`
  let zc: number | null = null;
  for (let z = zMin; z <= zMax + 1e-9; z += 0.005) {
    if (expInterp(caseArt, z, base) >= need - 1e-9) {
      zc = z;
      break;
    }
  }
  if (zc === null) return [[zMin, 0], [zMax, 0]];
  out.push([zMin, 0]);
  if (zc - 1e-3 > zMin) out.push([zc - 1e-3, 0]);
  out.push([zc, minInt]);
  for (let z = Math.ceil(zc / step) * step; z <= zMax + 1e-9; z += step) {
    if (z > zc + 1e-6) out.push([Math.round(z * 1000) / 1000, Math.max(minInt, expInterp(caseArt, z, base) - 2 * edge)]);
  }
  return out;
}

// ---- grids ---------------------------------------------------------------------------------------------------------

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

/** CPU twin of the thinning passes: Zhang-Suen on cells flagged `thin` (1) while solid (2) cells only count as ink. */
export function zhangSuen(cols: number, rows: number, codes: Uint8Array, iterations: number): Uint8Array {
  let cur = Uint8Array.from(codes);
  const isInk = (c: Uint8Array, x: number, y: number) => (x < 0 || y < 0 || x >= cols || y >= rows ? 0 : c[y * cols + x] === CODE.thin || c[y * cols + x] === CODE.solid ? 1 : 0);
  for (let it = 0; it < iterations * 2; it++) {
    const next = Uint8Array.from(cur);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (cur[y * cols + x] !== CODE.thin) continue;
        const n0 = isInk(cur, x, y - 1), n1 = isInk(cur, x + 1, y - 1), n2 = isInk(cur, x + 1, y), n3 = isInk(cur, x + 1, y + 1);
        const n4 = isInk(cur, x, y + 1), n5 = isInk(cur, x - 1, y + 1), n6 = isInk(cur, x - 1, y), n7 = isInk(cur, x - 1, y - 1);
        const B = n0 + n1 + n2 + n3 + n4 + n5 + n6 + n7;
        const seq = [n0, n1, n2, n3, n4, n5, n6, n7, n0];
        let A = 0;
        for (let k = 0; k < 8; k++) if (seq[k] === 0 && seq[k + 1] === 1) A++;
        if (B < 2 || B > 6 || A !== 1) continue;
        const ok = (it & 1) === 0 ? n0 * n2 * n4 === 0 && n2 * n4 * n6 === 0 : n0 * n2 * n6 === 0 && n0 * n4 * n6 === 0;
        if (ok) next[y * cols + x] = CODE.none;
      }
    }
    cur = next;
  }
  return cur;
}

/**
 * CPU twin of the staircase pass (see FRAG_THIN, mode 1). A one-pixel line sampled at cell centres is 4-connected
 * (two cells per step) at some angles, worst at 45 degrees. Sub-pass 0 removes a cell that is the LEFT corner of such
 * a stair; sub-pass 1 does the same for RIGHT corners that are still redundant. Every removal keeps 8-connectivity.
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

// ---- reference rasteriser ---------------------------------------------------------------------------------------

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
 * the coarse grid" means for the "centre" rule of the pass, and the reference the tests compare against.
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

// ---- metrics --------------------------------------------------------------------------------------------------------

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

/** Fraction of cells that differ between two consecutive frames (symmetric difference over the cell count of `a`). */
export function changedRatio(a: Mask, b: Mask): { changed: number; ink: number } {
  let c = 0;
  let ink = 0;
  for (let i = 0; i < a.data.length; i++) {
    if (a.data[i] !== b.data[i]) c++;
    ink += a.data[i]!;
  }
  return { changed: c, ink };
}

// ---- tone patterns (screen anchored) -------------------------------------------------------------------------------

/** 8x8 Bayer value 0..63: the standard recursive matrix, by bit interleave (identical to the GLSL). */
export function bayer8(x: number, y: number): number {
  const hi = y & 7;
  const lo = (x ^ y) & 7;
  let v = 0;
  for (let i = 0; i < 3; i++) v = (v << 2) | (((hi >> (2 - i)) & 1) << 1) | ((lo >> (2 - i)) & 1);
  return ((v & 1) << 5) | ((v & 2) << 3) | ((v & 4) << 1) | ((v & 8) >> 1) | ((v & 16) >> 3) | ((v & 32) >> 5);
}

export type PatternStyle = "bayer8" | "clean";

/**
 * Is the cell (cx, cy) lit for a fill of this tone? The cell is a SCREEN cell: the result depends on nothing but the
 * tone and the cell coordinates, so a stipple never swims under pan or zoom. "clean" first quantises the tone to
 * sixteenths, which makes the Bayer thresholds trace regular dot lattices (1/16 one dot per 4x4, 1/4 every other
 * pixel, 1/2 a checkerboard) instead of a scatter.
 */
export function toneLit(tone: number, cx: number, cy: number, style: PatternStyle = "clean"): boolean {
  if (style === "bayer8") return tone > (bayer8(cx, cy) + 0.5) / 64;
  const k = Math.floor(tone * 16 + 0.5);
  return bayer8(cx, cy) < k * 4;
}
