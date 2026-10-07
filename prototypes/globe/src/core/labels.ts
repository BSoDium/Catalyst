/**
 * Renderer-agnostic HTML label collision layer.
 *
 * Two parts:
 *  - `placeLabels`: pure greedy placement of label rects against projected screen rects (unit tested);
 *  - `LabelLayer`: DOM glue that owns one <button> per place and applies the placement.
 *
 * It knows nothing about WebGL, Three.js or MapLibre: it only needs a `project(lon, lat)` function
 * returning CSS-px coordinates and a front-hemisphere flag. Marker positions are NEVER moved: only the
 * label box moves around its marker, or disappears.
 */
import type { ScreenPoint } from "./geo";

export type Placement = "right" | "left" | "top" | "bottom";
export const DEFAULT_PLACEMENTS: readonly Placement[] = ["right", "left", "top", "bottom"];

export interface LabelInput {
  id: string;
  /** Marker anchor in CSS px. */
  x: number;
  y: number;
  /** Label box size in CSS px. */
  width: number;
  height: number;
  /** Higher wins. Matches `PublishedPlace.labelPriority` (0 to 100). */
  priority: number;
  /** Front hemisphere only. Occluded markers never get a label. */
  visible: boolean;
  /** 0 at the horizon, 1 at the view centre. Labels near the limb are dropped (see `minFacing`). */
  facing?: number;
  /** Selected / focused places: always placed, ahead of everything else. */
  forced?: boolean;
}

export interface PlaceOptions {
  width: number;
  height: number;
  /** Half-size of the marker hit box that labels must not cover. */
  markerRadius?: number;
  /** Distance between marker centre and label box edge. */
  gap?: number;
  /** Extra clearance around each placed label. */
  padding?: number;
  placements?: readonly Placement[];
  /** Placements chosen last time; reusing them avoids flicker while the globe moves. */
  previous?: ReadonlyMap<string, Placement>;
  /** Priority bonus for labels that were shown last frame (hysteresis). */
  stickiness?: number;
  /** Labels closer to the limb than this are not shown unless forced. */
  minFacing?: number;
  /** Keep labels fully inside the viewport (minus this margin). */
  edgeMargin?: number;
}

export interface PlacedLabel {
  id: string;
  placement: Placement;
  /** Top-left of the label box in CSS px. */
  x: number;
  y: number;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const intersects = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

/** Uniform grid so placement stays near O(n) at hundreds of markers. */
class RectGrid {
  private cells = new Map<number, Rect[]>();
  constructor(private cell = 96) {}
  private keys(r: Rect): number[] {
    const out: number[] = [];
    const cx0 = Math.floor(r.x0 / this.cell);
    const cx1 = Math.floor(r.x1 / this.cell);
    const cy0 = Math.floor(r.y0 / this.cell);
    const cy1 = Math.floor(r.y1 / this.cell);
    for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) out.push(cx * 73856093 ^ cy * 19349663);
    return out;
  }
  add(r: Rect) {
    for (const k of this.keys(r)) {
      const l = this.cells.get(k);
      if (l) l.push(r);
      else this.cells.set(k, [r]);
    }
  }
  hits(r: Rect, ignore?: Rect): boolean {
    for (const k of this.keys(r)) {
      const l = this.cells.get(k);
      if (l) for (const o of l) if (o !== ignore && intersects(r, o)) return true;
    }
    return false;
  }
}

function boxFor(l: LabelInput, p: Placement, gap: number): Rect {
  switch (p) {
    case "right":
      return { x0: l.x + gap, y0: l.y - l.height / 2, x1: l.x + gap + l.width, y1: l.y + l.height / 2 };
    case "left":
      return { x0: l.x - gap - l.width, y0: l.y - l.height / 2, x1: l.x - gap, y1: l.y + l.height / 2 };
    case "top":
      return { x0: l.x - l.width / 2, y0: l.y - gap - l.height, x1: l.x + l.width / 2, y1: l.y - gap };
    case "bottom":
      return { x0: l.x - l.width / 2, y0: l.y + gap, x1: l.x + l.width / 2, y1: l.y + gap + l.height };
  }
}

/**
 * Greedy label placement. Order: forced first, then by priority (+ stickiness) descending, then by id so
 * results are deterministic. Each label takes its first non-colliding placement or is dropped.
 */
