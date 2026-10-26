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
/** The gap between the moon and its card, CSS px, and the card's distance to the window's edge. */
const GAP = 10;
const EDGE = 8;
/** Below this much of the moon visible (planet in front of it) or let through by the zoom, the link is not a target. */
const LIVE = 0.6;

export class MoonOverlay {
  private link: HTMLAnchorElement;
  private card: HTMLElement;
  private closeTimer = 0;
  private open = false;
  private touched = false;
  private shown = false;
  private disposed = false;
  private at: { x: number; y: number; r: number; angle: number; unhidden: number } | null = null;

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
    return { shown: this.shown, live: this.shown && this.link.tabIndex === 0, open: this.open, x: r.left + r.width / 2, y: r.top + r.height / 2, size: r.width, angle: this.at?.angle ?? 0, unhidden: this.at?.unhidden ?? 0 };
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
    const size = Math.max(2, f.r * 2);
    link.style.width = link.style.height = `${size}px`;
    link.style.transform = `translate3d(${f.x - f.r}px, ${f.y - f.r}px, 0)`;
    // Where the planet is in front of most of it, or the zoom has most of it away, it is not a target (and not a tab stop).
    const live = f.unhidden > LIVE && f.amount > LIVE;
    link.style.pointerEvents = live ? "auto" : "none";
    link.tabIndex = live ? 0 : -1;
    if (!live) this.setOpen(false);
    this.at = { x: f.x, y: f.y, r: f.r, angle: f.angle, unhidden: f.unhidden };
    if (this.open) this.placeCard();
  }

  private hide() {
    if (!this.shown) return;
    this.shown = false;
    this.link.hidden = true;
    this.setOpen(false);
  }

  /** Put the card on the side of the moon with room, and inside the window. */
  private placeCard() {
    const at = this.at;
    if (!at) return;
    const card = this.card;
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const width = this.root.clientWidth;
    const height = this.root.clientHeight;
    const right = at.x + at.r + GAP + w <= width - EDGE;
    card.dataset.side = right ? "right" : "left";
    const dx = right ? at.r * 2 + GAP : -(w + GAP);
    const y = Math.min(Math.max(at.y - h / 2, EDGE), Math.max(EDGE, height - h - EDGE)) - (at.y - at.r);
    card.style.transform = `translate3d(${dx}px, ${y}px, 0)`;
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
