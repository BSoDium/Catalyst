/**
 * An image on the ART-PIXEL grid (pure, unit tested): one packed RGBA word per art cell (`0xAABBGGRR`, the byte order of
 * `ImageData` on a little-endian machine, so the overlay uploads `data` as it is). Everything the label overlays draw
 * (plates, outlines, text) goes through it, so every mark is whole art cells at whole-cell positions, 1 cell thick: no
 * sub-pixel position, no thin line, no smoothing, by construction. `PixelOverlay` shows it on a canvas of `cols x rows`
 * scaled up with nearest-neighbour, so one cell of the buffer is one art pixel of the map.
 *
 * Marks are written as a palette LEVEL (an index into the theme's ramp, 0 = the page colour, the last = the ink) and an
 * OPACITY. A mark with opacity below 1 is composited "over" what the buffer already holds in that cell, and the canvas
 * composites the buffer over the map: so a fade is a real alpha blend per art cell, never a darker or lighter shade of grey
 * (a shade-based fade has a visible minimum that occludes what is underneath, right after it appears and right before it goes).
 *
 * `CLEAR` (255) is what `get` answers for a cell that holds nothing, and `MIXED` for one that holds a blend of levels.
 */
import { forEachInk } from "./pixel-font/pixel-font";

export const CLEAR = 255;
export const MIXED = 254;

/** A packed colour of the default ramp: level `l` is the grey (l, l, l), so a buffer without a theme is still exact and readable in tests. */
const defaultColor = (level: number): number => (0xff000000 | (level << 16) | (level << 8) | level) >>> 0;

