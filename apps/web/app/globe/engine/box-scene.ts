/**
 * The detection boxes of the map, drawn as PIXEL ART on the art-pixel grid (engine/pixel-labels.ts: a `cols x rows` canvas of
 * the map's own art cells, scaled up with nearest-neighbour; the font is engine/pixel-font). ONE class shared by the Three.js
 * globe (`LabelLayer`) and the street overlay (`HudLayer`), so the two draw exactly the same thing on both sides of the
 * handover.
 *
 * From the cut of the hierarchy (engine/lod-tree.ts) and the rectangle every drawn node was given (`NodeScreen`, whole cells),
 * per frame, O(drawn nodes):
 *  - every drawn node is a RECTANGLE one cell thick (places and groups alike): at rest the four corners are solid and the rest of each
 *    edge is dashed (anchored to the box's edges, so a resize does not slide the dashes); its colour is its STATE (the `peak` level at rest, the
 *    ink hovered or focused, the dashes unchanged) and the selected one is one solid line in the ink. Its interior is masked in the page colour while it is
 *    clamped to the minimum size and hollow once it is bigger. Fades are OPACITY: the outline, the mask, the plate and the text are all
 *    composited at the node's alpha (`lod.alpha`, quantised to 1/`ALPHA_STEPS`) over what is underneath, so a faint node never darkens or
 *    lightens the map. The state is BINARY and the opacity runs to it by TIME (engine/fade.ts, owned by the tree), so a resting frame
 *    is never half way;
 *  - EVERY rectangle has a LABEL (engine/label-plan.ts: a prioritised list of positions, then a shorter way of writing it, then on top
 *    of the others on its page-colour plate; never a box without a name). It is text only on a plate of the page colour: the name and, for a
 *    group, its counter ("12 entries") a colour level below it, on the same baseline. The label is on with its node: it has no fade of its own.
 * The canvas is only touched when the set of rectangles and labels, their cells or their tones changed: an idle map does nothing.
 *
 * Accessibility: the overlay is a visual duplicate of the place list (the accessible path): the canvas has no focus, role or
 * text and the root is `aria-hidden` (set by the component). Clicking and hovering a node go through `hit()` (engine/hit-area.ts: the
 * convex hull of the rectangle and its label plate, plus slop), consulted by the host's pointer handling, so that dragging over a label
 * still pans and the touch target can be enlarged.
 */
import type { Rgb } from "./colors";
import { planLabels, type Prev } from "./label-plan";
import { isBigBox, pickNode, type PointerKind, type Target } from "./hit-area";
import { LOD, type LodTree } from "./lod-tree";
import type { NodeScreen } from "./node-screen";
import { textFloorLevel } from "./palette";
import { ALPHA_STEPS, HASH_SEED, PixelOverlay, drawBox, drawLabel, hashStep, labelCandidates, labelTones, labelVariants, quantAlpha, type CellRect, type LabelState, type LabelTones, type LabelVariant } from "./pixel-labels";

/** The art-pixel grid of a map's canvas. */
export interface PixelGrid {
  cols: number;
  rows: number;
  /** CSS px per cell, and the CSS position of cell (0, 0)'s top-left in the container. */
  cell: number;
  left: number;
  top: number;
}

/** Where a node's label is, in cells. */
interface Place {
  x: number;
  y: number;
  variant: number;
  cand: number;
  inside: boolean;
  overlap: boolean;
}

interface Item {
  i: number;
  rect: CellRect;
  /** Opacity of the box (outline), of its interior mask and of its label: the node's own, quantised. */
  alpha: number;
  fillAlpha: number;
  /** The cut wants the node drawn (else it is fading out). */
  wanted: boolean;
  state: LabelState;
  forced: boolean;
  variants: readonly LabelVariant[];
  place: Place;
  score: number;
}

const forcedState = (s: LabelState) => s.selected || s.focused || s.hover;

export class BoxScene {
  private overlay: PixelOverlay;
  private tones: LabelTones = labelTones(12);
  /** What the last frame drew, as targets for `hit` (every drawn node). */
  private targets: Target[] = [];
  private selected = -1;
  private focused = -1;
  private hovered = -1;
  private last: Item[] = [];
  /** What every node's label chose last frame (the plan keeps it while it is still free), and the plate's offset from the box for a label drawn over others. */
  private memSet: Uint8Array;
  private memVariant: Uint8Array;
  private memCand: Int16Array;
  private memDx: Int16Array;
  private memDy: Int16Array;

  constructor(
    root: HTMLElement,
    private lod: LodTree,
  ) {
    Object.assign(root.style, { position: "absolute", inset: "0", overflow: "hidden", pointerEvents: "none" });
    this.overlay = new PixelOverlay(root);
    this.memSet = new Uint8Array(lod.size);
    this.memVariant = new Uint8Array(lod.size);
    this.memCand = new Int16Array(lod.size);
    this.memDx = new Int16Array(lod.size);
    this.memDy = new Int16Array(lod.size);
  }

