/**
 * The link over the moon (docs/landing.md, "The moon"). The moon itself is an object in the scene (engine/moon-layer.ts); what is here is the page's side of it: one real
 * `<a>` laid over the disc the camera sees it as, round and invisible, so that the keyboard reaches it, a screen reader reads it, the browser's own link behaviour (middle
 * click, "open in a new tab", the status bar) works, and the pointer needs no picking code of its own. Placed after every frame the globe draws (the same frame as the
 * moon, `update`), so it never lags it; it has no clock and no timer of its own.
 *
 * The moon is picked out by a detection box, the look of the map's area boxes (a square round the disc, solid corner arms and dashes between them), drawn once the moon has stayed in the picture a while (`DWELL_MS`), in the map boxes' own tone, and in the ink on hover or focus, which shows the card
 * hung from its top-left corner like a place's label, with what it is, and holds the moon still (`setHeld`) so that it can be clicked. Where the planet hides most of the moon, or the zoom has taken it
 * away, the link is not a target and not a tab stop. Touch has no hover: the first tap shows the card (and holds the moon, as hover does), the card's own link is the second. Until that tap the moon goes on along its orbit, box and all: nothing has
 * been interacted with yet. On a touch screen the card keeps its two lines but says the second in fewer words (`GlobeMoon.shortDescription`) so that it is not as wide as the window, and a tap anywhere else puts it away.
 *
 * The look (class names `globe-moon`, `-card`, ...) is app.css's; this file sets only what changes per frame: the position, the size and which side the card is on.
 */
import type { GlobeMoon } from "../types";
import { clock, phaseName } from "./moon-hud";
import { MOON } from "./moon";
import { dashingFor, edgeLit } from "./pixel-labels";

/** What the globe tells the overlay each time it is asked (the renderer's `moonFrame`), in the container's CSS px. */
export interface MoonFrame {
  x: number;
  y: number;
  r: number;
  amount: number;
  unhidden: number;
  angle: number;
  /** The art grid the moon is drawn on: its centre and radius in cells (y down), the box of what the planet leaves of it (null: nothing), the cell's size in CSS px and the grid's origin in the container's CSS px. */
  grid: { col: number; row: number; rad: number; visible: { x0: number; y0: number; x1: number; y1: number } | null; cell: number; left: number; top: number };
  /** The colour of a box at rest on the map (the palette's `peak` level), as a CSS colour: the moon's box is drawn in it. */
  tone: string;
  /** The orbit display's data (#586), only while it is asked for (`setHud`): the orbit as points in these same px (null where it is behind the camera), its marks, the phase, the earth's shadow ahead. */
  hud?: {
    orbit: Array<[number, number] | null>;
    ticks: { deg: number; at: [number, number] | null }[];
    lit: number;
    waxing: boolean;
    angleDeg: number;
    info: { range: number; inclDeg: number; phaseDeg: number };
    eclipse: { now: boolean; fromAngle: number | null; peakAngle: number | null; at: [number, number] | null; peakAt: [number, number] | null };
  } | undefined;
}

/** The moon is boxed once it has been a target this long (ms): a moon that passes quickly is never boxed. */
export const DWELL_MS = 1500;

/** The glyphs of the card's text before it is read (mono type, so that the scrambled words are as wide as the real ones). */
const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#%&*+=?/<>";
/** How long the words take to come clear when the moon is held, ms; and how often the letters not yet clear change while they do. */
const REVEAL_MS = 520;
const CHURN_MS = 45;
/** Once read, the words stay clear this long (ms) after the moon is let go of, and then scramble again. */
export const READ_MS = 5000;

/**
 * `text` with its first `reveal` (0..1) share of letters as they are and the rest as random glyphs, spaces kept (so that the words wrap where the real ones do). Pure with `rand` given
 * (a function of 0..1), unit tested.
 */
export function scramble(text: string, reveal: number, rand: () => number = Math.random): string {
  const clear = Math.round(Math.min(1, Math.max(0, reveal)) * text.length);
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    out += i < clear || c === " " ? c : GLYPHS[Math.min(GLYPHS.length - 1, Math.floor(rand() * GLYPHS.length))];
  }
  return out;
}

/** The box's clear room round the moon's disc, in whole cells (6 to 7.5 px). */
export const BOX_PAD_CELLS = 3;