/** `[r, g, b]` (0..1) packed opaque. */
export const packRgb = (c: readonly [number, number, number]): number => (0xff000000 | (Math.round(c[2] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[0] * 255)) >>> 0;

export class PixelBuffer {
  cols = 0;
  rows = 0;
  /** Packed straight-alpha RGBA per cell; alpha 0 = transparent. */
  data = new Uint32Array(0);
  /** Bounding box of the cells written since the last `resetDirty` (inclusive), or an empty box (minX > maxX). */
  minX = 1;
  maxX = 0;
  minY = 1;
  maxY = 0;
  /** Opaque colour of every level, and the reverse lookup (`null`: the default grey ramp). */
  private ramp: Uint32Array | null = null;
  private levelOf: Map<number, number> | null = null;

  constructor(cols = 0, rows = 0) {
    if (cols > 0 && rows > 0) this.resize(cols, rows);
  }

  /** The theme's colours, one `[r, g, b]` (0..1) per level: page colour first, ink last. Cells already written keep their colour. */
  setRamp(ramp: readonly (readonly [number, number, number])[]): void {
    this.ramp = Uint32Array.from(ramp, packRgb);
    this.levelOf = new Map();
    this.ramp.forEach((c, l) => {
      if (!this.levelOf!.has(c)) this.levelOf!.set(c, l);
    });
  }

  private color(level: number): number {
    return this.ramp ? (this.ramp[level] ?? 0xff000000) : defaultColor(level);
  }

  resize(cols: number, rows: number) {
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols;
    this.rows = rows;
    this.data = new Uint32Array(cols * rows);
    this.resetDirty();
  }

  resetDirty() {
    this.minX = 1;
    this.maxX = 0;
    this.minY = 1;
    this.maxY = 0;
  }

  get dirty() {
    return this.minX <= this.maxX;
  }

  private touch(x: number, y: number) {
    if (this.minX > this.maxX) {
      this.minX = this.maxX = x;
      this.minY = this.maxY = y;
      return;
    }
    if (x < this.minX) this.minX = x;
    else if (x > this.maxX) this.maxX = x;
    if (y < this.minY) this.minY = y;
    else if (y > this.maxY) this.maxY = y;
  }

  /** Make every cell transparent again (only the dirty box is touched). */
  clearDirty() {
    if (!this.dirty) return;
    for (let y = this.minY; y <= this.maxY; y++) this.data.fill(0, y * this.cols + this.minX, y * this.cols + this.maxX + 1);
  }

  /** Composite one cell: colour `rgb` (opaque, packed) at opacity `a` (0..255) over what the cell holds. */
  private blend(i: number, rgb: number, a: number) {
    const d = this.data[i]!;
    const da = d >>> 24;
    if (a >= 255 || da === 0) {
      this.data[i] = a >= 255 ? rgb : (((a << 24) | (rgb & 0xffffff)) >>> 0);
      return;
    }
    // straight-alpha "over": out = (src * a + dst * da * (1 - a)) / outA
    const k = (da * (255 - a)) / 255;
    const oa = a + k;
    let out = Math.round(oa) << 24;
    for (let s = 0; s < 24; s += 8) out |= Math.round((((rgb >>> s) & 255) * a + ((d >>> s) & 255) * k) / oa) << s;
    this.data[i] = out >>> 0;
  }

  /** Write a cell in palette `level` at opacity `alpha` (0..1, default opaque); off the grid it is ignored. */
  set(x: number, y: number, level: number, alpha = 1) {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
    const a = alpha >= 1 ? 255 : Math.round(alpha * 255);
    if (a <= 0) return;
    this.blend(y * this.cols + x, this.color(level), a);
    this.touch(x, y);
  }

  /** The palette level of a cell's colour (its opacity is `alphaAt`): `CLEAR` when the cell is transparent, `MIXED` when its colour is a blend of levels. */
  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return CLEAR;
    const c = this.data[y * this.cols + x]!;
    if (c >>> 24 === 0) return CLEAR;
    const rgb = ((c & 0xffffff) | 0xff000000) >>> 0;
    const level = this.levelOf ? this.levelOf.get(rgb) : (rgb & 0xff) === ((rgb >>> 8) & 0xff) && (rgb & 0xff) === ((rgb >>> 16) & 0xff) ? rgb & 0xff : undefined;
    return level ?? MIXED;
  }

  /** The opacity of a cell, 0..1. */
  alphaAt(x: number, y: number): number {
    return x < 0 || y < 0 || x >= this.cols || y >= this.rows ? 0 : (this.data[y * this.cols + x]! >>> 24) / 255;
  }

  fillRect(x: number, y: number, w: number, h: number, level: number, alpha = 1) {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.cols, x + w);
    const y1 = Math.min(this.rows, y + h);
    if (x1 <= x0 || y1 <= y0) return;
    const a = alpha >= 1 ? 255 : Math.round(alpha * 255);
    if (a <= 0) return;
    const rgb = this.color(level);
    for (let yy = y0; yy < y1; yy++) {
      if (a >= 255) this.data.fill(rgb, yy * this.cols + x0, yy * this.cols + x1);
      else for (let i = yy * this.cols + x0, e = yy * this.cols + x1; i < e; i++) this.blend(i, rgb, a);
    }
    this.touch(x0, y0);
    this.touch(x1 - 1, y1 - 1);
  }

  /** A rectangle outline one cell thick; `dotted` lights every other cell along it (starting lit at each corner's row/column origin). Each cell is written once, so a translucent outline has one opacity all round. */
  strokeRect(x: number, y: number, w: number, h: number, level: number, dotted = false, alpha = 1) {
    if (w < 1 || h < 1) return;
    for (let i = 0; i < w; i++) {
      if (dotted && i % 2) continue;
      this.set(x + i, y, level, alpha);
      if (h > 1) this.set(x + i, y + h - 1, level, alpha);
    }
    for (let j = 1; j < h - 1; j++) {
      if (dotted && j % 2) continue;
      this.set(x, y + j, level, alpha);
      if (w > 1) this.set(x + w - 1, y + j, level, alpha);
    }
  }

  /** A one-cell line (Bresenham) between two cells, both included. */
  line(x0: number, y0: number, x1: number, y1: number, level: number, alpha = 1) {
    const dx = Math.abs(x1 - x0);
    const sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0);
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let x = x0;
    let y = y0;
    for (let n = 0; n < 4096; n++) {
      this.set(x, y, level, alpha);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  /** Text in the pixel font: pen at column `x`, baseline at row `baseline`, in palette `level` at opacity `alpha`. */
  text(text: string, x: number, baseline: number, level: number, alpha = 1) {
    forEachInk(text, x, baseline, (px, py) => this.set(px, py, level, alpha));
  }

  /** Number of cells that are not transparent (tests). */
  count(): number {
    let n = 0;
    for (let i = 0; i < this.data.length; i++) if (this.data[i]! >>> 24 !== 0) n++;
    return n;
  }

  /** The cells as rows of characters (tests, debugging): `.` transparent, else the level in base 36 (`?` for a blend). */
  dump(x = 0, y = 0, w = this.cols, h = this.rows): string[] {
    const out: string[] = [];
    for (let j = y; j < Math.min(this.rows, y + h); j++) {
      let s = "";
      for (let i = x; i < Math.min(this.cols, x + w); i++) {
        const v = this.get(i, j);
        s += v === CLEAR ? "." : v === MIXED ? "?" : v.toString(36);
      }
      out.push(s);
    }
    return out;
  }
}
