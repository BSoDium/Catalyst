/**
 * Labels with inertia (pure, unit tested): WHICH slot a label has, WHEN the plan runs, and how a label gets from one slot to the next.
 *
 * `planLabels` (engine/label-plan.ts) puts every label where it collides with nothing. Run on every frame it makes labels flicker: a plate
 * that moves a pixel with the camera frees or takes a position and a neighbour hops left and right. So the plan is not a function of the
 * frame, it is a decision that is kept, and what is DRAWN is not the decision but a follower of it:
 *
 *  1. A label keeps its SLOT (the candidate position and the way of writing it) between plans. Between plans the plate is put at its slot's
 *     place around the box's CURRENT rectangle (`spotAt`), O(1) per label, no collision test: the plate sticks to its box, it never lags.
 *  2. The plan is re-run for ALL labels continuously but at a bounded rate: as soon as a rectangle changed and `TRACK.replanMs` (100 ms) have
 *     passed since the last plan, so at most 10 plans a second while the camera moves, and once more after it stopped (a timer: an idle map
 *     draws no frames, `dueAt`). A plan is sticky (the planner keeps a choice that is still free and gives it up for a better one only when that
 *     one is free with `upgradeMargin` px of room), so slots change rarely, but they change WHEN they have to, in the middle of the motion, not
 *     in a lump after it. At the edges of the screen the plate slides along its box (or stays at the screen's edge, over the box) instead of
 *     changing slot (`slide`).
 *  3. A slot change never moves the plate at once. The plate is drawn at `target + glide`: the target is the slot's place around the box NOW,
 *     the glide a remainder (in px, relative to the box) that a critically damped spring (`TRACK.omega`, no overshoot) takes to zero. A re-plan
 *     that changes a slot sets the glide to "where the plate was minus the new target", so the plate stays where it is and sets off for the new
 *     place; the velocity is kept (a re-plan in the middle of a glide bends it, it does not restart it; capped so that the spring cannot overshoot).
 *     Every step is a pure function of `dt`: the same path at any frame rate. The glide is relative to the box: a moving box takes its
 *     plate along. Reduced motion (`instant`): no glide, and the plan runs only once the camera has stopped (a plan that moves a label would be a hop).
 *  4. A label that has no slot yet (its node just appeared) or whose slot became impossible (it would leave the screen, a nested label no longer
 *     fits its box) is placed at once, in the free places left by the labels that stay (`planLabels` with the others as `fixed` plates: their
 *     TARGETS): a drawn box always has its label, and a new label never displaces another. A new label has no glide (the node's fade shows it).
 *  5. Appearing and disappearing stays binary and timed (the node's own fade, engine/fade.ts); the text variants (whole / shortened) have the
 *     planner's hysteresis (`upgradeMargin`) and change only in a plan.
 *  6. At rest (every glide is below `TRACK.restPx`) the glide is exactly 0: every label is at its target. `gliding` counts the labels that are
 *     not yet there; the host keeps its frame loop going while it is not 0 and not a frame longer.
 *
 * Hover, focus and selection are NOT inputs of the plan, and they change neither the text nor the size of a label (the plate is inverted when
 * selected, nothing else): moving the pointer never moves a label.
 */
import { planLabels, type PlanItem, type PlanUnits, type Plate, type Prev, type Sized } from "./label-plan";
import { HASH_SEED, hashStep, spotAt, type CellRect, type GridSize } from "./pixel-labels";

export const TRACK = {
  /** Least time between two plans while the rectangles change (ms); the plan owed after the last change runs this long after the previous one. */
  replanMs: 100,
  /** Natural frequency of the glide's critically damped spring (1/s): 95 % of a move in 4.7 / omega = 0.34 s, 99 % in 0.47 s, no overshoot. */
  omega: 14,
  /** A glide shorter than this (px, both axes) and slower than `restSpeed` (px/s) has arrived: it is set to exactly 0. */
  restPx: 0.25,
  restSpeed: 8,
  /** While the camera moves, a slot is kept at least this long (ms) unless it stops being free: a better position is taken only after it, so a crowd that shifts as the camera moves cannot make labels swap places back and forth (it is longer than a glide). */
  dwellMs: 350,
  /** No rectangle changed for this long (ms): the camera has stopped and the dwell is over, the next plan puts every label at its best place. */
  restMs: 160,
  /** The longest step of the spring (ms): a frame that took longer (a hitch, a hidden tab) does not make a glide jump. */
  maxDtMs: 50,
  /** The step of the frame in which a glide starts (ms): at most one frame, so a plan run by a timer long after the last frame does not start with a leap. */
  startDtMs: 16.7,
  /** A label that was not stepped for this long (ms) has no glide to continue (it was out of view). */
  staleMs: 1500,
} as const;

