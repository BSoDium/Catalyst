/**
 * Pure greedy label placement (unit tested). Renderer-agnostic: it only sees projected CSS-px anchors,
 * priorities and a front-hemisphere flag. Marker positions are NEVER moved: only the label box moves
 * around its marker, or disappears.
 */
export type Placement = "right" | "left" | "top" | "bottom";
const DEFAULT_PLACEMENTS: readonly Placement[] = ["right", "left", "top", "bottom"];

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
  /** Placements to try, in order, instead of `PlaceOptions.placements` (a group's label sits above or below its square's edge). */
  placements?: readonly Placement[];
  /** Distance between the anchor and the label box edge, instead of `PlaceOptions.gap`. */
  gap?: number;
  /** Half-size of the obstacle this input makes for other labels, instead of `PlaceOptions.markerRadius`; 0 = none. */
  markerRadius?: number;
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
  /** Fixed rectangles (CSS px) that labels must not cover, like the tab of a cluster box. */
  obstacles?: readonly { x0: number; y0: number; x1: number; y1: number }[];
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
    const m = l.markerRadius ?? markerRadius;
    if (m <= 0) continue;
    const r = { x0: l.x - m, y0: l.y - m, x1: l.x + m, y1: l.y + m };
    markerRect.set(l.id, r);
    markers.add(r);
  }

  const score = (l: LabelInput) => l.priority + (previous?.has(l.id) ? stickiness : 0);
  const ordered = [...visible].sort(
    (a, b) => Number(!!b.forced) - Number(!!a.forced) || score(b) - score(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  const placed = new RectGrid();
  for (const o of opts.obstacles ?? []) placed.add({ x0: o.x0 - padding, y0: o.y0 - padding, x1: o.x1 + padding, y1: o.y1 + padding });
  const out: PlacedLabel[] = [];
  const inside = (r: Rect) =>
    r.x0 >= edgeMargin && r.y0 >= edgeMargin && r.x1 <= width - edgeMargin && r.y1 <= height - edgeMargin;

  for (const l of ordered) {
    const own = l.placements ?? placements;
    const g = l.gap ?? gap;
    const prev = previous?.get(l.id);
    const order = prev && own.includes(prev) ? [prev, ...own.filter((p) => p !== prev)] : own;
    let chosen: { p: Placement; r: Rect } | null = null;
    for (const p of order) {
      const r = boxFor(l, p, g);
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
      chosen = { p, r: boxFor(l, p, g) };
    }
    if (!chosen) continue;
    placed.add({ x0: chosen.r.x0 - padding, y0: chosen.r.y0 - padding, x1: chosen.r.x1 + padding, y1: chosen.r.y1 + padding });
    out.push({ id: l.id, placement: chosen.p, x: chosen.r.x0, y: chosen.r.y0 });
  }
  return out;
}


/**
 * Priority a label needs to be shown (unless selected or focused). Starts high on the whole-globe view and
 * falls linearly to 0 by `fullZoom`, so zooming in reveals progressively less important places.
 */
export function labelPriorityFloor(zoom: number, minZoom: number, fullZoom: number, maxFloor = 60): number {
  const t = fullZoom > minZoom ? Math.min(1, Math.max(0, (zoom - minZoom) / (fullZoom - minZoom))) : 1;
  return maxFloor * (1 - t);
}