/** The moon's box in whole cells of the art grid (`c0 .. c1 - 1`, `r0 .. r1 - 1`): the disc's cells and `BOX_PAD_CELLS` of room, so it snaps as the map's own boxes do. */
export function moonBox(g: MoonFrame["grid"]): { c0: number; r0: number; c1: number; r1: number } {
  // where the planet hides part of the moon the box fits what is left of it, not the whole disc
  const v = g.visible ?? { x0: g.col - g.rad, y0: g.row - g.rad, x1: g.col + g.rad, y1: g.row + g.rad };
  return {
    c0: Math.floor(v.x0) - BOX_PAD_CELLS,
    r0: Math.floor(v.y0) - BOX_PAD_CELLS,
    c1: Math.ceil(v.x1) + BOX_PAD_CELLS,
    r1: Math.ceil(v.y1) + BOX_PAD_CELLS,
  };
}

/** The card closes this long after the pointer leaves, so that a pointer going from the moon to the card does not close it. */
const CLOSE_MS = 160;
/** The gap between the box and its card (a map label's own `boxGap` is 3), and the card's distance to the window's edge. */
const GAP = 3;
/** The card's own padding on its left (app.css `.globe-moon-card`): it hangs this far out of the box, so that the TEXT is flush with the box's left edge, as a map label's is. */
const CARD_PAD_X = 6;
const EDGE = 8;
/** The link is never smaller than this (CSS px, a finger's width): the moon in the background is a small thing and the target should not be. */
const MIN_TARGET = 44;
/** Below this much of the moon visible (planet in front of it) or let through by the zoom, the link is not a target. */
const LIVE = 0.6;

/**
 * The link's mark: the icon set's `arrow-up-right` (lucide's path, with the set's own square ends: `.ui-icon`, app.css) drawn thin, a station sign's arrow for a way out:
 * a stem and a right-angled head. Built here because the globe imports nothing from the app; it is decoration (`aria-hidden`: the link's name is the words).
 */
function arrow(doc: Document): SVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(NS, "svg");
  // (the arrow fills its box, edge to edge, so that its height is the box's: the card sizes it to the words' height, square: it keeps its shape)
  svg.setAttribute("viewBox", "0 0 10 10");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "ui-icon globe-moon-arrow");
  svg.dataset.size = "inline";
  // the mark of a link, and the one it wears while its words are unread: an unknown (a blocky question mark, the same weight and square ends); `data-glyph` says which is up
  for (const [glyph, d] of [
    ["arrow", "M0 0h10v10M0 10 10 0"],
    ["unknown", "M0 3.5V0h10v5H5v2M5 8.5V10"],
  ] as const) {
    const path = doc.createElementNS(NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("class", `globe-moon-glyph-${glyph}`);
    svg.append(path);
  }
  svg.dataset.glyph = "unknown";
  return svg;
}

/**
 * The box's drawing for a box of `w x h` CELLS, as a path in cell units (one cell is a unit square): a one-cell outline, the corners solid and the rest of each edge dashed, each edge
 * anchored to a corner (the top at its left, the right at its top...), exactly the map's own boxes (`drawBox`, engine/pixel-labels.ts: the same `dashingFor` and `edgeLit`).
 */
export function boxPath(w: number, h: number): string {
  const dash = dashingFor(w, h);
  let d = "";
  const run = (x: number, y: number, n: number, horizontal: boolean) => (d += horizontal ? `M${x} ${y}h${n}v1h${-n}z` : `M${x} ${y}h1v${n}h-1z`);
  // `lit(k)` for the cell k of a line from `from`, merged into runs
  const line = (n: number, lit: (k: number) => boolean, at: (k: number) => [number, number], horizontal: boolean, from = 0, to = n) => {
    let start = -1;
    for (let k = from; k <= to; k++) {
      const on = k < to && lit(k);
      if (on && start < 0) start = k;
      if (!on && start >= 0) {
        const [x, y] = at(start);
        run(x, y, k - start, horizontal);
        start = -1;
      }
    }
  };
  line(w, (i) => edgeLit(i, w, false, dash), (i) => [i, 0], true); // top, anchored at its left corner
  if (h > 1) line(w, (i) => edgeLit(w - 1 - i, w, false, dash), (i) => [i, h - 1], true); // bottom, at its right corner
  line(h, (j) => edgeLit(j, h, false, dash), (j) => [0, j], false, 1, h - 1); // left, at its top
  if (w > 1) line(h, (j) => edgeLit(h - 1 - j, h, false, dash), (j) => [w - 1, j], false, 1, h - 1); // right, at its bottom
  return d;
}

function box(doc: Document): { svg: SVGElement; path: SVGElement } {
  const NS = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(NS, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "globe-moon-box");
  const path = doc.createElementNS(NS, "path");
  svg.append(path);
  return { svg, path };
}

