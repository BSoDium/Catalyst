/**
 * The detection boxes of the map. ONE class shared by the Three.js globe (`createGlobe`) and the street overlay (`HudLayer`), so the two
 * draw exactly the same thing on both sides of the handover.
 *
 * Two layers in one root, each in the medium that suits it:
 *  - the BOXES are PIXEL ART on the art-pixel grid (engine/pixel-labels.ts: a `cols x rows` canvas of the map's own art cells, scaled up with
 *    nearest-neighbour): a rectangle one cell thick, corners solid and the rest of each edge dashed (anchored to the box's edges), its colour
 *    its STATE (the `peak` level at rest, the ink hovered or focused) and the selected one a solid line in the ink; its interior masked in the
 *    page colour while it is clamped to the minimum size, hollow once it is bigger. They are part of the map.
 *  - the LABELS are HTML text in device pixels (engine/label-dom.ts): the UI font on a plate of the page colour with a feathered edge (app.css
 *    `.map-label`, `.map-halo`; the feather sits BELOW the box canvas so it never dims a box's outline). Labels are not part of the map's
 *    pixels; the pixel text pipeline stays for text that is (route labels, later).
 *
 * From the cut of the hierarchy (engine/lod-tree.ts) and the rectangle every drawn node was given (`NodeScreen`, whole cells), per frame,
 * O(drawn nodes):
 *  - fades are OPACITY: the box and its mask are composited at the node's alpha (`lod.alpha`, quantised to 1/`ALPHA_STEPS`) and the label's CSS
 *    opacity follows it. The state is BINARY and the opacity runs to it by TIME (engine/fade.ts, owned by the tree), so a resting frame is never
 *    half way;
 *  - EVERY rectangle has a LABEL, never a box without a name: the name on a first line and, under it, a smaller second line (a place's country
 *    and the entries linked to it by kind, a group's "<N> places" and the entries below it: engine/label-sub.ts). The text never depends on the
 *    state. Where it goes is engine/label-plan.ts, WHEN it is re-planned and how it gets there is engine/label-track.ts: a label has a slot
 *    (sticky), the plan runs continuously at a bounded rate (every 100 ms while the camera moves, once more when it stops), a plate that changes
 *    slot GLIDES (a spring relative to its box, per frame: it never snaps and never lags behind its box), a new box is labelled at once in the
 *    gaps of the others, and hover never re-plans anything (the hovered label looks as it did: the box's own colour logic is what changes);
 *  - a group that opens and the children it opens into (engine/lod-tree.ts) are one cross-fade: their boxes AND their labels run on the nodes'
 *    own timed opacity (`lod.alpha`, set in the same `update`, the same duration and ease), so the group's box and label go 1 -> 0 exactly as its
 *    children's come 0 -> 1 and the sum of a group's opacity and any child's never exceeds 1. Nothing here adds a fade of its own: a label has no
 *    CSS opacity transition, a hovered, focused or selected node is drawn at its own opacity too (its tone is what changes), and a node that is
 *    fading out is not a click target below `LOD.pickFadingMin`, so a fading group never steals a click from the children that replace it;
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
import { isBigBox, pickAlpha, pickNode, type PointerKind, type Target } from "./hit-area";
import { LabelLayer, type LabelMode } from "./label-dom";
import { PX_UNITS, boxesToAvoid, pxUnits } from "./label-plan";
import { LabelTracker, SlotMemory, type Placed, type TrackItem } from "./label-track";
import { subText } from "./label-sub";
import { labelVariants, type LabelText } from "./label-text";
import { LOD, type LodTree } from "./lod-tree";
import type { NodeScreen } from "./node-screen";
import { textFloorLevel } from "./palette";
import { ALPHA_STEPS, HASH_SEED, PixelOverlay, drawBox, hashStep, labelTones, quantAlpha, type CellRect, type LabelTones } from "./pixel-labels";

/** Room kept between a label and the boxes of the other nodes, px (the early opening keeps `LOD.open.gapPx.leave` from every box and label: the same). */
const AVOID_PAD = LOD.open.gapPx.leave;

/** The art-pixel grid of a map's canvas. */
export interface PixelGrid {
  cols: number;
  rows: number;
  /** CSS px per cell, and the CSS position of cell (0, 0)'s top-left in the container. */
  cell: number;
  left: number;
  top: number;
}

