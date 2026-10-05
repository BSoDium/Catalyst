/**
 * Level of detail of the street map, as DATA: one row per feature class, tuned in this one place.
 *
 * A class has three phases over zoom:
 *   z <= from        not drawn at all (the layer does not exist below `from`)
 *   from < z < full  RAMP: the class is drawn in the foreground-TONE channel, whose coverage the pixel pass turns into a
 *                    screen-anchored Bayer lattice (`toneLit`: a function of the screen cell and the tone only, so it
 *                    never swims; as the tone rises, cells only get ADDED). The tone climbs 0 -> 1 with `ease`.
 *   z >= full        the class's final look: hard one-pixel ink (solid, or dashed when `dash` is set), thinned and
 *                    widened by the rules of docs/pixel-line-rules.md.
 *
 * Widths are untouched by the ramp (art pixels, floor 1): lighter weight comes from density and pattern, never from
 * sub-pixel widths. At tone 1 the ramp draws exactly the cells of the final line (before staircase removal), so the
 * hand-over from the ramp to the ink is invisible apart from the removal of stair corners.
 */
import type { Stops } from "../core/art-line";

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
  /** first zoom at which the class is drawn (tone just above 0) */
  from: number;
  /** zoom at which the ramp is complete and the final ink look takes over */
  full: number;
  /** final pattern in line widths (= art px); undefined = solid */
  dash?: readonly number[];
}

export const LOD: Record<LodKey, LodEntry> = {
  highway: { from: 5.5, full: 8.5 },
  major: { from: 9.5, full: 12.5 },
  secondary: { from: 11.8, full: 14.2 },
  medium: { from: 13, full: 15.5 },
  minor: { from: 14.4, full: 16.4, dash: [1.8, 2.4] },
  minorSolid: { from: 16.6, full: 17.4 },
  link: { from: 14.8, full: 16.6, dash: [1.8, 3.6] },
  service: { from: 15.4, full: 16.8, dash: [1.8, 3.6] },
  path: { from: 15.9, full: 17, dash: [1.8, 3.6] },
  rail: { from: 12.5, full: 14.5, dash: [3, 2.2] },
  river: { from: 9, full: 11.5 },
  canal: { from: 13, full: 15, dash: [6, 1.5] },
  stream: { from: 14, full: 16, dash: [3, 1.5] },
  lake: { from: 7.5, full: 10 },
  waterDetail: { from: 12, full: 14 },
  regionBorder: { from: 4.5, full: 6.5, dash: [4, 1.5] },
  buildingOutline: { from: 16.6, full: 17.4 },
};

/** Fills (tones, already dithered by the pass) fade in over these zoom ranges: [from, to, tone at `to`]. */
export const FILL_LOD = {
  building: { from: 15.8, to: 17.5, tone: 0.16 },
} as const;

/** Tone 0..1 of a class in its ramp: smoothstep from `from` to `full` (0 below, 1 above). */
export function toneAt(e: LodEntry, z: number): number {
  if (z <= e.from) return 0;
  if (z >= e.full) return 1;
  const t = (z - e.from) / (e.full - e.from);
  return t * t * (3 - 2 * t);
}

/** True when the class is drawn at all at this zoom (ramp or final). */
export const visibleAt = (e: LodEntry, z: number): boolean => z > e.from;

/** True when the class is in its final ink look at this zoom. */
export const finalAt = (e: LodEntry, z: number): boolean => z >= e.full;

/** `line-opacity` stops of the ramp layer (tone over zoom), sampled densely enough to follow the easing. */
export function rampStops(e: LodEntry, step = 0.25): Stops {
  const out: [number, number][] = [[e.from, 0]];
  for (let z = Math.ceil((e.from + 1e-6) / step) * step; z < e.full - 1e-6; z += step) out.push([Math.round(z * 1000) / 1000, toneAt(e, z)]);
  out.push([e.full, 1]);
  return out;
}

/** The tone the pass actually uses: quantised to sixteenths, like `toneLit` in core/art-line. */
export const quantisedTone = (t: number): number => Math.floor(t * 16 + 0.5) / 16;