/**
 * Where the card goes (the window's coordinates, its top-left corner): where a map label sits by its box, ABOVE the box's top-left corner with its text flush with the box's left edge;
 * where there is no room above, BELOW the box, the same way. Always inside the window. `box` is the box's rectangle, `w` and `h` the card's size, `width` and `height` the window's.
 */
export function cardPlace(box: { x: number; y: number; w: number; h: number }, w: number, h: number, width: number, height: number): { side: "above" | "below"; x: number; y: number } {
  const x = Math.min(Math.max(box.x - CARD_PAD_X, EDGE), Math.max(EDGE, width - w - EDGE));
  const above = box.y - GAP - h;
  if (above >= EDGE) return { side: "above", x, y: above };
  const below = box.y + box.h + GAP;
  if (below + h <= height - EDGE) return { side: "below", x, y: below };
  return { side: "above", x, y: Math.max(EDGE, above) }; // no room anywhere: inside the window, over the box if it must
}

/** The orbit as SVG path data: runs of consecutive points, a run broken where the orbit is behind the camera. */
export function orbitPath(points: ReadonlyArray<[number, number] | null>): string {
  let d = "";
  let pen = false;
  for (const p of points) {
    if (!p) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
    pen = true;
  }
  return d;
}

/** The readout's lines (the orbit display's text): the phase, the place on the orbit, the shadow. */
export function hudLines(h: NonNullable<MoonFrame["hud"]>): string[] {
  const shadow = h.eclipse.now ? "ECLIPSE UNDER WAY" : h.eclipse.fromAngle === null ? "NO ECLIPSE ON THIS ORBIT" : `ECLIPSE IN ${clock((h.eclipse.fromAngle / (2 * Math.PI)) * MOON.periodMs)}`;
  return [`PHASE ${String(Math.round(h.lit * 100)).padStart(3, "0")}% ${phaseName(h.lit, h.waxing).toUpperCase()}`, `ORBIT ${String(Math.round(h.angleDeg) % 360).padStart(3, "0")}\u00b0`, shadow];
}

/** The orbit display's fade (app.css `.globe-moon-hud`), ms: the globe goes on feeding it frames this long after the card is put away. */
const HUD_FADE_MS = 400;

const SVG_NS = "http://www.w3.org/2000/svg";

type Hud = NonNullable<MoonFrame["hud"]>;

/** The longest run of the orbit that is in view, as points, left to right (the text runs along it and reads the right way up). */
export function longestRun(points: ReadonlyArray<[number, number] | null>): [number, number][] {
  let best: [number, number][] = [];
  let run: [number, number][] = [];
  const close = () => {
    if (run.length > best.length) best = run;
    run = [];
  };
  for (const p of points) (p ? run.push(p) : close());
  close();
  return best.length > 1 && best[0]![0] > best[best.length - 1]![0] ? [...best].reverse() : best;
}

/** The two lines of data that run along the orbit, above it and below it. Real numbers: the orbit's own, the moon's now, the shadow's. */
export function pathLines(h: Hud): [string, string] {
  const sep = "  //  ";
  const degAt = (ahead: number | null) => (ahead === null ? "---" : String(Math.round(((h.angleDeg + (ahead * 180) / Math.PI) % 360 + 360) % 360)).padStart(3, "0"));
  const above = ["LUNA ORBIT", `RADIUS ${MOON.orbit.toFixed(1)} ER`, `INCL ${h.info.inclDeg.toFixed(1)}\u00b0`, `PERIOD ${clock(MOON.periodMs)}`, `ANG VEL ${(360 / (MOON.periodMs / 1000)).toFixed(2)}\u00b0/S`, `RANGE ${h.info.range.toFixed(2)} ER`].join(sep);
  const e = h.eclipse;
  const shadow = e.now ? `UMBRA ENTERED AT ${degAt(0)}\u00b0` : e.fromAngle === null ? "SHADOW NOT ON PATH" : `SHADOW AT ${degAt(e.fromAngle)}\u00b0 PEAK ${degAt(e.peakAngle)}\u00b0`;
  const below = [`PHASE ANGLE ${String(Math.round(h.info.phaseDeg)).padStart(3, "0")}\u00b0`, `ILLUM ${(h.lit * 100).toFixed(1)}%`, shadow, e.now ? "ECLIPSE UNDER WAY" : e.fromAngle === null ? "NO ECLIPSE" : `T-${clock((e.fromAngle / (2 * Math.PI)) * MOON.periodMs)}`].join(sep);
  return [`${above}${sep}${above}${sep}`, `${below}${sep}${below}${sep}`];
}

