/**
 * The detection boxes of the map. ONE class shared by the Three.js globe (`createGlobe`) and the street overlay (`HudLayer`), so the two
 * draw exactly the same thing on both sides of the handover.
 *
 * Two layers in one root, each in the medium that suits it:
 *  - the BOXES are PIXEL ART on the art-pixel grid (engine/pixel-labels.ts: a `cols x rows` canvas of the map's own art cells, scaled up with
 *    nearest-neighbour): a rectangle one cell thick, corners solid and the rest of each edge dashed (anchored to the box's edges), its colour
 *    its STATE (the `peak` level at rest, the ink hovered or focused) and the selected one a solid line in the ink; its interior masked in the
 *    page colour while it is clamped to the minimum size, hollow once it is bigger. They are part of the map.
 *  - the LABELS are HTML text in device pixels (engine/label-dom.ts): the UI font, small and thin, with a halo of the page colour (app.css
 *    `.map-label`). Labels are not part of the map's pixels; the pixel text pipeline stays for text that is (route labels, later).
 *
 * From the cut of the hierarchy (engine/lod-tree.ts) and the rectangle every drawn node was given (`NodeScreen`, whole cells), per frame,
 * O(drawn nodes):
 *  - fades are OPACITY: the box and its mask are composited at the node's alpha (`lod.alpha`, quantised to 1/`ALPHA_STEPS`) and the label's CSS
 *    opacity follows it. The state is BINARY and the opacity runs to it by TIME (engine/fade.ts, owned by the tree), so a resting frame is never
 *    half way;
 *  - EVERY rectangle has a LABEL, never a box without a name: the name (a place's country is only added while it is hovered, focused or
 *    selected) and, for a group, its counter ("12 entries") in a smaller, lighter run. Where it goes is engine/label-plan.ts, WHEN it is re-planned
 *    is engine/label-track.ts: a label keeps its slot while the camera moves (it follows its box), the plan runs when the camera has settled, a
 *    new box is labelled at once in the gaps of the others, and hover never re-plans anything: the hovered label is written longer where it is
 *    (it may overlay its neighbours);
 *  - a PEEK (a place drawn inside a closed group, engine/lod-tree.ts) is a normal box with a normal label, except that its label ranks below
 *    every other (it takes the room that is left and never displaces another label) and that it is OPTIONAL: when the planner cannot place
 *    its label without overlapping another, the peek is dropped on the spot (never drawn over others, and not offered again until the camera
 *    has changed enough: `LodTree.dropPeek`), so the rule "every box has its label, none over another" holds for peeks too;
 *  - text sizes are measured once per string (engine/label-text.ts) and everything else, the plan, the hit hull, works in CSS px.
 * The canvas is only touched when the set of rectangles, their cells or their tones changed, and the labels' elements only when a value changed:
 * an idle map does nothing.
 *
 * Accessibility: the overlay is a visual duplicate of the place list (the accessible path): the canvas has no focus, role or text and the
 * root is `aria-hidden` (set by the component), so the real text of the labels is not read twice; it is not selectable either. Clicking and
 * hovering a node go through `hit()` (engine/hit-area.ts: the convex hull of the rectangle and its label plate, plus slop), consulted by the
 * host's pointer handling, so that dragging over a label still pans and the touch target can be enlarged.
 */
import type { Rgb } from "./colors";
import { isBigBox, pickNode, type PointerKind, type Target } from "./hit-area";
import { LabelLayer, type LabelMode } from "./label-dom";
import { PX_UNITS, peeksToDrop, pxUnits, type PeekCheck } from "./label-plan";
import { LabelTracker, SlotMemory, anchored, slotPosition, type Placed, type TrackItem } from "./label-track";
import { expandedLabel, labelVariants, type LabelText } from "./label-text";
import { LOD, labelScoreOf, type LodTree } from "./lod-tree";
import type { NodeScreen } from "./node-screen";
import { textFloorLevel } from "./palette";
import { ALPHA_STEPS, HASH_SEED, PixelOverlay, drawBox, hashStep, labelTones, quantAlpha, type CellRect, type LabelTones } from "./pixel-labels";

