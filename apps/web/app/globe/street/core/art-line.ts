/**
 * Pure logic of the "old LCD" line rules (docs/pixel-line-rules.md, variant F). Everything here has a GLSL twin in
 * `gl/pixel-pass.ts` or is a definition the style and the tests share:
 *
 *  - width ramps expressed in ART pixels with a hard floor of one art pixel, and the hollow-road interior derived
 *    from the casing so the edge lines are exactly one art pixel wide;
 *  - the ink classes: a one-pixel line is painted at `THIN_INK`, a wide one at full strength, so the pass knows
 *    which cells it may thin;
 *  - tone patterns that depend only on the screen cell (never on the world).
 *
 * The measurement toolbox (masks, components, the reference rasteriser) lives in `art-measure.ts`: it is only
 * used by tests and the regression harness and stays out of the street chunk.
 */

/** Class codes stored in the art texture. Twin of `CODE` in gl/pixel-pass.ts. */
export const CODE = { none: 0, thin: 1, solid: 2, tone: 3, muted: 4 } as const;

export type Stops = readonly (readonly [number, number])[];

/** The CSS-px nominal design unit of one art pixel (3 on desktop). Nominal widths are authored against it. */
export const DESIGN_CELL_CSS = 3;

/** MapLibre `interpolate exponential` between stops, clamped outside (same maths as the style expression). */
export function expInterp(stops: Stops, z: number, base = 1.5): number {
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  if (z <= first[0]) return first[1];
  if (z >= last[0]) return last[1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [z0, v0] = stops[i]!;
    const [z1, v1] = stops[i + 1]!;
    if (z >= z0 && z <= z1) {
      const t = base === 1 ? (z - z0) / (z1 - z0) : (Math.pow(base, z - z0) - 1) / (Math.pow(base, z1 - z0) - 1);
      return v0 + (v1 - v0) * t;
    }
  }
  return last[1];
}

/** Nominal CSS-px stops to art-pixel stops with a floor: no line is ever thinner than `minArt` art pixels. */
export function artStops(cssStops: Stops, minArt = 1, designCell = DESIGN_CELL_CSS): Stops {
  return cssStops.map(([z, w]) => [z, Math.max(minArt, w / designCell)] as const);
}

/** Art-pixel stops to CSS-px stops for a concrete cell size (a whole number of device px / dpr). */
export function cssStops(art: Stops, cellCss: number): Stops {
  return art.map(([z, w]) => [z, w * cellCss] as const);
}

/**
 * Ink strength encodes the line class for the pass: a line that is meant to be ONE art pixel wide is painted at
 * `THIN_INK` (R = 0.75), a wider line at full strength (R = 1). The pass thins only cells below `SOLID_FROM`, so
 * the staircase cleanup can never eat a deliberately wide road. The ink threshold of the pass is `0.49 * THIN_INK`,
 * which is the same "pixel centre inside the line" test for both classes.
 */
export const THIN_INK = 0.75;
export const SOLID_FROM = 0.9;
/** Ink threshold of the centre rule: half of the weakest ink. */
export const INK_THRESHOLD = 0.49 * THIN_INK;
/** art-pixel widths up to this are one-pixel lines; from `WIDE_FROM` they are wide lines; ramp in between */
export const THIN_UP_TO = 1.25;
export const WIDE_FROM = 1.6;

/** Ink opacity for a line of this width (art px). */
export function inkOpacityFor(widthArt: number): number {
  if (widthArt <= THIN_UP_TO) return THIN_INK;
  if (widthArt >= WIDE_FROM) return 1;
  return THIN_INK + ((1 - THIN_INK) * (widthArt - THIN_UP_TO)) / (WIDE_FROM - THIN_UP_TO);
}

/**
 * Ink opacity stops over zoom for a width ramp, sampled densely so the class switch follows the width.
 * `hollowFrom`: from this zoom the casing is only the two one-pixel OUTLINES of a hollow road (the interior is
 * erased), so it is a thin-line class again whatever the total road width.
 */
