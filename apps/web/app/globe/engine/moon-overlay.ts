/**
 * The moon on the page (docs/landing.md, "The moon"): one real link over the globe, placed each frame from the globe's camera (engine/moon.ts is the
 * maths). It is a DOM element and not a thing in the scene on purpose: the keyboard reaches it, a screen reader reads it, the browser's own link
 * behaviour (middle click, "open in a new tab", the status bar) works, and the pointer needs no picking code of its own.
 *
 * It moves on its own clock, `FRAME_MS` apart and only while the globe may move (no hold of the energy pass, no reduced motion; both leave it
 * standing where it is, still a link), so a page at rest costs nothing. It stops while the pointer or the keyboard is on it, so that it can be
 * clicked, and shows a card with what it is. Touch has no hover: the first tap shows the card, the card's own link is the second.
 *
 * The look (class names `globe-moon`, `-sprite`, `-card`, ...) is app.css's; this file sets only what changes per frame: the position and the sprite's pixels.
 */
import type { GlobeMoon } from "../types";
import type { GlobeTheme } from "./colors";
import { moonPlace, moonSprite, orbitAngle, spriteCells, toRad, MOON, type MoonGeometry } from "./moon";

/** What the globe tells the overlay each time it is asked (the renderer's `moonFrame`). */
export interface MoonFrame {
  geometry: MoonGeometry;
  amount: number;
  running: boolean;
  cell: number;
  theme: GlobeTheme;
}

/** Between two moves of the moon, ms: ten a second is a pixel-art moon crossing a few art pixels at a time. */
const FRAME_MS = 100;
/** The card closes this long after the pointer leaves, so that a pointer going from the moon to the card does not close it. */
const CLOSE_MS = 160;
/** The gap between the moon and its card, CSS px, and the card's distance to the window's edge. */
const GAP = 10;
const EDGE = 8;

const rgb = (c: readonly [number, number, number]) => `rgb(${Math.round(c[0] * 255)} ${Math.round(c[1] * 255)} ${Math.round(c[2] * 255)})`;

export class MoonOverlay {
  private link: HTMLAnchorElement;
  private canvas: HTMLCanvasElement;
  private card: HTMLElement;
  private ctx: CanvasRenderingContext2D | null;
  private timer = 0;
  private closeTimer = 0;
  /** The time the orbit has run for, ms (it does not advance while the moon is held or the globe is). */
  private activeMs = 0;
  private last = 0;
  private open = false;
  private touched = false;
  private drawn = { cells: 0, theme: null as GlobeTheme | null };
  private shown = false;
  private disposed = false;

  constructor(
    root: HTMLElement,
    moon: GlobeMoon,
    private frame: () => MoonFrame | null,
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

    const canvas = (this.canvas = doc.createElement("canvas"));
    canvas.className = "globe-moon-sprite";
    canvas.setAttribute("aria-hidden", "true");
    this.ctx = canvas.getContext("2d");

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

    link.append(canvas, card);
    root.append(link);

    link.addEventListener("pointerenter", this.onEnter);
    link.addEventListener("pointerleave", this.onLeave);
    link.addEventListener("pointerdown", this.onDown);
    link.addEventListener("click", this.onClick);
    link.addEventListener("focus", this.onFocus);
    link.addEventListener("blur", this.onBlur);
    link.addEventListener("keydown", this.onKey);
  }

  /** Whether the card is out (the moon holds still meanwhile). */
  get held(): boolean {
    return this.open;
  }

  /** Where the moon is now and whether it is shown (checks). */
  state() {
    const r = this.link.getBoundingClientRect();
    return { shown: this.shown, open: this.open, x: r.left + r.width / 2, y: r.top + r.height / 2, size: r.width, angle: this.angle() };
  }

  /** Pin the orbit at `deg` (checks); null lets it run. */
  pin(deg: number | null): void {
    this.pinned = deg === null ? null : toRad(deg);
    this.update(performance.now());
  }
  private pinned: number | null = null;

  private angle(): number {
    return this.pinned ?? orbitAngle(this.activeMs);
  }