/** The art-pixel grid of a map's canvas. */
export interface PixelGrid {
  cols: number;
  rows: number;
  /** CSS px per cell, and the CSS position of cell (0, 0)'s top-left in the container. */
  cell: number;
  left: number;
  top: number;
}

/** Where a node's label is: the plate's top-left corner in container CSS px, the way it is written and where it came from. */
interface Place {
  x: number;
  y: number;
  variant: number;
  cand: number;
  inside: boolean;
  overlap: boolean;
  /** Its slot changed in the last step (it moved, or it is new). */
  moved: boolean;
  fresh: boolean;
}

interface Item {
  i: number;
  /** The box in whole cells of the pixel grid (for drawing) and in container CSS px (for planning and picking). */
  rect: CellRect;
  px: CellRect;
  wanted: boolean;
  variants: readonly LabelText[];
  place: Place;
  score: number;
}

/** One slot memory per tree, shared by the overlays that draw it, so the labels stay where they were when the street map takes over. */
const memories = new WeakMap<LodTree, SlotMemory>();
function memoryFor(lod: LodTree): SlotMemory {
  let m = memories.get(lod);
  if (!m) memories.set(lod, (m = new SlotMemory(lod.size)));
  return m;
}

const strHash = (s: string): number => {
  let h = 2166136261;
  for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 16777619);
  return h | 0;
};

export class BoxScene {
  private overlay: PixelOverlay;
  private layer: LabelLayer;
  private tracker: LabelTracker;
  private mem: SlotMemory;
  private tones: LabelTones = labelTones(12);
  /** What the last frame drew, as targets for `hit` (every drawn node). */
  private targets: Target[] = [];
  private selected = -1;
  private focused = -1;
  private hovered = -1;
  private last: Item[] = [];
  private frame: { screen: NodeScreen; grid: PixelGrid } | null = null;
  /** The room of the labels: the root's size when known (ResizeObserver), else estimated from the canvas. */
  private room: { w: number; h: number } | null = null;
  private ro: ResizeObserver | null = null;
  private timer = 0;
  /** `lod.evaluations` when this scene last planned: a re-plan from a timer only runs on the camera it saw. */
  private evalStamp = -1;
  private reduced = false;
  private parked = false;
  private disposed = false;
  // per node, computed on first use
  private variantsOf: (readonly LabelText[] | undefined)[];
  private vkeyOf: Int32Array;
  private expandedOf: (LabelText | undefined)[];

  constructor(
    root: HTMLElement,
    private lod: LodTree,
  ) {
    Object.assign(root.style, { position: "absolute", inset: "0", overflow: "hidden", pointerEvents: "none" });
    this.overlay = new PixelOverlay(root);
    this.layer = new LabelLayer(root);
    this.mem = memoryFor(lod);
    this.tracker = new LabelTracker(this.mem, PX_UNITS);
    this.variantsOf = new Array(lod.size);
    this.vkeyOf = new Int32Array(lod.size);
    this.expandedOf = new Array(lod.size);
    if (typeof ResizeObserver !== "undefined") {
      this.ro = new ResizeObserver((entries) => {
        const r = entries[entries.length - 1]?.contentRect;
        if (r && r.width > 0 && r.height > 0) this.room = { w: r.width, h: r.height };
      });
      this.ro.observe(root);
    }
  }

  /** The theme's ramp (levels of the shared palette): the boxes. The labels follow the page's own CSS variables. */
  setTheme(theme: { ramp: readonly Rgb[] }) {
    this.tones = labelTones(theme.ramp.length, textFloorLevel(theme.ramp));
    this.overlay.setRamp(theme.ramp as readonly (readonly [number, number, number])[]);
  }

  /** Reduced motion: labels jump to a new place instead of gliding. */
  setReducedMotion(on: boolean) {
    this.reduced = on;
  }

  setSelected(slug: string | null) {
    const next = this.lod.indexOf(slug);
    if (next === this.selected) return;
    this.selected = next;
    this.represent();
  }

