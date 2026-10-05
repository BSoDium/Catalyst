/**
 * Pure logic of the pixel pass. Every function here has a GLSL twin in `gl/shaders.ts`; the unit tests pin the
 * behaviour so the shader and the maths cannot drift silently.
 *
 * Channel contract (what the map style paints, what the pass reads):
 *  - R: hard ink (foreground). Max-pooled, thresholded: thin lines stay connected, never dithered.
 *  - G: foreground tone, 0..1. Max-pooled, ordered-dithered (fills, dotted minor roads, faded borders).
 *  - B: muted tone, 0..1. Max-pooled, ordered-dithered (graticule, rail, limb).
 *  - A: coverage. Outside the globe disc alpha is 0; cells straddling the edge become the limb outline.
 */

export type Rgb = readonly [number, number, number];

/** Art pixel size in CSS px: 3 on desktop, 2 below 520 px (docs/renderer-decision.md). */
export function artPixelCss(viewportMinSide: number): number {
  return viewportMinSide >= 520 ? 3 : 2;
}

/** Whole device pixels per art pixel (fractional DPR is rounded so art pixels stay square and equal). */
export function cellDevicePx(artCss: number, dpr: number): number {
  return Math.max(1, Math.round(artCss * dpr));
}

/** 8x8 Bayer matrix value 0..63 by bit interleaving (identical to the GLSL). */
export function bayer8(x: number, y: number): number {
  const a = x & 7;
  const b = (x ^ y) & 7;
  // interleave bits of b (even) and a (odd), reversed: standard bit-reversal construction
  let v = 0;
  for (let i = 0; i < 3; i++) {
    v = (v << 2) | (((b >> (2 - i)) & 1) << 1) | ((a >> (2 - i)) & 1);
  }
  return ((v & 1) << 5) | ((v & 2) << 3) | ((v & 4) << 1) | ((v & 8) >> 1) | ((v & 16) >> 3) | ((v & 32) >> 5);
}

/** Dither threshold in (0,1) for art cell (cx, cy). A tone t lights the cell when t > threshold. */
export function ditherThreshold(cx: number, cy: number): number {
  return (bayer8(cx, cy) + 0.5) / 64;
}

export interface Pooled {
  r: number;
  g: number;
  b: number;
  /** min and max alpha over the cell footprint */
  aMin: number;
  aMax: number;
}

export type CellClass = "none" | "fg" | "muted";

export interface ClassifyOptions {
  /** R and the limb use this hard threshold */
  inkThreshold: number;
  /** false: tones use a plain 0.5 threshold (no stipple) */
  dither: boolean;
}

/** What one art cell becomes. Priority: R ink, limb, B tone, G tone. */
export function classify(p: Pooled, cx: number, cy: number, o: ClassifyOptions): CellClass {
  if (p.aMax < 0.5) return "none"; // outside the globe: page colour
  if (p.r > o.inkThreshold) return "fg";
  if (p.aMin < 0.5) return "muted"; // straddles the disc edge: 1 art px limb
  const t = o.dither ? ditherThreshold(cx, cy) : 0.5;
  if (p.b > t) return "muted";
  if (p.g > t) return "fg";
  return "none";
}

/**
 * Max-pool an RGBA8-like image (values 0..1, row 0 = top) into art cells of `cell` source pixels.
 * Reference implementation of pass A (used by tests and by the doc's "why max, not mean" figure).
 */
export function poolImage(
  data: Float32Array,
  w: number,
  h: number,
  cell: number,
): { cols: number; rows: number; cells: Pooled[] } {
  const cols = Math.ceil(w / cell);
  const rows = Math.ceil(h / cell);
  const cells: Pooled[] = [];
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const p: Pooled = { r: 0, g: 0, b: 0, aMin: 1, aMax: 0 };
      for (let y = cy * cell; y < Math.min(h, (cy + 1) * cell); y++) {
        for (let x = cx * cell; x < Math.min(w, (cx + 1) * cell); x++) {
          const i = (y * w + x) * 4;
          p.r = Math.max(p.r, data[i]!);
          p.g = Math.max(p.g, data[i + 1]!);
          p.b = Math.max(p.b, data[i + 2]!);
          p.aMin = Math.min(p.aMin, data[i + 3]!);
          p.aMax = Math.max(p.aMax, data[i + 3]!);
        }
      }
      cells.push(p);
    }
  }
  return { cols, rows, cells };
}

