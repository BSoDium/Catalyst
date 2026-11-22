import type { Rgb, RodContext } from "neon-activity-graph";

/**
 * The colours of the `?xmas` picture's rods (see `lib/xmas.ts`), given to the graph library as its `rodColor`: every rod is one of a string of lights, mostly white with the colours of a tree's as its highlights (red, green, gold, blue),
 * the same for a day each time. The brightness is the activity, as ever.
 */
const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hex = (h: string): Rgb => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255].map(srgbToLinear) as unknown as Rgb;
const COLOURS = ["#ff0a0a", "#00e03c", "#ffa600", "#1a3cff", "#ff0a0a", "#00e03c"].map(hex);
const WHITE = hex("#f8faff");
const scale = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];

export function xmasRod({ index, layer, t }: RodContext): Rgb {
  const h = Math.imul(index + 1, 2654435761) ^ Math.imul(layer === "bottom" ? 97 : 13, 40503);
  const slot = (((h >>> 7) % 10) + 10) % 10;
  // (a white light that is dim is a grey one, and no lamp glows grey: a quiet day is never white, it takes a colour of the string; a busy day's white is kept at a good brightness)
  // (white is the string's default, the colours are its highlights: 7 slots of 10 for a busy day, 3 for a quiet one)
  if (slot < (t >= 0.5 ? 7 : 3) && t >= 0.35) return scale(WHITE, 0.6 + 0.4 * t);
  return scale(COLOURS[(((h >>> 13) % COLOURS.length) + COLOURS.length) % COLOURS.length]!, 0.3 + 0.7 * t);
}