  /** The theme's ramp (levels of the shared palette). */
  setTheme(theme: { ramp: readonly Rgb[] }) {
    this.tones = labelTones(theme.ramp.length, textFloorLevel(theme.ramp));
    this.overlay.setRamp(theme.ramp as readonly (readonly [number, number, number])[]);
  }

  setSelected(slug: string | null) {
    const next = this.lod.indexOf(slug);
    if (next === this.selected) return;
    this.selected = next;
    this.overlay.invalidate();
  }

  setFocused(slug: string | null) {
    const next = this.lod.indexOf(slug);
    if (next === this.focused) return;
    this.focused = next;
    this.overlay.invalidate();
  }

  /** The node under the pointer (highlight only). */
  setHovered(slug: string | null) {
    const next = this.lod.indexOf(slug);
    if (next === this.hovered) return;
    this.hovered = next;
    this.overlay.invalidate();
  }

  /** Slugs of the nodes whose label is shown: every drawn node. */
  shown(): ReadonlySet<string> {
    const out = new Set<string>();
    for (const t of this.last) out.add(this.lod.slug[t.i]!);
    return out;
  }

  /** Cells of every rectangle and label drawn in the last frame, for checks. */
  snapshot() {
    const lod = this.lod;
    return this.last.map((t) => {
      const v = t.variants[t.place.variant]!;
      return {
        slug: lod.slug[t.i]!,
        kind: lod.kind[t.i]!,
        rect: t.rect,
        /** The label's plate in cells (`col`, `row`: its top-left cell), the row of its baseline, the text and counter as drawn (a shorter way of writing it when there was no room), and where it is. */
        label: {
          col: t.place.x,
          row: t.place.y,
          w: v.layout.w,
          h: v.layout.h,
          baseline: t.place.y + v.layout.baseline,
          inside: t.place.inside,
          chipCol: v.layout.chipW ? t.place.x + v.layout.chipX : null,
          chipW: v.layout.chipW,
          text: v.text,
          chip: v.chip,
          /** Index of the way of writing it (0: the whole label) and of the position (`SPOT`; -1: drawn over other labels, the last resort). */
          variant: t.place.variant,
          cand: t.place.cand,
          overlap: t.place.overlap,
        },
        text: lod.text[t.i]!,
        chip: lod.chip[t.i]!,
        /** Opacity of the box as drawn, of its mask and of its label. */
        alpha: t.alpha,
        fillAlpha: t.fillAlpha,
        /** The cut wants it drawn (else it is fading out). */
        wanted: t.wanted,
        /** Hovered, focused or selected: the ink instead of the rest tone. */
        active: t.forced,
        /** Selected: one solid line. */
        solid: t.state.selected,
        /** Some group above the node is drawn (it is wanted and has places in view). */
        parented: lod.hasDrawnAncestor(t.i),
      };
    });
  }

  /** Canvas drawing counters (frames drawn, frames skipped because nothing changed). */
  stats() {
    return { drawn: this.overlay.drawn, skipped: this.overlay.skipped };
  }

  /**
   * The node under a CSS-px point: the convex hull of a box and its label plate, plus slop (engine/hit-area.ts), of the nodes
   * drawn in the last frame. The innermost target that contains the point wins, else the nearest within the slop.
   */
  hit(x: number, y: number, kind: PointerKind): string | null {
    const i = pickNode(this.targets, x, y, kind, LOD.pickAlphaMin);
    return i < 0 ? null : this.lod.slug[i]!;
  }

