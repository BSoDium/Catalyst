/**
 * The geometry of a detection box on the art-pixel grid (pure, unit tested), shared by the Three.js globe and the street overlay
 * so the two draw exactly the same thing. Its hit area is engine/hit-area.ts.
 *
 * A node's box is a hollow RECTANGLE one art pixel thick, axis aligned in screen space (engine/lod-tree.ts gives its bounds in
 * CSS px). Its edges are whole art cells: the left/top edge is the cell containing the bound, the right/bottom edge the cell
 * after it. Its label sits above its top-left corner (engine/pixel-labels.ts).
 */
import type { CellRect } from "./pixel-labels";

export type { CellRect } from "./pixel-labels";

/** The cell rectangle of a box whose bounds are (`x0`, `y0`, `x1`, `y1`) CSS px in a grid whose cell (0, 0) starts at the origin: the cells that contain the bounds (at least 3 across). */
export function snapBox(x0: number, y0: number, x1: number, y1: number, cell: number): CellRect {
  let c0 = Math.floor(x0 / cell);
  let c1 = Math.ceil(x1 / cell);
  let r0 = Math.floor(y0 / cell);
  let r1 = Math.ceil(y1 / cell);
  for (let grow = 0; c1 - c0 < 3; grow++) grow % 2 ? c0-- : c1++;
  for (let grow = 0; r1 - r0 < 3; grow++) grow % 2 ? r0-- : r1++;
  return { c0, r0, c1, r1 };
}