/** Box-mean pooling of one channel, only to show in tests why it is the wrong choice for lines. */
export function meanPool(data: Float32Array, w: number, h: number, cell: number, channel: number): Float32Array {
  const cols = Math.ceil(w / cell);
  const rows = Math.ceil(h / cell);
  const out = new Float32Array(cols * rows);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      let s = 0;
      let n = 0;
      for (let y = cy * cell; y < Math.min(h, (cy + 1) * cell); y++) {
        for (let x = cx * cell; x < Math.min(w, (cx + 1) * cell); x++) {
          s += data[(y * w + x) * 4 + channel]!;
          n++;
        }
      }
      out[cy * cols + cx] = s / n;
    }
  }
  return out;
}

/** Focus mask coverage 0..1: 1 inside `radius`, smooth fall-off over `feather`, 0 beyond. */
export function maskCoverage(dist: number, radius: number, feather: number): number {
  if (radius <= 0) return 0;
  if (feather <= 0) return dist <= radius ? 1 : 0;
  const t = Math.min(1, Math.max(0, (dist - radius) / feather));
  return 1 - t * t * (3 - 2 * t);
}

/** A cell shows the sharp render when the mask coverage exceeds its dither threshold. */
export function showsSharp(coverage: number, cx: number, cy: number): boolean {
  return coverage > ditherThreshold(cx, cy);
}

/** Fraction of cells (of a big flat area) that are sharp at a given coverage. Used to test the dissolve is monotonic and fair. */
export function sharpFraction(coverage: number, size = 64): number {
  let n = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (showsSharp(coverage, x, y)) n++;
  return n / (size * size);
}

/** Reveal animation: eased 0..1 towards a target; instant under reduced motion. Pure, steps by dt (ms). */
export class RevealState {
  value = 0;
  target = 0;
  constructor(
    public durationMs = 700,
    public reducedMotion = false,
  ) {}
  set(target: number): void {
    this.target = Math.min(1, Math.max(0, target));
    if (this.reducedMotion) this.value = this.target;
  }
  get animating(): boolean {
    return this.value !== this.target;
  }
  step(dtMs: number): number {
    if (!this.animating) return this.value;
    const d = dtMs / this.durationMs;
    this.value = this.value < this.target ? Math.min(this.target, this.value + d) : Math.max(this.target, this.value - d);
    return this.value;
  }
  /** eased value for display (smoothstep) */
  get eased(): number {
    const t = this.value;
    return t * t * (3 - 2 * t);
  }
}

/** Compose a (possibly translucent) colour over an opaque background. */
export function over(fg: readonly [number, number, number, number], bg: Rgb): Rgb {
  const a = fg[3];
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a)];
}

/** Parse `rgb(r g b / a)`, `rgba(r, g, b, a)`, `#rgb[a]`, `#rrggbb[aa]` and `color(srgb r g b / a)` into 0..1 rgba. */
export function parseCssColor(input: string): [number, number, number, number] {
  const s = input.trim().toLowerCase();
  if (s.startsWith("#")) {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) throw new Error(`bad colour ${input}`);
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
    return [n(0), n(2), n(4), h.length === 8 ? n(6) : 1];
  }
  const m = /^(rgba?|color\(srgb)\s*\(?([^)]*)\)?$/.exec(s);
  if (!m) throw new Error(`bad colour ${input}`);
  const parts = m[2]!.split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.some((p) => Number.isNaN(p))) throw new Error(`bad colour ${input}`);
  const scale = m[1] === "color(srgb" ? 1 : 255;
  return [parts[0]! / scale, parts[1]! / scale, parts[2]! / scale, parts[3] ?? 1];
}
