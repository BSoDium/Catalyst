/**
 * The patterned legs (every mode but road) of the street map, written CELL BY CELL. MapLibre draws a dash at device resolution and the pass
 * then thresholds it onto the art grid, so a dash 1.5 cells long reads as one cell or two, or none, depending on the angle and the offset,
 * and flickers as the map moves. Here the path is projected to cell space and walked in whole cells: a dot is exactly one art pixel, a dash
 * exactly `on` of them, at every angle and zoom, and each is anchored to the leg's own length (a pan moves them with the line).
 *
 * Pure: `legCells` takes a path in cell coordinates and returns the cells to ink. The canvas is `TrailDotsLayer`.
 */
import { CELL_PATTERN, type LegMode } from "./modes";
import { TRAIL_BANDS } from "./trail";

export interface Cell {
  col: number;
  row: number;
  /** 0..TRAIL_BANDS-1 along the leg (0 at the origin), the band the gradient is in. */
  band: number;
}

/** The part of the segment a..b inside the rectangle [x0,x1]x[y0,y1] as a range of the parameter t in 0..1, or null. */
function clipRange(ax: number, ay: number, bx: number, by: number, x0: number, y0: number, x1: number, y1: number): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const edges: Array<[number, number]> = [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return t0 <= t1 ? [t0, t1] : null;
}

/**
 * The cells of one leg. `parts`: the leg's polyline pieces in cell coordinates (a leg is split where it crosses the antimeridian; the
 * pieces are walked in order as one length). `view`: the cells that are on screen (a margin of a few); everything else is skipped but still
 * counted, so the pattern does not depend on what is visible. Cells come out in path order, one per cell of pattern ink.
 */
export function legCells(parts: ReadonlyArray<ReadonlyArray<readonly [number, number]>>, mode: LegMode, view: { cols: number; rows: number }, margin = 3): Cell[] {
  const pattern = CELL_PATTERN[mode];
  if (!pattern) return [];
  let total = 0;
  for (const part of parts) for (let i = 1; i < part.length; i++) total += Math.hypot(part[i]![0] - part[i - 1]![0], part[i]![1] - part[i - 1]![1]);
  if (!(total > 0)) return [];
  const out: Cell[] = [];
  const { period, on } = pattern;
  let base = 0; // the path length before the piece
  const emit = (u: number, x: number, y: number) => {
    const band = Math.min(TRAIL_BANDS - 1, Math.floor((u / total) * TRAIL_BANDS));
    out.push({ col: Math.floor(x), row: Math.floor(y), band });
  };
  for (const part of parts) {
    for (let i = 1; i < part.length; i++) {
      const [ax, ay] = part[i - 1]!;
      const [bx, by] = part[i]!;
      const len = Math.hypot(bx - ax, by - ay);
      if (len === 0) continue;
      const range = clipRange(ax, ay, bx, by, -margin, -margin, view.cols + margin, view.rows + margin);
      if (range) {
        // whole cells along the path from the origin: u = 0, 1, 2, ...; the piece covers (base, base + len]
        const uFrom = Math.max(Math.ceil(base + range[0] * len), 0);
        const uTo = Math.floor(base + range[1] * len);
        for (let u = uFrom; u <= uTo; u++) {
          const m = u % period;
          if (m >= on) continue;
          const t = (u - base) / len;
          const x = ax + (bx - ax) * t;
          const y = ay + (by - ay) * t;
          emit(u, x, y);
        }
      }
      base += len;
    }
  }
  return out;
}