  /**
   * Place and draw everything the tree drew. `screen` holds each drawn node's rectangle in container CSS px (whole cells of
   * `grid`).
   */
  update(screen: NodeScreen, grid: PixelGrid) {
    this.overlay.layout(grid.cols, grid.rows, grid.cell, grid.left, grid.top);
    const lod = this.lod;
    const cell = grid.cell;
    const size = { cols: grid.cols, rows: grid.rows };
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
      const state: LabelState = { selected: i === this.selected, focused: i === this.focused && i !== this.selected, hover: i === this.hovered && i !== this.selected };
      const wanted = lod.life.target[i] === 1;
      // The selected, focused and hovered node is the full ink at once (a node that is on its way out keeps its own fade).
      const forced = forcedState(state) && wanted;
      items.push({
        i,
        rect,
        alpha: 0,
        fillAlpha: 0,
        wanted,
        state,
        forced,
        variants: labelVariants(lod.text[i]!, lod.chip[i]!),
        place: { x: 0, y: 0, variant: 0, cand: 0, inside: false, overlap: false },
        score: (forced ? 1000 : 0) + lod.priority[i]! + (lod.isGroup[i] ? 0 : LOD.placePriorityBonus),
      });
    }
    // Where every label goes (engine/label-plan.ts). Only the nodes the cut wants take part: one that is fading out keeps the place it had
    // and goes with its node.
    const planned = items.filter((t) => t.wanted);
    const plan = planLabels(
      planned.map((t) => {
        const i = t.i;
        const prev: Prev | null = this.memSet[i] ? { variant: this.memVariant[i]!, cand: this.memCand[i]!, dx: this.memDx[i]!, dy: this.memDy[i]! } : null;
        return { forced: t.forced, score: t.score, area: (t.rect.c1 - t.rect.c0) * (t.rect.r1 - t.rect.r0), key: lod.slug[i]!, rect: t.rect, variants: t.variants, prev };
      }),
      size,
    );
    planned.forEach((t, n) => {
      const p = plan[n]!;
      const i = t.i;
      t.place = { x: p.x, y: p.y, variant: p.variant, cand: p.cand, inside: p.inside, overlap: p.overlap };
      this.memSet[i] = 1;
      this.memVariant[i] = p.variant;
      this.memCand[i] = p.cand;
      this.memDx[i] = p.x - t.rect.c0;
      this.memDy[i] = p.y - t.rect.r0;
    });
    for (const t of items) {
      if (t.wanted) continue;
      // fading out: the place it had, followed to its box
      const i = t.i;
      const v = this.memSet[i] ? Math.min(this.memVariant[i]!, t.variants.length - 1) : 0;
      const { w, h } = t.variants[v]!.layout;
      const spot = this.memCand[i]! >= 0 && this.memSet[i] ? labelCandidates(t.rect, w, h, size).find((s) => s.id === this.memCand[i]) : undefined;
      const x = spot ? spot.x : this.memSet[i] ? t.rect.c0 + this.memDx[i]! : t.rect.c0;
      const y = spot ? spot.y : this.memSet[i] ? t.rect.r0 + this.memDy[i]! : t.rect.r0 - h;
      t.place = { x, y, variant: v, cand: spot ? spot.id : -1, inside: !!spot?.inside, overlap: false };
    }
    for (const t of items) {
      const i = t.i;
      t.alpha = quantAlpha(t.forced ? 1 : lod.alpha[i]!);
      t.fillAlpha = quantAlpha(t.forced ? lod.mask.value(i) : lod.fillAlpha[i]!);
    }

    const targets: Target[] = [];
    const mapMinSide = Math.min(grid.cols, grid.rows) * cell;
    let h = HASH_SEED;
    for (const t of items) {
      const v = t.variants[t.place.variant]!;
      h = hashStep(hashStep(hashStep(hashStep(h, t.i), t.rect.c0 * 4096 + t.rect.r0), t.rect.c1 * 4096 + t.rect.r1), Math.round(t.alpha * ALPHA_STEPS) * 16 + (t.state.selected ? 1 : 0) + (t.forced ? 2 : 0));
      h = hashStep(hashStep(h, Math.round(t.fillAlpha * ALPHA_STEPS)), t.place.x * 4096 + t.place.y);
      h = hashStep(h, t.place.variant * 8 + (t.state.hover ? 1 : 0) + (t.state.focused ? 2 : 0) + v.layout.w * 64);
      const box = { x0: grid.left + t.rect.c0 * cell, y0: grid.top + t.rect.r0 * cell, x1: grid.left + t.rect.c1 * cell, y1: grid.top + t.rect.r1 * cell };
      const plate = { x0: grid.left + t.place.x * cell, y0: grid.top + t.place.y * cell, x1: grid.left + (t.place.x + v.layout.w) * cell, y1: grid.top + (t.place.y + v.layout.h) * cell };
      targets.push({ id: t.i, box, plate, alpha: lod.alpha[t.i]!, priority: lod.priority[t.i]!, big: isBigBox(box, mapMinSide), slug: lod.slug[t.i]! });
    }
    h = hashStep(hashStep(h, items.length), grid.cols * 4096 + grid.rows);
    // Painter's order: lower score first, forced last, so a strong node is composited over a weak one.
    const paint = [...items].sort((a, b) => Number(a.forced) - Number(b.forced) || a.score - b.score);
    this.overlay.frame(h, (buf) => {
      for (const t of paint) drawBox(buf, t.rect, this.tones, { alpha: t.alpha, fillAlpha: t.fillAlpha, active: t.forced, solid: t.state.selected });
      // Labels drawn over others (the last resort) go on top of the ones they overlap, the forced ones on top of all.
      const labels = [...paint].sort((a, b) => Number(a.forced) - Number(b.forced) || Number(a.place.overlap) - Number(b.place.overlap));
      for (const t of labels) {
        const v = t.variants[t.place.variant]!;
        drawLabel(buf, t.place.x, t.place.y, v.text, v.chip, v.layout, t.alpha, this.tones, t.forced);
      }
    });
    this.last = items;
    this.targets = targets;
  }

  dispose() {
    this.overlay.dispose();
    this.targets = [];
  }
}
