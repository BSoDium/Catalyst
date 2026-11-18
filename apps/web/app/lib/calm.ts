/**
 * Where a photograph sits behind a trip's poster so that the map falls on its CALMEST part (sky, a wall, still water), not on its detail: the route and the labels are the poster's ink, and a skyline
 * or a crowd under them is noise (owner, 2026-11-18: "the map falls onto a sky area or an area with very little noise").
 *
 * `energy` is how much each cell of a small copy of the picture changes (the sum of the differences to its right and below neighbours, 0..1; `cols` x `rows`, row by row, top to bottom). The picture is shown at least as
 * large as the layer it fills (`w` x `run`, CSS px) and at most `ZOOM` times that, and the place chosen is the offset (and the scale) where the mean energy under `region` (the box the route is drawn in) is the least.
 * A tie is the middle of what the picture can move through: centred wins. Pure.
 */
export interface CalmPlace {
  width: number;
  height: number;
  left: number;
  top: number;
  /** The mean energy under the region at this place: what was minimised. */
  cost: number;
}

const STEPS = 15;
const ZOOMS = [1, 1.18, 1.4] as const;

export function calmPlace(
  energy: ArrayLike<number>,
  cols: number,
  rows: number,
  natural: { w: number; h: number },
  layer: { w: number; run: number },
  region: { x: number; y: number; w: number; h: number },
): CalmPlace | null {
  if (cols < 2 || rows < 2 || energy.length < cols * rows || natural.w <= 0 || natural.h <= 0 || region.w <= 0 || region.h <= 0) return null;
  const cover = Math.max(layer.w / natural.w, layer.run / natural.h);
  let best: CalmPlace | null = null;
  let bestScore = Infinity;
  for (const zoom of ZOOMS) {
    const k = cover * zoom;
    const width = natural.w * k;
    const height = natural.h * k;
    const spanX = width - layer.w;
    const spanY = height - layer.run;
    const nx = spanX > 0.5 ? STEPS : 1;
    const ny = spanY > 0.5 ? STEPS : 1;
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        // (the offsets run from the picture's far edge to its near one; the picture covers the layer at every one of them)
        const left = -spanX * (nx === 1 ? 0.5 : ix / (nx - 1));
        const top = -spanY * (ny === 1 ? 0.5 : iy / (ny - 1));
        // the cells under the region
        const c0 = Math.max(0, Math.floor(((region.x - left) / width) * cols));
        const c1 = Math.min(cols, Math.ceil(((region.x + region.w - left) / width) * cols));
        const r0 = Math.max(0, Math.floor(((region.y - top) / height) * rows));
        const r1 = Math.min(rows, Math.ceil(((region.y + region.h - top) / height) * rows));
        if (c1 <= c0 || r1 <= r0) continue;
        let sum = 0;
        for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) sum += energy[r * cols + c]!;
        const cost = sum / ((c1 - c0) * (r1 - r0));
        // (a little for being off centre and for being zoomed in: of two equally calm places the plainer one)
        const off = (nx === 1 ? 0 : Math.abs(ix / (nx - 1) - 0.5)) + (ny === 1 ? 0 : Math.abs(iy / (ny - 1) - 0.5));
        const score = cost + 0.004 * off + 0.01 * (zoom - 1);
        if (score < bestScore) {
          bestScore = score;
          best = { width, height, left, top, cost };
        }
      }
    }
  }
  return best;
}

/** How much each cell of an RGBA small copy changes: the mean absolute difference of its luminance to the cell on its right and the one below, 0..1 (the last column and row repeat). Pure. */
export function energyOf(rgba: ArrayLike<number>, cols: number, rows: number): Float32Array {
  const lum = new Float32Array(cols * rows);
  for (let i = 0; i < cols * rows; i++) lum[i] = (0.2126 * rgba[i * 4]! + 0.7152 * rgba[i * 4 + 1]! + 0.0722 * rgba[i * 4 + 2]!) / 255;
  const out = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const here = lum[r * cols + c]!;
      const right = lum[r * cols + Math.min(cols - 1, c + 1)]!;
      const below = lum[Math.min(rows - 1, r + 1) * cols + c]!;
      out[r * cols + c] = (Math.abs(here - right) + Math.abs(here - below)) / 2;
    }
  }
  return out;
}