/**
 * The orbit display (#586): where the moon goes round the planet, drawn like a spaceship's screen. The LINES are pixel art, on a canvas of the map's own cells (a dashed, low-contrast line, a short stroke
 * every 30 degrees, a bracket where the earth's shadow begins), so that they are as coarse as the rest of the map; the WORDS are SVG text, at the screen's resolution: the numbers at the marks, two lines of
 * data running along the path above it and below it, and a readout hung from the moon's box. Drawn while the card is held and for the fade after it; in the container's px (the frame's), a decoration: the
 * link's own name carries the words. Its look is app.css's (`.globe-moon-hud`).
 */
class OrbitHud {
  readonly svg: SVGSVGElement;
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private defs: SVGDefsElement;
  private route: SVGPathElement;
  private along: [SVGTextPathElement, SVGTextPathElement];
  private marks: SVGGElement;
  private readout: SVGTextElement;
  private routeKey = "";

  constructor(doc: Document, uid: string) {
    const canvas = (this.canvas = doc.createElement("canvas"));
    canvas.className = "globe-moon-hud-pixels";
    canvas.setAttribute("aria-hidden", "true");
    this.ctx = typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
    const svg = (this.svg = doc.createElementNS(SVG_NS, "svg") as SVGSVGElement);
    svg.setAttribute("class", "globe-moon-hud");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    this.defs = doc.createElementNS(SVG_NS, "defs") as SVGDefsElement;
    this.route = doc.createElementNS(SVG_NS, "path") as SVGPathElement;
    this.route.setAttribute("id", `${uid}-route`);
    this.defs.append(this.route);
    const text = (cls: string) => {
      const t = doc.createElementNS(SVG_NS, "text");
      t.setAttribute("class", cls);
      const tp = doc.createElementNS(SVG_NS, "textPath") as SVGTextPathElement;
      tp.setAttribute("href", `#${uid}-route`);
      t.append(tp);
      return { t, tp };
    };
    const above = text("globe-moon-hud-along");
    const below = text("globe-moon-hud-along globe-moon-hud-along-below");
    above.t.setAttribute("dy", "-7");
    below.t.setAttribute("dy", "15");
    this.along = [above.tp, below.tp];
    this.marks = doc.createElementNS(SVG_NS, "g") as SVGGElement;
    this.readout = doc.createElementNS(SVG_NS, "text") as SVGTextElement;
    this.readout.setAttribute("class", "globe-moon-hud-readout");
    svg.append(this.defs, above.t, below.t, this.marks, this.readout);
  }

  /** Visible or not (the fade is CSS). */
  show(on: boolean): void {
    if (on) {
      this.svg.dataset.on = "";
      this.canvas.dataset.on = "";
    } else {
      delete this.svg.dataset.on;
      delete this.canvas.dataset.on;
    }
  }

  /** Draw `h` (the frame's orbit data); the readout hangs from `box` on the side `card` is not (`side` is the card's); `g` is the art grid, `size` the container's. */
  draw(h: Hud, box: { x: number; y: number; w: number; h: number }, side: "above" | "below", g: MoonFrame["grid"], size: { w: number; h: number }, tone: string): void {
    const doc = this.svg.ownerDocument;
    this.pixels(h, g, size, tone);

    // the words along the path: the longest run in view, left to right
    const run = longestRun(h.orbit);
    const d = orbitPath(run);
    if (d !== this.routeKey) {
      this.routeKey = d;
      this.route.setAttribute("d", d);
    }
    const [a, b] = pathLines(h);
    if (this.along[0].textContent !== a) this.along[0].textContent = a;
    if (this.along[1].textContent !== b) this.along[1].textContent = b;

    // the numbers at the marks, on the side of the line that is up
    const marks = this.marks;
    marks.replaceChildren();
    const orbit = h.orbit.filter((p): p is [number, number] => p !== null);
    for (const k of h.ticks) {
      if (!k.at || orbit.length < 2) continue;
      const [x, y] = k.at;
      const [nx, ny] = this.normal(orbit, x, y);
      const label = doc.createElementNS(SVG_NS, "text");
      label.setAttribute("class", "globe-moon-hud-number");
      label.setAttribute("x", (x + nx * 24).toFixed(1));
      label.setAttribute("y", (y + ny * 24 + 3).toFixed(1));
      label.setAttribute("text-anchor", "middle");
      label.textContent = String(k.deg).padStart(3, "0");
      marks.append(label);
    }
    const e = h.eclipse;
    if (e.at) {
      const name = doc.createElementNS(SVG_NS, "text");
      name.setAttribute("class", "globe-moon-hud-number globe-moon-hud-eclipse");
      name.setAttribute("x", (e.at[0] + 12).toFixed(1));
      name.setAttribute("y", (e.at[1] + 3).toFixed(1));
      name.textContent = "UMBRA";
      marks.append(name);
    }

    // the readout, one line under the other, on the side of the box that the card is not on
    const lines = hudLines(h);
    this.readout.replaceChildren();
    const y0 = side === "above" ? box.y + box.h + 14 : box.y - 8 - (lines.length - 1) * 13;
    lines.forEach((line, i) => {
      const t = doc.createElementNS(SVG_NS, "tspan");
      t.setAttribute("x", box.x.toFixed(1));
      t.setAttribute("y", (y0 + i * 13).toFixed(1));
      t.textContent = line;
      this.readout.append(t);
    });
  }

