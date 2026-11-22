import type { Rgb, RodContext } from "neon-activity-graph";

/**
 * The `?xmas` picture's one change to the stock neon (the green and blue of the default palette): a few of the top layer's blocks light up bright red, picked by day, the same ones each time. Given to the graph library as its `rodColor`,
 * which colours the rods it gives a colour to and leaves the others as they are. The brightness is the activity, as ever.
 */
const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hex = (h: string): Rgb => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255].map(srgbToLinear) as unknown as Rgb;
// (brighter than 1: the library scales a rod's colour by its activity, and a plain red at that scale is the dimmest of the lights)
const RED = hex("#ff1414").map((c) => c * 2.4) as unknown as Rgb;
/** How many of the top layer's blocks are red (out of 100). */
export const RED_SHARE = 22;

export function xmasRod({ index, layer }: RodContext): Rgb | null {
  if (layer !== "top") return null;
  const h = Math.imul(index + 1, 2654435761) ^ Math.imul(13, 40503);
  return (((h >>> 7) % 100) + 100) % 100 < RED_SHARE ? RED : null;
}
