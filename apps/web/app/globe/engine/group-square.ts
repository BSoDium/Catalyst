/**
 * The geometry and the hit area of a detection box (pure, unit tested), shared by the Three.js globe and the street overlay so
 * the two draw, and pick, exactly the same thing.
 *
 * A node's box is a hollow RECTANGLE one art pixel thick, axis aligned in screen space (engine/lod-tree.ts gives its bounds in
 * CSS px). Its edges are whole art cells: the left/top edge is the cell containing the bound, the right/bottom edge the cell
 * after it. Its label sits above its top-left corner (engine/pixel-labels.ts).
 *
 * Hit area: the BORDER BAND (the outline grown by `GROUP_HIT.band` px each way) and the label plate, never the interior, so the boxes
 * inside a box stay clickable.
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

/** Distance in CSS px from a point to the OUTLINE of a rectangle (0 on it; inside or outside, the distance to the nearest edge). */
export function outlineDistance(x: number, y: number, x0: number, y0: number, x1: number, y1: number): number {
  const inX = x >= x0 && x <= x1;
  const inY = y >= y0 && y <= y1;
  if (inX && inY) return Math.min(x - x0, x1 - x, y - y0, y1 - y);
  const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
  const dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
  return Math.hypot(dx, dy);
}

/** Border band half-width, CSS px, per pointer type (the label plate is a hit area as a whole). */
export const GROUP_HIT = {
  mouse: { band: 6 },
  touch: { band: 12 },
} as const;

/**
 * How far a point is from a box's hit area: 0 on the border band or the label plate, growing outside, Infinity in the interior
 * between them (not part of the hit area). Smaller is nearer.
 */
export function boxHitDistance(
  x: number,
  y: number,
  box: { x0: number; y0: number; x1: number; y1: number },
  tab: { x0: number; y0: number; x1: number; y1: number } | null,
  kind: "mouse" | "touch",
): number {
  const band = GROUP_HIT[kind].band;
  const toBorder = outlineDistance(x, y, box.x0, box.y0, box.x1, box.y1);
  let d = Math.max(0, toBorder - band);
  if (tab) {
    const dx = x < tab.x0 ? tab.x0 - x : x > tab.x1 ? x - tab.x1 : 0;
    const dy = y < tab.y0 ? tab.y0 - y : y > tab.y1 ? y - tab.y1 : 0;
    d = Math.min(d, Math.hypot(dx, dy));
  }
  // inside the box and further than the band from its edge: the interior, not a target
  const inside = x > box.x0 && x < box.x1 && y > box.y0 && y < box.y1;
  if (inside && toBorder > band && !(tab && x >= tab.x0 && x <= tab.x1 && y >= tab.y0 && y <= tab.y1)) return Infinity;
  return d;
}

/** Whether a point is on the box's hit area (the border band or the label plate) for a pointer type. */
export function boxHit(x: number, y: number, box: { x0: number; y0: number; x1: number; y1: number }, tab: { x0: number; y0: number; x1: number; y1: number } | null, kind: "mouse" | "touch"): boolean {
  return boxHitDistance(x, y, box, tab, kind) <= 0;
}