  setFocused(slug: string | null) {
    const next = this.lod.indexOf(slug);
    if (next === this.focused) return;
    this.focused = next;
    this.represent();
  }

  /** The node under the pointer (highlight only). It re-draws the states, it never re-plans: no other label moves. */
  setHovered(slug: string | null) {
    const next = this.lod.indexOf(slug);
    if (next === this.hovered) return;
    this.hovered = next;
    this.represent();
  }

  /** Slugs of the nodes whose label is shown: every drawn node. */
  shown(): ReadonlySet<string> {
    const out = new Set<string>();
    for (const t of this.last) out.add(this.lod.slug[t.i]!);
    return out;
  }

  /** The state of node `i`: hovered, focused or selected. */
  private modeOf(i: number, wanted: boolean): LabelMode {
    if (!wanted) return "rest";
    if (i === this.selected) return "selected";
    return i === this.focused || i === this.hovered ? "hover" : "rest";
  }

  /** Rectangle of every box (cells) and label (CSS px) drawn in the last frame, for checks. */
  snapshot() {
    const lod = this.lod;
    return this.last.map((t) => {
      const mode = this.modeOf(t.i, t.wanted);
      const v = this.shownText(t, mode);
      return {
        slug: lod.slug[t.i]!,
        kind: lod.kind[t.i]!,
        rect: t.rect,
        /** The box in container CSS px. */
        box: { x0: t.px.c0, y0: t.px.r0, x1: t.px.c1, y1: t.px.r1 },
        /** The label's plate in container CSS px (top-left corner and size), the text and counter as written, and where it is. */
        label: {
          x: v.x,
          y: v.y,
          w: v.size.w,
          h: v.size.h,
          inside: t.place.inside,
          text: v.size.name,
          chip: v.size.chip,
          /** Index of the way of writing it (0: the whole label) and of the position (`SPOT`; -1: drawn over other labels, the last resort). */
          variant: t.place.variant,
          cand: t.place.cand,
          overlap: t.place.overlap,
          /** Hovered, focused (`hover`) or selected: written with its country. */
          mode,
          moved: t.place.moved,
        },
        text: lod.text[t.i]!,
        chip: lod.chip[t.i]!,
        /** Opacity of the box as drawn, of its mask and of its label. */
        alpha: this.alphaOf(t, mode),
        fillAlpha: this.fillAlphaOf(t, mode),
        /** The cut wants it drawn (else it is fading out). */
        wanted: t.wanted,
        /** Hovered, focused or selected: the ink instead of the rest tone. */
        active: mode !== "rest",
        /** Selected: one solid line. */
        solid: mode === "selected",
        /** Some group above the node is drawn (it is wanted and has places in view). */
        parented: lod.hasDrawnAncestor(t.i),
        /** The node is a peek: a place drawn inside its closed group on purpose (so `parented` is expected). */
        peek: lod.isPeek(t.i),
      };
    });
  }

  /** The labels as they are in the DOM now (checks; allocates). */
  labelsDom() {
    return this.layer.snapshot();
  }

  /** Canvas and label drawing counters (frames drawn, frames skipped because nothing changed; element writes). */
  stats() {
    return { drawn: this.overlay.drawn, skipped: this.overlay.skipped, labelWrites: this.layer.writes, replans: this.replans, partials: this.partials };
  }
  private replans = 0;
  /** The last plan dropped a peek. */
  private dropped = false;
  private partials = 0;

  /**
   * The node under a CSS-px point: the convex hull of a box and its label plate, plus slop (engine/hit-area.ts), of the nodes
   * drawn in the last frame. The innermost target that contains the point wins, else the nearest within the slop.
   */
  hit(x: number, y: number, kind: PointerKind): string | null {
    const i = pickNode(this.targets, x, y, kind, LOD.pickAlphaMin);
    return i < 0 ? null : this.lod.slug[i]!;
  }

  /** The ways node `i`'s label can be written at rest (cached). */
  private variants(i: number): readonly LabelText[] {
    return (this.variantsOf[i] ??= labelVariants(this.lod.text[i]!, this.lod.chip[i]!));
  }

