/**
 * Labels with inertia (pure, unit tested): WHEN the label plan runs and what happens to a label in between.
 *
 * `planLabels` (engine/label-plan.ts) puts every label where it collides with nothing. Run on every frame it makes labels flicker: a plate
 * that moves a pixel with the camera frees or takes a position and a neighbour hops left and right. So the plan is not a function of the
 * frame any more, it is a decision that is kept:
 *
 *  1. A label keeps its SLOT (the candidate position and the way of writing it) between frames. A frame only follows the box: the plate is put
 *     at its slot's place around the box's CURRENT rectangle (`spotAt`), O(1) per label, no collision test. Frozen labels cannot hop.
 *  2. The plan is re-run for ALL labels only when the camera has SETTLED (no rectangle changed for `TRACK.settleMs`), and, as a safety for a
 *     very long motion, once per `TRACK.maxFrozenMs` while it goes on. A re-plan is sticky (the planner keeps a choice that is still free) and
 *     the labels that move then are marked `moved`: the host glides them to the new place (a short CSS transition; none for reduced motion).
 *     At the edges of the screen the plate slides along its box (or stays at the screen's edge, over the box) instead of changing slot (`slide`).
 *  3. A label that has no slot yet (its node just appeared) or whose slot became impossible (it would leave the screen, a nested label no longer
 *     fits its box) is placed at once, in the free places left by the labels that stay (`planLabels` with the others as `fixed` plates): a drawn
 *     box always has its label, and a new label never displaces another.
 *  4. Appearing and disappearing stays binary and timed (the node's own fade, engine/fade.ts); the text variants (whole / shortened) have the
 *     planner's hysteresis (`upgradeMargin`) and change only in a re-plan.
 *
 * Hover, focus and selection are NOT inputs of the plan: the host draws the hovered label expanded (with its country) around the slot it has,
 * overlaying its neighbours if it has to (`anchored`). So moving the pointer never moves another label.
 */
import { planLabels, type PlanItem, type PlanUnits, type Plate, type Prev, type Sized } from "./label-plan";
import { HASH_SEED, hashStep, spotAt, type CellRect, type GridSize } from "./pixel-labels";

export const TRACK = {
  /** No rectangle changed for this long: the camera is at rest and the labels are re-planned. */
  settleMs: 160,
  /** Upper bound of a motion without a re-plan. */
  maxFrozenMs: 3000,
} as const;

/** What every node remembers between frames: the slot of its label. Shared by the overlays of one tree, so a handover keeps the labels where they were. */
export class SlotMemory {
  readonly set: Uint8Array;
  readonly variant: Uint8Array;
  readonly cand: Int16Array;
  /** The plate's offset from its box's top-left corner (what a label drawn over others keeps). */
  readonly dx: Float32Array;
  readonly dy: Float32Array;
  /** Identity of the list of ways of writing the label it was chosen from. */
  readonly vkey: Int32Array;

  constructor(size: number) {
    const n = Math.max(1, size);
    this.set = new Uint8Array(n);
    this.variant = new Uint8Array(n);
    this.cand = new Int16Array(n);
    this.dx = new Float32Array(n);
    this.dy = new Float32Array(n);
    this.vkey = new Int32Array(n);
  }

  prev(i: number): Prev | null {
    return this.set[i] ? { variant: this.variant[i]!, cand: this.cand[i]!, dx: this.dx[i]!, dy: this.dy[i]! } : null;
  }
}

export interface TrackItem {
  /** Index of the node (the slot in the memory). */
  id: number;
  key: string;
  rect: CellRect;
  score: number;
  area: number;
  variants: readonly Sized[];
  /** Changes whenever the list of ways of writing the label changes (its text); a changed list forgets the slot's variant. */
  vkey: number;
}

export interface Placed {
  variant: number;
  cand: number;
  x: number;
  y: number;
  w: number;
  h: number;
  inside: boolean;
  /** Drawn over other plates (nothing was free): the last resort. */
  overlap: boolean;
  /** Its slot (position or way of writing) is not the one it had in the previous step: a new label, or one a re-plan moved. */
  moved: boolean;
  /** It had no slot before (a node that just appeared, or whose text changed). */
  fresh: boolean;
}

export interface StepInfo {
  /** The rectangles changed since the previous step: the camera is moving (or the cut changed). */
  changed: boolean;
  /** A re-plan of every label ran in this step. */
  full: boolean;
  /** Labels that were placed in the gaps of the others in this step (new, or with an impossible slot). */
  partial: number;
}

export class LabelTracker {
  private sig = NaN;
  private lastChange = -Infinity;
  private lastFull = -Infinity;
  private motionStart = -Infinity;
  private owed = false;
  info: StepInfo = { changed: false, full: false, partial: 0 };

  constructor(
    readonly mem: SlotMemory,
    private units: PlanUnits,
    private opts: { settleMs: number; maxFrozenMs: number } = TRACK,
  ) {}

  /** When the re-plan that is owed is due (ms on the clock of `step`), or null when none is. The host arms a timer for it: an idle map draws no frames. */
  get dueAt(): number | null {
    return this.owed ? this.lastChange + this.opts.settleMs : null;
  }

  /** Run the owed plan at the next step whatever the time (checks, and a host that knows the camera is at rest). */
  settleNow(): void {
    this.lastChange = -Infinity;
    this.owed = true;
  }

  /** Forget that a plan is owed (the host is parked, or the tree changed under it). */
  reset(): void {
    this.sig = NaN;
    this.owed = false;
  }

