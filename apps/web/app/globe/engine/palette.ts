/**
 * THE grey palette of the map, shared by the Three.js globe and the street renderer so the two read as one system.
 *
 * Two CSS tokens (`--background`, `--foreground`; light and dark) are the only input. `PALETTE_LEVELS` greys between
 * them, interpolated in OKLab (so equal steps look equal in both themes, and the dark theme is not a lighter copy of the
 * light one). Level 0 is the page colour, the LAST level the full ink, and the levels in between form the MAP RAMP: they
 * only reach `MAP_CONTRAST` of the way from the page colour to the ink. So everything the map draws (coastlines, borders,
 * roads, rail, fills, graticule) tops out well below the ink, and the ink itself is kept for what must stand out: markers,
 * labels, the selected place and its route. `MAP_CONTRAST` is THE knob of how loud the map is, for both renderers.
 *
 * Everything else is a named ROLE that resolves to one of the levels for the current count, so the number of levels is one
 * constant: roles that are closer than a level apart simply share it.
 *
 *   role    position   used for
 *   bg      0          page, ocean, erased interiors
 *   wash    0.12       building fills; the first step of every fade-in
 *   faint   0.27       graticule, the dots of parks
 *   soft    0.42       rail, paths, service roads, streams, canals, the horizon outline, the dashes of water
 *   mid     0.60       minor roads, region borders, building outlines, tertiary roads
 *   strong  0.80       major roads, rivers, lakes
 *   peak    1          coastline, country borders: the loudest the map gets (MAP_CONTRAST of the way to the ink)
 *   ink     (last)     markers, labels, the selected place, routes: the full foreground
 *
 * Fades are TONE ramps: a feature that appears with zoom starts at the faintest level and steps through the levels up
 * to its role's level (`rampLevel`), it never dithers. Quantising to levels involves no smoothing between cells; the
 * line rules of docs/pixel-line-rules.md (1 art-pixel floor, centre sampling, no antialiased grey, stair removal) do not
 * look at levels at all.
 */

export type Rgb = readonly [number, number, number];

/** Total number of levels, page colour and ink included. Compared at 4, 6, 8, 10 and 12 in docs/palette/; 12 because the map ramp only spans MAP_CONTRAST of the range, and fades need small steps. */
export const PALETTE_LEVELS = 12;
/** Capacity of the shader's palette array and of the style's level encoding. */
export const MAX_LEVELS = 12;
/** Smallest ramp that still has a faintest level, a middle and the ink. */
export const MIN_LEVELS = 3;

/**
 * How far from the page colour to the ink the loudest map content (the `peak` level: coastlines, country borders) gets,
 * 0..1 in OKLab. 1 would draw the map in full ink (the first palette build); the owner asked for a recessive map, where
 * markers, labels and the selection are the only full-ink things. Tuned by eye in both themes (docs/palette/).
 */
export const MAP_CONTRAST = 0.55;
/** The dark page needs a little more than the light one for the same recession (equal lightness steps read weaker on a dark ground). */
export const MAP_CONTRAST_DARK = 0.58;

export const ROLES = ["bg", "wash", "faint", "soft", "mid", "strong", "peak", "ink"] as const;
export type Role = (typeof ROLES)[number];

/** Position of each role along the MAP ramp (page colour 0 to `peak` 1). `ink` is not on it: it is the last level. */
export const ROLE_POSITION: Record<Exclude<Role, "ink">, number> = { bg: 0, wash: 0.12, faint: 0.27, soft: 0.42, mid: 0.6, strong: 0.8, peak: 1 };

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

/** Highest level of the map ramp (`peak`): one below the ink. */
export const peakLevel = (n: number = activeLevels()): number => clampLevels(n) - 2;

/** Level index of a role: 0 for the page colour, `n - 1` for the ink, 1 .. `n - 2` for the map roles (`peak` = `n - 2`). */
export function roleLevel(role: Role, n: number = activeLevels()): number {
  const count = clampLevels(n);
  if (role === "bg") return 0;
  if (role === "ink") return count - 1;
  const top = count - 2;
  return Math.min(top, Math.max(1, Math.round(ROLE_POSITION[role] * top)));
}

/**
 * The level a fade-in is at, as a staircase of `finalLevel` equal steps over t in (0, 1]: 0 at t <= 0 (not drawn), 1 just
 * above 0 (the faintest level), `finalLevel` at t >= 1. Equal steps in t (zoom) keep every step the same length.
 */
export function rampLevel(t: number, finalLevel: number): number {
  if (!(t > 0)) return 0;
  if (t >= 1) return finalLevel;
  return Math.min(finalLevel, Math.max(1, Math.ceil(t * finalLevel)));
}

/** Zoom at which a fade-in over [from, full] with `finalLevel` steps enters level `k` (1..finalLevel). */
export const rampStepZoom = (from: number, full: number, finalLevel: number, k: number): number => from + ((k - 1) / finalLevel) * (full - from);

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

/** The map contrast for a theme: how far (0..1) the peak level is from the page colour towards the ink. */
export const mapContrastFor = (background: Rgb, ink: Rgb): number => (srgbToOklab(ink)[0] < srgbToOklab(background)[0] ? MAP_CONTRAST : MAP_CONTRAST_DARK);

/** The ramp: `n` colours from the page colour to the ink, interpolated in OKLab (map levels eased on a light page, see `RAMP_GAMMA`). */
export function buildRamp(background: Rgb, ink: Rgb, n: number = activeLevels(), contrast: number = mapContrastFor(background, ink)): Rgb[] {
  const count = clampLevels(n);
  const light = srgbToOklab(ink)[0] < srgbToOklab(background)[0];
  const gamma = light ? RAMP_GAMMA : 1;
  const top = count - 2;
  return Array.from({ length: count }, (_, k) => (k === 0 ? background : k === count - 1 ? ink : mixOklab(background, ink, contrast * (k / top) ** gamma)));
}

/** Colour of a role in a ramp built by `buildRamp`. */
export const roleColor = (ramp: readonly Rgb[], role: Role): Rgb => ramp[roleLevel(role, ramp.length)]!;

/** Level of the country borders at an internal globe zoom: a tone fade-in over `TUNING.borderZoom` (see tuning.ts) up to the `peak` level. */
export function borderLevel(zoom: number, levels: number, range: { readonly start: number; readonly end: number }): number {
  return rampLevel((zoom - range.start) / (range.end - range.start), peakLevel(levels));
}
