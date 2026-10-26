/**
 * The link over the moon (docs/landing.md, "The moon"). The moon itself is an object in the scene (engine/moon-layer.ts); what is here is the page's side of it: one real
 * `<a>` laid over the disc the camera sees it as, round and invisible, so that the keyboard reaches it, a screen reader reads it, the browser's own link behaviour (middle
 * click, "open in a new tab", the status bar) works, and the pointer needs no picking code of its own. Placed after every frame the globe draws (the same frame as the
 * moon, `update`), so it never lags it; it has no clock and no timer of its own.
 *
 * Hover or focus shows a card with what it is and holds the moon still (`setHeld`) so that it can be clicked. Where the planet hides most of the moon, or the zoom has taken it
 * away, the link is not a target and not a tab stop. Touch has no hover: the first tap shows the card, the card's own link is the second.
 *
 * The look (class names `globe-moon`, `-card`, ...) is app.css's; this file sets only what changes per frame: the position, the size and which side the card is on.
 */
import type { GlobeMoon } from "../types";

/** What the globe tells the overlay each time it is asked (the renderer's `moonFrame`), in the container's CSS px. */
export interface MoonFrame {
  x: number;
  y: number;
  r: number;
  amount: number;
  unhidden: number;
  angle: number;
}

/** The card closes this long after the pointer leaves, so that a pointer going from the moon to the card does not close it. */
const CLOSE_MS = 160;
/** The gap between the moon's edge and its card, CSS px (a map label's own `boxGap` is 3, and its plate's padding hangs outside it), and the card's distance to the window's edge. */
const GAP = 6;
const EDGE = 8;
/** The link is never smaller than this (CSS px, a finger's width): the moon in the background is a small thing and the target should not be. */
const MIN_TARGET = 44;
/** Below this much of the moon visible (planet in front of it) or let through by the zoom, the link is not a target. */
const LIVE = 0.6;

/**
 * The call to action's arrow: the same arrow as the home page's rows (the icon set's `arrow-right`, lucide's path, drawn with the set's own square ends and stroke:
 * `.ui-icon`, app.css), longer in the arm than the type beside it, as a station's sign is. Built here because the globe imports nothing from the app; it is decoration
 * (`aria-hidden`: the link's name is the words).
 */
function arrow(doc: Document): SVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "ui-icon globe-moon-arrow");
  svg.dataset.size = "inline";
  for (const d of ["M5 12h14", "m12 5 7 7-7 7"]) {
    const path = doc.createElementNS(NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

/**
 * Where the card goes (the window's coordinates, its top-left corner): to the RIGHT of the moon and centred on it vertically; where that does not fit, to the LEFT; where neither does (a
 * phone: the card is wider than the room either side of a moon in the middle), BELOW it, its left edge on the moon's left edge, and where there is no room below, ABOVE it the same way.
 * Always inside the window. `moon` is its centre and drawn radius, `w` and `h` the card's size, `width` and `height` the window's.
 */
export function cardPlace(moon: { x: number; y: number; r: number }, w: number, h: number, width: number, height: number): { side: "right" | "left" | "below" | "above"; x: number; y: number } {
  const clampX = (x: number) => Math.min(Math.max(x, EDGE), Math.max(EDGE, width - w - EDGE));
  const clampY = (y: number) => Math.min(Math.max(y, EDGE), Math.max(EDGE, height - h - EDGE));
  const beside = moon.y - h / 2 >= EDGE - 1 && moon.y + h / 2 <= height - EDGE + 1;
  if (beside && moon.x + moon.r + GAP + w <= width - EDGE) return { side: "right", x: moon.x + moon.r + GAP, y: clampY(moon.y - h / 2) };
  if (beside && moon.x - moon.r - GAP - w >= EDGE) return { side: "left", x: moon.x - moon.r - GAP - w, y: clampY(moon.y - h / 2) };
  if (moon.y + moon.r + GAP + h <= height - EDGE) return { side: "below", x: clampX(moon.x - moon.r), y: moon.y + moon.r + GAP };
  if (moon.y - moon.r - GAP - h >= EDGE) return { side: "above", x: clampX(moon.x - moon.r), y: moon.y - moon.r - GAP - h };
  return { side: "right", x: clampX(moon.x + moon.r + GAP), y: clampY(moon.y - h / 2) }; // no room anywhere: inside the window, over the moon if it must
}

export class MoonOverlay {
  private link: HTMLAnchorElement;
  private card: HTMLElement;
  private closeTimer = 0;
  private open = false;
  private touched = false;
  private shown = false;
  private disposed = false;
  private at: { x: number; y: number; r: number; angle: number; unhidden: number; drawn: number } | null = null;

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
    const title = doc.createElement("span");
    title.className = "globe-moon-title";
    title.textContent = moon.title;
    const body = doc.createElement("span");
    body.className = "globe-moon-body";
    body.textContent = moon.description;
    const cta = doc.createElement("span");
    cta.className = "globe-moon-cta";
    cta.textContent = moon.cta;
    cta.append(arrow(doc));
    card.append(title, body, cta);

    link.append(card);
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
    // Where the planet is in front of most of it, or the zoom has most of it away, it is not a target (and not a tab stop).
    const live = f.unhidden > LIVE && f.amount > LIVE;
    link.style.pointerEvents = live ? "auto" : "none";
    link.tabIndex = live ? 0 : -1;
    if (!live) this.setOpen(false);
    this.at = { x: f.x, y: f.y, r: size / 2, angle: f.angle, unhidden: f.unhidden, drawn: f.r };
    if (this.open) this.placeCard();
  }

  private hide() {
    if (!this.shown) return;
    this.shown = false;
    this.link.hidden = true;
    this.setOpen(false);
  }

  /**
   * Put the card beside the moon, as a map label sits by its box: to the RIGHT of it and centred on it vertically; where that does not fit, to the LEFT; where neither does (a phone:
   * the card is wider than the room either side of a moon in the middle), BELOW it, its left edge on the moon's left edge, and where there is no room below, ABOVE it the same way.
   * Always inside the window. The link is a little larger than the moon (a finger's width), so the card is placed from the moon's own edge, not the link's.
   */
  private placeCard() {
    const at = this.at;
    if (!at) return;
    const card = this.card;
    const place = cardPlace({ x: at.x, y: at.y, r: at.drawn }, card.offsetWidth, card.offsetHeight, this.root.clientWidth, this.root.clientHeight);
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
    this.setHeld(on);
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
    this.link.remove();
  }
}
