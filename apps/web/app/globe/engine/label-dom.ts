/**
 * The labels of the boxes as HTML, in device pixels (the DOM half of engine/box-scene.ts; the only part of the labels that touches the DOM).
 *
 * One `div.map-label` per drawn label from a POOL (elements are reused, never created in a frame once the pool is warm), positioned by
 * `transform: translate3d(x, y, 0)` ONLY (no layout, no paint: a moving label is a compositor move), rounded to whole device pixels so the text
 * stays sharp. Text is real text in the app's monospace stack (`--font-mono`, set in app.css `.map-label`), sized by `LABEL_TYPE` (engine/label-text.ts),
 * coloured by CSS (app.css `.map-label`: the foreground with a halo of the page colour; hovered: a page-colour plate and an underline; selected:
 * inverted). A write happens only when a value changed: an idle map, and a frame in which nothing moved, touch no element.
 *
 * Why DOM and not a canvas (measured, docs/web-architecture.md "Labels in device pixels"): the browser rasterises each label once and the
 * compositor moves the layers, so a pan costs one `transform` write per moving label and no text drawing; a canvas redraws and uploads
 * every glyph of every label on every frame it moves and has no real text.
 *
 * The overlay is `aria-hidden` (the places list is the accessible path, so a screen reader does not hear every place twice) and its text is
 * not selectable (a drag on the map must not select labels); pointer events pass through (picking is `BoxScene.hit`).
 */
import { LABEL_TYPE } from "./label-text";

/** How a label is drawn: at rest, hovered or focused (a page-colour plate, an underline, and its country), or selected (inverted). */
export type LabelMode = "rest" | "hover" | "selected";

export interface LabelView {
  /** Top-left corner of the plate, CSS px in the layer's root. */
  x: number;
  y: number;
  name: string;
  chip: string | null;
  mode: LabelMode;
  /** Drawn over other labels (the last resort): on a plate of the page colour so it stays legible. */
  over: boolean;
  /** The node's own opacity (its timed fade), 0..1. */
  alpha: number;
  /** Glide to the new position (a short transition) instead of jumping: a re-plan of a camera at rest. */
  glide: boolean;
}

interface Slot {
  el: HTMLDivElement;
  nameEl: HTMLSpanElement;
  chipEl: HTMLSpanElement;
  /** What was written last. */
  x: number;
  y: number;
  name: string;
  chip: string | null;
  mode: LabelMode | "";
  over: boolean;
  alpha: number;
  glide: boolean;
  used: boolean;
  shown: boolean;
  slug: string;
}

const POOL_KEEP = 400;

export class LabelLayer {
  private live = new Map<number, Slot>();
  private pool: Slot[] = [];
  private dpr = 1;
  /** Element writes since creation (checks and tests: a still frame writes none). */
  writes = 0;

  constructor(private root: HTMLElement) {}

  /** Start a frame: every label not `put` before `end` is released. */
  begin(): void {
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
      s.x = s.y = NaN;
      s.name = "";
      s.chip = ""; // not null: the counter is rewritten (a reused element still holds the last label's)
      s.mode = "";
      s.over = false;
      s.alpha = NaN;
      s.glide = false;
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
    if (v.chip !== s.chip) {
      s.chipEl.textContent = v.chip ?? "";
      s.chipEl.style.display = v.chip ? "" : "none";
      s.chip = v.chip;
      this.writes++;
    }
    if (v.mode !== s.mode) {
      s.el.dataset.mode = v.mode;
      s.mode = v.mode;
      this.writes++;
    }
    if (v.over !== s.over) {
      if (v.over) s.el.dataset.over = "";
      else delete s.el.dataset.over;
      s.over = v.over;
      this.writes++;
    }
    if (v.alpha !== s.alpha) {
      s.el.style.opacity = v.alpha === 1 ? "" : String(v.alpha);
      s.alpha = v.alpha;
      this.writes++;
    }
    // whole device pixels: the text is rasterised once and moved by the compositor, and a half pixel would blur it
    const d = this.dpr;
    const x = Math.round(v.x * d) / d;
    const y = Math.round(v.y * d) / d;
    if (x !== s.x || y !== s.y) {
      // the glide attribute changes only together with a move: a running transition is never cut by a frame that moves nothing
      if (v.glide !== s.glide) {
        if (v.glide) s.el.dataset.glide = "";
        else delete s.el.dataset.glide;
        s.glide = v.glide;
      }
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
      delete s.el.dataset.glide;
      delete s.el.dataset.over;
      s.shown = false;
      if (this.pool.length < POOL_KEEP) this.pool.push(s);
      else s.el.remove();
      this.writes++;
    }
  }

  private create(): Slot {
    const el = document.createElement("div");
    el.className = "map-label";
    const t = LABEL_TYPE;
    Object.assign(el.style, {
      position: "absolute",
      left: "0",
      top: "0",
      display: "none",
      boxSizing: "border-box",
      padding: `${t.padY}px ${t.padX}px`,
      lineHeight: `${t.lineHeight}px`,
      whiteSpace: "nowrap",
      pointerEvents: "none",
      userSelect: "none",
      willChange: "transform",
    } satisfies Partial<CSSStyleDeclaration>);
    const nameEl = document.createElement("span");
    nameEl.className = "map-label-name";
    Object.assign(nameEl.style, { fontSize: `${t.name.size}px`, fontWeight: String(t.name.weight), letterSpacing: `${t.name.tracking}em` } satisfies Partial<CSSStyleDeclaration>);
    const chipEl = document.createElement("span");
    chipEl.className = "map-label-count";
    Object.assign(chipEl.style, { fontSize: `${t.count.size}px`, fontWeight: String(t.count.weight), letterSpacing: `${t.count.tracking}em`, marginLeft: `${t.gap}px`, display: "none" } satisfies Partial<CSSStyleDeclaration>);
    el.append(nameEl, chipEl);
    this.root.append(el);
    return { el, nameEl, chipEl, x: NaN, y: NaN, name: "", chip: null, mode: "", over: false, alpha: NaN, glide: false, used: false, shown: false, slug: "" };
  }

  /** Number of labels shown. */
  get count(): number {
    return this.live.size;
  }

  /** What is in the DOM now, per label (checks; allocates): the real elements, read back. */
  snapshot() {
    return [...this.live.entries()].map(([id, s]) => {
      const r = s.el.getBoundingClientRect();
      return {
        id,
        slug: s.slug,
        text: s.nameEl.textContent ?? "",
        chip: s.chipEl.textContent || null,
        mode: s.el.dataset.mode ?? "",
        over: "over" in s.el.dataset,
        glide: "glide" in s.el.dataset,
        opacity: Number(s.el.style.opacity || 1),
        transform: s.el.style.transform,
        rect: { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom },
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
