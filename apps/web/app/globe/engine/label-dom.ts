/**
 * The labels of the boxes as HTML, in device pixels (the DOM half of engine/box-scene.ts; the only part of the labels that touches the DOM).
 *
 * Two pooled elements per drawn label, positioned by `transform: translate3d(x, y, 0)` ONLY (no layout, no paint: a moving label is a compositor
 * move), rounded to whole device pixels so the text stays sharp:
 *  - `div.map-label`: the PLATE and its text, two lines (`span.map-label-name`, `span.map-label-sub`, sized by `LABEL_TYPE`, engine/label-text.ts).
 *    The plate is the page colour at rest and hovered, inverted (foreground colour) selected (app.css `.map-label`);
 *  - `div.map-halo`: the FEATHER, a transparent box of the plate's size whose shadow fades out around it (`LABEL_TYPE.feather`, app.css
 *    `.map-halo`), so the text stays legible over any map line. It is a separate element in a layer BELOW the box canvas: the soft edge dims the
 *    map (coastlines, graticule) but never the boxes' own outlines, which stay crisp right next to a label. A selected label has none (its
 *    inverted plate is high contrast already).
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
  /** The plate's size as planned (engine/label-text.ts): the feather is drawn around exactly this. */
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
  /** Glide to the new position (a short transition) instead of jumping: a re-plan of a camera at rest. */
  glide: boolean;
}

interface Slot {
  el: HTMLDivElement;
  nameEl: HTMLSpanElement;
  subEl: HTMLSpanElement;
  /** The feather, in the layer below the boxes. */
  halo: HTMLDivElement;
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
  glide: boolean;
  used: boolean;
  shown: boolean;
  slug: string;
}

const POOL_KEEP = 400;

/** The feather as a `box-shadow` (page colour): two stacked layers, a dense core and a long soft tail, so the edge has no visible step. */
export function featherShadow(f: { blur: number; spread: number } = LABEL_TYPE.feather): string {
  return `0 0 ${f.blur}px ${f.spread}px var(--background), 0 0 ${f.blur * 2}px ${f.spread}px var(--background)`;
}

export class LabelLayer {
  private live = new Map<number, Slot>();
  private pool: Slot[] = [];
  private dpr = 1;
  /** The layer of the feathers: first child of the root, so below the boxes' canvas. */
  private halos: HTMLDivElement;
  /** Element writes since creation (checks and tests: a still frame writes none). */
  writes = 0;

  constructor(private root: HTMLElement) {
    this.halos = document.createElement("div");
    this.halos.className = "map-halos";
    Object.assign(this.halos.style, { position: "absolute", inset: "0", pointerEvents: "none", userSelect: "none" } satisfies Partial<CSSStyleDeclaration>);
    root.prepend(this.halos);
  }

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
      s.x = s.y = s.w = s.h = NaN;
      s.name = "";
      s.sub = ""; // not null: the second line is rewritten (a reused element still holds the last label's)
      s.mode = "";
      s.over = false;
      s.alpha = NaN;
      s.glide = false;
    }
    s.used = true;
    if (!s.shown) {
      s.el.style.display = "";
      s.halo.style.display = "";
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
    if (v.mode !== s.mode) {
      s.el.dataset.mode = v.mode;
      s.halo.dataset.mode = v.mode;
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
      const o = v.alpha === 1 ? "" : String(v.alpha);
      s.el.style.opacity = o;
      s.halo.style.opacity = o;
      s.alpha = v.alpha;
      this.writes++;
    }
    if (v.w !== s.w || v.h !== s.h) {
      s.el.style.minWidth = `${v.w}px`; // the plate is at least the planned size (the canvas measure of a mixed-script name can be a px wider than the DOM's): the feather and the hit hull are drawn around exactly that
      s.halo.style.width = `${v.w}px`;
      s.halo.style.height = `${v.h}px`;
      s.w = v.w;
      s.h = v.h;
      this.writes++;
    }
    // whole device pixels: the text is rasterised once and moved by the compositor, and a half pixel would blur it
    const d = this.dpr;
    const x = Math.round(v.x * d) / d;
    const y = Math.round(v.y * d) / d;
    if (x !== s.x || y !== s.y) {
      // the glide attribute changes only together with a move: a running transition is never cut by a frame that moves nothing
      if (v.glide !== s.glide) {
        if (v.glide) {
          s.el.dataset.glide = "";
          s.halo.dataset.glide = "";
        } else {
          delete s.el.dataset.glide;
          delete s.halo.dataset.glide;
        }
        s.glide = v.glide;
      }
      const t = `translate3d(${x}px,${y}px,0)`;
      s.el.style.transform = t;
      s.halo.style.transform = t;
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
      s.halo.style.display = "none";
      delete s.el.dataset.glide;
      delete s.halo.dataset.glide;
      delete s.el.dataset.over;
      s.shown = false;
      if (this.pool.length < POOL_KEEP) this.pool.push(s);
      else {
        s.el.remove();
        s.halo.remove();
      }
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
    const halo = document.createElement("div");
    halo.className = "map-halo";
    Object.assign(halo.style, { position: "absolute", left: "0", top: "0", display: "none", boxSizing: "border-box", boxShadow: featherShadow(), pointerEvents: "none", willChange: "transform" } satisfies Partial<CSSStyleDeclaration>);
    this.halos.append(halo);
    return { el, nameEl, subEl, halo, x: NaN, y: NaN, w: NaN, h: NaN, name: "", sub: null, mode: "", over: false, alpha: NaN, glide: false, used: false, shown: false, slug: "" };
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
      const h = s.halo.getBoundingClientRect();
      return {
        id,
        slug: s.slug,
        text: s.nameEl.textContent ?? "",
        sub: s.subEl.textContent || null,
        mode: s.el.dataset.mode ?? "",
        over: "over" in s.el.dataset,
        glide: "glide" in s.el.dataset,
        opacity: Number(s.el.style.opacity || 1),
        transform: s.el.style.transform,
        rect: { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom },
        /** The name's and the second line's boxes (the text starts `padX` inside the plate), and the feather's element. */
        nameRect: { x0: nameR.left, y0: nameR.top, x1: nameR.right, y1: nameR.bottom },
        subRect: { x0: subR.left, y0: subR.top, x1: subR.right, y1: subR.bottom },
        halo: { x0: h.left, y0: h.top, x1: h.right, y1: h.bottom, transform: s.halo.style.transform, mode: s.halo.dataset.mode ?? "" },
      };
    });
  }

  dispose(): void {
    for (const s of this.live.values()) {
      s.el.remove();
      s.halo.remove();
    }
    for (const s of this.pool) {
      s.el.remove();
      s.halo.remove();
    }
    this.halos.remove();
    this.live.clear();
    this.pool.length = 0;
  }
}