  private vkey(i: number): number {
    return (this.vkeyOf[i] ||= strHash(`${this.lod.chip[i] ?? ""}|${this.lod.text[i]!}`) || 1);
  }

  /** The label of node `i` written for a hovered, focused or selected state: with its country. */
  private expanded(i: number): LabelText {
    return (this.expandedOf[i] ??= expandedLabel(this.lod.text[i]!, this.lod.country[i]!, this.lod.chip[i]!));
  }

  /** What is written, where and how big, for a node in `mode`: at rest its slot's text at its slot, else the expanded text anchored the same way. */
  private shownText(t: Item, mode: LabelMode): { size: LabelText; x: number; y: number } {
    const v = t.variants[Math.min(t.place.variant, t.variants.length - 1)]!;
    if (mode === "rest" || !this.frame) return { size: v, x: t.place.x, y: t.place.y };
    const e = this.expanded(t.i);
    const p = anchored(t.place.cand, t.px, e, { x: t.place.x, y: t.place.y }, this.view(), pxUnits(this.frame.grid.cell));
    return { size: e, x: p.x, y: p.y };
  }

  private alphaOf(t: Item, mode: LabelMode): number {
    return quantAlpha(mode !== "rest" ? 1 : this.lod.alpha[t.i]!);
  }

  private fillAlphaOf(t: Item, mode: LabelMode): number {
    return quantAlpha(mode !== "rest" ? this.lod.mask.value(t.i) : this.lod.fillAlpha[t.i]!);
  }

  /** The room of the labels, container CSS px. */
  private view(): { cols: number; rows: number } {
    const g = this.frame!.grid;
    return this.room ? { cols: this.room.w, rows: this.room.h } : { cols: g.cols * g.cell + 2 * g.left, rows: g.rows * g.cell + 2 * g.top };
  }

  /** Re-plan every label now, as if the camera had been at rest for `TRACK.settleMs` (checks, and a host that jumped the camera). */
  settle() {
    if (!this.frame || this.disposed) return;
    // A peek dropped by a plan changes the set the next plan sees (and so its stability signature, which postpones a full plan): plan again until a full
    // plan has run and dropped none, as the timer does at rest.
    for (let k = 0; k < 4; k++) {
      this.tracker.settleNow();
      this.dropped = false;
      this.run(performance.now());
      if (this.tracker.info.full && !this.dropped) break; // (a plan runs in full only on rectangles that did not change since the last step)
    }
  }

  /** Stop the labels' timer and forget what is owed: the overlay is not the one on screen (the other renderer owns the picture). */
  park() {
    this.parked = true;
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.tracker.reset();
  }

  /**
   * Place and draw everything the tree drew. `screen` holds each drawn node's rectangle in container CSS px (whole cells of `grid`).
   */
  update(screen: NodeScreen, grid: PixelGrid) {
    this.parked = false;
    this.frame = { screen, grid };
    this.evalStamp = this.lod.evaluations;
    this.run(performance.now());
  }

