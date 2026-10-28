/**
 * The labels of the boxes as HTML, in device pixels (the DOM half of engine/box-scene.ts; the only part of the labels that touches the DOM).
 *
 * One pooled element per drawn label, positioned by `transform: translate3d(x, y, 0)` ONLY (no layout, no paint: a moving label is a compositor
 * move). At rest the position is rounded to whole device pixels so the text stays sharp; while anything moves it is exact, so a label follows
 * its box smoothly (`begin(settled)`). There is no CSS transition: the motion of a label (its eased glide to a new slot) is computed per
 * frame (engine/label-track.ts) and arrives here as a position:
 *  - `div.map-label`: the PLATE and its text, two lines (`span.map-label-name`, `span.map-label-sub`, sized by `LABEL_TYPE`, engine/label-text.ts).
 *    The plate is OPAQUE, the page colour, with a SHARP edge (owner, 2026-10-28: no gradient round the background of a label): no alpha, no
 *    feather, no `box-shadow`. Selected it is inverted (the foreground colour), as opaque as the others.
 * A write happens only when a value changed: an idle map, and a frame in which nothing moved, touch no element.
 *
 * Why DOM and not a canvas (measured, docs/web-architecture.md "Labels in device pixels"): the browser rasterises each label once and the
 * compositor moves the layers, so a pan costs one `transform` write per moving label and no text drawing; a canvas redraws and uploads
 * every glyph of every label on every frame it moves and has no real text.
 *
 * The overlay is `aria-hidden` (the places list is the accessible path, so a screen reader does not hear every place twice) and its text is
 * not selectable (a drag on the map must not select labels); pointer events pass through (picking is `BoxScene.hit`).
 */
import { LABEL_TYPE } from "./label-text";

/** How a label is drawn: at rest, hovered or focused (the box colour logic's own state: the text and the plate do not change), or selected (inverted plate). */
export type LabelMode = "rest" | "hover" | "selected";

export interface LabelView {
  /** Top-left corner of the plate, CSS px in the layer's root. */
  x: number;
  y: number;
  /** The plate's size as planned (engine/label-text.ts): the plate is exactly this big (at least). */
  w: number;
  h: number;
  name: string;
  /** The second line, null for a one-line label. */
  sub: string | null;
  mode: LabelMode;
  /** Drawn over other labels (the last resort): on top of them, on its plate. */
  over: boolean;
  /** The node's own opacity (its timed fade), 0..1. */
  alpha: number;
  /**
   * How far the plate moves when the label is selected (px; engine/pixel-labels.ts `selectedShiftAt`): the plate at rest hangs outside its box so the
   * text is flush with the box's edge, the selected card is flush with the box. Written as the CSS custom properties the stylesheet's `translate`
   * of a selected label reads (a compositor transition, no layout); written whenever the slot changes, whatever the mode is.
   */
  dx: number;
  dy: number;
}

interface Slot {
  el: HTMLDivElement;
  nameEl: HTMLSpanElement;
  subEl: HTMLSpanElement;
  /** What was written last. */
  x: number;
  y: number;
  w: number;
  h: number;
  name: string;
  sub: string | null;
  mode: LabelMode | "";
  over: boolean;
  alpha: number;
  dx: number;
  dy: number;
  used: boolean;
  shown: boolean;
  slug: string;
}

const POOL_KEEP = 400;

export class LabelLayer {
  private live = new Map<number, Slot>();
  private pool: Slot[] = [];
  private dpr = 1;
  /** Round positions to whole device pixels (the label is at rest: the text is sharp); false while things move, so that a label moves by fractions of a device pixel. */
  private snap = true;
  /** Element writes since creation (checks and tests: a still frame writes none). */
  writes = 0;

  constructor(private root: HTMLElement) {}

  /**
   * Start a frame: every label not `put` before `end` is released. `settled` (default true): nothing is moving, so positions are rounded to whole
   * device pixels and the text is sharp; false while the camera or a glide moves the labels: positions are exact, fractions of a device pixel
   * (a moving label follows its box smoothly; a rounding to device pixels would be a step of 0.5 px at 2x on every few frames of a slow spin).
   */
  begin(settled = true): void {
    this.snap = settled;
    this.dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
    for (const s of this.live.values()) s.used = false;
  }

