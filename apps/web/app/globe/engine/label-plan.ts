/**
 * Which labels are drawn, and which boxes are dimmed (pure, unit tested): the one rule that decides whether a drawn box has its name.
 *
 * The input is the set of nodes the cut WANTS drawn (binary: a node is in or out, engine/lod-tree.ts), not their momentary opacities,
 * so the plan is the same whether a node is half way through its fade or at rest. Every one of them wants its label; there is NO
 * zoom-dependent priority floor (a floor left isolated places as boxes with no name, which read as broken). Labels are placed greedily,
 * best first (selected, focused and hovered, then places before groups, then priority); one whose plate would overlap a placed plate
 * (a cell of clearance) is left out. A label that is drawn now keeps its place against a challenger of up to `LOD.labelHold` more score
 * (hysteresis: a camera that moves a plate by a cell cannot flip two labels back and forth).
 *
 * A node without a label is DIMMED (the box drawn at `LOD.unlabelledAlpha` of its opacity) only when some group above it is drawn too:
 * then it is one of several boxes crowded inside another and the dim says "this one is secondary". A node with no drawn group above it
 * (London on a view where Europe is open) is the top level of what is drawn and is never dimmed, whether it has its name or not; it is
 * still a target, and its name shows while it is hovered, focused or selected (those are forced and always placed). Both decisions are
 * binary; the transitions between them are timed (engine/fade.ts), never driven by the camera.
 */
import { LOD } from "./lod-tree";

export interface PlanItem {
  /** Selected, focused or hovered: always labelled, ahead of everything. */
  forced: boolean;
  /** Placement order: higher first. */
  score: number;
  /** The label plate in cells (columns `x0 .. x1 - 1`, rows `y0 .. y1 - 1`). */
  plate: { x0: number; y0: number; x1: number; y1: number };
  /** Tie-break: a stable key. */
  key: string;
  /** The node's label is drawn now: it keeps its place against a slightly better challenger. */
  held: boolean;
  /** Some group above the node is drawn at the moment. */
  parented: boolean;
}

export interface PlanResult {
  labelled: boolean;
  dimmed: boolean;
}

/** Cells of clearance between two plates. */
const CLEARANCE = 1;

export function planLabels(items: readonly PlanItem[]): PlanResult[] {
  const out: PlanResult[] = items.map(() => ({ labelled: true, dimmed: false }));
  const rank = (t: PlanItem) => t.score + (t.held ? LOD.labelHold : 0);
  const order = items.map((_, n) => n).sort((a, b) => rank(items[b]!) - rank(items[a]!) || (items[a]!.key < items[b]!.key ? -1 : items[a]!.key > items[b]!.key ? 1 : 0));
  const placed: PlanItem["plate"][] = [];
  for (const n of order) {
    const t = items[n]!;
    const r = { x0: t.plate.x0 - CLEARANCE, y0: t.plate.y0 - CLEARANCE, x1: t.plate.x1 + CLEARANCE, y1: t.plate.y1 + CLEARANCE };
    if (!t.forced && placed.some((p) => r.x0 < p.x1 && r.x1 > p.x0 && r.y0 < p.y1 && r.y1 > p.y0)) {
      out[n] = { labelled: false, dimmed: t.parented };
      continue;
    }
    placed.push(r);
  }
  return out;
}