/** Where a node's label is: the plate's top-left corner in container CSS px AS DRAWN (its slot's place plus what is left of its glide), the way it is written and where it came from. */
interface Place {
  x: number;
  y: number;
  /** What is left of the glide to the slot's place (px); both 0 at rest. */
  gx: number;
  gy: number;
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
  private parked = false;
  private disposed = false;
  // per node, computed on first use
  private variantsOf: (readonly LabelText[] | undefined)[];
  private vkeyOf: Int32Array;

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
    this.tracker.instant = on;
  }

  /**
   * Some label has not arrived at its place yet (a glide in progress): the host must keep drawing frames, and stop when this is false (an idle
   * map draws none).
   */
  get animating(): boolean {
    return !this.parked && !this.disposed && this.tracker.gliding > 0;
  }

  /** What the host does to get a frame drawn (`update` called) when a plan run by the scene's own timer started a glide on a map that is at rest. */
  setWake(fn: (() => void) | null) {
    this.wake = fn;
  }
  private wake: (() => void) | null = null;

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
      const v = this.shownText(t);
      return {
        slug: lod.slug[t.i]!,
        kind: lod.kind[t.i]!,
        rect: t.rect,
        /** The box in container CSS px. */
        box: { x0: t.px.c0, y0: t.px.r0, x1: t.px.c1, y1: t.px.r1 },
        /** The label's plate in container CSS px (top-left corner and size), the name and the second line as written, and where it is. */
        label: {
          /** The plate as DRAWN (and picked) now; `tx`, `ty` is where its slot puts it (the same at rest), `glide` the distance between the two. */
          x: v.x,
          y: v.y,
          tx: v.x - t.place.gx,
          ty: v.y - t.place.gy,
          glide: Math.hypot(t.place.gx, t.place.gy),
          w: v.size.w,
          h: v.size.h,
          inside: t.place.inside,
          text: v.size.name,
          sub: v.size.sub,
          /** Index of the way of writing it (0: the whole label) and of the position (`SPOT`; -1: drawn over other labels, the last resort). */
          variant: t.place.variant,
          cand: t.place.cand,
          overlap: t.place.overlap,
          /** Hovered, focused (`hover`) or selected (inverted plate); the text is the same in every state. */
          mode,
          moved: t.place.moved,
        },
        text: lod.text[t.i]!,
        /** The second line as it is whole (the variant written may have dropped parts of it). */
        subWhole: subText(lod.sub[t.i]!),
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
      };
    });
  }

  /** The labels as they are in the DOM now (checks; allocates). */
  labelsDom() {
    return this.layer.snapshot();
  }

  /** Canvas and label drawing counters (frames drawn, frames skipped because nothing changed; element writes, plans run; labels still gliding, a plan owed). */
  stats() {
    return { drawn: this.overlay.drawn, skipped: this.overlay.skipped, labelWrites: this.layer.writes, replans: this.replans, partials: this.partials, gliding: this.tracker.gliding, owed: this.tracker.dueAt !== null };
  }
  private replans = 0;
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
    return (this.variantsOf[i] ??= labelVariants(this.lod.text[i]!, this.lod.sub[i]!));
  }

  private vkey(i: number): number {
    const sub = this.lod.sub[i];
    return (this.vkeyOf[i] ||= strHash(`${sub?.lead ?? ""}|${sub?.entries ?? ""}|${this.lod.text[i]!}`) || 1);
  }

  /** What is written, where and how big: the way of writing the label its slot chose, at its slot. The same in every state. */
  private shownText(t: Item): { size: LabelText; x: number; y: number } {
    return { size: t.variants[Math.min(t.place.variant, t.variants.length - 1)]!, x: t.place.x, y: t.place.y };
  }

  /** The opacity of node `t`'s box and label: its own timed opacity in every state, so a group and its children cross-fade whatever is hovered or selected. */
  private alphaOf(t: Item, _mode: LabelMode): number {
    return quantAlpha(this.lod.alpha[t.i]!);
  }

  private fillAlphaOf(t: Item, _mode: LabelMode): number {
    return quantAlpha(this.lod.fillAlpha[t.i]!);
  }

  /** The room of the labels, container CSS px. */
  private view(): { cols: number; rows: number } {
    const g = this.frame!.grid;
    return this.room ? { cols: this.room.w, rows: this.room.h } : { cols: g.cols * g.cell + 2 * g.left, rows: g.rows * g.cell + 2 * g.top };
  }

  /** Re-plan every label now and end every glide, as if the camera had been at rest for good (checks, and a host that jumped the camera). */
  settle() {
    if (!this.frame || this.disposed) return;
    this.tracker.settleNow();
    this.run(performance.now());
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
        place: { x: 0, y: 0, gx: 0, gy: 0, variant: 0, cand: 0, inside: false, overlap: false, moved: false, fresh: false },
        score: (i === this.selected ? 1000 : 0) + lod.priority[i]! + (lod.isGroup[i] ? 0 : LOD.placePriorityBonus),
      });
    }
    // Where every label goes (engine/label-track.ts decides WHEN the plan runs: only the nodes the cut wants take part; one that is fading out
    // keeps its slot and goes with its node).
    const planned = items.filter((t) => t.wanted);
    // A label also keeps clear of the other boxes (the planner looks at plates only): their rectangles a few px wider, those near enough for a position of the plate.
    const boxPlates = planned.map((t) => ({ x0: t.px.c0 - AVOID_PAD, y0: t.px.r0 - AVOID_PAD, x1: t.px.c1 + AVOID_PAD, y1: t.px.r1 + AVOID_PAD }));
    const track: TrackItem[] = planned.map((t, n) => ({
      id: t.i,
      key: lod.slug[t.i]!,
      rect: t.px,
      score: t.score,
      area: (t.px.c1 - t.px.c0) * (t.px.r1 - t.px.r0),
      variants: t.variants,
      vkey: this.vkey(t.i),
      avoid: () => boxesToAvoid(boxPlates, n, t.variants[0]!.w + t.variants[0]!.h + 2 * AVOID_PAD),
    }));
    const placed: Placed[] = this.tracker.step(now, track, view, units.inset);
    if (this.tracker.info.full) this.replans++;
    this.partials += this.tracker.info.partial;
    planned.forEach((t, n) => {
      const p = placed[n]!;
      t.place = { x: p.x, y: p.y, gx: p.gx, gy: p.gy, variant: p.variant, cand: p.cand, inside: p.inside, overlap: p.overlap, moved: p.moved, fresh: p.fresh };
    });
    // fading out: the slot it had, followed to its box, and the glide it had going on
    const fading = items.filter((t) => !t.wanted);
    const mem = this.mem;
    const followed = this.tracker.follow(
      now,
      fading.map((t) => {
        const v = mem.set[t.i] ? Math.min(mem.variant[t.i]!, t.variants.length - 1) : 0;
        return { id: t.i, rect: t.px, size: t.variants[v]! };
      }),
      view,
      units.inset,
    );
    fading.forEach((t, k) => {
      const p = followed[k]!;
      const v = mem.set[t.i] ? Math.min(mem.variant[t.i]!, t.variants.length - 1) : 0;
      t.place = { x: p.x, y: p.y, gx: p.gx, gy: p.gy, variant: v, cand: mem.set[t.i] ? mem.cand[t.i]! : 0, inside: false, overlap: false, moved: false, fresh: false };
    });
    this.last = items;
    this.present();
    this.arm();
  }

  /** Re-draw the states (hover, focus, selection) from the last plan: no planning, no motion. */
  private represent() {
    if (this.frame && this.last.length) this.present();
  }

  /** Draw the boxes on the canvas and write the labels' elements and the hit targets from the last plan and the current states. */
  private present() {
    const frame = this.frame;
    if (!frame) return;
    const { grid } = frame;
    const lod = this.lod;
    const cell = grid.cell;
    const items = this.last;
    const targets: Target[] = [];
    const mapMinSide = Math.min(grid.cols, grid.rows) * cell;
    let h = HASH_SEED;
    this.layer.begin();
    for (const t of items) {
      const mode = this.modeOf(t.i, t.wanted);
      const forced = mode !== "rest";
      const alpha = this.alphaOf(t, mode);
      const fillAlpha = this.fillAlphaOf(t, mode);
      const v = this.shownText(t);
      this.layer.put(t.i, lod.slug[t.i]!, {
        x: v.x,
        y: v.y,
        w: v.size.w,
        h: v.size.h,
        name: v.size.name,
        sub: v.size.sub,
        mode,
        over: t.place.overlap && !forced,
        alpha,
      });
      h = hashStep(hashStep(hashStep(hashStep(h, t.i), t.rect.c0 * 4096 + t.rect.r0), t.rect.c1 * 4096 + t.rect.r1), Math.round(alpha * ALPHA_STEPS) * 16 + (mode === "selected" ? 1 : 0) + (forced ? 2 : 0));
      h = hashStep(h, Math.round(fillAlpha * ALPHA_STEPS));
      const box = { x0: t.px.c0, y0: t.px.r0, x1: t.px.c1, y1: t.px.r1 };
      const plate = { x0: v.x, y0: v.y, x1: v.x + v.size.w, y1: v.y + v.size.h };
      targets.push({ id: t.i, box, plate, alpha: pickAlpha(lod.alpha[t.i]!, t.wanted, LOD.pickFadingMin), priority: lod.priority[t.i]!, big: isBigBox(box, mapMinSide), slug: lod.slug[t.i]! });
    }
    this.layer.end();
    h = hashStep(hashStep(h, items.length), grid.cols * 4096 + grid.rows);
    // Painter's order: lower score first, forced last, so a strong node is composited over a weak one.
    const paint = [...items].sort((a, b) => Number(this.modeOf(a.i, a.wanted) !== "rest") - Number(this.modeOf(b.i, b.wanted) !== "rest") || a.score - b.score);
    this.overlay.frame(h, (buf) => {
      for (const t of paint) {
        const mode = this.modeOf(t.i, t.wanted);
        drawBox(buf, t.rect, this.tones, { alpha: this.alphaOf(t, mode), fillAlpha: this.fillAlphaOf(t, mode), active: mode !== "rest", solid: mode === "selected" });
      }
    });
    this.targets = targets;
  }

  /** Arm the timer of the re-plan that is owed (the last one after the camera stopped, or a young slot waiting out its dwell): an idle map draws no frames, so nothing else would run it. */
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
    if (this.animating) this.wake?.(); // a plan the timer ran started a glide: the frames must come
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
