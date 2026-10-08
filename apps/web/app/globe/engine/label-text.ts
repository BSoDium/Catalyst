/**
 * The text of the box labels and its size in CSS px (pure apart from the injectable meter; unit tested).
 *
 * The labels of the detection boxes are HTML text in device pixels, not pixel art (the pixel font stays for text that is part of the map
 * itself, engine/pixel-labels.ts): the app's own monospace stack (`--font-mono`) on a plate of the page colour with a soft feathered edge
 * (app.css `.map-label`, `.map-halo`). Everything the layout needs is the SIZE of a label, which is measured once per string with a 2D canvas
 * (`measureText`; the DOM is never read back) and cached: the planner (engine/label-plan.ts), the cut of the hierarchy (engine/lod-tree.ts: a
 * label counts as part of its node) and the hit hull (engine/hit-area.ts) all work from these numbers, in CSS px.
 *
 * A label is TWO LINES: line 1 the NAME (14 px, weight 500), line 2 a smaller SECOND LINE (11 px, regular) when there is one: for a place its
 * country and its linked entries split by kind, for a group its number of places and their entries (engine/label-sub.ts). The country is always
 * there when known, hovered or not; hover and selection change the colours of the plate, never the text or its size.
 * A label can be written several ways (`labelVariants`, widest first) for when there is no room: the whole label, without its entries, without
 * its country / number of places (one line), then the name truncated with an ellipsis down to `MIN_LABEL_CHARS` characters.
 */
import { subSteps, type LabelSub } from "./label-sub";

/**
 * The label type and plate. One place for the numbers: the DOM layer (engine/label-dom.ts) styles with them and the planner measures with them.
 * The font is the app's monospace stack (`--font-mono`, the one of the credits line and the dev badge).
 */
export const LABEL_TYPE = {
  /** Line 1, the name. */
  name: { size: 14, weight: 500, tracking: 0.01, lineHeight: 18 },
  /** Line 2, the country (or number of places) and the entries. */
  sub: { size: 11, weight: 400, tracking: 0.02, lineHeight: 14 },
  /** Room between the text and the edge of its plate (the plate is the hit area, the inverted selected plate and the page-colour ground of the text). */
  padX: 6,
  padY: 3,
  /** Clear room between a label outside its box and the box's outline (above, below, beside). */
  boxGap: 3,
  /** Extra room, beyond the outline's own thickness, between a nested label's plate and the box's outline. */
  nestInset: 3,
  /** How far the plate sticks out past the box's edge it is aligned with: none, the plate's edge IS the box's outer edge (the text starts `padX` inside it). */
  bleed: 0,
  /** The soft edge of the plate, px: it fades out over `blur` px around the plate, starting `spread` px beyond it (app.css `.map-halo`; label-dom.ts writes it). */
  feather: { blur: 8, spread: 3 },
} as const;

export type Run = "name" | "sub";

/** Something that knows how wide a run of text is, in CSS px, tracking not included. */
export interface TextMeter {
  width(text: string, run: Run): number;
}

/** Width of a character as a fraction of the font size: a monospace advances about 0.6 em (only used where there is no canvas: tests, a server). */
function approxEm(_ch: string): number {
  return 0.6;
}

/** The meter used without a canvas: deterministic, the width of a typical monospace. */
export const approximateMeter: TextMeter = {
  width(text, run) {
    let w = 0;
    for (const ch of text) w += approxEm(ch);
    return w * LABEL_TYPE[run].size;
  },
};

let meter: TextMeter | null = null;
let tried = false;
const widthCache = new Map<string, number>();
const variantCache = new Map<string, LabelText[]>();

/** Replace the meter (tests; null: back to the page's canvas, or the approximation without one). Clears every cache that depends on it. */
export function setTextMeter(m: TextMeter | null): void {
  meter = m;
  tried = m !== null;
  widthCache.clear();
  variantCache.clear();
}

/** The font of a run as a canvas `font` shorthand with the page's own family. */
export function runFont(run: Run, family: string): string {
  const t = LABEL_TYPE[run];
  return `${t.weight} ${t.size}px ${family}`;
}

/** The label font family as the page resolves it: the `--font-mono` token of app.css (the same stack `.map-label` uses), else a plain monospace. */
export function labelFontFamily(el: Element): string {
  return getComputedStyle(el).getPropertyValue("--font-mono").trim() || "ui-monospace, Menlo, Consolas, monospace";
}

