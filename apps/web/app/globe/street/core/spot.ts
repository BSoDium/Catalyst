/**
 * The spotlight on the selected node's rectangle (#569): the CPU twin of the rule in the present pass (gl/pixel-pass.ts, FRAG_PRESENT) and of the
 * rectangle the engine hands it. A pure function of the cell, so the tests pin the rule the shader implements.
 *
 * Inside the rectangle the map's LINES are lifted by `liftLow` (the faintest) to `lift` (the strongest) of the way to the peak (the box at rest, one level under the ink: the ink is the selection's
 * colour and the top step of the ramp is the biggest, so a line that was near the top must not land on it), the fills (the background: water, green,
 * the satellite's stipple) by the smaller `fill`. Outside, the lines lose `dim` of their tone (never below the faintest level) and the fills are left alone.
 * Levels of the path trails (from `greys`) and the page colour (0) are never touched, nor is a line already at the ink or the peak (never lowered).
 */
export interface SpotTune {
  /** Share of the way to the peak that the strongest lines are lifted; the faintest are lifted by `liftLow`, in between by level (the hierarchy of the roads stays). */
  lift: number;
  liftLow: number;
  dim: number;
  fill: number;
}

/** A rectangle in whole art cells, c1 / r1 exclusive. */
export interface CellRect {
  c0: number;
  r0: number;
  c1: number;
  r1: number;
}

/** How the lift grows with a line's level: t (0 the faintest .. 1 the peak) to the power of this, so the small streets are barely lifted and the lift is spent on the main roads. Twin: the shader. */
export const SPOT_CURVE = 2;

/** The palette level a cell is presented at under the spotlight (`greys` = the number of grey levels: the ink is `greys - 1`). */
export function spotLevel(level: number, isLine: boolean, inside: boolean, tune: SpotTune, greys: number): number {
  if (level <= 0 || level >= greys || (tune.lift <= 0 && tune.liftLow <= 0 && tune.dim <= 0 && tune.fill <= 0)) return level;
  if (inside) {
    const peak = greys - 2;
    if (level >= peak) return level;
    const t = (peak > 1 ? Math.min(1, Math.max(0, (level - 1) / (peak - 1))) : 1) ** SPOT_CURVE;
    return level + Math.floor((peak - level) * (isLine ? tune.liftLow + (tune.lift - tune.liftLow) * t : tune.fill) + 0.5);
  }
  return isLine ? Math.max(1, Math.floor(level * (1 - tune.dim) + 0.5)) : level;
}

/** The rectangle of a node's drawn box (CSS px, whole cells of `cell` px) in art cells. */
export function spotRect(box: { x0: number; y0: number; x1: number; y1: number }, cell: number): CellRect {
  return { c0: Math.round(box.x0 / cell), r0: Math.round(box.y0 / cell), c1: Math.round(box.x1 / cell), r1: Math.round(box.y1 / cell) };
}

export const sameRect = (a: CellRect | null, b: CellRect): boolean => !!a && a.c0 === b.c0 && a.r0 === b.r0 && a.c1 === b.c1 && a.r1 === b.r1;

/**
 * Where the light is this frame: on the selected node's rectangle (`now`) when it is drawn; otherwise it stays on the node it was on (`prev`, its rectangle
 * for the camera as it is) while it fades out, so it follows that node instead of staying where the camera left it; with nothing to follow (or once it has
 * faded out, `lit` false) there is no light.
 */
export function spotFollow(now: CellRect | null, prev: CellRect | null, lit: boolean): { box: CellRect | null; target: 0 | 1 } {
  if (now) return { box: now, target: 1 };
  return { box: lit ? prev : null, target: 0 };
}
