/**
 * THE grey palette of the map, shared by the Three.js globe and the street renderer so the two read as one system.
 *
 * Two CSS tokens (`--background`, `--foreground`; light and dark) are the only input. `PALETTE_LEVELS` greys between
 * them, interpolated in OKLab (so equal steps look equal in both themes, and the dark theme is not a lighter copy of the
 * light one). Level 0 is the page colour, the LAST level the full ink, and the levels in between form the MAP RAMP: they
 * only reach `MAP_CONTRAST` of the way from the page colour to the ink (the `coast` level), plus one level, `peak`, for the box at
 * rest (`BOX_CONTRAST`). So everything the map draws (coastlines, borders, roads, rail, fills, graticule) tops out well below the
 * boxes, and the ink itself is kept for what must stand out: markers, labels, the selected place and its route. `MAP_CONTRAST`
 * (with `MAP_CONTRAST_DARK`) is THE knob of how loud the map is, for both renderers; `BOX_CONTRAST` is how loud a box at rest is.
 *
 * Everything else is a named ROLE that resolves to one of the levels for the current count, so the number of levels is one
 * constant: roles that are closer than a level apart simply share it.
 *
 *   role    position   used for
 *   bg      0          page, ocean, erased interiors
 *   wash    0.12       building fills; the first step of every fade-in
 *   faint   0.27       graticule, the horizon outline, the dots of parks, junction links (road tiers between the roles use `at`, lod.ts: residential, service and paths 0.2, tertiary 0.4)
 *   soft    0.42       rail, streams, canals, the dashes of water
 *   mid     0.60       secondary roads (0.6), region borders, building outlines
 *   strong  0.80       primary roads, rivers, lakes
 *   coast   0.9        coastline, country borders, the water's edge: the loudest the MAP gets (MAP_CONTRAST of the way to the ink)
 *   peak    1          the box at rest (BOX_CONTRAST of the way to the ink): one level ABOVE the coastline, so a box always reads over the map
 *   ink     (last)     markers, labels, the selected place, routes: the full foreground
 *
 * Fades are TONE ramps: a line that appears or goes starts at the faintest level and steps through the levels up to its role's
 * level (`rampLevel`, driven by TIME: a feature is on or off, never half way, engine/fade.ts), it never dithers. Quantising to levels involves no smoothing between cells; the
 * line rules of docs/pixel-line-rules.md (1 art-pixel floor, centre sampling, no antialiased grey, stair removal) do not
 * look at levels at all.
 */

import { hysteresis } from "./fade";
export type Rgb = readonly [number, number, number];

/** Total number of levels, page colour and ink included. Compared at 4, 6, 8, 10 and 12 in docs/palette/; 12 because the map ramp only spans MAP_CONTRAST of the range, and fades need small steps. */
export const PALETTE_LEVELS = 12;
/** Capacity of the shader's palette array and of the style's level encoding. */
export const MAX_LEVELS = 12;
/** Smallest ramp that still has a faintest level, a middle and the ink. */
export const MIN_LEVELS = 3;

/**
 * How far from the page colour to the ink the loudest MAP content (the `coast` level: coastlines, country borders, the water's edge)
 * gets, 0..1 in OKLab: THE knob of how loud the map is. 1 would draw the map in full ink (the first palette build); 0.55 / 0.58 was
 * the value until 2026-10-08 (then shared with the box at rest, 5.2:1 / 5.5:1 against the page), when the owner asked to wash the
 * map out ("so that our labels and bounding boxes are even more visible"): about 40 % less in contrast ratio, 0.40 / 0.42 (3.1:1 / 3.2:1
 * against the page). The levels between the faint end (the `faint` level, untouched: the graticule, the sky and the horizon outline live there)
 * and the coast level are spread between the two on a convex curve (`MAP_RAMP_EXP`), so the road hierarchy keeps its order and every road, river and
 * region border is washed out in proportion. Tuned by eye in both themes (docs/palette/).
 */
export const MAP_CONTRAST = 0.40;
/** The dark page needs a little more than the light one for the same recession (equal lightness steps read weaker on a dark ground). */
export const MAP_CONTRAST_DARK = 0.42;
/**
 * How far to the ink the box at rest (the `peak` level) is: unchanged by the map wash of 2026-10-08, so the boxes are the loudest thing
 * of the map's own greys by a wide margin (5.2:1 / 5.5:1 against the page, the coastline 3.1:1 / 3.2:1). The pixel labels' rest tone is this level.
 */
