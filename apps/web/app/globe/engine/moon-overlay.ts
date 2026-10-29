/**
 * The link over the moon (docs/landing.md, "The moon"). The moon itself is an object in the scene (engine/moon-layer.ts); what is here is the page's side of it: one real
 * `<a>` laid over the disc the camera sees it as, round and invisible, so that the keyboard reaches it, a screen reader reads it, the browser's own link behaviour (middle
 * click, "open in a new tab", the status bar) works, and the pointer needs no picking code of its own. Placed after every frame the globe draws (the same frame as the
 * moon, `update`), so it never lags it; it has no clock and no timer of its own.
 *
 * The moon is picked out by a detection box, the look of the map's area boxes (a square round the disc, solid corner arms and dashes between them), drawn once the moon has stayed in the picture a while (`DWELL_MS`), in the map boxes' own tone, and in the ink on hover or focus, which shows the card
 * hung from its top-left corner like a place's label, with what it is, and holds the moon still (`setHeld`) so that it can be clicked. Where the planet hides most of the moon, or the zoom has taken it
 * away, the link is not a target and not a tab stop. Touch has no hover: the first tap shows the card, the card's own link is the second.
 *
 * The look (class names `globe-moon`, `-card`, ...) is app.css's; this file sets only what changes per frame: the position, the size and which side the card is on.
 */
import type { GlobeMoon } from "../types";
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
}

/** The moon is boxed once it has been a target this long (ms): a moon that passes quickly is never boxed. */
export const DWELL_MS = 1500;

/** The glyphs of the card's text before it is read (mono type, so that the scrambled words are as wide as the real ones). */
const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#%&*+=?/<>";
/** How long the words take to come clear when the moon is held, ms; and how often the letters not yet clear change while they do. */
const REVEAL_MS = 520;
const CHURN_MS = 45;

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
  private paintedAt = 0;
  private mark: SVGElement;
  private closeTimer = 0;
  private open = false;
  private touched = false;
  private shown = false;
  private disposed = false;
  private at: { x: number; y: number; r: number; angle: number; unhidden: number; drawn: number; box: { x: number; y: number; w: number; h: number } } | null = null;

  constructor(
    private root: HTMLElement,
    moon: GlobeMoon,
    private frame: () => MoonFrame | null,
    private setHeld: (on: boolean) => void,
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
    body.textContent = moon.description;
    text.append(title, body);
    this.words = { title, body, titleText: moon.title, bodyText: moon.description };
    this.mark = arrow(doc);
    this.paint();
    card.append(text, this.mark);

    // the box is drawn under the card, over the (invisible) link; it has no pointer of its own
    this.box = box(doc);
    link.append(this.box.svg, card);
    root.append(link);

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
  }

  private hide() {
    if (!this.shown) return;
    this.shown = false;
    this.link.hidden = true;
    this.dwell(false);
    this.setOpen(false);
  }

  /** Put the card by the box, as a map label sits by its box (`cardPlace`). The link is a little larger than the moon (a finger's width), so the card is placed from the moon's own edge, not the link's. */
  private placeCard() {
    const at = this.at;
    if (!at) return;
    const card = this.card;
    const place = cardPlace(at.box, card.offsetWidth, card.offsetHeight, this.root.clientWidth, this.root.clientHeight);
    card.dataset.side = place.side;
    // measured from the link's top-left corner (the moon is at its middle, `at.r` is its half side)
    card.style.transform = `translate3d(${place.x - (at.x - at.r)}px, ${place.y - (at.y - at.r)}px, 0)`;
  }

  private setOpen(on: boolean) {
    if (on === this.open) return;
    this.open = on;
    if (on) this.link.dataset.open = "";
    else {
      delete this.link.dataset.open;
      this.touched = false;
    }
    if (on) this.placeCard();
    this.reveal(on ? 1 : 0);
    this.setHeld(on);
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
    this.link.remove();
  }
}
