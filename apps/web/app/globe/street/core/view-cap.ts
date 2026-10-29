/**
 * What part of the planet a map view shows, as a cap on the unit sphere (the point the view is centred on and the angle to the farthest of the points
 * sampled round it), so that a leg whose own cap (`paths/trail-dots-layer.ts` `LegCap`) is out of it is not projected, point by point, every frame
 * (the street map's trail dots did: owner, 2026-10-29, a third of the main thread of a Pixel 7 over a flight through the levels).
 */
import { lonLatToVec3 } from "../../engine/geo";
import type { LegCap } from "../../paths/trail-dots-layer";

export interface ViewCap {
  u: [number, number, number];
  rho: number;
}

/** The margin on the view's angle, a ratio and a floor in radians: a point on the edge is never taken out (the corners are sampled, a curved edge between them is not). */
const MARGIN = 1.08;
const FLOOR = 0.002;

/**
 * The cap of a view: `centre` and the lon/lat of points round the view (its corners and the middle of its sides). A point that is not a number (the map
 * could not say what is under a corner: the sky of a globe at a low zoom) means the view reaches past the planet's edge: no cap, nothing is culled.
 */
export function viewCap(centre: readonly [number, number], round: ReadonlyArray<readonly [number, number] | null>): ViewCap | null {
  if (!Number.isFinite(centre[0]) || !Number.isFinite(centre[1])) return null;
  const u = lonLatToVec3(centre[0], centre[1]);
  let least = 1;
  for (const p of round) {
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
    const v = lonLatToVec3(p[0], p[1]);
    least = Math.min(least, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]);
  }
  const rho = Math.acos(Math.max(-1, Math.min(1, least)));
  return { u, rho: rho * MARGIN + FLOOR };
}

/** Whether a leg's cap may touch the view's: the angle between the two centres is not more than the sum of the angles. */
export function capReach(view: ViewCap, leg: LegCap): boolean {
  const d = Math.acos(Math.max(-1, Math.min(1, view.u[0] * leg.u[0] + view.u[1] * leg.u[1] + view.u[2] * leg.u[2])));
  return d <= view.rho + leg.rho;
}
