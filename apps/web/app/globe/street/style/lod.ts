/**
 * Level of detail of the street map, as DATA: one row per feature class, tuned in this one place.
 *
 * A class is either THERE or NOT, never half way (docs/web-architecture.md, "Binary visibility"): from its switch zoom `on` it is drawn in
 * its final look (the level of its `role`, its width, its dashes, thinned and widened by the rules of docs/pixel-line-rules.md), below it
 * it is not drawn. The camera only decides which (`layer-switch.ts`, with a hysteresis band so that a zoom jittering around `on` cannot
 * flap the layer); how the picture changes is the temporal ease's job (`core/ease.ts`): the cells of a layer that has just switched fade
 * in or out by TIME, a level per 24 ms, whatever the camera does, and the settle loop runs them to the end. So a map that comes to rest
 * at any zoom shows each class at its final tone or not at all. (Before 2026-10-08 a class stepped through the grey levels over a zoom
 * range, `from` to `full`, so a map at rest between the two showed it at a half tone; `on` sits near 30 % of that old span, where the
 * ramp was already clearly visible but not yet loud, and early enough for the city framings: the table below keeps each old span.)
 *
 * Widths are untouched (art pixels, floor 1). Which level a role is depends on the number of levels (engine/palette.ts).
 */
import type { Role } from "../../engine/palette";
import type { Pattern } from "../core/palette";
import { activeLevels, clampLevels, coastLevel, roleLevel } from "../../engine/palette";

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
  /** the zoom from which the class is drawn, in its final look (the switch of `layer-switch.ts`) */
  on: number;
  /** the zoom from which it is NOT drawn any more (a class that hands over to another, like dotted to solid residential streets) */
  off?: number;
  /** the tone the class is drawn in (the named role of the shared palette) */
  role: Role;
  /**
   * Finer tone than the six roles allow: a position 0..1 along the MAP ramp (0 = page colour, 1 = `peak`), which resolves to the level
   * `round(at * (n - 2))` for n levels. When set it replaces `role` for the level (the road hierarchy needs more tiers than the roles).
   */
  at?: number;
  /** pattern in line widths (= art px); undefined = solid */
  dash?: readonly number[];
}

