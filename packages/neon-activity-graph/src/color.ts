/**
 * Colours for the glass and the rods, made safe. The blocks are lit by emissive rods and by baked ground light tuned for a range of colours: a colour that is too bright blows the glow and the exposure out, one that is too dark
 * leaves black, opaque glass. `clampTone` takes any colour a visitor can pick, works in OKLCH (where lightness is what the eye sees as lightness, whatever the hue), and brings its lightness and chroma into the range where
 * the picture looks right, keeping the hue. Pure.
 */
import type { ColorInput } from "./types";

export type Oklch = { l: number; c: number; h: number };

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLinear = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

/** `#rrggbb` or 0xrrggbb to sRGB 0..1. */
export function parseColor(input: ColorInput): [number, number, number] {
  const n = typeof input === "number" ? input : parseInt(input.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function srgbToOklch([r, g, b]: [number, number, number]): Oklch {
  const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(a, bb);
  return { l: L, c, h: c < 1e-4 ? 0 : ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360 };
}

/** OKLCH to sRGB 0..1, or null when it is outside the sRGB gamut. */
export function oklchToSrgb({ l: L, c, h }: Oklch): [number, number, number] | null {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  if (lin.some((v) => v < -1e-4 || v > 1 + 1e-4)) return null;
  return lin.map((v) => fromLinear(Math.min(1, Math.max(0, v)))) as [number, number, number];
}

/** The range a colour is brought into (OKLCH lightness of the busiest day's glass; its quiet day's is `LOW_SHARE` of it). */
export const TONE_RANGE = { lMin: 0.6, lMax: 0.72, cMax: 0.19, achromatic: 0.03 };
const LOW_SHARE = 0.74;

const hex = (rgb: [number, number, number]) => `#${rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;

/** A colour at lightness `l` and hue `h` with as much chroma as the sRGB gamut allows, up to `c` (the chroma is lowered until it fits). */
function fit(l: number, c: number, h: number): [number, number, number] {
  for (let k = 0; k < 40; k++) {
    const rgb = oklchToSrgb({ l, c: c * (1 - k / 40), h });
    if (rgb) return rgb;
  }
  return fromGrey(l);
}
const fromGrey = (l: number): [number, number, number] => {
  const v = fromLinear(l ** 3);
  return [v, v, v];
};

/**
 * Any colour to a `[low, high]` pair of tones (the glass of a quiet day and of the busiest one): the lightness of `high` is brought into `TONE_RANGE` (a very dark colour is lifted, a very light one lowered), the chroma capped (a
 * grey stays grey) and fitted into the sRGB gamut, the hue kept; `low` is the same hue a little darker.
 */
export function clampTone(input: ColorInput): [string, string] {
  const { l, c, h } = srgbToOklch(parseColor(input));
  const { lMin, lMax, cMax, achromatic } = TONE_RANGE;
  const L = Math.min(lMax, Math.max(lMin, l));
  const grey = c < achromatic;
  const C = grey ? c * 0.5 : Math.min(cMax, c);
  return [hex(fit(L * LOW_SHARE, C * 0.92, h)), hex(fit(L, C, h))];
}

/** Whether two colours are the same one (by their 8-bit channels), whatever way each is written. */
export function sameColor(a: ColorInput, b: ColorInput): boolean {
  const x = parseColor(a).map((v) => Math.round(v * 255));
  const y = parseColor(b).map((v) => Math.round(v * 255));
  return x.every((v, i) => v === y[i]);
}
