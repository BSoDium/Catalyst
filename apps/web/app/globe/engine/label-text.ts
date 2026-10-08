/**
 * The text of the box labels and its size in CSS px (pure apart from the injectable meter; unit tested).
 *
 * The labels of the detection boxes are HTML text in device pixels, not pixel art (the pixel font stays for text that is part of the map
 * itself, engine/pixel-labels.ts): the app's own monospace stack (`--font-mono`), small, thin, tightly set, with a
 * halo of the page colour (app.css, `.map-label`). Everything the layout needs is the SIZE of a label, which is measured once per string
 * with a 2D canvas (`measureText`; the DOM is never read back) and cached: the planner (engine/label-plan.ts), the cut of the hierarchy
 * (engine/lod-tree.ts: a label counts as part of its node) and the hit hull (engine/hit-area.ts) all work from these numbers, in CSS px.
 *
 * Label parts: the NAME (a place's name; a group's name) and, for a group, its COUNTER ("12 entries") after a gap, in a lighter and smaller
 * run of the same colour (the weight and the size say it is secondary; its colour is the page's foreground like the name's, never dimmed).
 * A label can be written several ways (`labelVariants`, widest first) for when there is no room: the whole label, without its counter, then
 * the name truncated with an ellipsis down to `MIN_LABEL_CHARS` characters. While hovered, focused or selected a place's label also names its
 * country ("Name, Country", `expandedLabel`) and nothing else about it changes.
 */

/**
 * The label type and plate. One place for the numbers: the DOM layer (engine/label-dom.ts) styles with them and the planner measures with them.
 * The font is the app's monospace stack (`--font-mono`, the one of the credits line and the dev badge), thin and tightly tracked.
 */
export const LABEL_TYPE = {
  name: { size: 13, weight: 400, tracking: 0.02 },
  count: { size: 11, weight: 300, tracking: 0.02 },
  /** Line height of the label, px. Tight: a label is one line. */
  lineHeight: 16,
  /** Room between the text and the edge of its plate (the plate is the hit area, the inverted selected plate and the hover plate). */
  padX: 6,
  padY: 3,
  /** Between the name and its counter. */
  gap: 9,
  /** Clear room between a label outside its box and the box's outline (above, below, beside). */
  boxGap: 7,
  /** Extra room, beyond the outline's own thickness, between a nested label's plate and the box's outline. */
  nestInset: 4,
} as const;

export type Run = "name" | "count";

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
  /** A group's counter ("12 entries"), null for a place or when it was left out for room. */
  chip: string | null;
  w: number;
  h: number;
  /** The name's width and where the counter starts from the plate's left. */
  nameW: number;
  chipX: number;
}

/** Height of every plate. */
export const LABEL_H = LABEL_TYPE.lineHeight + 2 * LABEL_TYPE.padY;

/** The size of a label with this name and counter. */
export function labelText(name: string, chip: string | null): LabelText {
  const nameW = runWidth(name, "name");
  const chipX = LABEL_TYPE.padX + nameW + LABEL_TYPE.gap;
  const w = chip ? chipX + runWidth(chip, "count") + LABEL_TYPE.padX : LABEL_TYPE.padX + nameW + LABEL_TYPE.padX;
  return { name, chip, w, h: LABEL_H, nameW, chipX };
}

/** The text of a group's counter: "<N> entries", "1 entry" when singular. */
export const chipText = (count: number): string => `${count} ${count === 1 ? "entry" : "entries"}`;

/** Fewest characters (the ellipsis included) a name is truncated to. */
export const MIN_LABEL_CHARS = 6;
const TRAILING = /[\s,;:.\-–—]+$/;

/**
 * The ways a label can be written, widest first: the whole label, without its counter, then the name truncated one character at a time with an
 * ellipsis, down to `MIN_LABEL_CHARS` characters (never fewer; a name of six characters or less is never truncated). Each is narrower than the one
 * before. The first is what the label wants; the others are what the plan falls back to when there is no room for it.
 */
export function labelVariants(name: string, chip: string | null): LabelText[] {
  const key = `${chip ?? ""}|${name}`;
  const hit = variantCache.get(key);
  if (hit) return hit;
  const out: LabelText[] = [];
  let last = Infinity;
  const add = (n: string, c: string | null) => {
    const v = labelText(n, c);
    if (v.w >= last) return; // the shorter ways must really be narrower (the ellipsis is a wide glyph: cutting one letter does not shorten a label)
    last = v.w;
    out.push(v);
  };
  add(name, chip);
  if (chip) add(name, null);
  const chars = Array.from(name);
  for (let n = chars.length - 1; n >= MIN_LABEL_CHARS; n--) add(chars.slice(0, n - 1).join("").replace(TRAILING, "") + "…", null);
  if (variantCache.size > 4000) variantCache.clear();
  variantCache.set(key, out);
  return out;
}

/**
 * The label while hovered, focused or selected: the name with its country when the country is known ("Houston, United States"), and the
 * counter if it has one. Nothing else changes: it is written once, whole, never shortened (it may overlay a neighbour).
 */
export function expandedLabel(name: string, country: string | null, chip: string | null): LabelText {
  return labelText(country ? `${name}, ${country}` : name, chip);
}
