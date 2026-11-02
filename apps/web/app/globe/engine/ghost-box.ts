import type { CellRect } from "./pixel-labels";
import { LOD, type Ghost } from "./lod-tree";

/** A ghost box as the cells it is drawn in (#509): an outline of the true box, or, when a side is under `LOD.ghostMinCells`, a solid dot of its real size. */
export interface GhostCells {
  rect: CellRect;
  alpha: number;
  dot: boolean;
}

/**
 * The ghosts (`LodTree.ghosts`, container px) as whole cells of a grid of `cols` x `rows` cells of `cell` px: a box of `LOD.ghostMinCells` cells or more on both sides is
 * its true box rounded outwards; a smaller one is a dot (the owner, 2026-11-02: "a dot or rectangle 1 or 2 px wide depending on the actual size"): each side its real length
 * in cells, 1 under a cell and a half, else 2 (or the outline's own, 3 and over), centred where the box is. Only those that touch the grid, and none as big as the screen. Pure.
 */
export function ghostCells(list: readonly Ghost[], cell: number, cols: number, rows: number): GhostCells[] {
  const out: GhostCells[] = [];
  const min = LOD.ghostMinCells;
  const side = (n: number) => (n >= min ? Math.ceil(n) : n < 1.5 ? 1 : 2);
  for (const g of list) {
    const wc = (g.x1 - g.x0) / cell;
    const hc = (g.y1 - g.y0) / cell;
    const dot = wc < min || hc < min;
    let rect: CellRect;
    if (dot) {
      const w = side(wc);
      const h = side(hc);
      const c0 = Math.round((g.x0 + g.x1) / 2 / cell - w / 2);
      const r0 = Math.round((g.y0 + g.y1) / 2 / cell - h / 2);
      rect = { c0, r0, c1: c0 + w, r1: r0 + h };
    } else rect = { c0: Math.floor(g.x0 / cell), r0: Math.floor(g.y0 / cell), c1: Math.ceil(g.x1 / cell), r1: Math.ceil(g.y1 / cell) };
    if (rect.c1 <= 0 || rect.r1 <= 0 || rect.c0 >= cols || rect.r0 >= rows) continue;
    if (rect.c1 - rect.c0 > cols || rect.r1 - rect.r0 > rows) continue;
    out.push({ rect, alpha: g.alpha, dot });
  }
  return out;
}
