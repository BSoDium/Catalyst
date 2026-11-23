/**
 * Where the activity picture's day card goes, and the connector that ties it to the hovered column (owner, 2026-11-23). Pure, in CSS pixels of the picture; `components/activity-panel.tsx` draws it.
 *
 * The card stays CLOSE to its column but not on it: it is placed above it (the connector leaving the middle of the outline's top edge and going straight up) or, where that does not fit, at 45 degrees up or down to the right or to the
 * left (the connector leaving the outline's PROTRUDING corner, the vertex furthest that way, so that it never reads as the continuation of an edge of the outline: a tangent). A place fits when the card lies inside the picture (a little
 * above it is allowed) and neither the card nor the connector crosses the page's figures. The card glides to its place slowly (the panel), so that it does not follow every day of a sweeping pointer; the connector, from the outline to
 * the card's CURRENT place, is what moves.
 */
export const CARD_W = 240;
const GAP = 48; // the card above the column: its foot this far over the outline's top
const DIAG = 48; // the card at 45 degrees: its attach point this far over and across from the corner
const ATTACH = 24; // (the level of the card's date line, where a side connector enters)

export type Pt = [number, number];
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Mode = "top" | "bottom" | "right" | "left";
export interface Plan {
  mode: Mode;
  /** Which of the places this is (`mode` and the corner it leaves from): what the next plan prefers. */
  key: string;
  /** Where the connector leaves the outline. */
  from: Pt;
  /** The card's top left corner. */
  x: number;
  y: number;
}

export function parseOutline(outline: string): Pt[] {
  return outline
    .split(" ")
    .map((q) => q.split(",").map(Number) as Pt)
    .filter((q) => q.length === 2 && Number.isFinite(q[0]) && Number.isFinite(q[1]));
}

export const bounds = (pts: Pt[]): Rect => {
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};

export const grow = (r: Rect, m: number): Rect => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });
export const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const rectOf = (a: Pt, b: Pt): Rect => ({ x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) });

/** The middle of the outline's top (or bottom) edge: the mean x of the vertices on it. */
function edgeMid(pts: Pt[], top: boolean): Pt {
  const y = top ? Math.min(...pts.map((q) => q[1])) : Math.max(...pts.map((q) => q[1]));
  const on = pts.filter((q) => Math.abs(q[1] - y) <= 4);
  return [on.reduce((s, q) => s + q[0], 0) / on.length, y];
}

/** The vertex furthest towards (side, v): the corner that protrudes that way. */
function corner(pts: Pt[], side: number, v: number): Pt {
  const score = (q: Pt) => side * q[0] + v * q[1];
  // (a tie goes to the one further out sideways: the corner of a chamfer, not the end of the edge before it)
  return pts.reduce((m, q) => (score(q) > score(m) || (score(q) === score(m) && side * q[0] > side * m[0]) ? q : m));
}

/** The card's place, by the order of preference above; `view` is the picture's size, `figures` the grid of the page's figures (or null) and `h` the card's height. */
export function plan(outline: string, view: { width: number; height: number }, figures: Rect | null, h: number, prefer?: string): Plan | null {
  const pts = parseOutline(outline);
  if (!pts.length) return null;
  const W = view.width || 1e9;
  const inView = (r: Rect) => r.x >= 4 && r.x + r.w <= W - 4 && r.y >= -48 && r.y + r.h <= view.height + 48;
  const cands: Plan[] = [];
  const topMid = edgeMid(pts, true);
  const botMid = edgeMid(pts, false);
  const cx = Math.min(Math.max(topMid[0] - CARD_W / 2, 4), W - CARD_W - 4);
  cands.push({ mode: "top", key: "top", from: topMid, x: cx, y: topMid[1] - GAP - h });
  for (const [mode, side, v] of [["right", 1, -1], ["left", -1, -1], ["right", 1, 1], ["left", -1, 1]] as const) {
    const s = corner(pts, side, v);
    const ex = s[0] + side * DIAG;
    cands.push({ mode, key: `${mode}${v}`, from: s, x: side === 1 ? ex : ex - CARD_W, y: s[1] + v * DIAG - ATTACH });
  }
  const bx = Math.min(Math.max(botMid[0] - CARD_W / 2, 4), W - CARD_W - 4);
  cands.push({ mode: "bottom", key: "bottom", from: botMid, x: bx, y: botMid[1] + GAP });
  const fits = (c: Plan) => {
    const card: Rect = { x: c.x, y: c.y, w: CARD_W, h };
    if (!inView(card)) return false;
    if ((c.mode === "top" || c.mode === "bottom") && (c.from[0] < c.x + 12 || c.from[0] > c.x + CARD_W - 12)) return false;
    if (figures) {
      if (overlaps(grow(card, 10), figures)) return false;
      const e = connector(c.mode, c.from, { x: c.x, y: c.y, w: CARD_W, h })[1];
      if (overlaps(grow(rectOf(c.from, e), 3), figures)) return false;
    }
    return true;
  };
  // (the place the card had stays the first choice while it still fits: a column a little higher or lower must not send the card across to another side)
  const first = prefer ? cands.filter((c) => c.key === prefer) : [];
  return [...first, ...cands].find(fits) ?? cands[0] ?? null;
}

/** The connector's two ends: where it leaves the outline and where it enters the card (its foot or its side). */
function connector(mode: Mode, from: Pt, card: Rect): [Pt, Pt] {
  if (mode === "top") return [from, [Math.min(Math.max(from[0], card.x + 12), card.x + card.w - 12), card.y + card.h]];
  if (mode === "bottom") return [from, [Math.min(Math.max(from[0], card.x + 12), card.x + card.w - 12), card.y]];
  return [from, [mode === "right" ? card.x : card.x + card.w, card.y + ATTACH]];
}

/**
 * The connector's path from the outline to the card where it is NOW (the card glides): straight and 45 degrees, like a textbook's labels. At the side: 45 degrees until level with the entry, then flat (or straight along first
 * when the card is nearly above). Over or under: straight up, then 45 degrees into the foot where the card's middle is not over the edge's middle.
 */
export function route(mode: Mode, from: Pt, card: Rect): string {
  const [s, e] = connector(mode, from, card);
  const D = Math.abs(e[0] - s[0]);
  const V = Math.abs(e[1] - s[1]);
  const sx = Math.sign(e[0] - s[0]) || 1;
  const sy = Math.sign(e[1] - s[1]) || 1;
  const f = (n: number) => Math.round(n * 100) / 100;
  const M = (p: Pt) => `${f(p[0])} ${f(p[1])}`;
  if (mode === "right" || mode === "left") {
    if (D >= V) return `M${M(s)}L${M([s[0] + sx * V, e[1]])}L${M(e)}`;
    return `M${M(s)}L${M([s[0], s[1] + sy * (V - D)])}L${M(e)}`;
  }
  if (V >= D) return `M${M(s)}L${M([s[0], e[1] - sy * D])}L${M(e)}`;
  return `M${M(s)}L${M(e)}`;
}