export const BOX_CONTRAST = 0.55;
export const BOX_CONTRAST_DARK = 0.58;
/**
 * Shape of the stretch between the faint end and the coast level: 1 is even steps, above 1 keeps the middle levels (secondary roads,
 * rivers, region borders) closer to the faint end and puts the rise near the coast, so the whole map is washed out and not only its top.
 */
export const MAP_RAMP_EXP = 1.6;

export const ROLES = ["bg", "wash", "faint", "soft", "mid", "strong", "coast", "peak", "ink"] as const;
export type Role = (typeof ROLES)[number];

/** Position of each role along the MAP ramp (page colour 0 to `peak` 1). `ink` is not on it (it is the last level), nor is `coast` (the level just under `peak`, `coastLevel`); no role is above the coast but the peak. */
export const ROLE_POSITION: Record<Exclude<Role, "ink" | "coast">, number> = { bg: 0, wash: 0.12, faint: 0.27, soft: 0.42, mid: 0.6, strong: 0.8, peak: 1 };

export const clampLevels = (n: number): number => Math.min(MAX_LEVELS, Math.max(MIN_LEVELS, Math.round(n)));

let active = PALETTE_LEVELS;
/**
 * The number of levels in use: `PALETTE_LEVELS` unless a check overrides it (`setActiveLevels`, the `levels` street/globe
 * debug option). Both renderers and the style read it when they are built, so the override must come first.
 */
export const activeLevels = (): number => active;
export function setActiveLevels(n: number | null): void {
  active = n === null ? PALETTE_LEVELS : clampLevels(n);
}

/** Highest level of the map ramp (`peak`, the box at rest): one below the ink. */
export const peakLevel = (n: number = activeLevels()): number => clampLevels(n) - 2;

/** The loudest level of the MAP itself (`coast`): one below `peak` (with 3 levels there is no room and it is the peak). */
export const coastLevel = (n: number = activeLevels()): number => Math.max(1, peakLevel(n) - 1);

/** Level index of a role: 0 for the page colour, `n - 1` for the ink, 1 .. `n - 2` for the map roles (`peak` = `n - 2`). */
export function roleLevel(role: Role, n: number = activeLevels()): number {
  const count = clampLevels(n);
  if (role === "bg") return 0;
  if (role === "ink") return count - 1;
  const top = count - 2;
  if (role === "coast") return coastLevel(count);
  if (role === "peak") return top;
  return Math.min(coastLevel(count), Math.max(1, Math.round(ROLE_POSITION[role] * top)));
}

/**
 * The level a fade-in is at, as a staircase of `finalLevel` equal steps over t in (0, 1]: 0 at t <= 0 (not drawn), 1 just
 * above 0 (the faintest level), `finalLevel` at t >= 1. Equal steps in t (time) keep every step the same length.
 */
export function rampLevel(t: number, finalLevel: number): number {
  if (!(t > 0)) return 0;
  if (t >= 1) return finalLevel;
  return Math.min(finalLevel, Math.max(1, Math.ceil(t * finalLevel)));
}

/**
 * Checks only: `?levels=N` or sessionStorage "palette-levels" overrides the level count, and only on pages in debug mode
 * (`?globe-debug`, sessionStorage "globe-debug" or "street-debug"). Call before the renderers are built.
 */
export function applyDebugLevels(): void {
  try {
    const debug = new URLSearchParams(location.search).has("globe-debug") || sessionStorage.getItem("globe-debug") === "1" || sessionStorage.getItem("street-debug") === "1";
    if (!debug) return;
    const q = new URLSearchParams(location.search).get("levels") ?? sessionStorage.getItem("palette-levels");
    if (q && Number.isFinite(Number(q))) setActiveLevels(Number(q));
  } catch {
    // no storage: keep the default
  }
}

/* ------------------------------------------------------------------ OKLab ------------------------------------------------------------------ */

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

export type Lab = readonly [number, number, number];