  /** The unit normal of the orbit at the point nearest (x, y), pointing up the screen. */
  private normal(orbit: [number, number][], x: number, y: number): [number, number] {
    let nearest = 0;
    let best = Infinity;
    orbit.forEach((p, i) => {
      const dd = Math.hypot(p[0] - x, p[1] - y);
      if (dd < best) {
        best = dd;
        nearest = i;
      }
    });
    const a = orbit[Math.max(0, nearest - 1)]!;
    const c = orbit[Math.min(orbit.length - 1, nearest + 1)]!;
    let nx = -(c[1] - a[1]);
    let ny = c[0] - a[0];
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    return ny > 0 ? [-nx, -ny] : [nx, ny];
  }

  /** The lines, in cells: a dashed low-contrast orbit, a stroke at each mark and a bracket at the shadow. */
  private pixels(h: Hud, g: MoonFrame["grid"], size: { w: number; h: number }, tone: string): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const cols = Math.max(1, Math.ceil(size.w / g.cell));
    const rows = Math.max(1, Math.ceil(size.h / g.cell));
    const c = this.canvas;
    if (c.width !== cols || c.height !== rows) {
      c.width = cols;
      c.height = rows;
    }
    c.style.left = `${g.left}px`;
    c.style.top = `${g.top}px`;
    c.style.width = `${cols * g.cell}px`;
    c.style.height = `${rows * g.cell}px`;
    ctx.clearRect(0, 0, cols, rows);
    ctx.fillStyle = tone;
    const cell = (p: [number, number]): [number, number] => [Math.floor((p[0] - g.left) / g.cell), Math.floor((p[1] - g.top) / g.cell)];
    const dot = (x: number, y: number) => {
      if (x >= 0 && y >= 0 && x < cols && y < rows) ctx.fillRect(x, y, 1, 1);
    };
    const line = (a: [number, number], b: [number, number], on: (k: number) => boolean) => {
      let [x0, y0] = a;
      const [x1, y1] = b;
      const dx = Math.abs(x1 - x0);
      const dy = -Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1;
      const sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      let k = 0;
      for (let guard = 0; guard < 4000; guard++) {
        if (on(k++)) dot(x0, y0);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) {
          err += dy;
          x0 += sx;
        }
        if (e2 <= dx) {
          err += dx;
          y0 += sy;
        }
      }
    };
    // the orbit: two cells lit, three dark, the count running on from one segment to the next
    ctx.globalAlpha = 0.42;
    let step = 0;
    let prev: [number, number] | null = null;
    for (const p of h.orbit) {
      if (!p) {
        prev = null;
        continue;
      }
      const q = cell(p);
      if (prev) {
        const from = step;
        line(prev, q, (k) => (from + k) % 5 < 2);
        step += Math.max(Math.abs(q[0] - prev[0]), Math.abs(q[1] - prev[1]));
      }
      prev = q;
    }
    // a stroke across the orbit at each mark (five cells), a little stronger than the line
    ctx.globalAlpha = 0.75;
    const orbit = h.orbit.filter((p): p is [number, number] => p !== null);
    for (const k of h.ticks) {
      if (!k.at || orbit.length < 2) continue;
      const [nx, ny] = this.normal(orbit, k.at[0], k.at[1]);
      const m = cell(k.at);
      const dx = Math.round(nx * 3);
      const dy = Math.round(ny * 3);
      line([m[0] - dx, m[1] - dy], [m[0] + dx, m[1] + dy], () => true);
    }
    // the shadow's bracket: a square, five cells, round where it begins
    const e = h.eclipse;
    if (e.at) {
      ctx.globalAlpha = 1;
      const [mx, my] = cell(e.at);
      for (let i = -3; i <= 3; i++) {
        dot(mx + i, my - 3);
        dot(mx + i, my + 3);
        dot(mx - 3, my + i);
        dot(mx + 3, my + i);
      }
    }
    ctx.globalAlpha = 1;
  }
}

