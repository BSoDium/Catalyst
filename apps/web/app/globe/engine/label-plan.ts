/**
 * Where every label goes (pure, unit tested): the rule that EVERY drawn box shows its label. There is no dimmed box, no box without a name.
 *
 * The input is the set of nodes the cut WANTS drawn (binary: a node is in or out, engine/lod-tree.ts), each with the rectangle it is drawn in
 * and the ways its label can be written (`labelVariants` in engine/label-text.ts: the whole label, without its counter, truncated with an
 * ellipsis down to six characters). Nodes are placed in priority order (the higher score, then the bigger box, then the key, so the result
 * never depends on the order of the input). For each node, widest label first:
 *   1. the first of its candidate positions (`labelCandidates`: above-left, above-right, nested in each inner corner, below, left, right,
 *      shifted along the edges) whose plate collides with no plate already placed (`clearance` of room) wins;
 *   2. if none is free the next, shorter way of writing the label is tried at all the positions;
 *   3. if the shortest is not free anywhere the label is drawn ANYWAY, on top, on a plate of the page colour: the position (of the whole label or of
 *      the shortest one) that overlaps the placed plates least, shifted from the first candidate by the smallest displacement that reduces the
 *      overlap.
 *
 * Stable between plans: a node's previous choice is kept while it is still free, and only given up for a better one (a wider label, an earlier
 * position) when that one is free with `upgradeMargin` extra room, so a camera that moves a plate by a pixel cannot flip two labels back and
 * forth. A choice that stops being free is replaced at once. (Between plans, when the plan runs at all, is engine/label-track.ts.)
 *
 * Units: the geometry is unit-free. The labels of the boxes plan in CSS px (`PX_UNITS`, with the box line's thickness as `inset`); the pixel
 * text of the map keeps the whole-cell version (`CELL_UNITS`), used by the tests of the planner as well.
 */
import { LABEL_TYPE } from "./label-text";
import { labelCandidates, type CellRect, type GridSize, type LabelSpot } from "./pixel-labels";

/** The distances the plan works with, in the unit of its geometry. */
export interface PlanUnits {
  /** Room kept between two plates. */
  clearance: number;
  /** Extra room a better choice needs before it replaces the one a node had in the last plan. */
  upgradeMargin: number;
  /** Step of the displacement search of the last resort. */
  shiftStep: number;
  /** How far a nested plate sits inside the box's outline: the outline's thickness. */
  inset: number;
  /** Snap of the positions shifted along an edge. */
  quant: number;
  /** Clear room between a plate outside a box and the box's outline. */
  gap: number;
  /** How far a plate aligned with a box edge sticks out past it (0: its edge is the box's outer edge). */
  bleed: number;
}

/** Whole art cells (the pixel text). */
export const CELL_UNITS: PlanUnits = { clearance: 1, upgradeMargin: 2, shiftStep: 2, inset: 1, quant: 1, gap: 0, bleed: 0 };
/**
 * CSS px (the DOM labels): 4 px between two labels, 10 px of room before a label gives its place up, `LABEL_TYPE.boxGap` (3 px) of clear room
 * between a label and its box, the plate's edge ON the box's outer edge (`LABEL_TYPE.bleed` 0: the text starts `padX` inside it), a nested label
 * `inset` (the outline's thickness plus `LABEL_TYPE.nestInset`, set per plan from the cell) inside.
 */
export const PX_UNITS: PlanUnits = { clearance: 4, upgradeMargin: 10, shiftStep: 6, inset: 2.5 + LABEL_TYPE.nestInset, quant: 0.5, gap: LABEL_TYPE.boxGap, bleed: LABEL_TYPE.bleed };

/** The units of a plan on a map whose art cell is `cell` CSS px (the box outline is one cell thick). */
export const pxUnits = (cell: number): PlanUnits => ({ ...PX_UNITS, inset: cell + LABEL_TYPE.nestInset });

/** Kept for the cell version's tests and docs. */
export const CLEARANCE = CELL_UNITS.clearance;
export const UPGRADE_MARGIN = CELL_UNITS.upgradeMargin;

/** What a node chose in the last plan: the variant, the candidate id (-1: drawn over others) and, for the last resort, the plate's offset from the box's top-left corner. */
export interface Prev {
  variant: number;
  cand: number;
  dx: number;
  dy: number;
}

/** A way of writing a label, for the plan: its size. */
export interface Sized {
  w: number;
  h: number;
}