export type TrackOptions = { [K in keyof typeof TRACK]: number };

/** What every node remembers between frames: the slot of its label and its glide. Shared by the overlays of one tree, so a handover keeps the labels where they were. */
export class SlotMemory {
  readonly set: Uint8Array;
  readonly variant: Uint8Array;
  readonly cand: Int16Array;
  /** The plate's offset from its box's top-left corner (what a label drawn over others keeps). */
  readonly dx: Float32Array;
  readonly dy: Float32Array;
  /** Identity of the list of ways of writing the label it was chosen from. */
  readonly vkey: Int32Array;
  /** The glide: where the plate is minus where its slot is (px, relative to the box), and its velocity (px/s). 0 at rest. */
  readonly gx: Float64Array;
  readonly gy: Float64Array;
  readonly gvx: Float64Array;
  readonly gvy: Float64Array;
  /** Where the plate was drawn at the last step, relative to its box's top-left corner (the slot's place plus the glide). */
  readonly ox: Float64Array;
  readonly oy: Float64Array;
  /** The clock of the last step that drew the label (ms), and of the last time its slot changed. */
  readonly seen: Float64Array;
  readonly since: Float64Array;

  constructor(size: number) {
    const n = Math.max(1, size);
    this.set = new Uint8Array(n);
    this.variant = new Uint8Array(n);
    this.cand = new Int16Array(n);
    this.dx = new Float32Array(n);
    this.dy = new Float32Array(n);
    this.vkey = new Int32Array(n);
    this.gx = new Float64Array(n);
    this.gy = new Float64Array(n);
    this.gvx = new Float64Array(n);
    this.gvy = new Float64Array(n);
    this.ox = new Float64Array(n);
    this.oy = new Float64Array(n);
    this.seen = new Float64Array(n);
    this.since = new Float64Array(n);
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
  /** The rectangles the plate must also stay clear of when it is planned (`PlanItem.avoid`: the other nodes' boxes), built only for a node that is planned. */
  avoid?: (() => readonly Plate[]) | undefined;
}

export interface Placed {
  variant: number;
  cand: number;
  /** Where the plate is DRAWN: its slot's place plus the glide. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** What is left of the glide (px): drawn minus slot place. Both 0 at rest. */
  gx: number;
  gy: number;
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

/** How a label's place was decided in this step: fresh (no glide), a new slot (the plate sets off from where it is), the same slot (the glide goes on). */
type Move = "fresh" | "retarget" | "keep";

/**
 * One step of a critically damped spring towards 0 (exact for any `dt`): position `x` and velocity `v` after `dt` seconds. Monotone when it starts
 * at rest (or towards 0 with `|v| <= omega |x|`): it never crosses 0.
 */
export function springStep(x: number, v: number, omega: number, dt: number): { x: number; v: number } {
  const e = Math.exp(-omega * dt);
  const c = v + omega * x;
  return { x: (x + c * dt) * e, v: (v - omega * c * dt) * e };
}

export class LabelTracker {
  private sig = NaN;
  private lastFull = -Infinity;
  private owed = false;
  private lastChange = -Infinity;
  private lastT = NaN;
  /** The step of the clock of the step in progress (s), set by `step` and used by `follow`. */
  private dt = 0;
  private snapOnce = false;
  /** This step ends every glide (`settleNow`). */
  private snap = false;
  private count = 0;
  /** Reduced motion: no glide, a label is where its slot is. */
  instant = false;
  info: StepInfo = { changed: false, full: false, partial: 0 };

  constructor(
    readonly mem: SlotMemory,
    private units: PlanUnits,
    private opts: TrackOptions = TRACK,
  ) {}

  /** When the re-plan that is owed is due (ms on the clock of `step`), or null when none is. The host arms a timer for it: an idle map draws no frames. */
  get dueAt(): number | null {
    if (!this.owed) return null;
    const due = this.lastFull + this.opts.replanMs;
    return this.instant ? Math.max(due, this.lastChange + this.opts.restMs) : due;
  }

  /** Labels that have not arrived at their slot yet after the last step: the host keeps drawing frames while this is not 0. */
  get gliding(): number {
    return this.count;
  }

  /** Run the owed plan at the next step whatever the time, and end every glide (checks, and a host that knows the camera is at rest and wants the final picture). */
  settleNow(): void {
    this.lastFull = -Infinity;
    this.lastChange = -Infinity;
    this.owed = true;
    this.snapOnce = true;
  }

  /** Forget that a plan is owed (the host is parked, or the tree changed under it). */
  reset(): void {
    this.sig = NaN;
    this.owed = false;
    this.count = 0;
  }

