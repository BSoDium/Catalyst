/**
 * The detection boxes of the map, drawn as PIXEL ART on the art-pixel grid (engine/pixel-labels.ts: a `cols x rows` canvas of
 * the map's own art cells, scaled up with nearest-neighbour; the font is engine/pixel-font). ONE class shared by the Three.js
 * globe (`LabelLayer`) and the street overlay (`HudLayer`), so the two draw exactly the same thing on both sides of the
 * handover.
 *
 * From the cut of the hierarchy (engine/lod-tree.ts) and the rectangle every drawn node was given (`NodeScreen`, whole cells),
 * per frame, O(drawn nodes):
 *  - every drawn node is a RECTANGLE one cell thick in the full ink (places and groups alike; the selected, focused or hovered
 *    one has a second ring inside), its interior masked in the page colour while it is clamped to the minimum size and hollow
 *    once it is bigger. Fades are OPACITY: the outline, the mask, the plate and the text are all composited at the node's alpha
 *    (`lod.alpha`, quantised to 1/`ALPHA_STEPS`) over what is underneath, so a faint node never darkens or lightens the map;
 *  - every rectangle has a LABEL, text only, just above its top edge and left-justified on its left edge, on a plate of the
 *    page colour: the name in bold (a place that is alone in its country: and the country) and, for a group, its counter
 *    ("12 entries", regular weight) after a clear gap, on the same baseline;
 *  - labels are placed greedily by priority (selected, focused and hovered first, then places, then groups); one that would
 *    overlap a label already placed is left out (its rectangle stays), and places below the zoom-dependent priority floor go
 *    without a label.
 * The canvas is only touched when the set of rectangles and labels, their cells or their tones changed: an idle map does nothing.
 *
 * Accessibility: the overlay is a visual duplicate of the place list (the accessible path): the canvas has no focus, role or
 * text and the root is `aria-hidden` (set by the component). Clicking a label goes through `hit()`, and a rectangle's border
 * through the host's picking, so that dragging over a label still pans and the touch hit area can be enlarged.
 */
import type { Rgb } from "./colors";
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

interface Hit {
  x: number;
  y: number;
  w: number;
  h: number;
  alpha: number;
}

interface Item {
  i: number;
  rect: CellRect;
  /** Opacity of the node (outline, plate, text) and of its interior mask, quantised. */
  alpha: number;
  fillAlpha: number;
  state: LabelState;
  forced: boolean;
  layout: LabelLayout;
  label: { col: number; row: number; inside: boolean };
  /** Whether the label is drawn (alpha, priority floor and collisions). */
  labelled: boolean;
  score: number;
}

const forcedState = (s: LabelState) => s.selected || s.focused || s.hover;

export class BoxScene {
  private overlay: PixelOverlay;
  private tones: LabelTones = labelTones(12);
  private hits = new Map<number, Hit>();
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
    for (const i of this.hits.keys()) out.add(this.lod.slug[i]!);
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
      alpha: t.alpha,
      fillAlpha: t.fillAlpha,
      ring: forcedState(t.state),
    }));
  }

  /** Canvas drawing counters (frames drawn, frames skipped because nothing changed). */
  stats() {
    return { drawn: this.overlay.drawn, skipped: this.overlay.skipped };
  }

  /**
   * The node whose label plate is under a CSS-px point, grown by `slop` px on every side (larger for touch). The nearest plate
   * centre wins when plates overlap. A label that is mostly faded is not a target.
   */
  hit(x: number, y: number, slop: number): string | null {
    let best = -1;
    let bestD = Infinity;
    for (const [i, b] of this.hits) {
      if (b.alpha < LOD.pickAlphaMin) continue;
      if (x < b.x - slop || x > b.x + b.w + slop || y < b.y - slop || y > b.y + b.h + slop) continue;
      const d = Math.hypot(x - (b.x + b.w / 2), y - (b.y + b.h / 2));
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best < 0 ? null : this.lod.slug[best]!;
  }

  /**
   * Place and draw everything the tree drew. `screen` holds each drawn node's rectangle in container CSS px (whole cells of
   * `grid`); `minPriority` is the zoom-dependent floor below which a PLACE has no label (its rectangle stays).
   */
  update(screen: NodeScreen, minPriority: number, grid: PixelGrid) {
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
      const forced = forcedState(state);
      const group = !!lod.isGroup[i];
      const layout = labelLayout(lod.text[i]!, lod.chip[i]!);
      const alpha = lod.alpha[i]!;
      const labelled = forced || (alpha >= LOD.labelAlphaMin && (group || lod.priority[i]! >= minPriority));
      items.push({
        i,
        rect,
        alpha: quantAlpha(forced ? 1 : alpha),
        fillAlpha: quantAlpha(lod.fillAlpha[i]!),
        state,
        forced,
        layout,
        label: labelCell(rect, layout.h),
        labelled,
        score: (forced ? 1000 : 0) + lod.priority[i]! + (group ? 0 : LOD.placePriorityBonus) + (alpha >= 0.5 ? 0 : -100),
      });
    }
    // Labels, greedily by priority (selected > place > group): one that would overlap a placed plate (a cell of clearance) is left out.
    const order = items.filter((t) => t.labelled).sort((a, b) => b.score - a.score || (lod.slug[a.i]! < lod.slug[b.i]! ? -1 : 1));
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (const t of order) {
      const r = { x0: t.label.col - LABEL_PAD - 1, y0: t.label.row - 1, x1: t.label.col - LABEL_PAD + t.layout.w + 1, y1: t.label.row + t.layout.h + 1 };
      if (!t.forced && placed.some((p) => r.x0 < p.x1 && r.x1 > p.x0 && r.y0 < p.y1 && r.y1 > p.y0)) {
        t.labelled = false;
        continue;
      }
      placed.push(r);
    }

    const nextHits = new Map<number, Hit>();
    let h = HASH_SEED;
    for (const t of items) {
      h = hashStep(hashStep(hashStep(hashStep(h, t.i), t.rect.c0 * 4096 + t.rect.r0), t.rect.c1 * 4096 + t.rect.r1), Math.round(t.alpha * ALPHA_STEPS) * 16 + (t.state.selected ? 1 : 0) + (t.state.focused ? 2 : 0) + (t.state.hover ? 4 : 0) + (t.labelled ? 8 : 0));
      h = hashStep(h, Math.round(t.fillAlpha * ALPHA_STEPS));
      if (t.labelled) {
        h = hashStep(hashStep(h, t.label.col), t.label.row + 100000 * lod.total[t.i]!);
        nextHits.set(t.i, { x: grid.left + (t.label.col - LABEL_PAD) * cell, y: grid.top + t.label.row * cell, w: t.layout.w * cell, h: t.layout.h * cell, alpha: lod.alpha[t.i]! });
      }
    }
    h = hashStep(hashStep(h, items.length), grid.cols * 4096 + grid.rows);
    // Painter's order: faint first, forced last, so a fading node is composited under a strong one.
    const paint = [...items].sort((a, b) => Number(a.forced) - Number(b.forced) || a.score - b.score);
    this.overlay.frame(h, (buf) => {
      for (const t of paint) drawBox(buf, t.rect, this.tones, { alpha: t.alpha, fillAlpha: t.fillAlpha, ring: t.forced });
      for (const t of paint) {
        if (!t.labelled) continue;
        drawLabel(buf, t.label.col, t.label.row, lod.text[t.i]!, lod.chip[t.i]!, t.layout, t.alpha, this.tones);
      }
    });
    this.last = items;
    this.hits = nextHits;
  }

  dispose() {
    this.overlay.dispose();
    this.hits.clear();
  }
}
