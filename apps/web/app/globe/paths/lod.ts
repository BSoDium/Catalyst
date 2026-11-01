/**
 * Level of detail and fade of the paths, as pure functions of the view (so the shader and the tests agree).
 *
 * Detail: the coarsest simplification level whose error is at most `LEVEL_ERROR_CELLS` of an art pixel at the current scale. The
 * switch has a hysteresis (`LEVEL_HYSTERESIS`): the scale has to move 25 % past a boundary to change level, so a zoom that
 * hovers at one never flickers between two.
 *
 * Tone: a leg is never faded out by its length (it used to be: hidden under 2 art pixels, stepping up to full at 14, so the chain of a trip lost its
 * short legs from space, #459). A path that is farther away only loses RESOLUTION (the simplification level above, a coarser dot pitch); where many legs
 * are in one place (`paths/thin.ts` `crowdLegs`) they are one quiet solid tone, `CROWD_TONE` by the crowd's step.
 */
import { EARTH_RADIUS_M } from "./simplify";
import { LOD_TOLERANCES_M } from "./network";

export const LEVEL_ERROR_CELLS = 0.5;
export const LEVEL_HYSTERESIS = 1.25;

/** How far toward the page colour (0..1, solid) a leg of a crowd of step 1..3 is drawn: index 0 is "not crowded". Its mode is carried by the pattern, so a crowd, which has none, is the quiet one. */
export const CROWD_TONE = [0, 0.3, 0.45, 0.55] as const;
/** The same for every leg of the world view with `?paths=solid` (#459, option c: solid quiet lines from space, the patterns back from `SOLID_UNTIL`). */
export const SOLID_TONE = 0.35;
export const SOLID_UNTIL = 3.2;

/** Metres on the ground per art pixel at the centre of the globe: `radiusPx` is `zoomToRadiusPx(zoom)` and `cssPerCell` the art pixel in CSS px. */
export const metresPerCell = (radiusPx: number, cssPerCell: number): number => (EARTH_RADIUS_M * cssPerCell) / radiusPx;

/** The level to draw at `mPerCell`, given the one drawn now (`null`: none yet). */
export function levelFor(mPerCell: number, current: number | null, tolerances: readonly number[] = LOD_TOLERANCES_M): number {
  const half = LEVEL_ERROR_CELLS * mPerCell;
  const last = tolerances.length - 1;
  if (current === null) {
    let k = 0;
    while (k < last && tolerances[k + 1]! <= half) k++;
    return k;
  }
  let k = Math.min(last, Math.max(0, current));
  while (k < last && tolerances[k + 1]! <= half / LEVEL_HYSTERESIS) k++;
  while (k > 0 && tolerances[k]! > half * LEVEL_HYSTERESIS) k--;
  return k;
}

/**
 * The cell the dots of a dotted or dashed leg are counted in, in the globe's own units (radians along the leg per art pixel), snapped to a quarter of an
 * octave of scale. The pattern is anchored at the start of the leg and runs along it in these cells; with the exact cell it changed at every frame of a zoom,
 * and every dot of a leg slid along it, faster the farther it was from the start (a dot at 400 pixels from the start moved 400 times the zoom's change
 * of scale: the whole line shimmered). Snapped, the dots stay where they are on the ground while the scale moves inside a step, and the pattern is laid
 * out again, once, when it crosses to the next (the dots are then up to 9 % longer or shorter than the table's).
 */
export const DOT_STEPS_PER_OCTAVE = 4;
export function dotCell(cell: number): number {
  return cell > 0 ? 2 ** (Math.round(Math.log2(cell) * DOT_STEPS_PER_OCTAVE) / DOT_STEPS_PER_OCTAVE) : cell;
}

/**
 * How far away the view is, 0..1, for the paths' own tone: 1 on the whole globe, 0 from `FAR_TO` (internal zoom) on, in sixths (a timed value would
 * be a fade; a step of the tone is what the art does). Far away every path is quieter, so the set of them does not read as a tangle; the legs of the
 * selected place are not affected.
 */
/**
 * The rail's cross-ticks (a 3-cell bar across the line in the middle of every dash) are drawn from this zoom on: from far away a rail is a dashed line
 * (the tick at overview doubled the weight of every rail and made a region of many trips a mesh of crosses).
 */
export const TICK_FROM = 5.5;
/** How far toward the page colour (0..1, solid) the paths that are not selected go on the whole globe (`farOf` 1): from space they are a faint trace, not a line (#459: one pixel is a lot on a planet this small). */
export const FAR_TONE = 0.6;
export const FAR_FROM = 2.6;
export const FAR_TO = 4.2;
export function farOf(zoom: number): number {
  const t = Math.min(1, Math.max(0, (zoom - FAR_FROM) / (FAR_TO - FAR_FROM)));
  return Math.round((1 - t * t * (3 - 2 * t)) * 6) / 6;
}
