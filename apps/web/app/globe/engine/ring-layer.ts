/**
 * The ring of type as a DOM layer: one `<canvas>` (2D) in a transparent, `aria-hidden`, `pointer-events: none` wrapper inside the globe's stage,
 * above the WebGL canvas and below the labels, the street map's overlay and the hero. The maths is engine/ring.ts; docs/web-architecture.md,
 * "Ring of type".
 *
 * Why a 2D canvas and not DOM text or the pixel buffer:
 * - Not the pixel buffer. The glyphs turn about the planet every frame (each is rotated to its place on the circle); a 5 x 7 bitmap font cannot
 *   be turned, and the labels of the map were moved out of the pixel buffer into device-pixel text for the same reason (engine/label-text.ts).
 *   The ring is drawn in the labels' own type (`--font-mono`), crisp at the device's resolution, in palette tones.
 * - Not DOM text. 250 absolutely positioned glyph elements with a matrix each would be 250 style writes a frame and 250 elements for a
 *   crawler, a text search and a screen reader's virtual cursor to skip; a canvas is one element with no text in the page. The one thing a
 *   canvas cannot do is be selected, which is what is wanted.
 *
 * Cost model. Nothing runs while the ring is not shown (`alpha` 0: the wrapper is hidden, no timer, no listener but the page's visibility).
 * While shown it draws on the frames the globe draws anyway (the camera moved: the ring must be where the planet is, in the same frame) and, on
 * its own clock, at most one frame per `RING.frameMs` for the slow turn; never under reduced motion (a static ring) nor in a hidden tab. A
 * frame is a clear of the ring's bounding box and about 100 `drawImage`s of an atlas cell with a rotation each, with no layout and no DOM read. The canvas is
 * sized to the ring's bounding box (grown, rarely shrunk), not to the window.
 */
import type { GlobeTheme } from "./colors";
import { GlyphBuffer, placeGlyphs, ringLayout, ringPhase, ringTone, type RingLayout } from "./ring";
import { CAPTION, RING } from "./tuning";

export interface RingFrame {
  /** Centre of the planet on the container, CSS px. */
  cx: number;
  cy: number;
  /** The planet's silhouette radius now, CSS px (`silhouetteRadiusPx`). */
  r: number;
  /** `ringAlpha` of the zoom, 0..1. */
  alpha: number;
  /** The container's size, CSS px (the canvas never goes beyond it). */
  width: number;
  height: number;
}

export interface RingState {
  shown: boolean;
  level: number;
  alpha: number;
  repeats: number;
  /** Characters of the line (spaces included: the glyph slots of one turn) and the ones that are drawn (not spaces), for checks. */
  length: number;
  letters: number;
  /** Tracking the layout picked so that the line closes, em. */
  tracking: number;
  glyphs: number;
  /** Em of every letter, CSS px, and the radii of the baseline and of the letters' centres. */
  em: number;
  baseline: number;
  radius: number;
  looping: boolean;
  /** The ring's turn now, degrees (its own clock). */
  phaseDeg: number;
  /** Frames drawn since creation and the JS time they took (ms): the last, the sum. */
  frames: number;
  lastMs: number;
  totalMs: number;
  canvas: { width: number; height: number; left: number; top: number; dpr: number };
  /** Extent of the circle the letters' centres lie on, container CSS px. */
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

/**
 * The glyphs are not drawn with `fillText`: a canvas draws TURNED text as outlines on the main thread (measured: 6 ms of the main
 * thread's commit per 250-glyph frame in headless Chrome with the GPU on, against 0.13 ms for the same frame with upright text). Each distinct
 * character is drawn once, upright, into a small atlas (one per palette tone, `ATLAS_EM` CSS px, at the device's resolution), and a frame is
 * `drawImage` of one cell per glyph with its matrix: a textured quad on the GPU, mipmapped on the way down.
 */
const ATLAS_EM = 24;
const CELL_W = Math.ceil(ATLAS_EM * 0.9);
const CELL_H = Math.ceil(ATLAS_EM * 1.25);
/** Baseline below the glyph's cell centre, in em: half a cap height of the monospace stack (the caps stand centred on the ring's line). */
const BASELINE = 0.36;

interface Atlas {
  canvas: HTMLCanvasElement;
  /** Character code -> column. */
  col: Map<number, number>;
}

const FALLBACK_FAMILY = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

export class RingLayer {
  readonly root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private text: string;
  private layout: RingLayout = { repeats: 1, emPerR: 0.04, tracking: 0.14 };
  private theme: GlobeTheme;
  private reduced: boolean;
  private hidden = typeof document !== "undefined" && document.hidden;
  private family = FALLBACK_FAMILY;
  private glyphs = new GlyphBuffer();

