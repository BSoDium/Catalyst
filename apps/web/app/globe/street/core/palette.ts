/**
 * The street renderer's side of the shared palette (`engine/palette.ts`): how a level travels from the MapLibre style
 * to the pixel pass, and the colours the pass presents. Nothing here knows how many levels there are.
 *
 * Channel contract between the style and the pass (the source render is plain 8-bit RGBA):
 *   LINES   R = ink strength: `THIN_INK` (0.75, a one-pixel line the pass may thin) or 1 (a wide line);
 *           G = R x level / LEVEL_SCALE.  The pass reads the level as G / R, which is exact whatever the coverage of an
 *           antialiased edge texel and whatever R is, so the quantisation to levels has no smoothing between cells.
 *   FILLS   B = level / LEVEL_SCALE (fills are opaque and not antialiased, so B is exact);
 *   ERASE   black: the page colour (hollow road interiors, route halos).
 * The art texture the pass writes holds, per cell, the level in R and the line class (none / thin / solid) in G.
 */
import { CODE } from "./art-line";
import { MAX_LEVELS, PALETTE_LEVELS, activeLevels, buildRamp, roleLevel, type Rgb, type Role } from "../../engine/palette";

export { MAX_LEVELS, PALETTE_LEVELS, activeLevels, roleLevel };
export type { Role };

/** One unit of the level encoding: level k is written as k / LEVEL_SCALE. */
export const LEVEL_SCALE = MAX_LEVELS;

const byte = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);

/** MapLibre colour of a line at a level (opacity carries thin / solid). */
export const lineColor = (level: number): string => `rgb(255,${byte(level / LEVEL_SCALE)},0)`;
/** MapLibre colour of an opaque fill at a level. */
export const fillColor = (level: number): string => `rgb(0,0,${byte(level / LEVEL_SCALE)})`;
/** The erasing colour: the page colour. */
export const ERASE = "#000000";

/** Level written for the 1 art pixel limb where a globe projection's disc edge straddles a cell (role `soft`). */
export const limbLevel = (n: number = activeLevels()): number => roleLevel("soft", n);

export interface PaletteTheme {
  background: Rgb;
  ink: Rgb;
}

export interface Palette {
  /** One colour per level, level 0 = page colour, last = ink. */
  rgb: Rgb[];
  levels: number;
  limbLevel: number;
}

export function buildPalette(theme: PaletteTheme, n: number = activeLevels()): Palette {
  const rgb = buildRamp(theme.background, theme.ink, n);
  return { rgb, levels: rgb.length, limbLevel: limbLevel(rgb.length) };
}

/** Class code of the art cell as `readCodes` reports it: lines keep thin / solid, any other lit cell is a fill (`tone`). */
export function codeOf(level: number, lineClass: number): number {
  if (lineClass === 1) return CODE.thin;
  if (lineClass === 2) return CODE.solid;
  return level > 0 ? CODE.tone : CODE.none;
}