export function inkOpacityStops(widthArt: Stops, base = 1.5, step = 0.25, hollowFrom: number | null = null): Stops {
  const z0 = widthArt[0]![0];
  const z1 = widthArt[widthArt.length - 1]![0];
  const out: [number, number][] = [];
  for (let z = z0; z < z1 + 1e-9; z += step) {
    const hollow = hollowFrom !== null && z >= hollowFrom;
    out.push([Math.round(z * 1000) / 1000, hollow ? THIN_INK : inkOpacityFor(expInterp(widthArt, z, base))]);
  }
  if (hollowFrom !== null && hollowFrom > z0 && hollowFrom < z1) {
    // make the switch sharp at the hollow zoom, not one sample later
    out.push([hollowFrom - 1e-3, inkOpacityFor(expInterp(widthArt, hollowFrom - 1e-3, base))], [hollowFrom, THIN_INK]);
  }
  // A width that STEPS (two stops a hair apart, e.g. 1 to 2 art px at z9) must switch the ink class with it: sample every stop and a hair
  // before it, so a 2 px line is never painted at the thin ink strength between two coarse samples.
  for (const [z] of widthArt) {
    if (z <= z0 || z >= z1) continue;
    for (const zz of [z - 1e-3, z]) if (!hollowFrom || zz < hollowFrom - 1e-3 || zz >= hollowFrom) out.push([Math.round(zz * 1000) / 1000, hollowFrom !== null && zz >= hollowFrom ? THIN_INK : inkOpacityFor(expInterp(widthArt, zz, base))]);
  }
  out.sort((a, b) => a[0] - b[0]);
  // strictly ascending stops (MapLibre requires it): drop a sample that repeats a zoom
  return out.filter((p, i) => i === 0 || p[0] > out[i - 1]![0]);
}

export interface HollowOptions {
  /** width in art px of each outline of a hollow road */
  edge?: number;
  /** smallest interior that keeps the two outlines apart at every angle and offset (they merge at 45 degrees below ~2) */
  minInterior?: number;
  base?: number;
  step?: number;
  maxZoom?: number;
}

/**
 * Width (art px) of the erasing interior of a hollow road whose casing follows `caseArt`.
 * Rule: a road is hollow only when its casing is wide enough for two outlines plus a visible interior
 * (2 * edge + minInterior = 4 art px); then the outlines are exactly `edge` wide. Below that it stays one solid line.
 * Returns dense stops (so the exponential interpolation of the style tracks `case - 2 * edge` closely) including the
 * jump from 0 to `minInterior` at the zoom where the casing reaches 4 art px.
 */
export function hollowFillStops(caseArt: Stops, o: HollowOptions = {}): Stops {
  const edge = o.edge ?? 1;
  const minInt = o.minInterior ?? 2;
  const base = o.base ?? 1.5;
  const step = o.step ?? 0.25;
  const zMin = caseArt[0]![0];
  const zMax = o.maxZoom ?? caseArt[caseArt.length - 1]![0];
  const need = 2 * edge + minInt;
  const out: [number, number][] = [];
  let zc: number | null = null;
  for (let z = zMin; z <= zMax + 1e-9; z += 0.005) {
    if (expInterp(caseArt, z, base) >= need - 1e-9) {
      zc = z;
      break;
    }
  }
  if (zc === null) return [[zMin, 0], [zMax, 0]];
  out.push([zMin, 0]);
  if (zc - 1e-3 > zMin) out.push([zc - 1e-3, 0]);
  out.push([zc, minInt]);
  for (let z = Math.ceil(zc / step) * step; z <= zMax + 1e-9; z += step) {
    if (z > zc + 1e-6) out.push([Math.round(z * 1000) / 1000, Math.max(minInt, expInterp(caseArt, z, base) - 2 * edge)]);
  }
  return out;
}

/** 8x8 Bayer value 0..63: the standard recursive matrix, by bit interleave (identical to the GLSL). */
export function bayer8(x: number, y: number): number {
  const hi = y & 7;
  const lo = (x ^ y) & 7;
  let v = 0;
  for (let i = 0; i < 3; i++) v = (v << 2) | (((hi >> (2 - i)) & 1) << 1) | ((lo >> (2 - i)) & 1);
  return ((v & 1) << 5) | ((v & 2) << 3) | ((v & 4) << 1) | ((v & 8) >> 1) | ((v & 16) >> 3) | ((v & 32) >> 5);
}

/** Dither threshold in (0,1) for art cell (cx, cy). */
export function ditherThreshold(cx: number, cy: number): number {
  return (bayer8(cx, cy) + 0.5) / 64;
}

/**
 * Is the cell (cx, cy) lit for a fill of this tone? The cell is a SCREEN cell: the result depends on nothing but the
 * tone and the cell coordinates, so a stipple never swims under pan or zoom. The tone is first quantised to
 * sixteenths, which makes the Bayer thresholds trace regular dot lattices (1/16 one dot per 4x4, 1/4 every other
 * pixel, 1/2 a checkerboard) instead of a scatter.
 */
export function toneLit(tone: number, cx: number, cy: number): boolean {
  const k = Math.floor(tone * 16 + 0.5);
  return bayer8(cx, cy) < k * 4;
}