  private frame: RingFrame | null = null;
  private shown = false;
  private raf = 0;
  private clock = 0;
  private lastAt = 0;
  private drawnAt = 0;
  private phase = ringPhase(0);
  private frames = 0;
  private lastMs = 0;
  private totalMs = 0;
  private atlases = new Map<number, Atlas>();
  /** The line's characters before this index are the highlighted phrases (0: none). */
  private hlEnd = 0;
  private hlMode: "blue" | "ink" | "none" = RING.highlight.mode;
  private atlasDpr = 0;
  private codes: number[];
  private allocW = 0;
  private allocH = 0;
  private cssLeft = 0;
  private cssTop = 0;
  private dpr = 1;
  private disposed = false;
  /** The energy pass's hold: the ring stands still (no loop, its clock stops) and is drawn only when the camera moves it. */
  private frozen = false;

  constructor(host: HTMLElement, text: string, theme: GlobeTheme, reduced: boolean) {
    this.text = text;
    this.hlEnd = this.highlightEnd();
    this.codes = [...new Set([...text].map((c) => c.charCodeAt(0)).filter((c) => c !== 32))];
    this.theme = theme;
    this.reduced = reduced;
    this.root = document.createElement("div");
    this.root.setAttribute("aria-hidden", "true");
    this.root.dataset.ring = "";
    Object.assign(this.root.style, { position: "absolute", inset: "0", overflow: "hidden", pointerEvents: "none", visibility: "hidden" } satisfies Partial<CSSStyleDeclaration>);
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.canvas.height = 0; // no pixels until the ring is shown
    Object.assign(this.canvas.style, { position: "absolute", left: "0", top: "0", display: "block", pointerEvents: "none" } satisfies Partial<CSSStyleDeclaration>);
    this.root.append(this.canvas);
    this.ctx = this.canvas.getContext("2d", { alpha: true });
    host.append(this.root);
    const fam = getComputedStyle(host).getPropertyValue("--font-mono").trim();
    if (fam) this.family = fam;
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  /** Whether the ring is on the screen now (the renderer skips the camera maths while it is not). */
  get isShown(): boolean {
    return this.shown;
  }

  /** The silhouette's radius at the lowest zoom (CSS px): how the line closes round the ring (`ringLayout`) follows from it, and only changes with the viewport. */
  setLayout(rFloorPx: number): void {
    const next = ringLayout(this.text.length, rFloorPx);
    const cur = this.layout;
    if (next.repeats === cur.repeats && next.emPerR === cur.emPerR && next.tracking === cur.tracking) return;
    this.layout = next;
    this.redraw();
  }

  /** The end (character index) of the highlighted phrases of the line: the first `RING.highlight.phrases` of them (0: none). */
  private highlightEnd(): number {
    let at = 0;
    for (let n = 0; n < RING.highlight.phrases; n++) {
      const next = this.text.indexOf(RING.separator, at);
      if (next < 0) return this.text.length;
      at = n === RING.highlight.phrases - 1 ? next : next + RING.separator.length;
    }
    return at;
  }

  /** Checks and captures: the highlight's look (`blue`, `ink`, `none`; null: the tuned one). */
  setHighlight(mode: "blue" | "ink" | "none" | null): void {
    this.hlMode = mode ?? RING.highlight.mode;
    this.atlases.clear();
    this.redraw();
  }

  setTheme(theme: GlobeTheme): void {
    this.theme = theme;
    this.atlases.clear();
    this.redraw();
  }

  /** The ring stands still (the energy pass's hold) or turns again. */
  setFrozen(on: boolean): void {
    if (on === this.frozen) return;
    this.frozen = on;
    if (on) this.stopLoop();
    else this.wake();
  }

  setReduced(on: boolean): void {
    if (on === this.reduced) return;
    this.reduced = on;
    if (on) this.stopLoop();
    this.redraw();
  }

  private fadeMask: string | null = null;

  /** `mask-image` of the container's inset fade (the panel's edge), or null. */
  setMask(mask: string | null): void {
    this.fadeMask = mask;
    this.applyMask();
  }

  private applyMask(): void {
    const value = this.fadeMask ?? "";
    for (const prop of ["mask-image", "-webkit-mask-image"]) this.root.style.setProperty(prop, value);
  }

  /** Where the planet is now and how present the ring is. Draws at once when the ring is shown (the camera moved: the ring goes with the planet in the same frame). */
  update(frame: RingFrame): void {
    if (this.disposed) return;
    this.frame = frame;
    if (frame.alpha <= 0) {
      if (this.shown) this.hide();
      return;
    }
    this.draw(performance.now(), false);
    this.wake();
  }

  state(): RingState {
    const f = this.frame;
    return {
      shown: this.shown,
      level: f ? ringTone(f.alpha, this.theme.ramp.length) : 0,
      alpha: f?.alpha ?? 0,
      repeats: this.layout.repeats,
      length: this.text.length,
      letters: this.text.replace(/ /g, "").length,
      tracking: this.layout.tracking,
      glyphs: this.glyphs.count,
      em: this.glyphs.em,
      baseline: this.glyphs.baseline,
      radius: this.glyphs.radius,
      looping: this.raf !== 0,
      phaseDeg: (this.phase * 180) / Math.PI,
      frames: this.frames,
      lastMs: this.lastMs,
      totalMs: this.totalMs,
      canvas: { width: this.allocW, height: this.allocH, left: this.cssLeft, top: this.cssTop, dpr: this.dpr },
      bounds: { minX: this.glyphs.minX, maxX: this.glyphs.maxX, minY: this.glyphs.minY, maxY: this.glyphs.maxY },
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopLoop();
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.root.remove();
    this.canvas.width = 0;
    this.atlases.clear();
  }

  /* ------------------------------ clock ------------------------------ */

  private onVisibility = () => {
    this.hidden = document.hidden;
    if (this.hidden) this.stopLoop();
    else {
      this.lastAt = performance.now(); // the time spent hidden is not turned
      this.wake();
    }
  };

  private wantsLoop(): boolean {
    return this.shown && !this.reduced && !this.hidden && !this.disposed && !this.frozen;
  }

  private wake(): void {
    if (this.raf || !this.wantsLoop()) return;
    this.lastAt = performance.now();
    // (an animation frame at the display's rate: the ring's letters move 3 degrees a second, and a timer's uneven intervals against the vsync show as judder)
    this.raf = requestAnimationFrame(this.loop);
  }

  private stopLoop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private loop = (now: number) => {
    this.raf = 0;
    if (!this.wantsLoop()) return;
    // (a full frame of the globe in this same display frame has drawn the ring already)
    if (now - this.drawnAt > 3) this.draw(now, true);
    this.raf = requestAnimationFrame(this.loop);
  };

  /* ------------------------------ drawing ------------------------------ */

  private hide(): void {
    this.shown = false;
    this.root.style.visibility = "hidden";
    this.stopLoop();
    // Release the pixels: a hidden ring costs nothing but a small element.
    if (this.allocW || this.allocH) {
      this.canvas.width = 0;
      this.canvas.height = 0;
      this.allocW = this.allocH = 0;
    }
  }

  /** The atlas of one palette tone: every character of the line, upright, in that grey, at the device's resolution. */
  private atlas(level: number, dpr: number, hl = false): Atlas | null {
    const key = level * 2 + (hl ? 1 : 0);
    const have = this.atlases.get(key);
    if (have) return have;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(CELL_W * this.codes.length * dpr);
    canvas.height = Math.ceil(CELL_H * dpr);
    const c = canvas.getContext("2d");
    if (!c) return null;
    let rgb: readonly number[] = this.theme.ramp[level]!;
    let weight: number = RING.type.weight;
    if (hl) {
      // a highlight is faded with the ring by the same tone staircase: its strength is the level's share of the ring's top tone
      const ramp = this.theme.ramp;
      const top = Math.max(1, ringTone(1, ramp.length));
      const f = Math.min(1, level / top);
      const page = ramp[0]!;
      const to = this.hlMode === "blue" ? this.accent() : ramp[ramp.length - 1]!;
      rgb = [page[0]! + (to[0]! - page[0]!) * f, page[1]! + (to[1]! - page[1]!) * f, page[2]! + (to[2]! - page[2]!) * f];
      if (this.hlMode === "ink") weight = RING.highlight.inkWeight;
    }
    c.scale(dpr, dpr);
    c.font = `${weight} ${ATLAS_EM}px ${this.family}`;
    c.textAlign = "center";
    c.textBaseline = "alphabetic";
    c.fillStyle = `rgb(${Math.round(rgb[0]! * 255)} ${Math.round(rgb[1]! * 255)} ${Math.round(rgb[2]! * 255)})`;
    const col = new Map<number, number>();
    this.codes.forEach((code, i) => {
      col.set(code, i);
      c.fillText(String.fromCharCode(code), i * CELL_W + CELL_W / 2, CELL_H / 2 + BASELINE * ATLAS_EM);
    });
    const atlas = { canvas, col };
    this.atlases.set(key, atlas);
    return atlas;
  }

  /** The blue of the highlight for the theme's scheme, 0..1. */
  private accent(): [number, number, number] {
    const bg = this.theme.background;
    const dark = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2] < 0.5;
    const h = (dark ? CAPTION.colors.accent.dark : CAPTION.colors.accent.light).slice(1);
    return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
  }

  private redraw(): void {
    if (this.shown && this.frame) this.draw(performance.now(), false);
  }

  /** `turn`: advance the ring's own clock by the time since the last frame (the loop); a camera frame draws it where it is. */
  private draw(now: number, turn: boolean): void {
    const t0 = performance.now();
    this.paint(now, turn);
    this.lastMs = performance.now() - t0;
    this.totalMs += this.lastMs;
  }

  private paint(now: number, turn: boolean): void {
    const fr = this.frame;
    const ctx = this.ctx;
    if (!fr || !ctx) return;
    const levels = this.theme.ramp.length;
    const level = ringTone(fr.alpha, levels);
    if (level <= 0) {
      if (this.shown) this.hide();
      return;
    }
    if (turn || !this.reduced) {
      // The clock runs while the ring is on and moving; a stalled frame cannot jump it.
      const dt = Math.min(now - this.lastAt, RING.maxStepMs);
      if (!this.reduced && !this.frozen && dt > 0) this.clock += dt;
      this.lastAt = now;
    }
    this.phase = ringPhase(this.clock);
    this.drawnAt = now;
    this.frames++;
    const g = this.glyphs;
    placeGlyphs(g, { text: this.text, layout: this.layout, phase: this.phase, r: fr.r, cx: fr.cx, cy: fr.cy });
    const pad = g.em * 1.6;
    const left = Math.max(0, Math.floor(g.minX - pad));
    const top = Math.max(0, Math.floor(g.minY - pad));
    const right = Math.min(fr.width, Math.ceil(g.maxX + pad));
    const bottom = Math.min(fr.height, Math.ceil(g.maxY + pad));
    const w = Math.max(1, right - left);
    const h = Math.max(1, bottom - top);
    const dpr = Math.min(window.devicePixelRatio || 1, RING.maxDpr);
    // The backing store is grown in steps and shrunk when it is twice what is needed, or 1.35 times on the ring's own clock frames (nothing is
    // moving then: a resize clears and reallocates it, and a smaller store is less to clear and composite every frame for as long as the ring turns).
    const needW = Math.ceil(w * dpr);
    const needH = Math.ceil(h * dpr);
    const slack = turn ? 1.35 : 2;
    if (needW > this.allocW || needH > this.allocH || needW * slack < this.allocW || needH * slack < this.allocH || dpr !== this.dpr) {
      this.allocW = Math.min(Math.ceil(fr.width * dpr), Math.ceil(needW * 1.15 + 16));
      this.allocH = Math.min(Math.ceil(fr.height * dpr), Math.ceil(needH * 1.15 + 16));
      this.dpr = dpr;
      this.canvas.width = this.allocW;
      this.canvas.height = this.allocH;
      this.canvas.style.width = `${this.allocW / dpr}px`;
      this.canvas.style.height = `${this.allocH / dpr}px`;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
    }
    if (dpr !== this.atlasDpr) {
      this.atlasDpr = dpr;
      this.atlases.clear();
    }
    if (left !== this.cssLeft || top !== this.cssTop || !this.shown) {
      this.cssLeft = left;
      this.cssTop = top;
      this.canvas.style.transform = `translate(${left}px, ${top}px)`;
    }
    if (!this.shown) {
      this.shown = true;
      this.root.style.visibility = "";
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.allocW, this.allocH);
    // The atlas cell is drawn at `ATLAS_EM`; a letter is `g.em`. The cell's centre is the capital's centre: each letter turns about it to its
    // angle (clockwise from twelve o'clock), its top pointing away from the planet.
    const lv = Math.min(level, levels - 1);
    const atlas = this.atlas(lv, dpr);
    if (!atlas) return;
    const hlAtlas = this.hlMode !== "none" && this.hlEnd > 0 ? this.atlas(lv, dpr, true) : null;
    const m = (dpr * g.em) / ATLAS_EM;
    const ox = -left * dpr;
    const oy = -top * dpr;
    const cw = CELL_W * dpr;
    const ch = CELL_H * dpr;
    for (let i = 0; i < g.count; i++) {
      const hl = hlAtlas !== null && g.idx[i]! < this.hlEnd;
      const at = hl ? hlAtlas! : atlas;
      const col = at.col.get(g.code[i]!);
      if (col === undefined) continue;
      const a = g.angle[i]!;
      const c = Math.cos(a) * m;
      const sn = Math.sin(a) * m;
      ctx.setTransform(c, sn, -sn, c, g.x[i]! * dpr + ox, g.y[i]! * dpr + oy);
      ctx.drawImage(at.canvas, col * cw, 0, cw, ch, -CELL_W / 2, -CELL_H / 2, CELL_W, CELL_H);
    }
  }
}