/** The tone a class (or fill) ends up with, as a palette level for `n` levels: `at` when given, else the role. */
export function toneLevel(e: { role: Role; at?: number }, n: number = activeLevels()): number {
  if (e.at === undefined) return roleLevel(e.role, n);
  const top = clampLevels(n) - 2;
  return Math.min(coastLevel(n), Math.max(1, Math.round(e.at * top)));
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
  // ROAD HIERARCHY. The class is told by TONE (a constant per class, palette levels of the 12 in brackets, map-ramp position `at`) and by
  // WIDTH (core `MAJOR_ART` in street-style.ts): motorway and trunk 0.7 (7), primary 0.6 (6), secondary 0.5 (5), tertiary and rail 0.3 (3);
  // then the quiet ones, the DECOR of the map: links and the solid residential streets 0.2 (2), the dotted residential streets, service
  // roads and paths 0.1 (1, the lowest map level). The boxes at rest are the peak (10), the coast and the borders the coast level (9): a road
  // is never louder than level 7, two levels under the coast and three under the boxes. Width: motorway, trunk and primary are 2 art px from
  // z9, every other class stays at 1 px (floor, centre sampling and stair removal untouched).
  // History. Owner, 2026-10-08, first: "the streets are only decor, they shouldn't be this visible and noisy": the binary switch had put
  // every class at its FINAL tone from about 30 % of the span of the old ramp, and the table was recalmed to 10, 8, 6, 4, then 3 / 2 / 2 / 2.
  // Then again, the same day: streets "are still way too visible in big cities, they are only decor", the box and its label must stand out:
  // every class lowered by about two levels (motorway 10 to 7, primary 8 to 5, secondary 6 to 4, tertiary 4 to 3, links and solid 3 to 2,
  // dotted 2 to 1, rail 4 to 3), the order and the width hierarchy kept; checked in Paris, London and New York at z10 to 17, light and dark,
  // with the box on. The spans of the removed ramp, `from .. full`, are in the comment of each row.
  // Then, still 2026-10-08, the whole map was washed out (engine/palette.ts: levels 4 to 9 are fainter, the coast level is 3.1:1 against the
  // page and no longer the box's tone): the level of each tier stays, but its colour is lighter (motorway 2.8:1 to 2.1:1, tertiary and
  // below unchanged, they sit at the floor). Primary and secondary went up a level (5 to 6, 4 to 5) so the three tiers above tertiary are still
  // told apart at the lighter ramp (secondary and tertiary were 1.5:1 and 1.4:1 otherwise).
  highway: { on: 6.4, role: "strong", at: 0.7 }, // 5.5 .. 8.5
  major: { on: 8.7, role: "mid", at: 0.6 }, // 8.6 .. 9.7; just under the phone framings (8.8 to 10.2)
  secondary: { on: 9.35, role: "soft", at: 0.5 }, // 9 .. 10.2
  medium: { on: 11.1, role: "faint", at: 0.3 }, // 10.9 .. 11.7
  minor: { on: 13, off: 16.85, role: "faint", at: 0.1, dash: [1.8, 2.4] }, // 12.2 .. 14.2; solid from the next row
  minorSolid: { on: 16.85, role: "faint", at: 0.2 }, // 16.6 .. 17.4
  link: { on: 10.2, role: "faint", at: 0.2, dash: [1.8, 3.6] }, // 10.2 .. 12.2
  service: { on: 14.4, role: "faint", at: 0.1, dash: [1.8, 3.6] }, // 13.4 .. 15.4
  path: { on: 15.4, role: "faint", at: 0.1, dash: [1.8, 3.6] }, // 14.6 .. 16.4
  rail: { on: 10.2, role: "faint", at: 0.3, dash: [3, 2.2] }, // 10.2 .. 12.2
  river: { on: 7.65, role: "strong" }, // 7 .. 9.2
  canal: { on: 12.55, role: "soft", dash: [6, 1.5] }, // 12 .. 13.8
  stream: { on: 13.6, role: "soft", dash: [3, 1.5] }, // 13 .. 15
  lake: { on: 6.25, role: "strong" }, // 5.5 .. 8
  waterDetail: { on: 11.8, role: "mid" }, // 11.2 .. 13.2
  regionBorder: { on: 4.2, role: "mid", dash: [4, 1.5] }, // 3.8 .. 5.2
  buildingOutline: { on: 16.85, role: "mid" }, // 16.6 .. 17.4
};

/**
 * Fills switch on at these zooms. Water and green areas are screen-anchored PATTERNS (core/palette.ts: dashes for water, a dot lattice
 * for parks and woods) painted in a dimmed level, so they read as green or water at a glance in both themes; buildings are a flat wash.
 * The sea is not on this table: it is a texture for a FLAT view, so it switches on with the flatness of the view, not with a zoom
 * (`core/flatness.ts`, `layer-switch.ts`); `water` here only carries its look.
 */
export const FILL_LOD = {
  water: { on: 0, role: "soft", pattern: "water" }, // the sea texture: switched by the flatness of the view
  park: { on: 7.1, role: "soft", pattern: "green" }, // 6.4 .. 8.8
  green: { on: 10.1, role: "soft", pattern: "green" }, // 9.6 .. 11.2
  building: { on: 16.3, role: "wash", pattern: "flat" }, // 15.8 .. 17.5
} as const satisfies Record<string, { on: number; role: Role; pattern: Pattern }>;

/** Whether a class is drawn at this zoom, without hysteresis (the settled answer: tests, the synthetic gate, a style built for a fixed zoom). */
export const visibleAt = (e: { on: number; off?: number }, z: number): boolean => z >= e.on && (e.off === undefined || z < e.off);

/** The palette level a class is drawn in at a zoom: 0 when it is not drawn, else its final level. */
export const levelAt = (e: { on: number; off?: number; role: Role; at?: number }, z: number, n: number = activeLevels()): number => (visibleAt(e, z) ? toneLevel(e, n) : 0);