  /**
   * Where a label is drawn: its slot's place `(x, y)` (container px) around the box `rect`, plus its glide, advanced by this step. Writes the
   * glide and where the plate is into the memory.
   */
  private place(t: number, i: number, rect: CellRect, x: number, y: number, kind: Move): { x: number; y: number; gx: number; gy: number } {
    const mem = this.mem;
    const o = this.opts;
    const tx = x - rect.c0;
    const ty = y - rect.r0;
    const move = kind;
    let dt = Math.min(this.dt, o.maxDtMs / 1000);
    if (this.instant || this.snap || move === "fresh" || t - mem.seen[i]! > o.staleMs) {
      mem.gx[i] = mem.gy[i] = mem.gvx[i] = mem.gvy[i] = 0;
    } else if (move === "retarget") {
      // the plate stays where it was (relative to its box) and sets off for the new place; the velocity goes on, capped so that it cannot carry the plate past the target
      const gx = mem.ox[i]! - tx;
      const gy = mem.oy[i]! - ty;
      mem.gx[i] = gx;
      mem.gy[i] = gy;
      mem.gvx[i] = Math.max(-o.omega * Math.abs(gx), Math.min(o.omega * Math.abs(gx), mem.gvx[i]!));
      mem.gvy[i] = Math.max(-o.omega * Math.abs(gy), Math.min(o.omega * Math.abs(gy), mem.gvy[i]!));
      dt = Math.min(dt, o.startDtMs / 1000);
    }
    if (mem.gx[i] !== 0 || mem.gy[i] !== 0 || mem.gvx[i] !== 0 || mem.gvy[i] !== 0) {
      const sx = springStep(mem.gx[i]!, mem.gvx[i]!, o.omega, dt);
      const sy = springStep(mem.gy[i]!, mem.gvy[i]!, o.omega, dt);
      if (Math.abs(sx.x) < o.restPx && Math.abs(sy.x) < o.restPx && Math.abs(sx.v) < o.restSpeed && Math.abs(sy.v) < o.restSpeed) {
        mem.gx[i] = mem.gy[i] = mem.gvx[i] = mem.gvy[i] = 0;
      } else {
        mem.gx[i] = sx.x;
        mem.gy[i] = sy.x;
        mem.gvx[i] = sx.v;
        mem.gvy[i] = sy.v;
        this.count++;
      }
    }
    mem.ox[i] = tx + mem.gx[i]!;
    mem.oy[i] = ty + mem.gy[i]!;
    mem.seen[i] = t;
    return { x: rect.c0 + mem.ox[i]!, y: rect.r0 + mem.oy[i]!, gx: mem.gx[i]!, gy: mem.gy[i]! };
  }

