/**
 * Where every label goes (pure, unit tested): the rule that EVERY drawn box shows its label. There is no dimmed box, no box without a name.
 *
 * The input is the set of nodes the cut WANTS drawn (binary: a node is in or out, engine/lod-tree.ts), each with the rectangle it is drawn in
 * and the ways its label can be written (`labelVariants`: the whole label, without its counter, without the country, truncated with an
 * ellipsis down to six characters). Nodes are placed in priority order (selected, focused and hovered first, then the higher score, then the
 * bigger box, then the key, so the result never depends on the order of the input). For each node, widest label first:
 *   1. the first of its candidate positions (`labelCandidates`: above-left, above-right, nested in each inner corner, below, left, right,
 *      shifted along the edges) whose plate collides with no plate already placed (`CLEARANCE` cells of room) wins;
 *   2. if none is free the next, shorter way of writing the label is tried at all the positions;
 *   3. if the shortest is not free anywhere the label is drawn ANYWAY, on top, on its page-colour plate: the position (of the whole label or of
 *      the shortest one) that overlaps the placed plates least, shifted from the first candidate by the smallest displacement that reduces the
 *      overlap. A hovered, focused or selected node is placed first, whole, and never shortened.
 *
 * Stable between frames (no flicker, no hopping): a node's previous choice is kept while it is still free, and only given up for a better
 * one (a wider label, an earlier position) when that one is free with `UPGRADE_MARGIN` extra cells of room, so a camera that moves a
 * plate by a cell cannot flip two labels back and forth. A choice that stops being free is replaced at once.
 */
import { labelCandidates, type CellRect, type GridSize, type LabelSpot, type LabelVariant } from "./pixel-labels";

/** Cells of clearance between two plates. */
export const CLEARANCE = 1;
/** Extra clearance a better choice needs before it replaces the one a node had last frame. */
export const UPGRADE_MARGIN = 2;
/** Step in cells of the displacement search of the last resort. */
const SHIFT_STEP = 2;

/** What a node chose last frame: the variant, the candidate id (-1: drawn over others) and, for the last resort, the plate's offset from the box's top-left cell. */
export interface Prev {
  variant: number;
  cand: number;
  dx: number;
  dy: number;
}

export interface PlanItem {
  /** Selected, focused or hovered: placed first, whole. */
  forced: boolean;
  /** Placement order: higher first. */
  score: number;
  /** The box's area in cells (the tie-break: the bigger box first). */
  area: number;
  /** Final tie-break: a stable key. */
  key: string;
  rect: CellRect;
  variants: readonly LabelVariant[];
  prev: Prev | null;
}

