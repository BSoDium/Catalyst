/**
 * HUD label placement (pure, unit tested), ported from the spike and the globe's collision layer
 * (`engine/labels.ts`: priority order, forced ones first, markers are obstacles, stickiness against flicker):
 * boxes sit diagonally off their anchor so a leader line can join them, collision-aware by priority. Marker
 * positions are never moved; only the box moves around its marker, or disappears.
 */
export interface Candidate {
  id: string;
  /** Marker anchor, CSS px (already snapped to an art pixel centre). */
  x: number;
  y: number;
  /** Box size, CSS px. */
  w: number;
  h: number;
  /** Higher wins. */
  priority: number;
  /** Selected / focused: always placed, ahead of everything, even when it overlaps. */
  forced?: boolean;
}

export type Side = "ne" | "nw" | "se" | "sw";

export interface Placed {
  id: string;
  side: Side;
  /** Top-left of the box. */
  left: number;
  top: number;
  w: number;
  h: number;
}

/** Offsets tried in order: up-right (leader line at 45 degrees), up-left, down-right, down-left. */
const SIDES: readonly { side: Side; sx: 1 | -1; sy: 1 | -1 }[] = [
  { side: "ne", sx: 1, sy: -1 },
  { side: "nw", sx: -1, sy: -1 },
  { side: "se", sx: 1, sy: 1 },
  { side: "sw", sx: -1, sy: 1 },
];

interface Rect {
  left: number;
  top: number;
  w: number;
  h: number;
}

const overlaps = (a: Rect, b: Rect, pad: number) =>
  a.left < b.left + b.w + pad && b.left < a.left + a.w + pad && a.top < b.top + b.h + pad && b.top < a.top + a.h + pad;

export interface PlaceOptions {
  /** Distance of the box from the anchor along each axis (leader length). */
  gap?: number;
  /** Clearance between boxes. */
  pad?: number;
  /** Keep boxes this far inside the viewport. */
  margin?: number;
  /** Half-size of the marker footprint that boxes must not cover. */
  markerHalf?: number;
  /** Sides chosen last time: tried first, and shown labels get a priority bonus (no flicker while panning). */
  previous?: ReadonlyMap<string, Side>;
  stickiness?: number;
  /** Markers that have no label (suppressed by priority) but that no label may cover. */
  obstacles?: readonly { id: string; x: number; y: number }[];
}

export function placeLabels(cands: readonly Candidate[], viewport: { w: number; h: number }, opts: PlaceOptions = {}): Placed[] {
  const gap = opts.gap ?? 22;
  const pad = opts.pad ?? 3;
  const margin = opts.margin ?? 4;
  const markerHalf = opts.markerHalf ?? 5;
  const stick = opts.stickiness ?? 8;
  const score = (c: Candidate) => c.priority + (opts.previous?.has(c.id) ? stick : 0);
  const order = [...cands].sort((a, b) => Number(!!b.forced) - Number(!!a.forced) || score(b) - score(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const placed: Placed[] = [];
  const markers = [...cands, ...(opts.obstacles ?? [])].map((c) => ({ id: c.id, left: c.x - markerHalf, top: c.y - markerHalf, w: markerHalf * 2, h: markerHalf * 2 }));

  const boxAt = (c: Candidate, s: (typeof SIDES)[number]): Rect => ({
    left: s.sx > 0 ? c.x + gap : c.x - gap - c.w,
    top: s.sy < 0 ? c.y - gap - c.h : c.y + gap,
    w: c.w,
    h: c.h,
  });

  for (const c of order) {
    const prev = opts.previous?.get(c.id);
    const sides = prev ? [SIDES.find((s) => s.side === prev)!, ...SIDES.filter((s) => s.side !== prev)] : SIDES;
    let choice: Placed | null = null;
    for (const s of sides) {
      const r = boxAt(c, s);
      const inside = r.left >= margin && r.top >= margin && r.left + r.w <= viewport.w - margin && r.top + r.h <= viewport.h - margin;
      if (!inside) continue;
      if (placed.some((p) => overlaps(r, p, pad))) continue;
      if (markers.some((m) => m.id !== c.id && overlaps(r, m, 0))) continue;
      choice = { id: c.id, side: s.side, ...r };
      break;
    }
    if (!choice && c.forced) {
      const s = sides[0]!;
      choice = { id: c.id, side: s.side, ...boxAt(c, s) };
    }
    if (choice) placed.push(choice);
  }
  return placed;
}

/** Snap a CSS-px coordinate to the centre of the art cell that contains it. */
export function snapToCell(v: number, cellCss: number): number {
  return Math.floor(v / cellCss) * cellCss + cellCss / 2;
}
