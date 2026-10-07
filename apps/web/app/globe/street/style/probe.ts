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


/**
 * Evaluate the subset of MapLibre filter / expression syntax the street style uses against one feature (tests only: it lets a
 * unit test ask "does this boundary feature get drawn?" without a GL context). Missing properties are null, like MapLibre's `get`.
 */
export function evalFilter(expr: unknown, props: Record<string, unknown>, geometry: "LineString" | "Polygon" | "MultiPolygon" | "Point" = "LineString"): unknown {
  if (!Array.isArray(expr)) return expr;
  const [op, ...a] = expr as [string, ...unknown[]];
  const ev = (x: unknown) => evalFilter(x, props, geometry);
  switch (op) {
    case "literal": return a[0];
    case "get": return props[a[0] as string] ?? null;
    case "has": return props[a[0] as string] !== undefined;
    case "geometry-type": return geometry;
    case "all": return a.every((x) => ev(x) === true);
    case "any": return a.some((x) => ev(x) === true);
    case "!": return ev(a[0]) !== true;
    case "==": return ev(a[0]) === ev(a[1]);
    case "!=": return ev(a[0]) !== ev(a[1]);
    case ">=": return (ev(a[0]) as number) >= (ev(a[1]) as number);
    case "<=": return (ev(a[0]) as number) <= (ev(a[1]) as number);
    case "to-number": { const v = ev(a[0]); const n = typeof v === "number" ? v : Number(v); return Number.isFinite(n) && v !== null ? n : ev(a[1]); }
    case "in": { const hay = ev(a[1]); return Array.isArray(hay) ? hay.includes(ev(a[0])) : false; }
    default: throw new Error(`evalFilter: unsupported operator ${op}`);
  }
}