  private run(now: number) {
    const frame = this.frame;
    if (!frame || this.disposed) return;
    const { screen, grid } = frame;
    const lod = this.lod;
    const cell = grid.cell;
    this.overlay.layout(grid.cols, grid.rows, cell, grid.left, grid.top);
    const view = this.view();
    const units = pxUnits(cell);
    const items: Item[] = [];
    for (let k = 0; k < lod.count; k++) {
      const i = lod.visible[k]!;
      if (!screen.shown[i]) continue;
      const rect: CellRect = {
        c0: Math.round((screen.bx0[i]! - grid.left) / cell),
        r0: Math.round((screen.by0[i]! - grid.top) / cell),
        c1: Math.round((screen.bx1[i]! - grid.left) / cell),
        r1: Math.round((screen.by1[i]! - grid.top) / cell),
      };
      items.push({
        i,
        rect,
        px: { c0: screen.bx0[i]!, r0: screen.by0[i]!, c1: screen.bx1[i]!, r1: screen.by1[i]! },
        wanted: lod.life.target[i] === 1,
        variants: this.variants(i),
        place: { x: 0, y: 0, variant: 0, cand: 0, inside: false, overlap: false, moved: false, fresh: false },
        score: this.scoreOf(i),
      });
    }
    // Where every label goes (engine/label-track.ts decides WHEN the plan runs: only the nodes the cut wants take part; one that is fading out
    // keeps its slot and goes with its node).
    const planned = items.filter((t) => t.wanted);
    // A peek's plate also keeps clear of the other boxes (the planner looks at plates only): their rectangles, a few px wider, except its host's.
    const pad = LOD.peek.gapPx.leave;
    const boxPlates = planned.map((t) => ({ x0: t.px.c0 - pad, y0: t.px.r0 - pad, x1: t.px.c1 + pad, y1: t.px.r1 + pad }));
    const track: TrackItem[] = planned.map((t, n) => ({
      id: t.i,
      key: lod.slug[t.i]!,
      rect: t.px,
      score: t.score,
      area: (t.px.c1 - t.px.c0) * (t.px.r1 - t.px.r0),
      variants: t.variants,
      vkey: this.vkey(t.i),
      avoid: lod.isPeek(t.i) ? boxPlates.filter((_, m) => m !== n && planned[m]!.i !== lod.peekHost[t.i]) : undefined,
    }));
    const placed: Placed[] = this.tracker.step(now, track, view, units.inset);
    if (this.tracker.info.full) this.replans++;
    this.partials += this.tracker.info.partial;
    planned.forEach((t, n) => {
      const p = placed[n]!;
      t.place = { x: p.x, y: p.y, variant: p.variant, cand: p.cand, inside: p.inside, overlap: p.overlap, moved: p.moved, fresh: p.fresh };
    });
    for (const t of items) {
      if (t.wanted) continue;
      // fading out: the slot it had, followed to its box
      const mem = this.mem;
      const v = mem.set[t.i] ? Math.min(mem.variant[t.i]!, t.variants.length - 1) : 0;
      const size = t.variants[v]!;
      const p = slotPosition(mem, t.i, t.px, size, view, units);
      t.place = { x: p.x, y: p.y, variant: v, cand: mem.set[t.i] ? mem.cand[t.i]! : 0, inside: false, overlap: false, moved: false, fresh: false };
    }
    // A peek is optional: it is dropped when its label could only go over others or another label landed on its box (`peeksToDrop`), never drawn
    // over them, and not offered again until the camera has changed enough (`LodTree.dropPeek`).
    let kept = items;
    const checks: PeekCheck[] = planned.map((t, n) => ({
      box: { x0: t.px.c0, y0: t.px.r0, x1: t.px.c1, y1: t.px.r1 },
      plate: { x0: t.place.x, y0: t.place.y, x1: t.place.x + placed[n]!.w, y1: t.place.y + placed[n]!.h },
      peek: lod.isPeek(t.i),
      host: lod.peekHost[t.i]! >= 0 ? planned.findIndex((u) => u.i === lod.peekHost[t.i]) : -1,
      overlap: t.place.overlap,
      onScreen: t.px.c1 > 0 && t.px.r1 > 0 && t.px.c0 < view.cols && t.px.r0 < view.rows,
    }));
    for (const k of peeksToDrop(checks)) {
      const t = planned[k]!;
      lod.dropPeek(t.i);
      this.dropped = true;
      this.mem.set[t.i] = 0;
      if (kept === items) kept = items.slice();
      kept.splice(kept.indexOf(t), 1);
    }
    this.last = kept;
    this.present(this.tracker.info.changed);
    this.arm();
  }

  /** Placement order of node `i`'s label: the selected first, then by priority (places before groups); a peek's label after every other, and below its host's. */
  private scoreOf(i: number): number {
    const lod = this.lod;
    const own = (i === this.selected ? 1000 : 0) + lod.priority[i]! + (lod.isGroup[i] ? 0 : LOD.placePriorityBonus);
    const host = lod.peekHost[i]!;
    return labelScoreOf(own, host < 0 ? null : lod.priority[host]! + (host === this.selected ? 1000 : 0));
  }

  /** Re-draw the states (hover, focus, selection) from the last plan: no planning. */
  private represent() {
    if (this.frame && this.last.length) this.present(true);
  }