  /**
   * One step at time `t` (ms): the labels of `items` for the rectangles they have NOW. `grid` is the room (CSS px); `result[n]` belongs to `items[n]`.
   * Items are the nodes the cut wants drawn. Call `follow` after it, in the same frame, for the nodes that are fading out.
   */
  step(t: number, items: readonly TrackItem[], grid: GridSize, inset: number): Placed[] {
    const mem = this.mem;
    const units: PlanUnits = { ...this.units, inset };  // `inset`: the nested label's distance from the box's edge
    this.dt = Number.isFinite(this.lastT) ? Math.max(0, t - this.lastT) / 1000 : 0;
    this.lastT = t;
    this.count = 0;
    this.snap = this.snapOnce;
    this.snapOnce = false;
    // Did the rectangles change? (rounded: a float that wobbles in its last digits is not motion)
    let h = hashStep(hashStep(HASH_SEED, grid.cols * 4096 + grid.rows), items.length);
    for (const it of items) {
      h = hashStep(hashStep(h, it.id), Math.round(it.rect.c0 * 4) * 8192 + Math.round(it.rect.r0 * 4));
      h = hashStep(h, Math.round(it.rect.c1 * 4) * 8192 + Math.round(it.rect.r1 * 4));
    }
    const changed = h !== this.sig;
    this.sig = h;
    if (changed) {
      this.lastChange = t;
      this.owed = true;
    }
    const moving = t - this.lastChange < this.opts.restMs;
    // reduced motion has no glide, so a plan that moves a label is a hop: it runs only when the camera has stopped (as the labels did before they had a glide)
    const full = this.owed && t - this.lastFull >= this.opts.replanMs && !(this.instant && moving);
    if (full) {
      this.owed = false;
      this.lastFull = t;
    }

    // Slots that stay: remembered, still possible. Everything else is planned.
    const out: Placed[] = new Array(items.length);
    const plan: number[] = [];
    const fixed: Plate[] = [];
    const at = { x: 0, y: 0, inside: false };
    const before = items.map((it) => (mem.set[it.id] ? { cand: mem.cand[it.id]!, variant: mem.variant[it.id]!, dx: mem.dx[it.id]!, dy: mem.dy[it.id]! } : null));
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
      const d = this.place(t, i, it.rect, x, y, "keep");
      out[n] = { variant: v, cand: mem.cand[i]!, x: d.x, y: d.y, w, h: hh, gx: d.gx, gy: d.gy, inside, overlap: mem.cand[i]! < 0, moved: false, fresh: false };
      fixed.push({ x0: x, y0: y, x1: x + w, y1: y + hh }); // the slot's place, not the drawn one: the plan keeps clear of where a plate WILL be
    }
    let held = false; // a plan ran while a choice was still young: it is owed again once the youngest is old enough
    if (plan.length) {
      const sub: PlanItem[] = plan.map((n) => {
        const it = items[n]!;
        return { score: it.score, area: it.area, key: it.key, rect: it.rect, variants: it.variants, prev: mem.prev(it.id), hold: moving && mem.set[it.id] === 1 && t - mem.since[it.id]! < this.opts.dwellMs, avoid: it.avoid?.() };
      });
      const res = planLabels(sub, grid, units, full ? [] : fixed);
      plan.forEach((n, k) => {
        const it = items[n]!;
        const p = res[k]!;
        const i = it.id;
        const fresh = !mem.set[i];
        const b = before[n]!;
        // a new slot: another position, or, for the last resort, another displacement
        const kind: Move = fresh ? "fresh" : b && (b.cand !== p.cand || (p.cand < 0 && (Math.abs(b.dx - (p.x - it.rect.c0)) > 0.01 || Math.abs(b.dy - (p.y - it.rect.r0)) > 0.01))) ? "retarget" : "keep";
        const changedSlot = fresh || !b || b.cand !== p.cand || b.variant !== p.variant;
        if (changedSlot) mem.since[i] = t;
        else if (full && moving && t - mem.since[i]! < this.opts.dwellMs) held = true;
        mem.set[i] = 1;
        mem.variant[i] = p.variant;
        mem.cand[i] = p.cand;
        mem.dx[i] = p.x - it.rect.c0;
        mem.dy[i] = p.y - it.rect.r0;
        mem.vkey[i] = it.vkey;
        const d = this.place(t, i, it.rect, p.x, p.y, kind);
        out[n] = { variant: p.variant, cand: p.cand, x: d.x, y: d.y, w: p.w, h: p.h, gx: d.gx, gy: d.gy, inside: p.inside, overlap: p.overlap, moved: changedSlot, fresh };
      });
    }
    if (held) this.owed = true;
    this.info = { changed, full, partial: full ? 0 : plan.length };
    return out;
  }

  /**
   * The labels of nodes that are fading out (not planned): the slot they had, followed to their box, with the glide they had going on. Same
   * frame as `step` (it uses the step's clock). `result[n]` belongs to `items[n]`.
   */
  follow(t: number, items: readonly { id: number; rect: CellRect; size: Sized }[], grid: GridSize, inset: number): { x: number; y: number; gx: number; gy: number }[] {
    const units: PlanUnits = { ...this.units, inset };
    return items.map((it) => {
      const p = slotSpot(this.mem, it.id, it.rect, it.size, grid, units);
      // a slot that is not possible any more puts the plate at the fallback place: a new place, reached by gliding
      return this.place(t, it.id, it.rect, p.x, p.y, !this.mem.set[it.id] ? "fresh" : p.ok ? "keep" : "retarget");
    });
  }
}

/**
 * Where the plate of a label that is not being planned (a node fading out) is, from the slot it had: around its current rectangle, else
 * above-left, clamped to the room.
 */
export function slotPosition(mem: SlotMemory, id: number, rect: CellRect, size: Sized, grid: GridSize, units: PlanUnits): { x: number; y: number } {
  const { x, y } = slotSpot(mem, id, rect, size, grid, units);
  return { x, y };
}

/** `slotPosition`, and whether the position is the slot's own (false: the fallback above-left of the box, the slot is not possible any more). */
function slotSpot(mem: SlotMemory, id: number, rect: CellRect, size: Sized, grid: GridSize, units: PlanUnits): { x: number; y: number; ok: boolean } {
  const at = { x: 0, y: 0, inside: false };
  if (mem.set[id]) {
    if (mem.cand[id]! >= 0) {
      if (spotAt(mem.cand[id]!, rect, size.w, size.h, grid, { ...units, slide: true }, at)) return { x: at.x, y: at.y, ok: true };
    } else return { x: rect.c0 + mem.dx[id]!, y: rect.r0 + mem.dy[id]!, ok: true };
  }
  return { x: rect.c0, y: rect.r0 - size.h, ok: false };
}