export function srgbToOklab([r, g, b]: Rgb): Lab {
  const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

export function oklabToSrgb([L, a, b]: Lab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (v: number) => Math.min(1, Math.max(0, toSrgb(Math.min(1, Math.max(0, v)))));
  return [
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** Perceptual mix of two sRGB colours (0 = a, 1 = b). */
export function mixOklab(a: Rgb, b: Rgb, t: number): Rgb {
  const x = srgbToOklab(a), y = srgbToOklab(b);
  return oklabToSrgb([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

/**
 * On a light page the map ramp is eased: map level k sits at `MAP_CONTRAST * (k / peak) ** RAMP_GAMMA` of the way from the
 * page colour to the ink in OKLab, so the first levels (the first step of every fade-in) are light and the steps grow
 * towards the peak, where the line hierarchy (strong against peak) needs the contrast. On a dark page the ramp is linear in
 * OKLab lightness: the same lightness difference reads weaker on a dark ground, so the first levels need the full step to
 * be seen at all. The last level is the ink itself, outside that ramp.
 */
export const RAMP_GAMMA = 1.15;

/** The map contrast for a theme: how far (0..1) the `coast` level is from the page colour towards the ink. */
export const mapContrastFor = (background: Rgb, ink: Rgb): number => (isLight(background, ink) ? MAP_CONTRAST : MAP_CONTRAST_DARK);
/** The box-at-rest contrast for a theme: how far (0..1) the `peak` level is from the page colour towards the ink. */
export const boxContrastFor = (background: Rgb, ink: Rgb): number => (isLight(background, ink) ? BOX_CONTRAST : BOX_CONTRAST_DARK);
const isLight = (background: Rgb, ink: Rgb): boolean => srgbToOklab(ink)[0] < srgbToOklab(background)[0];

/**
 * The ramp: `n` colours from the page colour to the ink, interpolated in OKLab (map levels eased on a light page, see `RAMP_GAMMA`).
 *
 * Three stretches. From the page colour to `faintLevel` (the graticule, the sky, the horizon outline, the dimmest roads) the ramp is
 * the eased one that reaches `box` at the peak level, untouched by the wash of 2026-10-08: its levels are barely above the page and
 * are the floor that nothing may go under. From there to the `coast` level it rises (in OKLab, convexly, `MAP_RAMP_EXP`) up to `contrast`, the map's
 * loudest tone. The peak level (the box at rest) is `box` of the way, one level above the coast, and the last level is the ink.
 * `contrast` is the map's knob; `box` the box's.
 */
export function buildRamp(background: Rgb, ink: Rgb, n: number = activeLevels(), contrast: number = mapContrastFor(background, ink), box: number = boxContrastFor(background, ink)): Rgb[] {
  const count = clampLevels(n);
  const gamma = isLight(background, ink) ? RAMP_GAMMA : 1;
  const top = count - 2;
  const coast = coastLevel(count);
  const kept = Math.min(roleLevel("faint", count), coast);
  const eased = (k: number) => box * (k / top) ** gamma;
  const share = (k: number): number => {
    if (k >= top) return box;
    if (k <= kept) return Math.min(eased(k), contrast);
    const from = Math.min(eased(kept), contrast);
    return from + (contrast - from) * ((k - kept) / (coast - kept)) ** MAP_RAMP_EXP;
  };
  return Array.from({ length: count }, (_, k) => (k === 0 ? background : k === count - 1 ? ink : mixOklab(background, ink, share(k))));
}

/** Colour of a role in a ramp built by `buildRamp`. */
export const roleColor = (ramp: readonly Rgb[], role: Role): Rgb => ramp[roleLevel(role, ramp.length)]!;

/** Whether the country borders are wanted at an internal globe zoom: on from `range.on + band`, off again below `range.on - band` (a hysteresis, in between it keeps its state). */
export const bordersWanted = (was: boolean, zoom: number, range: { readonly on: number; readonly band: number }): boolean => hysteresis(was, zoom, range.on - range.band, range.on + range.band);

/** Level of the country borders for a fade value 0..1 (engine/fade.ts): 0 = not drawn, then the faintest grey level, stepping up to the `coast` level. */
export function borderLevel(fade: number, levels: number): number {
  return rampLevel(fade, coastLevel(levels));
}

/* ------------------------------------------------------------------ text contrast ------------------------------------------------------------------ */

const luminance = (c: Rgb) => 0.2126 * toLinear(c[0]) + 0.7152 * toLinear(c[1]) + 0.0722 * toLinear(c[2]);

/** WCAG contrast ratio of two sRGB colours (1 .. 21). */
export const contrastRatio = (a: Rgb, b: Rgb): number => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

/** WCAG AA for text that is not large. */
export const AA_TEXT = 4.5;

/** The lowest level of a ramp whose contrast with the page colour (level 0) is AA for text: the dimmest a label may be (light page: the peak level, dark page: one below). */
export function textFloorLevel(ramp: readonly Rgb[], min: number = AA_TEXT): number {
  for (let k = 1; k < ramp.length; k++) if (contrastRatio(ramp[k]!, ramp[0]!) >= min) return k;
  return ramp.length - 1;
}
