import type { CellRect } from "./pixel-labels";
import { LOD, type Ghost } from "./lod-tree";

/** A ghost box as the cells it is drawn in (#509). */
export interface GhostCells {
  rect: CellRect;
  alpha: number;
}

/**
 * The ghosts (`LodTree.ghosts`, container px) as whole cells of a grid of `cols` x `rows` cells of `cell` px: the true box rounded outwards, and only where it is at least `LOD.ghostMinCells` (3)
 * cells on both sides (owner, 2026-11-02: a smaller one is not drawn: dots were tried and taken back), and touches the grid, and is not as big as the screen. Pure.
 */
export function ghostCells(list: readonly Ghost[], cell: number, cols: number, rows: number): GhostCells[] {
  const out: GhostCells[] = [];
  for (const g of list) {
    if ((g.x1 - g.x0) / cell < LOD.ghostMinCells || (g.y1 - g.y0) / cell < LOD.ghostMinCells) continue;
    const rect: CellRect = { c0: Math.floor(g.x0 / cell), r0: Math.floor(g.y0 / cell), c1: Math.ceil(g.x1 / cell), r1: Math.ceil(g.y1 / cell) };
    if (rect.c1 <= 0 || rect.r1 <= 0 || rect.c0 >= cols || rect.r0 >= rows) continue;
    if (rect.c1 - rect.c0 > cols || rect.r1 - rect.r0 > rows) continue;
    out.push({ rect, alpha: g.alpha });
  }
  return out;
}