  /** Draw the boxes on the canvas and write the labels' elements and the hit targets from the last plan and the current states. */
  private present(moving: boolean) {
    const frame = this.frame;
    if (!frame) return;
    const { grid } = frame;
    const lod = this.lod;
    const cell = grid.cell;
    const items = this.last;
    const targets: Target[] = [];
    const mapMinSide = Math.min(grid.cols, grid.rows) * cell;
    let h = HASH_SEED;
    const glideOk = !moving && !this.reduced;
    this.layer.begin();
    for (const t of items) {
      const mode = this.modeOf(t.i, t.wanted);
      const forced = mode !== "rest";
      const alpha = this.alphaOf(t, mode);
      const fillAlpha = this.fillAlphaOf(t, mode);
      const v = this.shownText(t, mode);
      this.layer.put(t.i, lod.slug[t.i]!, {
        x: v.x,
        y: v.y,
        name: v.size.name,
        chip: v.size.chip,
        mode,
        over: t.place.overlap && !forced,
        alpha,
        glide: glideOk && t.place.moved && !t.place.fresh && t.wanted,
      });
      h = hashStep(hashStep(hashStep(hashStep(h, t.i), t.rect.c0 * 4096 + t.rect.r0), t.rect.c1 * 4096 + t.rect.r1), Math.round(alpha * ALPHA_STEPS) * 16 + (mode === "selected" ? 1 : 0) + (forced ? 2 : 0));
      h = hashStep(h, Math.round(fillAlpha * ALPHA_STEPS));
      const box = { x0: t.px.c0, y0: t.px.r0, x1: t.px.c1, y1: t.px.r1 };
      const plate = { x0: v.x, y0: v.y, x1: v.x + v.size.w, y1: v.y + v.size.h };
      targets.push({ id: t.i, box, plate, alpha: lod.alpha[t.i]!, priority: lod.priority[t.i]!, big: isBigBox(box, mapMinSide), slug: lod.slug[t.i]! });
    }
    this.layer.end();
    h = hashStep(hashStep(h, items.length), grid.cols * 4096 + grid.rows);
    // Painter's order: lower score first, forced last, so a strong node is composited over a weak one.
    // A peek is composited over its host (its masked interior over the host's outline), over everything but the forced.
    const peek = (t: Item) => Number(lod.isPeek(t.i));
    const paint = [...items].sort((a, b) => Number(this.modeOf(a.i, a.wanted) !== "rest") - Number(this.modeOf(b.i, b.wanted) !== "rest") || peek(a) - peek(b) || a.score - b.score);
    this.overlay.frame(h, (buf) => {
      for (const t of paint) {
        const mode = this.modeOf(t.i, t.wanted);
        drawBox(buf, t.rect, this.tones, { alpha: this.alphaOf(t, mode), fillAlpha: this.fillAlphaOf(t, mode), active: mode !== "rest", solid: mode === "selected" });
      }
    });
    this.targets = targets;
  }

  /** Arm the timer of the re-plan that is owed once the camera has settled: an idle map draws no frames, so nothing else would run it. */
  private arm() {
    if (this.timer || this.parked || this.disposed) return;
    const due = this.tracker.dueAt;
    if (due === null) return;
    this.timer = window.setTimeout(this.fire, Math.max(0, due - performance.now()) + 2);
  }

  private fire = () => {
    this.timer = 0;
    if (this.parked || this.disposed) return;
    const due = this.tracker.dueAt;
    if (due === null) return;
    const now = performance.now();
    if (now < due) {
      this.timer = window.setTimeout(this.fire, due - now + 2);
      return;
    }
    // The tree must still be at the camera this scene last planned for (the other renderer may have moved it since).
    if (this.lod.evaluations !== this.evalStamp) {
      this.tracker.reset();
      return;
    }
    this.run(now);
  };

  dispose() {
    this.disposed = true;
    window.clearTimeout(this.timer);
    this.ro?.disconnect();
    this.layer.dispose();
    this.overlay.dispose();
    this.targets = [];
  }
}
