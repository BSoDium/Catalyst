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
import type { Pattern } from "../core/palette";
import { activeLevels, clampLevels, rampLevel, rampStepZoom, roleLevel } from "../../engine/palette";

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
  /** the tone the class ends up with (the named role of the shared palette) */
  role: Role;
  /**
   * Finer tone than the six roles allow: a position 0..1 along the MAP ramp (0 = page colour, 1 = `peak`), which resolves to the level
   * `round(at * (n - 2))` for n levels. When set it replaces `role` for the level (the road hierarchy needs more tiers than the roles).
   */
  at?: number;
  /** final pattern in line widths (= art px); undefined = solid */
  dash?: readonly number[];
}

/** The tone a class (or fill) ends up with, as a palette level for `n` levels: `at` when given, else the role. */
export function toneLevel(e: { role: Role; at?: number }, n: number = activeLevels()): number {
  if (e.at === undefined) return roleLevel(e.role, n);
  const top = clampLevels(n) - 2;
  return Math.min(top, Math.max(1, Math.round(e.at * top)));
}

/**
 * The table is tuned to the camera the app actually uses when a place is clicked: `engine/framing.ts` fits a circle of the place's
 * `viewRadiusKm` (12 km by default, 10 to 18 typical) into the free viewport with a 25 % margin. In map zoom (`street/core/
 * registration.ts`, `scripts/street/city-frames.mjs --table=1`) that is 10.0 to 11.4 at 1440x900 for 10 to 18 km at 0 to 49 degrees
 * of latitude (9.7 to 11.1 with the 50 % detail panel open, 8.8 to 10.2 on a 390 px phone). A city has to read as a city there:
 * primary and secondary roads in full, links, rail, rivers and parks showing, tertiary and residential streets starting as soon
 * as the tiles carry them. The tile DATA bounds how early a class can be drawn at all: a tile of zoom z holds, in OpenMapTiles,
 * primary roads from z8, secondary from z9, tertiary from z11, residential and paths from z12, service from z13 (Protomaps is
 * the same within a level), and MapLibre draws the tiles of zoom floor(map zoom). So tertiary starts at 10.9, one hair before
 * its tiles exist, and rises over a single zoom level; the rest is as early as its tiles allow, with the ramps lengthened where
 * the data is already there. Far zoom is as calm as before: nothing road-like below z5.5 (motorways and trunks, sparse), nothing
 * but them below z8 (docs/street-architecture.md, "Level of detail").
 */
export const LOD: Record<LodKey, LodEntry> = {
  // ROAD HIERARCHY (owner: "really hard to distinguish which roads are major and which are small"): the class is told by TONE and by
  // WIDTH. Tone, in map-ramp positions (level of 12 in brackets): motorway and trunk = the peak (10, the loudest the map gets, still
  // `MAP_CONTRAST` below the ink of labels and markers), primary 0.9 (9), secondary 0.7 (7), tertiary 0.5 (5), residential and service `soft` (4),
  // paths `faint` (3) (the dots of parks and the dashes of water are `soft` too, below the roads' ink by their 1-in-8 coverage), so every tier is one to three levels from its neighbour. Width (core `MAJOR_ART` in street-style.ts):
  // motorway, trunk and primary are 2 art px from z9, every other class stays at 1 px (floor, centre sampling and stair removal untouched).
  highway: { from: 5.5, full: 8.5, role: "peak" },
  major: { from: 8.6, full: 9.7, role: "strong", at: 0.9 },
  secondary: { from: 9, full: 10.2, role: "strong", at: 0.7 },
  medium: { from: 10.9, full: 11.7, role: "mid", at: 0.5 },
  minor: { from: 12.2, full: 14.2, role: "soft", dash: [1.8, 2.4] },
  minorSolid: { from: 16.6, full: 17.4, role: "soft" },
  link: { from: 10.2, full: 12.2, role: "soft", dash: [1.8, 3.6] },
  service: { from: 13.4, full: 15.4, role: "soft", dash: [1.8, 3.6] },
  path: { from: 14.6, full: 16.4, role: "faint", dash: [1.8, 3.6] },
  rail: { from: 10.2, full: 12.2, role: "soft", dash: [3, 2.2] },
  river: { from: 7, full: 9.2, role: "strong" },
  canal: { from: 12, full: 13.8, role: "soft", dash: [6, 1.5] },
  stream: { from: 13, full: 15, role: "soft", dash: [3, 1.5] },
  lake: { from: 5.5, full: 8, role: "strong" },
  waterDetail: { from: 11.2, full: 13.2, role: "mid" },
  regionBorder: { from: 3.8, full: 5.2, role: "mid", dash: [4, 1.5] },
  buildingOutline: { from: 16.6, full: 17.4, role: "mid" },
};

/**
 * Fills fade in over these zoom ranges, stepping through the levels up to their role. Water and green areas are screen-
 * anchored PATTERNS (core/palette.ts: dashes for water, a dot lattice for parks and woods) painted in a dimmed level, so
 * they read as green or water at a glance in both themes; buildings are a flat wash. The sea starts right after the
 * globe-to-street cut (map zoom 3.5 to 5 depending on latitude) and climbs slowly through the levels, so it is never a
 * single step: see docs/palette/ (sea ease).
 */
export const FILL_LOD = {
  water: { from: 1.7, full: 6.5, role: "soft", pattern: "water" },
  park: { from: 6.4, full: 8.8, role: "soft", pattern: "green" },
  green: { from: 9.6, full: 11.2, role: "soft", pattern: "green" },
  building: { from: 15.8, full: 17.5, role: "wash", pattern: "flat" },
} as const satisfies Record<string, { from: number; full: number; role: Role; pattern: Pattern }>;

/** Progress 0..1 of a fade over [from, full] (0 at or below `from`, 1 at or above `full`). */
export const progressAt = (e: { from: number; full: number }, z: number): number => (z <= e.from ? 0 : z >= e.full ? 1 : (z - e.from) / (e.full - e.from));

/** The palette level of a class at a zoom: 0 = not drawn, 1 = the faintest level ... the role's level from `full` on. */
export function levelAt(e: { from: number; full: number; role: Role; at?: number }, z: number, n: number = activeLevels()): number {
  return rampLevel(progressAt(e, z), toneLevel(e, n));
}

/** Zoom at which the class enters level `k` (1 .. its final level). */
export const stepZoom = (e: { from: number; full: number; role: Role; at?: number }, k: number, n: number = activeLevels()): number =>
  rampStepZoom(e.from, e.full, toneLevel(e, n), k);

/** True when the class is drawn at all at this zoom (fading in or final). */
export const visibleAt = (e: { from: number }, z: number): boolean => z > e.from;

/** True when the class is in its final look at this zoom. */
export const finalAt = (e: { full: number }, z: number): boolean => z >= e.full;