  /**
   * One step at time `t` (ms): the labels of `items` for the rectangles they have NOW. `grid` is the room (CSS px); `result[n]` belongs to `items[n]`.
   * Items are the nodes the cut wants drawn.
   */
  step(t: number, items: readonly TrackItem[], grid: GridSize, inset: number): Placed[] {
    const mem = this.mem;
    const units: PlanUnits = { ...this.units, inset };  // `inset`: the nested label's distance from the box's edge
    // Did the rectangles change? (rounded: a float that wobbles in its last digits is not motion)
    let h = hashStep(hashStep(HASH_SEED, grid.cols * 4096 + grid.rows), items.length);
    for (const it of items) {
      h = hashStep(hashStep(h, it.id), Math.round(it.rect.c0 * 4) * 8192 + Math.round(it.rect.r0 * 4));
      h = hashStep(h, Math.round(it.rect.c1 * 4) * 8192 + Math.round(it.rect.r1 * 4));
    }
    const changed = h !== this.sig;
    this.sig = h;
    if (changed) {
      if (t - this.lastChange > this.opts.settleMs) this.motionStart = t; // a new motion
      this.lastChange = t;
      this.owed = true;
    }
    const settled = t - this.lastChange >= this.opts.settleMs;
    const full = this.owed && (settled || (changed && t - Math.max(this.lastFull, this.motionStart) >= this.opts.maxFrozenMs));
    if (full) {
      this.owed = false;
      this.lastFull = t;
    }

    // Slots that stay: remembered, still possible. Everything else is planned.
    const out: Placed[] = new Array(items.length);
    const plan: number[] = [];
    const fixed: Plate[] = [];
    const at = { x: 0, y: 0, inside: false };
    const before = items.map((it) => (mem.set[it.id] ? mem.cand[it.id]! * 256 + mem.variant[it.id]! : -1));
    for (let n = 0; n < items.length; n++) {
      const it = items[n]!;
      const i = it.id;
      if (mem.set[i] && mem.vkey[i] !== it.vkey) mem.set[i] = 0; // the text changed: its slot is meaningless
      if (full || !mem.set[i] || mem.variant[i]! >= it.variants.length) {
        plan.push(n);
        continue;
      }
      const v = mem.variant[i]!;
      const { w, h: hh } = it.variants[v]!;
      let x: number;
      let y: number;
      let inside = false;
      let ok: boolean;
      if (mem.cand[i]! >= 0) {
        ok = spotAt(mem.cand[i]!, it.rect, w, hh, grid, { inset, quant: units.quant, gap: units.gap, bleed: units.bleed, slide: true }, at);
        x = at.x;
        y = at.y;
        inside = at.inside;
      } else {
        x = it.rect.c0 + mem.dx[i]!;
        y = it.rect.r0 + mem.dy[i]!;
        ok = x >= 0 && y >= 0 && x + w <= grid.cols && y + hh <= grid.rows;
      }
      if (!ok) {
        plan.push(n); // would leave the screen, or no longer fits: replaced at once
        continue;
      }
      out[n] = { variant: v, cand: mem.cand[i]!, x, y, w, h: hh, inside, overlap: mem.cand[i]! < 0, moved: false, fresh: false };
      fixed.push({ x0: x, y0: y, x1: x + w, y1: y + hh });
    }
    if (plan.length) {
      const sub: PlanItem[] = plan.map((n) => {
        const it = items[n]!;
        return { score: it.score, area: it.area, key: it.key, rect: it.rect, variants: it.variants, prev: mem.prev(it.id) };
      });
      const res = planLabels(sub, grid, units, full ? [] : fixed);
      plan.forEach((n, k) => {
        const it = items[n]!;
        const p = res[k]!;
        const i = it.id;
        const fresh = !mem.set[i];
        mem.set[i] = 1;
        mem.variant[i] = p.variant;
        mem.cand[i] = p.cand;
        mem.dx[i] = p.x - it.rect.c0;
        mem.dy[i] = p.y - it.rect.r0;
        mem.vkey[i] = it.vkey;
        out[n] = { variant: p.variant, cand: p.cand, x: p.x, y: p.y, w: p.w, h: p.h, inside: p.inside, overlap: p.overlap, moved: fresh || before[n] !== p.cand * 256 + p.variant, fresh };
      });
    }
    this.info = { changed, full, partial: full ? 0 : plan.length };
    return out;
  }
}

/**
 * Where the plate of a label that is not being planned (a node fading out) is, from the slot it had: around its current rectangle, else
 * above-left, clamped to the room.
 */
export function slotPosition(mem: SlotMemory, id: number, rect: CellRect, size: Sized, grid: GridSize, units: PlanUnits): { x: number; y: number } {
  const at = { x: 0, y: 0, inside: false };
  if (mem.set[id]) {
    if (mem.cand[id]! >= 0) {
      if (spotAt(mem.cand[id]!, rect, size.w, size.h, grid, units, at)) return { x: at.x, y: at.y };
    } else return { x: rect.c0 + mem.dx[id]!, y: rect.r0 + mem.dy[id]! };
  }
  return { x: rect.c0, y: rect.r0 - size.h };
}

/**
 * The plate of a label EXPANDED around the slot of its normal one (hover, focus, selection: the same label written longer, with its country):
 * the same candidate position for the new size, so it grows the way the label is anchored (a label on the box's right edge grows to the left),
 * and clamped into the room so it never leaves the screen. Not a plan: nothing else moves.
 */
export function anchored(cand: number, rect: CellRect, size: Sized, normal: { x: number; y: number }, grid: GridSize, units: PlanUnits): { x: number; y: number } {
  const at = { x: 0, y: 0, inside: false };
  let x = normal.x;
  let y = normal.y;
  if (cand >= 0 && spotAt(cand, rect, size.w, size.h, grid, units, at)) {
    x = at.x;
    y = at.y;
  }
  return { x: Math.max(0, Math.min(grid.cols - size.w, x)), y: Math.max(0, Math.min(grid.rows - size.h, y)) };
}
