/** Test helpers: read a palette level back out of a style paint (the inverse of core/palette.ts `lineColor` / `fillColor`). */
import { LEVEL_SCALE } from "../core/palette";

const decode = (c: string) => /^rgb\((\d+),(\d+),(\d+)\)$/.exec(c)!.slice(1).map(Number) as [number, number, number];

/** Level encoded by a style colour (`rgb(255,G,0)` for lines; `rgb(0,0,B)` for fills, B = pattern x 16 + level). */
export function decodeLevel(c: string): number {
  const [r, g, b] = decode(c);
  return r > 0 ? Math.round((g / 255) * LEVEL_SCALE) : b & 15;
}
/** Pattern id encoded by a fill colour (0 = flat). */
export function decodePattern(c: string): number {
  const [r, , b] = decode(c);
  return r > 0 ? 0 : b >> 4;
}
/** Level of a (constant or zoom-`step`) style colour at a zoom. */
export function levelOfPaint(v: unknown, z: number): number {
  if (typeof v === "string") return decodeLevel(v);
  const e = v as unknown[]; // ["step", ["zoom"], c0, z1, c1, ...]
  let out = e[2] as string;
  for (let i = 3; i < e.length; i += 2) if (z >= (e[i] as number)) out = e[i + 1] as string;
  return decodeLevel(out);
}

