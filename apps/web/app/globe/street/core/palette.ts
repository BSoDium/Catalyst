/**
 * The street renderer's side of the shared palette (`engine/palette.ts`): how a level travels from the MapLibre style
 * to the pixel pass, and the colours the pass presents. Nothing here knows how many levels there are.
 *
 * Channel contract between the style and the pass (the source render is plain 8-bit RGBA):
 *   LINES   R = ink strength: `THIN_INK` (0.75, a one-pixel line the pass may thin) or 1 (a wide line);
 *           G = R x level / LEVEL_SCALE.  The pass reads the level as G / R, which is exact whatever the coverage of an
 *           antialiased edge texel and whatever R is, so the quantisation to levels has no smoothing between cells.
 *   FILLS   B = (pattern x 16 + level) / 255, R = G = 0 (fills are opaque and not antialiased, so B is exact). R = G = 0 keeps
 *           a line that is drawn over a fill (and shows 25 % of it through its opacity) readable: only B is polluted, and
 *           lines never read B. The pass lights the cells of the fill that its PATTERN lattice selects (a function of the
 *           screen cell only, so it never moves under pan or zoom) at the fill's level, the others stay page colour.
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
/**
 * Screen-anchored fill patterns (a lattice of lit art cells, evaluated by the pass from the cell coordinates only). The
 * ids are the values written to the G channel of a fill; keep them in step with `patternLit` in gl/pixel-pass.ts.
 *   flat    every cell of the fill is lit (building washes)
 *   green   parks, woods, grass: a sparse regular lattice of single dots, a dot every 4 cells, alternate rows offset by 2
 *   water   sea, lakes, rivers: short horizontal dashes in rows 4 cells apart, alternate rows offset by half a period
 */
export const PATTERN = { flat: 0, green: 1, water: 2 } as const;
export type Pattern = keyof typeof PATTERN;

/** MapLibre colour of an opaque fill at a level, with the pattern that selects which of its cells are lit. */
export const fillColor = (level: number, pattern: Pattern = "flat"): string => `rgb(0,0,${PATTERN[pattern] * 16 + level})`;
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
