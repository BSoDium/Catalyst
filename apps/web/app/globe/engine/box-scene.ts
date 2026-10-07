/**
 * The detection boxes of the map, drawn as PIXEL ART on the art-pixel grid (engine/pixel-labels.ts: a `cols x rows` canvas of
 * the map's own art cells, scaled up with nearest-neighbour; the font is engine/pixel-font). ONE class shared by the Three.js
 * globe (`LabelLayer`) and the street overlay (`HudLayer`), so the two draw exactly the same thing on both sides of the
 * handover.
 *
 * From the cut of the hierarchy (engine/lod-tree.ts) and the rectangle every drawn node was given (`NodeScreen`, whole cells),
 * per frame, O(drawn nodes):
 *  - every drawn node is a RECTANGLE one cell thick in the full ink (places and groups alike): at rest the four corners are solid
 *    and the rest of each edge is dashed, and the selected, focused or hovered one is a single solid line (nothing doubles); its
 *    interior is masked in the page colour while it is clamped to the minimum size and hollow once it is bigger. Fades are OPACITY: the outline, the mask, the plate and the text are all composited at the node's alpha
 *    (`lod.alpha`, quantised to 1/`ALPHA_STEPS`) over what is underneath, so a faint node never darkens or lightens the map. The state is BINARY
 *    (a node, its label and its dim are each on or off; the camera and the label plan only decide which) and the opacity runs to it by TIME
 *    (engine/fade.ts, owned by the tree), so a resting frame is never half way;
 *  - every rectangle has a LABEL, text only, just above its top edge and left-justified on its left edge, on a plate of the
 *    page colour: the name in bold (a place that is alone in its country: and the country) and, for a group, its counter
 *    ("12 entries", regular weight) after a clear gap, on the same baseline;
 *  - labels are placed greedily by priority (selected, focused and hovered first, then places, then groups); one that would
 *    overlap a label already placed is left out (it is still a target, and its label shows while it is hovered), and when a group above it
 *    is drawn its rectangle is dimmed to `LOD.unlabelledAlpha` of its opacity (engine/label-plan.ts). There is NO zoom-dependent priority
 *    floor (docs/web-architecture.md, "Targets and labels"). Where a label goes: just above the box, or nested inside it when the top of the
 *    grid leaves no room (`labelCell`).
 * The canvas is only touched when the set of rectangles and labels, their cells or their tones changed: an idle map does nothing.
 *
 * Accessibility: the overlay is a visual duplicate of the place list (the accessible path): the canvas has no focus, role or
 * text and the root is `aria-hidden` (set by the component). Clicking and hovering a node go through `hit()` (engine/hit-area.ts: the
 * convex hull of the rectangle and its label, plus slop), consulted by the host's pointer handling, so that dragging over a label
 * still pans and the touch target can be enlarged.
 */
import type { Rgb } from "./colors";
import { planLabels } from "./label-plan";
import { isBigBox, pickNode, type PointerKind, type Target } from "./hit-area";
import { LOD, type LodTree } from "./lod-tree";
import type { NodeScreen } from "./node-screen";
import { ALPHA_STEPS, HASH_SEED, LABEL_PAD, PixelOverlay, drawBox, drawLabel, hashStep, labelCell, labelLayout, labelTones, quantAlpha, type CellRect, type LabelLayout, type LabelState, type LabelTones } from "./pixel-labels";

/** The art-pixel grid of a map's canvas. */
export interface PixelGrid {
  cols: number;
  rows: number;
  /** CSS px per cell, and the CSS position of cell (0, 0)'s top-left in the container. */
  cell: number;
  left: number;
  top: number;
}

interface Item {
  i: number;
  rect: CellRect;
  /** Opacity of the box (outline) and of its interior mask, quantised, the dim included. */
  alpha: number;
  fillAlpha: number;
  /** Opacity of the label (plate and text), quantised: the node's own times its label's. */
  labelAlpha: number;
  /** The cut wants the node drawn (else it is fading out). */
  wanted: boolean;
  state: LabelState;
  forced: boolean;
  layout: LabelLayout;
  label: { col: number; row: number; inside: boolean };
  /** Whether the label is drawn (it is wanted, or it is fading out). */
  labelled: boolean;
  /** The label lost its place to a better one and a group above is drawn: the box is dimmed (its target; the dim itself is a timed fade). */
  dimmed: boolean;
  score: number;
}

