/**
 * The click and hover target of a node of the map (pure, unit tested), shared by the Three.js globe and the street overlay
 * through `BoxScene.hit`, so the two pick exactly what they draw.
 *
 * A node is a rectangle (its box) with a label plate just above the top edge, left-justified on the left edge. Its target is
 * the CONVEX HULL of the two, grown by a few pixels of slop: the box itself, the label, and the gap between them. The gap is
 * real when the label is wider than the box (a small box with a long name): the hull fills the triangle under the label's
 * right end, between the box's top-right corner, the label's bottom-right corner and the box's right edge, so the pointer can
 * travel from the label to the box without leaving the target. Hover over the whole target shows the pointer cursor and the
 * hover state; a click on it selects the node.
 *
 * A BIG box (wider or taller than `HIT.bigBoxFrac` of the smaller side of the map) is an outline you are inside, not an object:
 * its interior is not a target (a click there is a click on the map), only its border band and its label are.
 *
 * Overlaps (a group's box over its children, two neighbours): of the targets that contain the point (distance 0) the SMALLEST
 * wins, so the innermost, most specific node is chosen and a group never steals a click on a place inside it; when none
 * contains it, the NEAREST target within the slop wins (then the smallest, then the highest priority, then the slug, so the
 * answer never depends on the order of the nodes). A node that is almost faded out is not a target (`LOD.pickAlphaMin`).
 *
 * Touch: the slop is larger so that a target is about 44 CSS px across (a minimum box is 22 px, its label adds height).
 */
export type PointerKind = "mouse" | "touch";

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Slop (CSS px grown around the target), the band of a big box's outline, and what counts as a big box. */
export const HIT = {
  slop: { mouse: 4, touch: 14 },
  /** Half width of the band along a box's outline that is a target even when the interior is not. */
  band: { mouse: 6, touch: 12 },
  /** A box wider or taller than this fraction of the smaller side of the map has no interior target (it opens at 0.45, `LOD.boxMaxFrom`). */
  bigBoxFrac: 0.45,
} as const;

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Convex hull (Andrew's monotone chain, counter-clockwise in a y-up frame, i.e. clockwise on screen) of points; collinear points are dropped. */
export function convexHull(points: readonly Point[]): Point[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

const corners = (r: Rect): Point[] => [
  { x: r.x0, y: r.y0 },
  { x: r.x1, y: r.y0 },
  { x: r.x1, y: r.y1 },
  { x: r.x0, y: r.y1 },
];

/** The convex hull of a box and its label plate (the box alone without a plate). */
export function nodeHull(box: Rect, plate: Rect | null): Point[] {
  return convexHull(plate ? [...corners(box), ...corners(plate)] : corners(box));
}

/** Distance from a point to a convex polygon (0 inside or on it). `poly` is the output of `convexHull`. */
export function distanceToHull(x: number, y: number, poly: readonly Point[]): number {
  const n = poly.length;
  if (n === 0) return Infinity;
  if (n === 1) return Math.hypot(x - poly[0]!.x, y - poly[0]!.y);
  let inside = n >= 3;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    if (inside && cross(a, b, { x, y }) < 0) inside = false; // right of an edge of a counter-clockwise polygon
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
    const d = Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
    if (d < best) best = d;
  }
  return inside ? 0 : best;
}

/** Distance in CSS px from a point to the OUTLINE of a rectangle (0 on it; inside or outside, the distance to the nearest edge). */
export function outlineDistance(x: number, y: number, r: Rect): number {
  const inX = x >= r.x0 && x <= r.x1;
  const inY = y >= r.y0 && y <= r.y1;
  if (inX && inY) return Math.min(x - r.x0, r.x1 - x, y - r.y0, r.y1 - y);
  const dx = x < r.x0 ? r.x0 - x : x > r.x1 ? x - r.x1 : 0;
  const dy = y < r.y0 ? r.y0 - y : y > r.y1 ? y - r.y1 : 0;
  return Math.hypot(dx, dy);
}

const rectDistance = (x: number, y: number, r: Rect) => {
  const dx = x < r.x0 ? r.x0 - x : x > r.x1 ? x - r.x1 : 0;
  const dy = y < r.y0 ? r.y0 - y : y > r.y1 ? y - r.y1 : 0;
  return Math.hypot(dx, dy);
};

/** What `pickNode` needs of a drawn node. */
export interface Target {
  id: number;
  /** The rectangle (CSS px, whole cells). */
  box: Rect;
  /** The label plate, null when the label is not drawn (the hull is then the box alone). */
  plate: Rect | null;
  /** The node's opacity: below `minAlpha` it is not a target. */
  alpha: number;
  priority: number;
  /** A big box: no interior target, only its border band and its label. */
  big: boolean;
  slug: string;
}

/** Whether a box is big for a map of `mapMinSide` CSS px on its smaller side. */
export const isBigBox = (box: Rect, mapMinSide: number): boolean => Math.max(box.x1 - box.x0, box.y1 - box.y0) > HIT.bigBoxFrac * mapMinSide;

/** Distance in CSS px from a point to a node's target before the slop (0 = on it). */
export function targetDistance(x: number, y: number, t: Target, kind: PointerKind): number {
  if (!t.big) return distanceToHull(x, y, nodeHull(t.box, t.plate));
  const band = Math.max(0, outlineDistance(x, y, t.box) - HIT.band[kind]);
  return t.plate ? Math.min(band, rectDistance(x, y, t.plate)) : band;
}

/** The node under a point (see the header for the rule), or -1. */
export function pickNode(targets: readonly Target[], x: number, y: number, kind: PointerKind, minAlpha: number): number {
  const slop = HIT.slop[kind];
  let best: Target | null = null;
  let bestD = Infinity;
  let bestArea = Infinity;
  for (const t of targets) {
    if (t.alpha < minAlpha) continue;
    const d = targetDistance(x, y, t, kind);
    if (d > slop) continue;
    const area = hullArea(t);
    // inside beats near; inside: the smallest; near: the nearest, then the smallest
    const rank = d === 0 ? 0 : d;
    const better =
      !best ||
      rank < bestD - 1e-9 ||
      (Math.abs(rank - bestD) <= 1e-9 && (area < bestArea - 1e-9 || (Math.abs(area - bestArea) <= 1e-9 && (t.priority > best.priority || (t.priority === best.priority && t.slug < best.slug)))));
    if (better) {
      best = t;
      bestD = rank;
      bestArea = area;
    }
  }
  return best ? best.id : -1;
}

/** Area of a target's box (the tie-break between nested nodes: the smaller is the more specific). */
function hullArea(t: Target): number {
  return (t.box.x1 - t.box.x0) * (t.box.y1 - t.box.y0);
}
