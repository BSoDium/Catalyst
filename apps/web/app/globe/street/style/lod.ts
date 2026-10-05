/**
 * Level of detail of the street map, as DATA: one row per feature class, tuned in this one place.
 *
 * A class has two phases over zoom:
 *   z <= from        not drawn at all (the layer does not exist below `from`)
 *   from < z < full  FADE-IN IN TONE: the class is drawn in its final shape (same width, same dashes) but in a lighter
 *                    grey. It enters at the faintest palette level and steps up through the levels (`rampLevel`, equal
 *                    steps of zoom) until it reaches the level of its `role` at `full`. A cell only ever changes by one
 *                    level at a time and no cell is ever added or removed by the fade: it is the same line from the
 *                    first zoom, so there is no dither, no noise, no swimming.
 *   z >= full        the class's final look: its role's level, solid (or dashed when `dash` is set), thinned and
 *                    widened by the rules of docs/pixel-line-rules.md.
 *
 * Widths are untouched by the fade (art pixels, floor 1): the weight is the tone. Which level a role is depends on the
 * number of levels (engine/palette.ts).
 */
import type { Role } from "../../engine/palette";
import { activeLevels, rampLevel, rampStepZoom, roleLevel } from "../../engine/palette";

export type LodKey =
  | "highway" // motorway, trunk
  | "major" // primary
  | "secondary"
  | "medium" // tertiary
  | "minor" // residential, unclassified: dotted
  | "minorSolid" // residential, unclassified: solid, at the closest zooms
  | "link" // slip roads and junction links: dotted
  | "service" // service, track: dotted
  | "path" // footways, cycleways, paths: dotted
  | "rail"
  | "river" // river lines
  | "canal"
  | "stream"
  | "lake" // outlines of lakes and reservoirs (the sea is always drawn)
  | "waterDetail" // outlines of small ponds, rivers as polygons (the coast and big lakes are always drawn)
  | "regionBorder"
  | "buildingOutline";

export interface LodEntry {
  /** first zoom at which the class is drawn (at the faintest level) */
  from: number;
  /** zoom at which the fade-in is complete and the class has its role's level */
  full: number;
  /** the tone the class ends up with */
  role: Role;
  /** final pattern in line widths (= art px); undefined = solid */
  dash?: readonly number[];
}

export const LOD: Record<LodKey, LodEntry> = {
  highway: { from: 5.5, full: 8.5, role: "strong" },
  major: { from: 9.5, full: 12.5, role: "strong" },
  secondary: { from: 11.8, full: 14.2, role: "strong" },
  medium: { from: 13, full: 15.5, role: "mid" },
  minor: { from: 14.4, full: 16.4, role: "mid", dash: [1.8, 2.4] },
  minorSolid: { from: 16.6, full: 17.4, role: "mid" },
  link: { from: 14.8, full: 16.6, role: "soft", dash: [1.8, 3.6] },
  service: { from: 15.4, full: 16.8, role: "soft", dash: [1.8, 3.6] },
  path: { from: 15.9, full: 17, role: "soft", dash: [1.8, 3.6] },
  rail: { from: 12.5, full: 14.5, role: "soft", dash: [3, 2.2] },
  river: { from: 9, full: 11.5, role: "strong" },
  canal: { from: 13, full: 15, role: "soft", dash: [6, 1.5] },
  stream: { from: 14, full: 16, role: "soft", dash: [3, 1.5] },
  lake: { from: 7.5, full: 10, role: "strong" },
  waterDetail: { from: 12, full: 14, role: "mid" },
  regionBorder: { from: 4.5, full: 6.5, role: "mid", dash: [4, 1.5] },
  buildingOutline: { from: 16.6, full: 17.4, role: "mid" },
};

/** Fills (flat tone washes) fade in over these zoom ranges, stepping through the levels up to their role. */
export const FILL_LOD = {
  water: { from: 8, full: 10, role: "wash" },
  park: { from: 9, full: 12, role: "wash" },
  building: { from: 15.8, full: 17.5, role: "wash" },
} as const satisfies Record<string, { from: number; full: number; role: Role }>;

/** Progress 0..1 of a fade over [from, full] (0 at or below `from`, 1 at or above `full`). */
export const progressAt = (e: { from: number; full: number }, z: number): number => (z <= e.from ? 0 : z >= e.full ? 1 : (z - e.from) / (e.full - e.from));

/** The palette level of a class at a zoom: 0 = not drawn, 1 = the faintest level ... the role's level from `full` on. */
export function levelAt(e: { from: number; full: number; role: Role }, z: number, n: number = activeLevels()): number {
  return rampLevel(progressAt(e, z), roleLevel(e.role, n));
}

/** Zoom at which the class enters level `k` (1 .. its final level). */
export const stepZoom = (e: { from: number; full: number; role: Role }, k: number, n: number = activeLevels()): number =>
  rampStepZoom(e.from, e.full, roleLevel(e.role, n), k);

/** True when the class is drawn at all at this zoom (fading in or final). */
export const visibleAt = (e: { from: number }, z: number): boolean => z > e.from;

/** True when the class is in its final look at this zoom. */
export const finalAt = (e: { full: number }, z: number): boolean => z >= e.full;
