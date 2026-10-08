/**
 * Theme colours are read from the app's CSS variables (docs/design-tokens.md), so light and dark follow
 * `prefers-color-scheme` and any future token change reaches the globe without touching this code.
 */
import { activeLevels, buildRamp, roleColor, roleLevel } from "./palette";

export type Rgb = readonly [number, number, number];

export interface Rgba {
  rgb: Rgb;
  a: number;
}

export interface GlobeTheme {
  /** Page colour. Also the ocean (the disc body): the globe is only ever drawn as linework on the page colour. */
  background: Rgb;
  /** Markers and the route: the palette's full ink (the loudest thing on the map). */
  ink: Rgb;
  /** Coastlines and fully faded-in borders: the palette's `coast` level, the loudest the MAP gets (`MAP_CONTRAST`), one level under the box at rest (`peak`) and far below the ink. */
  coast: Rgb;
  /** Horizon outline: one palette level below the graticule's `faint` (`outlineLevel`, level 2 of 12: 1.24:1 light, 1.21:1 dark against the page), a quiet edge, not a line. */
  outline: Rgb;
  /** Graticule dots (the palette's `faint` level). */
  grid: Rgb;
  /** The shared grey ramp (engine/palette.ts): page colour ... ink. Borders step through it as they fade in. */
  ramp: readonly Rgb[];
}

const byte = (v: string) => Math.min(255, Math.max(0, Number(v))) / 255;
const alpha = (v: string | undefined) => {
  if (v === undefined) return 1;
  const n = v.endsWith("%") ? Number(v.slice(0, -1)) / 100 : Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
};

/**
 * Parses what `getComputedStyle().color` returns for sRGB colours: `rgb()`/`rgba()` (comma or space syntax),
 * `color(srgb r g b / a)`, and `#rgb` / `#rrggbb` as a fallback. Returns null for anything else.
 */
export function parseCssColor(input: string): Rgba | null {
  const s = input.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (hex) {
    const h = hex[1]!.length === 3 ? [...hex[1]!].map((c) => c + c).join("") : hex[1]!;
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
    return { rgb: [n(0), n(2), n(4)], a: 1 };
  }
  const fn = /^rgba?\(\s*([^)]+)\)$/.exec(s);
  if (fn) {
    const [parts, a] = fn[1]!.split("/");
    const nums = parts!.trim().split(/[\s,]+/);
    const alphaPart = a?.trim() ?? nums[3];
    if (nums.length < 3 || nums.slice(0, 3).some((n) => !Number.isFinite(Number(n)))) return null;
    return { rgb: [byte(nums[0]!), byte(nums[1]!), byte(nums[2]!)], a: alpha(alphaPart) };
  }
  const srgb = /^color\(\s*srgb\s+([^)]+)\)$/.exec(s);
  if (srgb) {
    const [parts, a] = srgb[1]!.split("/");
    const nums = parts!.trim().split(/\s+/).map(Number);
    if (nums.length < 3 || nums.some((n) => !Number.isFinite(n))) return null;
    const c = (n: number) => Math.min(1, Math.max(0, n));
    return { rgb: [c(nums[0]!), c(nums[1]!), c(nums[2]!)], a: alpha(a?.trim()) };
  }
  return null;
}

/** Composite `fg` over an opaque background. */
export function over(fg: Rgba, bg: Rgb): Rgb {
  const mix = (i: 0 | 1 | 2) => fg.rgb[i] * fg.a + bg[i] * (1 - fg.a);
  return [mix(0), mix(1), mix(2)];
}

const FALLBACK = {
  light: { background: [0.984, 0.984, 0.984], ink: [0.039, 0.039, 0.039] },
  dark: { background: [0.039, 0.039, 0.039], ink: [0.96, 0.96, 0.96] },
} satisfies Record<string, { background: Rgb; ink: Rgb }>;

/** Resolve a custom property to a colour by letting the browser compute `color: var(--name)` on a probe. */
function readToken(host: HTMLElement, name: string): Rgba | null {
  const probe = document.createElement("span");
  probe.style.color = `var(${name})`;
  probe.style.display = "none";
  host.append(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return parseCssColor(value) ?? parseCssColor(getComputedStyle(host).getPropertyValue(name));
}

/**
 * The theme comes from the two tokens `--background` and `--foreground` only; every other colour of the map is a level
 * of the grey ramp derived from them (engine/palette.ts), so the globe and the street map share one palette.
 */
export function readTheme(host: HTMLElement): GlobeTheme {
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  const fb = dark ? FALLBACK.dark : FALLBACK.light;
  const opaque = (name: string, fallback: Rgb): Rgb => readToken(host, name)?.rgb ?? fallback;
  return themeFromTokens(opaque("--background", fb.background), opaque("--foreground", fb.ink));
}

/** Level of the globe's horizon outline: one below the graticule (`faint`), never the page colour. 12 levels: 2 (the graticule is 3). */
export const outlineLevel = (levels: number): number => Math.max(1, roleLevel("faint", levels) - 1);

export function themeFromTokens(background: Rgb, ink: Rgb, levels: number = activeLevels()): GlobeTheme {
  const ramp = buildRamp(background, ink, levels);
  return { background, ink, coast: roleColor(ramp, "coast"), outline: ramp[outlineLevel(levels)]!, grid: roleColor(ramp, "faint"), ramp };
}