export interface PlanItem {
  /** Placement order: higher first (selected nodes are boosted by the caller). */
  score: number;
  /** The box's area (the tie-break: the bigger box first). */
  area: number;
  /** Final tie-break: a stable key. */
  key: string;
  rect: CellRect;
  variants: readonly Sized[];
  prev: Prev | null;
  /**
   * Rectangles this node's plate must stay clear of, as well as the plates already placed: the BOXES of the other nodes (`boxesToAvoid`; the
   * planner otherwise looks at plates only, and a label would land on a neighbour's outline). A position that touches one comes after every
   * position of the same wording that does not; it is still taken, rather than shortening the label or going over other plates.
   */
  avoid?: readonly Plate[] | undefined;
}

export interface PlanResult {
  /** Index in the node's variants. */
  variant: number;
  /** The plate's top-left corner and size. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The candidate id, or -1 when it is drawn over other plates (nothing was free). */
  cand: number;
  inside: boolean;
  /** The plate overlaps a placed one: the last resort. */
  overlap: boolean;
}

/** A plate that is already there and must be avoided. */
export interface Plate {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const hits = (p: Plate, x: number, y: number, w: number, h: number, pad: number) => x - pad < p.x1 && x + w + pad > p.x0 && y - pad < p.y1 && y + h + pad > p.y0;
const overlapArea = (p: Plate, x: number, y: number, w: number, h: number) => Math.max(0, Math.min(p.x1, x + w) - Math.max(p.x0, x)) * Math.max(0, Math.min(p.y1, y + h) - Math.max(p.y0, y));

interface Best {
  v: number;
  x: number;
  y: number;
  cand: number;
  inside: boolean;
  area: number;
  shift: number;
}

/** Placement order of the items: score, then the bigger box, then the key. */
export function planOrder(items: readonly PlanItem[]): number[] {
  return items.map((_, n) => n).sort((a, b) => {
    const p = items[a]!;
    const q = items[b]!;
    return q.score - p.score || q.area - p.area || (p.key < q.key ? -1 : p.key > q.key ? 1 : 0);
  });
}

/**
 * Place the plates of `items` on `grid`, avoiding the `fixed` plates (labels that stay where they are: the plan of the nodes that are new
 * while the rest is frozen). `result[n]` belongs to `items[n]`.
 */
export function planLabels(items: readonly PlanItem[], grid: GridSize, units: PlanUnits = CELL_UNITS, fixed: readonly Plate[] = []): PlanResult[] {
  const out: PlanResult[] = new Array(items.length);
  const order = planOrder(items);
  const placed: Plate[] = fixed.slice();
  const free = (x: number, y: number, w: number, h: number, pad: number) => !placed.some((p) => hits(p, x, y, w, h, pad));
  const rank = (v: number, id: number) => v * 64 + id;
  const { clearance, upgradeMargin, shiftStep } = units;
  const spotUnits = { inset: units.inset, quant: units.quant, gap: units.gap, bleed: units.bleed };

  for (const n of order) {
    const t = items[n]!;
    const count = t.variants.length;
    const spots: LabelSpot[][] = [];
    const spotsOf = (v: number) => (spots[v] ??= labelCandidates(t.rect, t.variants[v]!.w, t.variants[v]!.h, grid, spotUnits));
    /**
     * The first (variant, candidate) in priority order, ranked below `before`, that is free with `pad` more room, or null. A position that touches
     * one of the boxes to `avoid` is taken only when no position of the same wording keeps clear of them (the label is not shortened for it).
     */
    const avoid = t.avoid;
    const clearOfBoxes = (x: number, y: number, w: number, h: number) => !avoid || !avoid.some((p) => hits(p, x, y, w, h, 0));
    const first = (pad: number, before = Infinity): { v: number; s: LabelSpot } | null => {
      for (let v = 0; v < count; v++) {
        const { w, h } = t.variants[v]!;
        let touching: { v: number; s: LabelSpot } | null = null;
        for (const s of spotsOf(v)) {
          if (rank(v, s.id) >= before) return touching;
          if (!free(s.x, s.y, w, h, clearance + pad)) continue;
          if (clearOfBoxes(s.x, s.y, w, h)) return { v, s };
          touching ??= { v, s };
        }
        if (touching) return touching;
      }
      return null;
    };
    let chosen: { v: number; s: LabelSpot } | null = first(0);
    const prev = t.prev;
    if (chosen && prev && prev.cand >= 0 && prev.variant < count) {
      const { w, h } = t.variants[prev.variant]!;
      const same = spotsOf(prev.variant).find((s) => s.id === prev.cand);
      if (same && free(same.x, same.y, w, h, clearance) && rank(chosen.v, chosen.s.id) < rank(prev.variant, prev.cand)) {
        // a better choice exists: take it only when it is free with room to spare
        chosen = first(upgradeMargin, rank(prev.variant, prev.cand)) ?? { v: prev.variant, s: same };
      }
    }
    if (chosen) {
      const { w, h } = t.variants[chosen.v]!;
      placed.push({ x0: chosen.s.x, y0: chosen.s.y, x1: chosen.s.x + w, y1: chosen.s.y + h });
      out[n] = { variant: chosen.v, x: chosen.s.x, y: chosen.s.y, w, h, cand: chosen.s.id, inside: chosen.s.inside, overlap: false };
      continue;
    }

    // The last resort: on top of the others, where it overlaps the least. The whole label and the shortest are weighed; every candidate
    // position and the displacements of the first one are tried.
    const vs = count > 1 ? [0, count - 1] : [0];
    let best: Best | null = null;
    const consider = (v: number, x: number, y: number, cand: number, inside: boolean, shift: number) => {
      const { w, h } = t.variants[v]!;
      if (x < 0 || y < 0 || x + w > grid.cols || y + h > grid.rows) return;
      let area = 0;
      for (const p of placed) area += overlapArea(p, x, y, w, h);
      const b = best;
      if (!b || area < b.area || (area === b.area && (shift < b.shift || (shift === b.shift && v < b.v)))) best = { v, x, y, cand, inside, area, shift };
    };
    for (const v of vs) {
      const { w, h } = t.variants[v]!;
      const sp = spotsOf(v);
      const home = sp[0];
      for (const s of sp) consider(v, s.x, s.y, s.id, s.inside, home ? Math.abs(s.x - home.x) + Math.abs(s.y - home.y) : 0);
      if (home) for (let dy = -h; dy <= h; dy += shiftStep) for (let dx = -w; dx <= w; dx += shiftStep) if (dx || dy) consider(v, home.x + dx, home.y + dy, -1, false, Math.abs(dx) + Math.abs(dy));
    }
    const found = best as Best | null;
    let pick: Best;
    if (prev && prev.cand < 0 && prev.variant < count && found) {
      // keep the last plan's displaced plate while it overlaps no more than the new best
      const { w, h } = t.variants[prev.variant]!;
      const x = t.rect.c0 + prev.dx;
      const y = t.rect.r0 + prev.dy;
      let area = Infinity;
      if (x >= 0 && y >= 0 && x + w <= grid.cols && y + h <= grid.rows) {
        area = 0;
        for (const p of placed) area += overlapArea(p, x, y, w, h);
      }
      pick = area <= found.area ? { v: prev.variant, x, y, cand: -1, inside: false, area, shift: 0 } : found;
    } else if (found) pick = found;
    else {
      // nothing fits the grid at all (a label wider than the screen): the shortest, clamped
      const { w, h } = t.variants[count - 1]!;
      pick = { v: count - 1, x: Math.max(0, Math.min(grid.cols - w, t.rect.c0)), y: Math.max(0, Math.min(grid.rows - h, t.rect.r0 - h)), cand: -1, inside: false, area: 0, shift: 0 };
    }
    const { w, h } = t.variants[pick.v]!;
    placed.push({ x0: pick.x, y0: pick.y, x1: pick.x + w, y1: pick.y + h });
    out[n] = { variant: pick.v, x: pick.x, y: pick.y, w, h, cand: pick.cand, inside: pick.inside, overlap: true };
  }
  return out;
}

/**
 * The boxes the plate of node `k` must keep clear of (`PlanItem.avoid`): every OTHER box of `boxes` (each already grown by the room to keep) that
 * is near enough for one of its plate's positions to touch it, that is within `reach` px of node `k`'s own box (the largest distance a position of
 * its plate can be from it: its width or height plus the gap). Pure.
 */
export function boxesToAvoid(boxes: readonly Plate[], k: number, reach: number): Plate[] {
  const me = boxes[k]!;
  const out: Plate[] = [];
  for (let j = 0; j < boxes.length; j++) {
    const b = boxes[j]!;
    if (j !== k && b.x0 < me.x1 + reach && b.x1 > me.x0 - reach && b.y0 < me.y1 + reach && b.y1 > me.y0 - reach) out.push(b);
  }
  return out;
}