export interface PlanResult {
  /** Index in the node's variants. */
  variant: number;
  /** The plate's top-left cell and size. */
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

interface Plate {
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

export function planLabels(items: readonly PlanItem[], grid: GridSize): PlanResult[] {
  const out: PlanResult[] = new Array(items.length);
  const order = items.map((_, n) => n).sort((a, b) => {
    const p = items[a]!;
    const q = items[b]!;
    return Number(q.forced) - Number(p.forced) || q.score - p.score || q.area - p.area || (p.key < q.key ? -1 : p.key > q.key ? 1 : 0);
  });
  const placed: Plate[] = [];
  const free = (x: number, y: number, w: number, h: number, pad: number) => !placed.some((p) => hits(p, x, y, w, h, pad));
  const rank = (v: number, id: number) => v * 64 + id;

  for (const n of order) {
    const t = items[n]!;
    // the variants this node may use: a forced one is whole
    const count = t.forced ? 1 : t.variants.length;
    const spots: LabelSpot[][] = [];
    const spotsOf = (v: number) => (spots[v] ??= labelCandidates(t.rect, t.variants[v]!.layout.w, t.variants[v]!.layout.h, grid));
    /** The first (variant, candidate) in priority order, ranked below `before`, that is free with `pad` cells of room, or null. */
    const first = (pad: number, before = Infinity): { v: number; s: LabelSpot } | null => {
      for (let v = 0; v < count; v++) {
        const { w, h } = t.variants[v]!.layout;
        for (const s of spotsOf(v)) {
          if (rank(v, s.id) >= before) return null;
          if (free(s.x, s.y, w, h, CLEARANCE + pad)) return { v, s };
        }
      }
      return null;
    };
    let chosen: { v: number; s: LabelSpot } | null = first(0);
    const prev = t.prev;
    if (t.forced && prev && prev.cand >= 0) {
      // A hovered label must not run away from the pointer: it stays at the position it had (the whole label there) while that is free.
      const same = spotsOf(0).find((s) => s.id === prev.cand);
      if (same && free(same.x, same.y, t.variants[0]!.layout.w, t.variants[0]!.layout.h, CLEARANCE)) chosen = { v: 0, s: same };
    } else if (chosen && prev && prev.cand >= 0 && prev.variant < count) {
      const { w, h } = t.variants[prev.variant]!.layout;
      const same = spotsOf(prev.variant).find((s) => s.id === prev.cand);
      if (same && free(same.x, same.y, w, h, CLEARANCE) && rank(chosen.v, chosen.s.id) < rank(prev.variant, prev.cand)) {
        // a better choice exists: take it only when it is free with room to spare
        chosen = first(UPGRADE_MARGIN, rank(prev.variant, prev.cand)) ?? { v: prev.variant, s: same };
      }
    }
    if (chosen) {
      const { w, h } = t.variants[chosen.v]!.layout;
      placed.push({ x0: chosen.s.x, y0: chosen.s.y, x1: chosen.s.x + w, y1: chosen.s.y + h });
      out[n] = { variant: chosen.v, x: chosen.s.x, y: chosen.s.y, w, h, cand: chosen.s.id, inside: chosen.s.inside, overlap: false };
      continue;
    }

    // The last resort: on top of the others, where it overlaps the least. The whole label and the shortest are weighed; every candidate
    // position and the displacements of the first one are tried.
    const vs = count > 1 ? [0, count - 1] : [0];
    let best: Best | null = null;
    const consider = (v: number, x: number, y: number, cand: number, inside: boolean, shift: number) => {
      const { w, h } = t.variants[v]!.layout;
      if (x < 0 || y < 0 || x + w > grid.cols || y + h > grid.rows) return;
      let area = 0;
      for (const p of placed) area += overlapArea(p, x, y, w, h);
      const b = best;
      if (!b || area < b.area || (area === b.area && (shift < b.shift || (shift === b.shift && v < b.v)))) best = { v, x, y, cand, inside, area, shift };
    };
    for (const v of vs) {
      const { w, h } = t.variants[v]!.layout;
      const sp = spotsOf(v);
      const home = sp[0];
      for (const s of sp) consider(v, s.x, s.y, s.id, s.inside, home ? Math.abs(s.x - home.x) + Math.abs(s.y - home.y) : 0);
      if (home) for (let dy = -h; dy <= h; dy += SHIFT_STEP) for (let dx = -w; dx <= w; dx += SHIFT_STEP) if (dx || dy) consider(v, home.x + dx, home.y + dy, -1, false, Math.abs(dx) + Math.abs(dy));
    }
    const found = best as Best | null;
    let pick: Best;
    if (prev && prev.cand < 0 && prev.variant < count && found) {
      // keep last frame's displaced plate while it overlaps no more than the new best
      const { w, h } = t.variants[prev.variant]!.layout;
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
      const { w, h } = t.variants[count - 1]!.layout;
      pick = { v: count - 1, x: Math.max(0, Math.min(grid.cols - w, t.rect.c0)), y: Math.max(0, Math.min(grid.rows - h, t.rect.r0 - h)), cand: -1, inside: false, area: 0, shift: 0 };
    }
    const { w, h } = t.variants[pick.v]!.layout;
    placed.push({ x0: pick.x, y0: pick.y, x1: pick.x + w, y1: pick.y + h });
    out[n] = { variant: pick.v, x: pick.x, y: pick.y, w, h, cand: pick.cand, inside: pick.inside, overlap: true };
  }
  return out;
}