export class MoonOverlay {
  private link: HTMLAnchorElement;
  private card: HTMLElement;
  private box: { svg: SVGElement; path: SVGElement };
  private boxCells = "";
  private tone = "";
  private seenTimer = 0;
  private words: { title: HTMLElement; body: HTMLElement; titleText: string; bodyText: string };
  private revealed = 0;
  private revealRaf = 0;
  private readTimer = 0;
  private sizes = { w: 0, h: 0, rw: 0, rh: 0 };
  private observer: ResizeObserver | null = null;
  private paintedAt = 0;
  private mark: SVGElement;
  private closeTimer = 0;
  private open = false;
  private touched = false;
  private shown = false;
  private disposed = false;
  private hud: OrbitHud;
  private hudTimer = 0;
  private at: { x: number; y: number; r: number; angle: number; unhidden: number; drawn: number; box: { x: number; y: number; w: number; h: number } } | null = null;

  constructor(
    private root: HTMLElement,
    moon: GlobeMoon,
    private frame: () => MoonFrame | null,
    private setHeld: (on: boolean) => void,
    private setHud: (on: boolean) => void = () => {},
  ) {
    const doc = root.ownerDocument;
    const link = (this.link = doc.createElement("a"));
    link.className = "globe-moon";
    link.href = moon.href;
    link.target = "_blank";
    link.rel = "noopener";
    link.hidden = true;
    link.dataset.slot = "globe-moon";
    link.setAttribute("aria-label", `${moon.title}. ${moon.description} ${moon.cta}`);

    const card = (this.card = doc.createElement("span"));
    card.className = "globe-moon-card";
    card.setAttribute("aria-hidden", "true");
    // the words (a name over a second line) and, apart from them, the mark of a link: the card is as high as the words, so the moon is centred on them
    const text = doc.createElement("span");
    text.className = "globe-moon-text";
    const title = doc.createElement("span");
    title.className = "globe-moon-title";
    title.textContent = moon.title;
    const body = doc.createElement("span");
    body.className = "globe-moon-body";
    // (on a touch screen the card is narrow, and says it in fewer words: the link's name, `aria-label`, keeps the long ones)
    const description = this.coarse() ? (moon.shortDescription ?? moon.description) : moon.description;
    body.textContent = description;
    text.append(title, body);
    this.words = { title, body, titleText: moon.title, bodyText: description };
    this.mark = arrow(doc);
    this.paint();
    card.append(text, this.mark);

    // the box is drawn under the card, over the (invisible) link; it has no pointer of its own
    this.box = box(doc);
    link.append(this.box.svg, card);
    root.append(link);
    this.hud = new OrbitHud(doc, `moon-hud-${Math.random().toString(36).slice(2, 8)}`);
    root.append(this.hud.canvas, this.hud.svg);
    if (typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver(() => {
        this.measure();
        if (this.open || "seen" in link.dataset) this.placeCard();
      });
      this.observer.observe(card);
      this.observer.observe(root);
    }

    link.addEventListener("pointerenter", this.onEnter);
    link.addEventListener("pointerleave", this.onLeave);
    link.addEventListener("pointerdown", this.onDown);
    link.addEventListener("click", this.onClick);
    link.addEventListener("focus", this.onFocus);
    link.addEventListener("blur", this.onBlur);
    link.addEventListener("keydown", this.onKey);
  }

  /** Where the moon is on the page now and whether the link is up (checks). */
  state() {
    const r = this.link.getBoundingClientRect();
    return { shown: this.shown, live: this.shown && this.link.tabIndex === 0, open: this.open, x: r.left + r.width / 2, y: r.top + r.height / 2, size: r.width, angle: this.at?.angle ?? 0, unhidden: this.at?.unhidden ?? 0, radius: this.at?.drawn ?? 0 };
  }