const forcedState = (s: LabelState) => s.selected || s.focused || s.hover;

export class BoxScene {
  private overlay: PixelOverlay;
  private tones: LabelTones = labelTones(12);
  /** What the last frame drew, as targets for `hit` (every drawn node, labelled or not). */
  private targets: Target[] = [];
  /** Slugs of the nodes whose label is drawn. */
  private labelledSet = new Set<number>();
  private selected = -1;
  private focused = -1;
  private hovered = -1;
  private last: Item[] = [];

  constructor(
    root: HTMLElement,
    private lod: LodTree,
  ) {
    Object.assign(root.style, { position: "absolute", inset: "0", overflow: "hidden", pointerEvents: "none" });
    this.overlay = new PixelOverlay(root);
  }

  /** The theme's ramp (levels of the shared palette). */
  setTheme(theme: { ramp: readonly Rgb[] }) {
    this.tones = labelTones(theme.ramp.length);
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

  /** Slugs of the nodes whose label is shown. */
  shown(): ReadonlySet<string> {
    const out = new Set<string>();
    for (const i of this.labelledSet) out.add(this.lod.slug[i]!);
    return out;
  }

  /** Cells of every rectangle and label drawn in the last frame, for checks. */
  snapshot() {
    const lod = this.lod;
    return this.last.map((t) => ({
      slug: lod.slug[t.i]!,
      kind: lod.kind[t.i]!,
      rect: t.rect,
      /** The label's plate in cells (`col` is the anchor, the box's left edge; the plate starts `LABEL_PAD` cells left of it), the row of its baseline, and where the chip is. */
      label: t.labelled ? { col: t.label.col, row: t.label.row, w: t.layout.w, h: t.layout.h, baseline: t.label.row + t.layout.baseline, inside: t.label.inside, chipCol: t.layout.chipW ? t.label.col + t.layout.chipX : null, chipW: t.layout.chipW } : null,
      text: lod.text[t.i]!,
      chip: lod.chip[t.i]!,
      /** Opacity of the box as drawn (dim included), of its mask and of its label. */
      alpha: t.alpha,
      fillAlpha: t.fillAlpha,
      labelAlpha: t.labelAlpha,
      /** The cut wants it drawn (else it is fading out). */
      wanted: t.wanted,
      solid: forcedState(t.state),
      /** The label is not drawn and a group above is: the box is dimmed (still a target). */
      dimmed: t.dimmed,
      /** Some group above the node is drawn (it is wanted and has places in view). */
      parented: lod.hasDrawnAncestor(t.i),
    }));
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
      const layout = labelLayout(lod.text[i]!, lod.chip[i]!);
      items.push({
        i,
        rect,
        alpha: 0,
        fillAlpha: 0,
        labelAlpha: 0,
        wanted,
        state,
        forced,
        layout,
        label: labelCell(rect, layout.h),
        labelled: false,
        dimmed: false,
        score: (forced ? 1000 : 0) + lod.priority[i]! + (lod.isGroup[i] ? 0 : LOD.placePriorityBonus),
      });
    }
    // Which labels are wanted, and which boxes are dimmed for lack of one (engine/label-plan.ts). Only the nodes the cut wants take part:
    // one that is fading out keeps the label state it had and goes with its node.
    const planned = items.filter((t) => t.wanted);
    const plan = planLabels(
      planned.map((t) => ({
        forced: t.forced,
        score: t.score,
        plate: { x0: t.label.col - LABEL_PAD, y0: t.label.row, x1: t.label.col - LABEL_PAD + t.layout.w, y1: t.label.row + t.layout.h },
        key: lod.slug[t.i]!,
        held: lod.label.target[t.i] === 1,
        parented: lod.hasDrawnAncestor(t.i),
      })),
    );
    planned.forEach((t, n) => {
      const p = plan[n]!;
      const i = t.i;
      if (t.forced) {
        lod.label.snap(i, true);
        lod.dim.snap(i, false);
      } else if (lod.born[i]) {
        // A node that has just appeared starts in its label and dim state; only the node itself fades in.
        lod.label.snap(i, p.labelled);
        lod.dim.snap(i, p.dimmed);
      } else {
        lod.label.set(i, p.labelled);
        lod.dim.set(i, p.dimmed);
      }
      lod.born[i] = 0;
    });
    for (const t of items) {
      const i = t.i;
      const life = lod.alpha[i]!;
      const dim = t.forced ? 0 : lod.dim.value(i);
      const boxAlpha = t.forced ? 1 : life * (1 - (1 - LOD.unlabelledAlpha) * dim);
      t.alpha = quantAlpha(boxAlpha);
      t.fillAlpha = quantAlpha(t.forced ? lod.mask.value(i) : lod.fillAlpha[i]! * (1 - (1 - LOD.unlabelledAlpha) * dim));
      t.labelAlpha = quantAlpha(t.forced ? 1 : life * lod.label.value(i));
      t.labelled = t.labelAlpha >= LOD.labelAlphaMin;
      t.dimmed = t.wanted && lod.dim.target[i] === 1;
    }

    const targets: Target[] = [];
    const labelledSet = new Set<number>();
    const mapMinSide = Math.min(grid.cols, grid.rows) * cell;
    let h = HASH_SEED;
    for (const t of items) {
      h = hashStep(hashStep(hashStep(hashStep(h, t.i), t.rect.c0 * 4096 + t.rect.r0), t.rect.c1 * 4096 + t.rect.r1), Math.round(t.alpha * ALPHA_STEPS) * 16 + (t.state.selected ? 1 : 0) + (t.state.focused ? 2 : 0) + (t.state.hover ? 4 : 0) + (t.labelled ? 8 : 0));
      h = hashStep(hashStep(h, Math.round(t.fillAlpha * ALPHA_STEPS)), Math.round(t.labelAlpha * ALPHA_STEPS));
      if (t.labelled) {
        h = hashStep(hashStep(h, t.label.col), t.label.row + 100000 * lod.total[t.i]!);
        labelledSet.add(t.i);
      }
      const box = { x0: grid.left + t.rect.c0 * cell, y0: grid.top + t.rect.r0 * cell, x1: grid.left + t.rect.c1 * cell, y1: grid.top + t.rect.r1 * cell };
      const plate = t.labelled ? { x0: grid.left + (t.label.col - LABEL_PAD) * cell, y0: grid.top + t.label.row * cell, x1: grid.left + (t.label.col - LABEL_PAD + t.layout.w) * cell, y1: grid.top + (t.label.row + t.layout.h) * cell } : null;
      // A target at its node's own opacity (a dimmed box is picked as if it were not dimmed).
      targets.push({ id: t.i, box, plate, alpha: lod.alpha[t.i]!, priority: lod.priority[t.i]!, big: isBigBox(box, mapMinSide), slug: lod.slug[t.i]! });
    }
    h = hashStep(hashStep(h, items.length), grid.cols * 4096 + grid.rows);
    // Painter's order: lower score first, forced last, so a strong node is composited over a weak one.
    const paint = [...items].sort((a, b) => Number(a.forced) - Number(b.forced) || a.score - b.score);
    this.overlay.frame(h, (buf) => {
      for (const t of paint) drawBox(buf, t.rect, this.tones, { alpha: t.alpha, fillAlpha: t.fillAlpha, solid: t.forced });
      for (const t of paint) {
        if (!t.labelled) continue;
        drawLabel(buf, t.label.col, t.label.row, lod.text[t.i]!, lod.chip[t.i]!, t.layout, t.labelAlpha, this.tones);
      }
    });
    this.last = items;
    this.targets = targets;
    this.labelledSet = labelledSet;
  }

  dispose() {
    this.overlay.dispose();
    this.targets = [];
    this.labelledSet.clear();
  }
}
