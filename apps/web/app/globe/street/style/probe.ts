/** Test helpers: read a palette level back out of a style paint (the inverse of core/palette.ts `lineColor` / `fillColor`). */
import { LEVEL_SCALE } from "../core/palette";

/** Level encoded by a style colour (`rgb(255,G,0)` for lines, `rgb(0,0,B)` for fills). */
export function decodeLevel(c: string): number {
  const m = /^rgb\((\d+),(\d+),(\d+)\)$/.exec(c)!;
  return Math.round(((Number(m[2]) || Number(m[3])) / 255) * LEVEL_SCALE);
}
/** Level of a (constant or zoom-`step`) style colour at a zoom. */
export function levelOfPaint(v: unknown, z: number): number {
  if (typeof v === "string") return decodeLevel(v);
  const e = v as unknown[]; // ["step", ["zoom"], c0, z1, c1, ...]
  let out = e[2] as string;
  for (let i = 3; i < e.length; i += 2) if (z >= (e[i] as number)) out = e[i + 1] as string;
  return decodeLevel(out);
}