  /** The globe drew a frame: put the link where the moon is. */
  update(): void {
    if (this.disposed) return;
    const f = this.frame();
    if (!f || f.amount < 0.02) {
      this.hide();
      return;
    }
    const link = this.link;
    if (!this.shown) {
      this.shown = true;
      link.hidden = false;
    }
    const size = Math.max(MIN_TARGET, f.r * 2);
    link.style.width = link.style.height = `${size}px`;
    link.style.transform = `translate3d(${f.x - size / 2}px, ${f.y - size / 2}px, 0)`;
    // The box is on the art grid, the moon's own: whole cells, from the cell origin, so it steps by a cell as the map's boxes do (the link is where the moon is, to the sub-pixel).
    const g = f.grid;
    const cells = moonBox(g);
    const cols = cells.c1 - cells.c0;
    const rows = cells.r1 - cells.r0;
    const key = `${cols}x${rows}`;
    if (key !== this.boxCells) {
      this.boxCells = key;
      this.box.path.setAttribute("d", boxPath(cols, rows));
      this.box.svg.setAttribute("viewBox", `0 0 ${cols} ${rows}`);
      this.box.svg.style.width = `${cols * g.cell}px`;
      this.box.svg.style.height = `${rows * g.cell}px`;
    }
    const boxX = g.left + cells.c0 * g.cell;
    const boxY = g.top + cells.r0 * g.cell;
    this.box.svg.style.transform = `translate3d(${boxX - (f.x - size / 2)}px, ${boxY - (f.y - size / 2)}px, 0)`;
    // Where the planet is in front of most of it, or the zoom has most of it away, it is not a target (and not a tab stop).
    const live = f.unhidden > LIVE && f.amount > LIVE;
    link.style.pointerEvents = live ? "auto" : "none";
    link.tabIndex = live ? 0 : -1;
    this.dwell(live);
    if (f.tone !== this.tone) {
      this.tone = f.tone;
      link.style.setProperty("--moon-box", f.tone);
    }
    if (!live) this.setOpen(false);
    this.at = { x: f.x, y: f.y, r: size / 2, angle: f.angle, unhidden: f.unhidden, drawn: f.r, box: { x: boxX, y: boxY, w: cols * g.cell, h: rows * g.cell } };
    if (this.open || "seen" in link.dataset) this.placeCard();
    // the orbit display: only while the card is held, and when the frame brought its data
    // (and for its fade out: the globe goes on bringing the data until `setHud(false)`, so the lines follow the camera while they fade)
    if (f.hud) {
      const m = this.sizes.rw > 0 ? this.sizes : this.measure();
      this.hud.draw(f.hud, this.at.box, this.card.dataset.side === "below" ? "below" : "above", f.grid, { w: m.rw, h: m.rh }, f.tone);
      this.hud.show(this.open);
    } else this.hud.show(false);
  }

  /** The moon has been a target for `DWELL_MS` without a break: the box comes in (`data-seen`). It goes as soon as the moon stops being a target. */
  private dwell(live: boolean) {
    if (live) {
      if (!this.seenTimer && !("seen" in this.link.dataset)) {
        this.seenTimer = window.setTimeout(() => {
          this.seenTimer = 0;
          this.link.dataset.seen = "";
          // the card is up with the box, unread: its words scrambled until the moon is held
          this.revealed = this.open ? 1 : 0;
          this.paint();
          this.placeCard();
        }, DWELL_MS);
      }
      return;
    }
    window.clearTimeout(this.seenTimer);
    this.seenTimer = 0;
    delete this.link.dataset.seen;
    // the card goes with the box, and is unread the next time it comes up
    if (this.revealed > 0 || this.readTimer) {
      window.cancelAnimationFrame(this.revealRaf);
      window.clearTimeout(this.readTimer);
      this.readTimer = 0;
      delete this.link.dataset.read;
      this.revealed = 0;
      this.paint();
    }
  }

  private hide() {
    if (!this.shown) return;
    this.shown = false;
    this.link.hidden = true;
    this.dwell(false);
    this.setOpen(false);
  }

  /** The card's and the window's sizes, read when one of them changes (a `ResizeObserver`), not every frame: a read after the frame's writes would force a layout each time. */
  private measure() {
    const s = this.sizes;
    s.w = this.card.offsetWidth;
    s.h = this.card.offsetHeight;
    s.rw = this.root.clientWidth;
    s.rh = this.root.clientHeight;
    return s;
  }

  /** Put the card by the box, as a map label sits by its box (`cardPlace`). The link is a little larger than the moon (a finger's width), so the card is placed from the moon's own edge, not the link's. */
  private placeCard() {
    const at = this.at;
    if (!at) return;
    const card = this.card;
    const m = this.sizes.w > 0 ? this.sizes : this.measure();
    const place = cardPlace(at.box, m.w, m.h, m.rw, m.rh);
    card.dataset.side = place.side;
    // measured from the link's top-left corner (the moon is at its middle, `at.r` is its half side)
    card.style.transform = `translate3d(${place.x - (at.x - at.r)}px, ${place.y - (at.y - at.r)}px, 0)`;
  }

