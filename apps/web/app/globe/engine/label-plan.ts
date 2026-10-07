/**
 * Which labels are drawn (pure, unit tested): the one rule that decides whether a drawn box has its name.
 *
 * Every drawn node (opacity at least `LOD.labelAlphaMin`) wants its label. There is NO zoom-dependent priority floor: a floor
 * left isolated places (Houston, New York on the world view) as full-ink boxes with no name, which read as broken. Labels are
 * placed greedily, best first (selected, focused and hovered, then places before groups, then priority); one whose plate would
 * overlap a placed plate (a cell of clearance) is left out. The box of a node that loses its label is DIMMED, its opacity capped at
 * `LOD.unlabelledAlpha`, so the map never holds a full-opacity box without a name; it is still a target (engine/hit-area.ts) and
 * its label shows while it is hovered, focused or selected (those are forced and always placed).
 *
 * The invariant (`labelInvariant`, asserted by the tests and by `scripts/globe/groups.mjs targets`): a node drawn at pick opacity
 * either has its label or is dimmed.
 */
import { LOD } from "./lod-tree";

export interface PlanItem {
  /** The node's opacity (0..1). */
  alpha: number;
  /** Selected, focused or hovered: always labelled, ahead of everything. */
  forced: boolean;
  /** Placement order: higher first. */
  score: number;
  /** The label plate in cells (columns `x0 .. x1 - 1`, rows `y0 .. y1 - 1`). */
  plate: { x0: number; y0: number; x1: number; y1: number };
  /** Tie-break: a stable key. */
  key: string;
}

export interface PlanResult {
  labelled: boolean;
  dimmed: boolean;
  /** The opacity to draw the box, its mask and (when labelled) its label with. */
  alpha: number;
}

/** Cells of clearance between two plates. */
const CLEARANCE = 1;

export function planLabels(items: readonly PlanItem[]): PlanResult[] {
  const out: PlanResult[] = items.map((t) => ({ labelled: t.forced || t.alpha >= LOD.labelAlphaMin, dimmed: false, alpha: t.alpha }));
  const order = items.map((_, n) => n).filter((n) => out[n]!.labelled).sort((a, b) => items[b]!.score - items[a]!.score || (items[a]!.key < items[b]!.key ? -1 : items[a]!.key > items[b]!.key ? 1 : 0));
  const placed: PlanItem["plate"][] = [];
  for (const n of order) {
    const t = items[n]!;
    const r = { x0: t.plate.x0 - CLEARANCE, y0: t.plate.y0 - CLEARANCE, x1: t.plate.x1 + CLEARANCE, y1: t.plate.y1 + CLEARANCE };
    if (!t.forced && placed.some((p) => r.x0 < p.x1 && r.x1 > p.x0 && r.y0 < p.y1 && r.y1 > p.y0)) {
      out[n] = { labelled: false, dimmed: true, alpha: Math.min(t.alpha, LOD.unlabelledAlpha) };
      continue;
    }
    placed.push(r);
  }
  return out;
}

/** The invariant of the rule for a planned frame: every node at pick opacity has its label or is dimmed below it. */
export function labelInvariant(plan: readonly PlanResult[]): boolean {
  return plan.every((p) => p.labelled || p.dimmed || p.alpha < LOD.labelAlphaMin);
}