  /** Show label `id` (`slug` for checks) as `v`. Writes only what changed. */
  put(id: number, slug: string, v: LabelView): void {
    let s = this.live.get(id);
    if (!s) {
      s = this.pool.pop() ?? this.create();
      this.live.set(id, s);
      s.slug = slug;
      s.el.dataset.slug = slug;
      s.x = s.y = s.w = s.h = NaN;
      s.name = "";
      s.sub = ""; // not null: the second line is rewritten (a reused element still holds the last label's)
      s.mode = "";
      s.over = false;
      s.alpha = NaN;
      s.dx = s.dy = NaN;
    }
    s.used = true;
    if (!s.shown) {
      s.el.style.display = "";
      s.shown = true;
      this.writes++;
    }
    if (v.name !== s.name) {
      s.nameEl.textContent = v.name;
      s.name = v.name;
      this.writes++;
    }
    if (v.sub !== s.sub) {
      s.subEl.textContent = v.sub ?? "";
      s.subEl.style.display = v.sub ? "block" : "none"; // a block line of its own height (an inline span would take the parent's line box)
      s.sub = v.sub;
      this.writes++;
    }
    if (v.mode !== s.mode || v.over !== s.over) {
      if (v.mode !== s.mode) s.el.dataset.mode = v.mode;
      if (v.over !== s.over) {
        if (v.over) s.el.dataset.over = "";
        else delete s.el.dataset.over;
      }
      s.mode = v.mode;
      s.over = v.over;
      this.writes++;
    }
    if (v.alpha !== s.alpha) {
      s.el.style.opacity = v.alpha === 1 ? "" : String(v.alpha);
      s.alpha = v.alpha;
      this.writes++;
    }
    if (v.dx !== s.dx || v.dy !== s.dy) {
      s.el.style.setProperty("--map-label-dx", `${v.dx}px`);
      s.el.style.setProperty("--map-label-dy", `${v.dy}px`);
      s.dx = v.dx;
      s.dy = v.dy;
      this.writes++;
    }
    if (v.w !== s.w || v.h !== s.h) {
      s.el.style.minWidth = `${v.w}px`; // the plate is at least the planned size (the canvas measure of a mixed-script name can be a px wider than the DOM's, and a plate is a whole number of art cells): the hit hull is drawn around exactly that
      s.el.style.minHeight = `${v.h}px`;
      s.w = v.w;
      s.h = v.h;
      this.writes++;
    }
    // at rest: whole device pixels, the text is rasterised once and moved by the compositor, and a half pixel would blur it; moving: exact
    const d = this.dpr;
    const x = this.snap ? Math.round(v.x * d) / d : v.x;
    const y = this.snap ? Math.round(v.y * d) / d : v.y;
    if (x !== s.x || y !== s.y) {
      s.el.style.transform = `translate3d(${x}px,${y}px,0)`;
      s.x = x;
      s.y = y;
      this.writes++;
    }
  }

  /** End the frame: the labels that were not `put` go back to the pool, hidden. */
  end(): void {
    for (const [id, s] of this.live) {
      if (s.used) continue;
      this.live.delete(id);
      s.el.style.display = "none";
      delete s.el.dataset.over;
      s.shown = false;
      if (this.pool.length < POOL_KEEP) this.pool.push(s);
      else s.el.remove();
      this.writes++;
    }
  }

  private create(): Slot {
    const t = LABEL_TYPE;
    const el = document.createElement("div");
    el.className = "map-label";
    Object.assign(el.style, {
      position: "absolute",
      left: "0",
      top: "0",
      display: "none",
      boxSizing: "border-box",
      padding: `${t.padY}px ${t.padX}px`,
      whiteSpace: "nowrap",
      pointerEvents: "none",
      userSelect: "none",
      willChange: "transform",
    } satisfies Partial<CSSStyleDeclaration>);
    const nameEl = document.createElement("span");
    nameEl.className = "map-label-name";
    Object.assign(nameEl.style, { display: "block", fontSize: `${t.name.size}px`, fontWeight: String(t.name.weight), letterSpacing: `${t.name.tracking}em`, lineHeight: `${t.name.lineHeight}px` } satisfies Partial<CSSStyleDeclaration>);
    const subEl = document.createElement("span");
    subEl.className = "map-label-sub";
    Object.assign(subEl.style, { display: "none", fontSize: `${t.sub.size}px`, fontWeight: String(t.sub.weight), letterSpacing: `${t.sub.tracking}em`, lineHeight: `${t.sub.lineHeight}px` } satisfies Partial<CSSStyleDeclaration>);
    el.append(nameEl, subEl);
    this.root.append(el);
    return { el, nameEl, subEl, x: NaN, y: NaN, w: NaN, h: NaN, name: "", sub: null, mode: "", over: false, alpha: NaN, dx: NaN, dy: NaN, used: false, shown: false, slug: "" };
  }

  /** Number of labels shown. */
  get count(): number {
    return this.live.size;
  }

  /** What is in the DOM now, per label (checks; allocates): the real elements, read back. */
  snapshot() {
    return [...this.live.entries()].map(([id, s]) => {
      const r = s.el.getBoundingClientRect();
      const nameR = s.nameEl.getBoundingClientRect();
      const subR = s.subEl.getBoundingClientRect();
      return {
        id,
        slug: s.slug,
        text: s.nameEl.textContent ?? "",
        sub: s.subEl.textContent || null,
        mode: s.el.dataset.mode ?? "",
        over: "over" in s.el.dataset,
        opacity: Number(s.el.style.opacity || 1),
        transform: s.el.style.transform,
        rect: { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom },
        /** The name's and the second line's boxes (the text starts `padX` inside the plate). */
        nameRect: { x0: nameR.left, y0: nameR.top, x1: nameR.right, y1: nameR.bottom },
        subRect: { x0: subR.left, y0: subR.top, x1: subR.right, y1: subR.bottom },
      };
    });
  }

  dispose(): void {
    for (const s of this.live.values()) s.el.remove();
    for (const s of this.pool) s.el.remove();
    this.live.clear();
    this.pool.length = 0;
  }
}