  private setOpen(on: boolean) {
    if (on === this.open) return;
    this.open = on;
    const doc = this.root.ownerDocument;
    if (on && this.coarse()) doc.addEventListener?.("pointerdown", this.onOutside, true);
    else doc.removeEventListener?.("pointerdown", this.onOutside, true);
    window.clearTimeout(this.hudTimer);
    if (on) this.setHud(true);
    else {
      this.hud.show(false);
      this.hudTimer = window.setTimeout(() => this.setHud(false), HUD_FADE_MS + 50);
    }
    if (on) this.link.dataset.open = "";
    else {
      delete this.link.dataset.open;
      this.touched = false;
    }
    if (on) this.placeCard();
    // read: clear while held and for `READ_MS` after it is let go of, then scrambled again
    window.clearTimeout(this.readTimer);
    this.readTimer = 0;
    if (on) {
      this.link.dataset.read = "";
      this.reveal(1);
    } else if (this.revealed > 0) {
      this.readTimer = window.setTimeout(() => this.forget(), READ_MS);
    }
    this.setHeld(on);
  }

  /** A touch screen (no hover): there the card is a pill until it is tapped. */
  private coarse(): boolean {
    return window.matchMedia?.("(hover: none)").matches === true;
  }

  /** A press anywhere but on the moon puts an open card away (touch has no pointer leaving it). */
  private onOutside = (e: Event) => {
    const t = e.target as Node | null;
    if (t && this.link.contains(t)) return;
    this.setOpen(false);
  };

  /** Unread again: the words scramble (the card, if it is still up, shows gibberish once more). */
  private forget() {
    window.clearTimeout(this.readTimer);
    this.readTimer = 0;
    delete this.link.dataset.read;
    this.reveal(0);
  }

  /** The words as they are at `revealed`: the first part clear, the rest scrambled. */
  private paint() {
    const w = this.words;
    w.title.textContent = scramble(w.titleText, this.revealed);
    w.body.textContent = scramble(w.bodyText, this.revealed);
    this.mark.dataset.glyph = this.revealed >= 0.5 ? "arrow" : "unknown";
  }

  /** Run the words to clear (1) or to scrambled (0); at once under reduced motion. The letters not yet clear change every `CHURN_MS`. */
  private reveal(target: 0 | 1) {
    window.cancelAnimationFrame(this.revealRaf);
    this.revealRaf = 0;
    if (this.disposed) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      this.revealed = target;
      this.paint();
      return;
    }
    let last = performance.now();
    const step = (now: number) => {
      const dt = now - last;
      last = now;
      this.revealed = target ? Math.min(1, this.revealed + dt / REVEAL_MS) : Math.max(0, this.revealed - dt / (REVEAL_MS / 2));
      const done = this.revealed === target;
      if (done || now - this.paintedAt >= CHURN_MS) {
        this.paintedAt = now;
        this.paint();
      }
      this.revealRaf = done ? 0 : window.requestAnimationFrame(step);
    };
    this.revealRaf = window.requestAnimationFrame(step);
  }

  private showCard() {
    window.clearTimeout(this.closeTimer);
    this.closeTimer = 0;
    this.setOpen(true);
  }

  private closeCard(delay: number) {
    window.clearTimeout(this.closeTimer);
    this.closeTimer = window.setTimeout(() => {
      this.closeTimer = 0;
      if (!this.link.matches(":focus-visible")) this.setOpen(false);
    }, delay);
  }

  private onEnter = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    this.showCard();
  };
  private onLeave = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    this.closeCard(CLOSE_MS);
  };
  private onDown = (e: PointerEvent) => {
    this.touched = e.pointerType === "touch";
  };
  /** A first tap on a touch screen shows the card; the next is the link. A mouse or the keyboard goes straight through. */
  private onClick = (e: MouseEvent) => {
    if (this.touched && !this.open) {
      e.preventDefault();
      this.showCard();
    }
  };
  private onFocus = () => {
    if (this.link.matches(":focus-visible")) this.showCard();
  };
  private onBlur = () => this.closeCard(0);
  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.open) {
      e.stopPropagation();
      this.setOpen(false);
    }
  };

  dispose(): void {
    this.disposed = true;
    window.clearTimeout(this.closeTimer);
    window.clearTimeout(this.seenTimer);
    window.cancelAnimationFrame(this.revealRaf);
    window.clearTimeout(this.readTimer);
    this.root.ownerDocument.removeEventListener?.("pointerdown", this.onOutside, true);
    this.observer?.disconnect();
    this.link.remove();
    this.hud.svg.remove();
    this.hud.canvas.remove();
    window.clearTimeout(this.hudTimer);
  }
}