  /** The globe drew a frame, or the timer fired: move the moon to where it is for `now`, and arm the timer if it is going to move again. */
  update(now: number): void {
    if (this.disposed) return;
    window.clearTimeout(this.timer);
    this.timer = 0;
    const f = this.frame();
    if (!f) {
      this.hide();
      this.last = 0;
      return;
    }
    const moving = f.running && !this.open && this.pinned === null;
    if (moving && this.last > 0) this.activeMs += Math.min(250, Math.max(0, now - this.last));
    this.last = moving ? now : 0;
    // A page that has never run (reduced motion, or held before the first move) stands at the rest place: in front, in view.
    const place = moonPlace(f.geometry, this.pinned !== null || f.running || this.activeMs > 0 ? this.angle() : toRad(MOON.restDeg));
    const alpha = place.alpha * f.amount;
    if (alpha <= 0.02) {
      this.hide();
    } else {
      this.show(f, place.x, place.y, place.size, alpha, place.front);
    }
    if (moving && !this.disposed) this.timer = window.setTimeout(() => this.update(performance.now()), FRAME_MS);
  }

  private hide() {
    if (!this.shown) return;
    this.shown = false;
    this.link.hidden = true;
    this.setOpen(false);
  }

  private show(f: MoonFrame, x: number, y: number, size: number, alpha: number, front: boolean) {
    const cells = spriteCells(size, f.cell);
    const px = cells * f.cell;
    // On the art grid, like everything the globe draws: the moon's top-left corner is a whole cell.
    const left = Math.round((x - px / 2) / f.cell) * f.cell;
    const top = Math.round((y - px / 2) / f.cell) * f.cell;
    const link = this.link;
    if (!this.shown) {
      this.shown = true;
      link.hidden = false;
    }
    if (this.drawn.cells !== cells || this.drawn.theme !== f.theme) this.paint(cells, f.theme);
    link.style.width = link.style.height = `${px}px`;
    this.canvas.style.width = this.canvas.style.height = `${px}px`;
    link.style.transform = `translate3d(${left}px, ${top}px, 0)`;
    link.style.opacity = alpha >= 0.995 ? "" : String(alpha);
    // Over the planet's hidden half, or under the hero's text, it is not a target (and not a tab stop) even where it is faintly drawn.
    const live = alpha > 0.6;
    link.style.pointerEvents = live ? "auto" : "none";
    link.tabIndex = live ? 0 : -1;
    link.dataset.side = front ? "front" : "back";
    if (!live) this.setOpen(false);
    else if (this.open) this.placeCard(left, top, px, f.geometry);
    link.style.zIndex = front ? "2" : "1";
    this.at = { left, top, px, geometry: f.geometry };
  }
  private at: { left: number; top: number; px: number; geometry: MoonGeometry } | null = null;

  /** Draw the sprite for this size and theme into its canvas (one pixel per art cell; the CSS scales it up crisply). */
  private paint(cells: number, theme: GlobeTheme) {
    this.drawn = { cells, theme };
    const ctx = this.ctx;
    const canvas = this.canvas;
    canvas.width = canvas.height = cells;
    if (!ctx) return;
    const n = theme.ramp.length;
    const at = (k: number) => rgb(theme.ramp[Math.round((n - 1) * k)]!);
    // On the light page the lit side is the page's own colour (the outline makes the disc, and the planet's lines do not show through); on the dark one the moon is the light thing.
    const dark = theme.scheme === "dark";
    const tones = [null, at(dark ? 0.8 : 0.92), dark ? at(0.6) : rgb(theme.background), at(dark ? 0.3 : 0.5), at(dark ? 0.42 : 0.36)];
    const sprite = moonSprite(cells);
    ctx.clearRect(0, 0, cells, cells);
    for (let j = 0; j < cells; j++) {
      for (let i = 0; i < cells; i++) {
        const tone = tones[sprite[j * cells + i]!];
        if (!tone) continue;
        ctx.fillStyle = tone;
        ctx.fillRect(i, j, 1, 1);
      }
    }
  }

  /** Put the card on the side of the moon with room, and inside the window. */
  private placeCard(left: number, top: number, px: number, g: MoonGeometry) {
    const card = this.card;
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const right = left + px + GAP + w <= g.width - EDGE;
    card.dataset.side = right ? "right" : "left";
    const dx = right ? px + GAP : -(w + GAP);
    const middle = top + px / 2;
    const y = Math.min(Math.max(middle - h / 2, EDGE), Math.max(EDGE, g.height - h - EDGE)) - top;
    card.style.transform = `translate3d(${dx}px, ${y}px, 0)`;
  }

  private setOpen(on: boolean) {
    if (on === this.open) return;
    this.open = on;
    if (on) this.link.dataset.open = "";
    else delete this.link.dataset.open;
    if (on) {
      if (this.at) this.placeCard(this.at.left, this.at.top, this.at.px, this.at.geometry);
    } else {
      this.touched = false;
      this.update(performance.now());
    }
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
    window.clearTimeout(this.timer);
    window.clearTimeout(this.closeTimer);
    this.link.remove();
  }
}