export function placeLabels(inputs: readonly LabelInput[], opts: PlaceOptions): PlacedLabel[] {
  const {
    width,
    height,
    markerRadius = 5,
    gap = 8,
    padding = 2,
    placements = DEFAULT_PLACEMENTS,
    previous,
    stickiness = 8,
    minFacing = 0.08,
    edgeMargin = 4,
  } = opts;

  const visible = inputs.filter((l) => l.visible && (l.forced || (l.facing ?? 1) >= minFacing));

  // Every visible marker is an obstacle (a label may not cover another marker), including unlabeled ones.
  const markers = new RectGrid();
  const markerRect = new Map<string, Rect>();
  for (const l of inputs) {
    if (!l.visible) continue;
    const r = { x0: l.x - markerRadius, y0: l.y - markerRadius, x1: l.x + markerRadius, y1: l.y + markerRadius };
    markerRect.set(l.id, r);
    markers.add(r);
  }

  const score = (l: LabelInput) => l.priority + (previous?.has(l.id) ? stickiness : 0);
  const ordered = [...visible].sort(
    (a, b) => Number(!!b.forced) - Number(!!a.forced) || score(b) - score(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  const placed = new RectGrid();
  const out: PlacedLabel[] = [];
  const inside = (r: Rect) =>
    r.x0 >= edgeMargin && r.y0 >= edgeMargin && r.x1 <= width - edgeMargin && r.y1 <= height - edgeMargin;

  for (const l of ordered) {
    const prev = previous?.get(l.id);
    const order = prev ? [prev, ...placements.filter((p) => p !== prev)] : placements;
    let chosen: { p: Placement; r: Rect } | null = null;
    for (const p of order) {
      const r = boxFor(l, p, gap);
      const padded = { x0: r.x0 - padding, y0: r.y0 - padding, x1: r.x1 + padding, y1: r.y1 + padding };
      if (!l.forced && !inside(r)) continue;
      if (placed.hits(padded)) continue;
      if (!l.forced && markers.hits(r, markerRect.get(l.id))) continue;
      chosen = { p, r };
      break;
    }
    if (!chosen && l.forced) {
      // Selected/focused label is always shown: take the preferred side even if it overlaps something.
      const p = order[0] ?? "right";
      chosen = { p, r: boxFor(l, p, gap) };
    }
    if (!chosen) continue;
    placed.add({ x0: chosen.r.x0 - padding, y0: chosen.r.y0 - padding, x1: chosen.r.x1 + padding, y1: chosen.r.y1 + padding });
    out.push({ id: l.id, placement: chosen.p, x: chosen.r.x0, y: chosen.r.y0 });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* DOM layer                                                            */
/* ------------------------------------------------------------------ */

export interface LabelItem {
  id: string;
  text: string;
  /** Optional authored context shown as a title tooltip. */
  title?: string;
  lon: number;
  lat: number;
  priority: number;
}

export interface Projector {
  project(lon: number, lat: number): ScreenPoint;
}

export interface LabelLayerOptions {
  onSelect?: (id: string) => void;
  markerRadius?: number;
  gap?: number;
}

export class LabelLayer {
  private els = new Map<string, HTMLButtonElement>();
  private sizes = new Map<string, { w: number; h: number }>();
  private lastTransform = new Map<string, string>();
  private lastShown = new Set<string>();
  private previous = new Map<string, Placement>();
  private selectedId: string | null = null;
  private focusedId: string | null = null;
  private items: LabelItem[] = [];
  private onFocusIn = (e: FocusEvent) => {
    this.focusedId = (e.target as HTMLElement).dataset.id ?? null;
  };
  private onFocusOut = () => {
    this.focusedId = null;
  };

  constructor(
    private root: HTMLElement,
    items: readonly LabelItem[],
    private options: LabelLayerOptions = {},
  ) {
    root.classList.add("label-layer");
    root.addEventListener("focusin", this.onFocusIn);
    root.addEventListener("focusout", this.onFocusOut);
    this.setItems(items);
  }

  setItems(items: readonly LabelItem[]) {
    this.items = [...items];
    for (const el of this.els.values()) el.remove();
    this.els.clear();
    this.sizes.clear();
    this.lastTransform.clear();
    const frag = document.createDocumentFragment();
    for (const item of items) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "label";
      el.dataset.id = item.id;
      el.textContent = item.text;
      if (item.title) el.title = item.title;
      el.addEventListener("click", () => this.options.onSelect?.(item.id));
      this.els.set(item.id, el);
      frag.append(el);
    }
    this.root.append(frag);
    this.remeasure();
  }

  /** Re-measure label boxes (call after fonts load or the root's font size changes). */
  remeasure() {
    for (const [id, el] of this.els) {
      el.style.visibility = "hidden";
      this.sizes.set(id, { w: el.offsetWidth, h: el.offsetHeight });
    }
    this.lastTransform.clear();
  }

  setSelected(id: string | null) {
    this.selectedId = id;
    for (const [i, el] of this.els) el.classList.toggle("selected", i === id);
  }

  /** Places currently shown, in priority order. */
  shown(): ReadonlySet<string> {
    return this.lastShown;
  }

  update(projector: Projector, size: { width: number; height: number }) {
    const inputs: LabelInput[] = this.items.map((it) => {
      const p = projector.project(it.lon, it.lat);
      const s = this.sizes.get(it.id) ?? { w: 60, h: 20 };
      return {
        id: it.id,
        x: p.x,
        y: p.y,
        width: s.w,
        height: s.h,
        priority: it.priority,
        visible: p.visible,
        facing: p.facing,
        forced: it.id === this.selectedId || it.id === this.focusedId,
      };
    });
    const placed = placeLabels(inputs, {
      width: size.width,
      height: size.height,
      markerRadius: this.options.markerRadius ?? 6,
      gap: this.options.gap ?? 9,
      previous: this.previous,
    });
    const next = new Map<string, Placement>();
    const shown = new Set<string>();
    for (const l of placed) {
      const el = this.els.get(l.id)!;
      const t = `translate(${Math.round(l.x)}px, ${Math.round(l.y)}px)`;
      if (this.lastTransform.get(l.id) !== t) {
        el.style.transform = t;
        this.lastTransform.set(l.id, t);
      }
      if (!this.lastShown.has(l.id)) {
        el.style.visibility = "visible";
        el.style.opacity = "1";
      }
      next.set(l.id, l.placement);
      shown.add(l.id);
    }
    for (const id of this.lastShown) {
      if (!shown.has(id)) {
        const el = this.els.get(id);
        if (el) {
          el.style.visibility = "hidden";
          el.style.opacity = "0";
        }
      }
    }
    // Labels never shown yet stay hidden (remeasure sets visibility: hidden).
    this.previous = next;
    this.lastShown = shown;
  }

  dispose() {
    this.root.removeEventListener("focusin", this.onFocusIn);
    this.root.removeEventListener("focusout", this.onFocusOut);
    for (const el of this.els.values()) el.remove();
    this.els.clear();
  }
}