/** A meter on a 2D canvas using the font family the page resolves for `el` (the page's UI font). null when there is no canvas. */
export function canvasMeter(el: Element): TextMeter | null {
  if (typeof document === "undefined") return null;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return null;
  const family = labelFontFamily(el);
  return {
    width(text, run) {
      ctx.font = runFont(run, family);
      return ctx.measureText(text).width;
    },
  };
}

/** The meter in use: the one set, else a canvas on the page's UI font (the root element's font family, resolved once), else the approximation. */
function activeMeter(): TextMeter {
  if (!meter && !tried) {
    tried = true;
    meter = typeof document === "undefined" ? null : canvasMeter(document.documentElement);
  }
  return meter ?? approximateMeter;
}

/** Width of a run in CSS px, tracking included, rounded up to half a px (a label never measures narrower than it is). */
export function runWidth(text: string, run: Run): number {
  const key = `${run}|${text}`;
  const hit = widthCache.get(key);
  if (hit !== undefined) return hit;
  const m = activeMeter();
  const t = LABEL_TYPE[run];
  const w = Math.ceil((m.width(text, run) + Array.from(text).length * t.size * t.tracking) * 2) / 2;
  if (widthCache.size > 20000) widthCache.clear();
  widthCache.set(key, w);
  return w;
}

/** One way of writing a label and its size in CSS px (the plate: text, `padX` / `padY` of room all round). */
export interface LabelText {
  name: string;
  /** The second line as written (country / places and entries, or just the first of them), null for a one-line label. */
  sub: string | null;
  w: number;
  h: number;
  /** The width of the name and of the second line (0 without one). */
  nameW: number;
  subW: number;
}

/** Height of a plate with one line (the name) and with two (the name and the second line). */
export const LABEL_H_ONE = LABEL_TYPE.name.lineHeight + 2 * LABEL_TYPE.padY;
export const LABEL_H_TWO = LABEL_H_ONE + LABEL_TYPE.sub.lineHeight;

/** The size of a label with this name and second line (`sub` null: one line). The plate is as wide as the wider line. */
export function labelText(name: string, sub: string | null): LabelText {
  const nameW = runWidth(name, "name");
  const subW = sub ? runWidth(sub, "sub") : 0;
  return { name, sub, w: Math.max(nameW, subW) + 2 * LABEL_TYPE.padX, h: sub ? LABEL_H_TWO : LABEL_H_ONE, nameW, subW };
}

/** The text of a group's chip in the PIXEL text of the map ("12 entries", "1 entry"); the box labels do not use it (engine/label-sub.ts). */
export const chipText = (count: number): string => `${count} ${count === 1 ? "entry" : "entries"}`;

/** Fewest characters (the ellipsis included) a name is truncated to. */
export const MIN_LABEL_CHARS = 6;
const TRAILING = /[\s,;:.\-–—]+$/;

/**
 * The ways a label can be written, widest first: the whole label, then without its entries, then without its country / number of places (one line),
 * then the name truncated one character at a time with an ellipsis, down to `MIN_LABEL_CHARS` characters (never fewer; a name of six characters or
 * less is never truncated). Each is smaller than the one before (narrower, or as wide and lower: dropping a line a long name does not need
 * frees height only). The first is what the label wants; the others are what the plan falls back to when there is no room for it.
 */
export function labelVariants(name: string, sub: LabelSub | null): LabelText[] {
  const key = `${sub?.lead ?? ""}|${sub?.entries ?? ""}|${name}`;
  const hit = variantCache.get(key);
  if (hit) return hit;
  const out: LabelText[] = [];
  let lastW = Infinity;
  let lastH = Infinity;
  const add = (n: string, line: string | null) => {
    const v = labelText(n, line);
    if (v.w > lastW || v.h > lastH || (v.w === lastW && v.h === lastH)) return; // the shorter ways must really be smaller (the ellipsis is a wide glyph: cutting one letter does not shorten a label)
    lastW = v.w;
    lastH = v.h;
    out.push(v);
  };
  for (const line of subSteps(sub)) add(name, line);
  const chars = Array.from(name);
  for (let n = chars.length - 1; n >= MIN_LABEL_CHARS; n--) add(chars.slice(0, n - 1).join("").replace(TRAILING, "") + "…", null);
  if (variantCache.size > 4000) variantCache.clear();
  variantCache.set(key, out);
  return out;
}
