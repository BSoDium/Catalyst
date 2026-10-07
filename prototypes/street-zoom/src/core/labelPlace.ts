export interface Candidate {
  id: string;
  /** projected anchor, CSS px */
  x: number;
  y: number;
  /** box size, CSS px */
  w: number;
  h: number;
  /** higher wins */
  priority: number;
  /** always placed, even when it overlaps */
  pinned?: boolean;
}

export interface Placed {
  id: string;
  /** top-left of the box */
  left: number;
  top: number;
  anchorX: number;
  anchorY: number;
}

/** Offsets tried in order: up-right (leader line at 45 deg), up-left, down-right, down-left. */
const SIDES: readonly (readonly [number, number])[] = [[1, -1], [-1, -1], [1, 1], [-1, 1]];

const overlaps = (a: Placed & { w: number; h: number }, b: Placed & { w: number; h: number }, pad: number) =>
  a.left < b.left + b.w + pad && b.left < a.left + a.w + pad && a.top < b.top + b.h + pad && b.top < a.top + a.h + pad;

/**
 * Greedy collision-aware placement: boxes offset diagonally from their anchor (HUD style leader lines). A box that is
 * outside the viewport or overlaps an already placed one tries the next side, then is dropped (unless pinned).
 * Anchors (markers) are obstacles too, so a label never covers another place's marker.
 */
export function placeLabels(
  cands: Candidate[],
  viewport: { w: number; h: number },
  opts: { gap?: number; pad?: number; margin?: number } = {},
): Placed[] {
  const gap = opts.gap ?? 22;
  const pad = opts.pad ?? 3;
  const margin = opts.margin ?? 4;
  const order = [...cands].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.priority - a.priority || a.id.localeCompare(b.id));
  const placed: (Placed & { w: number; h: number })[] = [];
  const markers = cands.map((c) => ({ id: c.id, left: c.x - 4, top: c.y - 4, anchorX: c.x, anchorY: c.y, w: 8, h: 8 }));
  for (const c of order) {
    let choice: (Placed & { w: number; h: number }) | null = null;
    for (const [sx, sy] of SIDES) {
      const left = sx > 0 ? c.x + gap : c.x - gap - c.w;
      const top = sy < 0 ? c.y - gap - c.h : c.y + gap;
      const box = { id: c.id, left, top, anchorX: c.x, anchorY: c.y, w: c.w, h: c.h };
      const inside = left >= margin && top >= margin && left + c.w <= viewport.w - margin && top + c.h <= viewport.h - margin;
      if (!inside) continue;
      if (placed.some((p) => overlaps(box, p, pad))) continue;
      if (markers.some((m) => m.id !== c.id && overlaps(box, m, 0))) continue;
      choice = box;
      break;
    }
    if (!choice && c.pinned) {
      choice = { id: c.id, left: c.x + gap, top: c.y - gap - c.h, anchorX: c.x, anchorY: c.y, w: c.w, h: c.h };
    }
    if (choice) placed.push(choice);
  }
  return placed.map(({ w: _w, h: _h, ...p }) => p);
}

/** Snap a CSS-px point to the centre of the art cell that contains it. */
export function snapToCell(v: number, cellCss: number): number {
  return Math.floor(v / cellCss) * cellCss + cellCss / 2;
}
