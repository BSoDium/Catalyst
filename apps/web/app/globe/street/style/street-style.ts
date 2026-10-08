/**
 * Greyscale MapLibre style for the pixel pass. Hand-written (no `protomaps-themes-base`: it emits coloured fills and
 * label layers that need glyphs). Every layer is painted in a plain colour that ENCODES a palette level (core/palette.ts):
 *
 *   lines    rgb(255, G, 0) at an opacity of 0.75 (a one-pixel line the pass may thin) or 1: G = level / LEVEL_SCALE
 *   fills    rgb(0, 0, B), opaque: B = level / LEVEL_SCALE
 *   black    (#000000)               -> erases to the page colour (hollow road interiors, route halos)
 *
 * The level is a ROLE of the shared grey palette (engine/palette.ts: wash, faint, soft, mid, strong, ink), so the style
 * does not know how many greys there are. A class that fades in with zoom is ONE layer whose colour steps through the
 * levels (a zoom `step` expression), from the faintest up to its role's level: no ramp layers, no dither.
 *
 * Two tile schemas map to one visual spec, so the look is identical whichever source is active:
 *   "protomaps"    Protomaps basemap v4 (the PMTiles fallback)
 *   "openmaptiles" OpenMapTiles (OpenFreeMap, the primary)
 *
 * No glyphs, no sprite, no symbol layers: text is HTML, so no font or sprite request is ever made. Widths follow
 * docs/pixel-line-rules.md: every width is authored in ART pixels, floored at one, multiplied by the actual cell size
 * at paint time (`applyCell` re-applies them when the cell changes).
 */
import type { ExpressionSpecification, LayerSpecification, Map as MLMap, StyleSpecification } from "maplibre-gl";
import { DESIGN_CELL_CSS, THIN_INK, artStops, cssStops, hollowFillStops, inkOpacityFor, inkOpacityStops, type Stops } from "../core/art-line";
import type { Schema } from "../core/source-descriptor";
import { roleLevel, type Role } from "../core/palette";
import { ERASE, fillColor, lineColor, type Pattern } from "../core/palette";
import { FILL_LOD, LOD, toneLevel, type LodKey } from "./lod";

export type { Schema };

/** The vector source as the style sees it: tile URLs already carry the instance's protocol prefix. */
export interface StyleTiles {
  tiles: string[];
  minzoom: number;
  maxzoom: number;
  bounds: [number, number, number, number] | null;
}

export interface StreetStyleOptions {
  schema: Schema;
  /** null = no tile source (connecting or capped): only the bundled world data is drawn. */
  tiles: StyleTiles | null;
  coastlines: GeoJSON.FeatureCollection;
  borders: GeoJSON.FeatureCollection;
  graticule: GeoJSON.FeatureCollection;
  routes: GeoJSON.FeatureCollection;
  /** Zoom at which the world-scale coastline (110m, @catalyst/geodata) hands over to tile geometry. */
  handoffZoom?: number;
  projection?: "globe" | "mercator";
  /** CSS px of one art pixel (whole device px / dpr). Default 3. */
  cellCss?: number;
  /**
   * The switched layers (layer-switch.ts) that start on; the others start hidden. Absent: all on (tests, the synthetic gate builds its own).
   * The engine passes the state for the camera, so a style swap does not flash a layer that should be off.
   */
  visible?: ReadonlySet<string>;
}

/**
 * The zoom from which the sea texture may be drawn: just after the hand-over to tile geometry, whichever schema (and so hand-over zoom) is
 * active (the PMTiles extract only has tiles around its place, so a fill that started earlier would show the tile edges). It is also
 * gated by the flatness of the view (`core/flatness.ts`, `layer-switch.ts`): the texture does not read as water on a visibly curved earth.
 */
export const seaFrom = (handoff: number): number => handoff + 0.7;

/**
 * Zoom at which the tile boundary takes over from the bundled Natural Earth country borders (and so where the latter end): the
 * coastline's hand-over, but never before 5. OpenMapTiles itself switches its boundary DATA from Natural Earth (z0 to z4 tiles, whose
 * lines follow the globe's) to OpenStreetMap (z5 and up) there, so drawing tile lines earlier would add a second, differently
 * registered Natural Earth line for no gain, and the one swap a viewer can see (the border moves by up to tens of km where a
 * frontier is disputed, `scripts/street/border-register.mjs`) happens once.
 */
export const BORDER_TILE_MINZOOM = 1;
export const borderHandoff = (handoff: number): number => Math.max(handoff, BORDER_TILE_MINZOOM);

/**
 * The bundled world lines (110m coast, 50m borders: the globe's own data) as a PLACEHOLDER under the tile lines, for a source whose tiles
 * are global (the tile coast is drawn from the first zoom): below this MapLibre zoom they are drawn WHILE tiles are loading
 * (`placeholderLayers`, switched by the engine from `map.areTilesLoaded()`), so a slow network shows the globe's lines until the real ones
 * arrive and the temporal ease cross-fades one to the other, instead of an empty map. They are hidden once the tiles are in: never two
 * geometries of one coast at once. Above this zoom the parent tiles of MapLibre already stand in for the missing ones.
 */
export const WORLD_PLACEHOLDER_BELOW = 5;
export const PLACEHOLDER_LAYERS = ["world-coast", "world-borders"] as const;
/** Whether a style with this hand-over zoom keeps the world lines as a (hidden until needed) placeholder. */
export const hasPlaceholder = (handoff: number, hasTiles: boolean): boolean => hasTiles && handoff < WORLD_PLACEHOLDER_BELOW;

/** Handover zoom per schema: the PMTiles extract only has tiles around the place, OpenFreeMap is global. */
export const DEFAULT_HANDOFF: Record<Schema, number> = { protomaps: 8.5, openmaptiles: 1 };

const zoomInterp = (stops: Stops, base = 1.5): ExpressionSpecification =>
  ["interpolate", ["exponential", base], ["zoom"], ...stops.flatMap(([z, v]) => [z, v])] as ExpressionSpecification;

export interface Spec {
  id: string;
  type: "fill" | "line";
  /** which paint: a level-encoded line (`ink`), a level-encoded fill, or the erasing page colour */
  ch: "ink" | "fill" | "erase";
  /** the tone this layer ends up with (lines without a `lod` entry are always at it; `lod` and `fade` take it from their table) */
  role?: Role;
  /** nominal CSS width (or stops) before the art floor */
  width?: number | Stops;
  minzoom?: number;
  maxzoom?: number;
  /** schema specific source layer + filter */
  pm?: { layer: string; filter?: unknown[] };
  omt?: { layer: string; filter?: unknown[] };
  /** dash pattern in line widths (= art px); undefined = solid */
  dash?: readonly number[];
  /** width in art px (a number, or stops over zoom), overriding the nominal CSS width */
  artW?: number | Stops;
  /** this casing is hollowed out by the interior spec of the given id; from that zoom it is two thin outlines */
  hollowBy?: string;
  /** level of detail class (lod.ts): on from its switch zoom in its final look (layer-switch.ts) */
  lod?: LodKey;
  /** (fills) the tone and pattern, and the zoom from which the fill is on */
  fade?: { on: number; role: Role; pattern: Pattern };
  /** this is the erasing interior of a hollow road whose casing follows these ART-pixel stops */
  hollowOf?: Stops;
}

const LINE = ["==", ["geometry-type"], "LineString"] as const;
const POLY = ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "MultiPolygon"]] as const;
const kindIn = (key: string, v: string[]) => ["in", ["get", key], ["literal", v]] as const;

/**
 * ONE line per frontier (owner report: a second, wavy line next to the Mauritania / Western Sahara / Morocco / Algeria border).
 * Both tile schemas carry the same frontier several times: the de-facto border (`admin_level` 2, `disputed` 0), disputed or claimed
 * lines (`disputed` 1: the Moroccan wall, Kashmir's LoC / LAC, Crimea, the West Bank, ... drawn on top of or beside the real line,
 * sometimes tens of km away) and maritime limits (`maritime` 1: the territorial sea, along the coast). Only the de-facto land border
 * is drawn, solid, at every zoom; disputed and maritime lines are never drawn (a dotted claim line beside the border reads as a
 * second border, and a world map with a single clear line is the point). OpenMapTiles: `disputed` and `maritime` are 0 / 1 numbers
 * (a missing value is not 1); Protomaps: `disputed` is a boolean and there is no maritime boundary in the layer.
 */
export const COUNTRY_BORDER_OMT = ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1], ["!=", ["get", "disputed"], 1]] as never;
export const COUNTRY_BORDER_PM = ["all", ["==", ["get", "kind"], "country"], ["!=", ["get", "disputed"], true]] as never;
/** Regional borders (admin 3 to 6) get the same rule: no maritime, no disputed duplicates. */
const REGION_BORDER_OMT = ["all", [">=", ["to-number", ["get", "admin_level"], 99], 3], ["<=", ["to-number", ["get", "admin_level"], 99], 6], ["!=", ["get", "maritime"], 1], ["!=", ["get", "disputed"], 1]] as never;
const REGION_BORDER_PM = ["all", ["==", ["get", "kind"], "region"], ["!=", ["get", "disputed"], true]] as never;

/** Nominal hairline in CSS px (floored to one art pixel). */
const HAIR = 0.6;
const MAJOR_CASE: Stops = [[5, HAIR], [12, 1.1], [14, 2.2], [15, 3.4], [16, 7], [17, 14], [18, 30]];
const MAJOR_FILL: Stops = [[16, 0], [16.6, 2.6], [17, 8], [18, 22]];
const MED_CASE: Stops = [[12, HAIR], [14, 1], [15, 2], [16, 5], [17, 10], [18, 24]];
/**
 * The same ramps in ART pixels. Roads stay exactly ONE art pixel wide until z14.6 (the old ramp started thickening at
 * z12, which made the city-wide view a black mesh; widths between 1 and 1.6 would also make a thin-class line two cells
 * wide at some offsets); they thicken only at street scale and turn hollow once the casing
 * holds two outlines and a 2 px interior (4 art px, about z16.9 for main roads and z17.4 for tertiary roads).
 * Never below 1.
 */
const SECONDARY_ART: Stops = [[5, 1], [14.6, 1], [15.2, 1.7], [16, 2.4], [17, 4.2], [18, 9]];
/**
 * Motorways, trunks and primary roads (the road hierarchy, owner report "everything is the same"): TWO art pixels wide from z9 (the
 * city framings are 10 to 11.4 on a desktop, 8.8 to 10.2 on a phone), one pixel below it; the width steps in 0.01 of zoom so no
 * intermediate width (1.25 to 1.6, where a line is one or two cells wide depending on its offset) is ever drawn. From z15.2 the
 * ramp is the old one (the hollow road at 4 art px, z16.9, is unchanged). A two-pixel line is a wide class (never thinned).
 */
export const MAJOR_WIDE_FROM = 9;
const MAJOR_ART: Stops = [[5, 1], [MAJOR_WIDE_FROM, 1], [MAJOR_WIDE_FROM + 0.01, 2], [15.2, 2], [16, 2.4], [17, 4.2], [18, 9]];
const MED_ART: Stops = [[12, 1], [15.4, 1], [16, 1.7], [17, 3], [18, 7]];
const MED_FILL: Stops = [[16.4, 0], [17, 3], [18, 14]];

// Road classes. The two schemas are mapped class by class so that the same road gets the same look whichever source is
// active. Protomaps keeps trunk, primary, secondary AND tertiary under `major_road` (and motorways under `highway`),
// OpenMapTiles has one `class` per level; junction links are `is_link` / `ramp` and drawn as their own, lighter class.
const PM_LINK = ["==", ["get", "is_link"], true] as const;
const PM_NOT_LINK = ["!=", ["get", "is_link"], true] as const;
const OMT_RAMP = ["==", ["get", "ramp"], 1] as const;
const OMT_NOT_RAMP = ["!=", ["get", "ramp"], 1] as const;
const detailIn = (v: string[]) => kindIn("kind_detail", v);

const HIGHWAY_PM = ["all", LINE, PM_NOT_LINK, ["any", kindIn("kind", ["highway"]), detailIn(["motorway", "trunk"])]] as never;
const HIGHWAY_OMT = ["all", LINE, OMT_NOT_RAMP, kindIn("class", ["motorway", "trunk"])] as never;
const MAJOR_PM = ["all", LINE, PM_NOT_LINK, ["==", ["get", "kind"], "major_road"], detailIn(["primary"])] as never;
const MAJOR_OMT = ["all", LINE, OMT_NOT_RAMP, kindIn("class", ["primary"])] as never;
const SECONDARY_PM = ["all", LINE, PM_NOT_LINK, ["==", ["get", "kind"], "major_road"], detailIn(["secondary"])] as never;
const SECONDARY_OMT = ["all", LINE, OMT_NOT_RAMP, kindIn("class", ["secondary"])] as never;
const MEDIUM_PM = ["all", LINE, PM_NOT_LINK, ["any", ["==", ["get", "kind"], "medium_road"], detailIn(["tertiary"])]] as never;
const MEDIUM_OMT = ["all", LINE, OMT_NOT_RAMP, ["==", ["get", "class"], "tertiary"]] as never;
const BIG_PM = ["all", LINE, PM_NOT_LINK, ["any", kindIn("kind", ["highway", "major_road", "medium_road"]), detailIn(["motorway", "trunk", "tertiary"])]] as never;
const BIG_OMT = ["all", LINE, OMT_NOT_RAMP, kindIn("class", ["motorway", "trunk", "primary", "secondary", "tertiary"])] as never;
const MINOR_PM = ["all", LINE, PM_NOT_LINK, ["==", ["get", "kind"], "minor_road"], ["!", detailIn(["service", "track"])]] as never;
const MINOR_OMT = ["all", LINE, OMT_NOT_RAMP, kindIn("class", ["minor"])] as never;
const LINK_PM = ["all", LINE, PM_LINK] as never;
const LINK_OMT = ["all", LINE, OMT_RAMP, kindIn("class", ["motorway", "trunk", "primary", "secondary", "tertiary"])] as never;
const SERVICE_PM = ["all", LINE, ["any", ["all", ["==", ["get", "kind"], "minor_road"], detailIn(["service", "track"])], ["==", ["get", "kind"], "other"]]] as never;
const SERVICE_OMT = ["all", LINE, kindIn("class", ["service", "track"])] as never;
const PATH_PM = ["all", LINE, ["==", ["get", "kind"], "path"], ["!", detailIn(["sidewalk", "crossing"])]] as never;
const PATH_OMT = ["all", LINE, ["==", ["get", "class"], "path"]] as never;
const RAIL_PM = ["all", LINE, ["==", ["get", "kind"], "rail"], detailIn(["rail", "light_rail", "narrow_gauge"])] as never;
const RAIL_OMT = ["all", LINE, ["==", ["get", "class"], "rail"], kindIn("subclass", ["rail", "light_rail", "narrow_gauge"])] as never;
/** The sea always gets an outline, lakes ramp in early (`lake`), every other water polygon is `waterDetail`. */
const SEA_PM = ["any", kindIn("kind", ["ocean", "sea"]), detailIn(["sea", "ocean"]), ["!", ["has", "kind_detail"]]] as const;
const SEA_OMT = kindIn("class", ["ocean", "sea"]);
const LAKE_PM = ["any", ["==", ["get", "kind"], "lake"], detailIn(["lake"])] as const;
const LAKE_OMT = kindIn("class", ["lake"]);

export const SPECS: Spec[] = [
  // --- areas: flat washes (tones first, lines on top) ---
  {
    id: "water-fill", type: "fill", ch: "fill", fade: FILL_LOD.water,
    pm: { layer: "water", filter: POLY as never }, omt: { layer: "water" },
  },
  {
    id: "park-fill", type: "fill", ch: "fill", fade: FILL_LOD.park,
    pm: { layer: "landuse", filter: kindIn("kind", ["forest", "wood", "grass", "nature_reserve", "cemetery", "farmland"]) as never },
    omt: { layer: "park" },
  },
  // Urban green (public parks, gardens, golf courses). OpenMapTiles keeps them in `landcover` (class grass), NOT in `park`
  // (protected areas only: Bois de Boulogne yes, the Tuileries no), Protomaps in `landuse`; they start with the city framing.
  {
    id: "green-fill", type: "fill", ch: "fill", fade: FILL_LOD.green,
    pm: { layer: "landuse", filter: kindIn("kind", ["park", "garden", "golf_course"]) as never },
    omt: { layer: "landcover", filter: kindIn("subclass", ["park", "garden", "golf_course", "village_green", "recreation_ground"]) as never },
  },
  {
    id: "building-fill", type: "fill", ch: "fill", fade: FILL_LOD.building,
    pm: { layer: "buildings" }, omt: { layer: "building" },
  },
  // --- lighter lines (soft and mid), many of them dashed ---
  {
    id: "waterway-minor", type: "line", ch: "ink", width: 1, lod: "stream", dash: LOD.stream.dash,
    pm: { layer: "water", filter: ["all", LINE, kindIn("kind", ["stream", "drain", "ditch"])] as never },
    omt: { layer: "waterway", filter: kindIn("class", ["stream", "drain", "ditch"]) as never },
  },
  {
    id: "boundary-region", type: "line", ch: "ink", width: 1, lod: "regionBorder", dash: LOD.regionBorder.dash,
    pm: { layer: "boundaries", filter: REGION_BORDER_PM },
    omt: { layer: "boundary", filter: REGION_BORDER_OMT },
  },
  {
    id: "road-minor-dotted", type: "line", ch: "ink", width: 1, lod: "minor", dash: LOD.minor.dash,
    pm: { layer: "roads", filter: MINOR_PM }, omt: { layer: "transportation", filter: MINOR_OMT },
  },
  {
    id: "road-link-dotted", type: "line", ch: "ink", width: 1, lod: "link", dash: LOD.link.dash,
    pm: { layer: "roads", filter: LINK_PM }, omt: { layer: "transportation", filter: LINK_OMT },
  },
  {
    id: "road-other-dotted", type: "line", ch: "ink", width: 1, lod: "service", dash: LOD.service.dash,
    pm: { layer: "roads", filter: SERVICE_PM }, omt: { layer: "transportation", filter: SERVICE_OMT },
  },
  {
    id: "path-dotted", type: "line", ch: "ink", width: 1, lod: "path", dash: LOD.path.dash,
    pm: { layer: "roads", filter: PATH_PM }, omt: { layer: "transportation", filter: PATH_OMT },
  },
  {
    id: "rail", type: "line", ch: "ink", width: 1, lod: "rail", dash: LOD.rail.dash,
    pm: { layer: "roads", filter: RAIL_PM }, omt: { layer: "transportation", filter: RAIL_OMT },
  },
  // --- heavier lines ---
  {
    id: "road-minor", type: "line", ch: "ink", width: 0.8, lod: "minorSolid",
    pm: { layer: "roads", filter: MINOR_PM }, omt: { layer: "transportation", filter: MINOR_OMT },
  },
  {
    id: "road-medium-case", type: "line", ch: "ink", width: MED_CASE, artW: MED_ART, lod: "medium", hollowBy: "road-medium-fill",
    pm: { layer: "roads", filter: MEDIUM_PM }, omt: { layer: "transportation", filter: MEDIUM_OMT },
  },
  {
    id: "road-major-case", type: "line", ch: "ink", width: MAJOR_CASE, artW: MAJOR_ART, lod: "major", hollowBy: "road-major-fill",
    pm: { layer: "roads", filter: MAJOR_PM }, omt: { layer: "transportation", filter: MAJOR_OMT },
  },
  {
    id: "road-secondary-case", type: "line", ch: "ink", width: MAJOR_CASE, artW: SECONDARY_ART, lod: "secondary", hollowBy: "road-major-fill",
    pm: { layer: "roads", filter: SECONDARY_PM }, omt: { layer: "transportation", filter: SECONDARY_OMT },
  },
  {
    id: "road-highway-case", type: "line", ch: "ink", width: MAJOR_CASE, artW: MAJOR_ART, lod: "highway", hollowBy: "road-major-fill",
    pm: { layer: "roads", filter: HIGHWAY_PM }, omt: { layer: "transportation", filter: HIGHWAY_OMT },
  },
  {
    id: "road-medium-fill", type: "line", ch: "erase", width: MED_FILL, minzoom: 16.4, hollowOf: MED_ART,
    pm: { layer: "roads", filter: MEDIUM_PM }, omt: { layer: "transportation", filter: MEDIUM_OMT },
  },
  {
    id: "road-major-fill", type: "line", ch: "erase", width: MAJOR_FILL, minzoom: 16, hollowOf: MAJOR_ART,
    pm: { layer: "roads", filter: BIG_PM }, omt: { layer: "transportation", filter: BIG_OMT },
  },
  {
    id: "building-outline", type: "line", ch: "ink", width: HAIR, lod: "buildingOutline",
    pm: { layer: "buildings" }, omt: { layer: "building" },
  },
  {
    id: "water-edge", type: "line", ch: "ink", role: "peak", width: HAIR, minzoom: 0,
    pm: { layer: "water", filter: ["all", POLY, SEA_PM] as never },
    omt: { layer: "water", filter: SEA_OMT as never },
  },
  {
    id: "water-edge-lake", type: "line", ch: "ink", width: HAIR, lod: "lake",
    pm: { layer: "water", filter: ["all", POLY, LAKE_PM] as never }, omt: { layer: "water", filter: LAKE_OMT as never },
  },
  {
    id: "water-edge-detail", type: "line", ch: "ink", width: HAIR, lod: "waterDetail",
    pm: { layer: "water", filter: ["all", POLY, ["!", ["any", SEA_PM, LAKE_PM]]] as never }, omt: { layer: "water", filter: ["!", kindIn("class", ["ocean", "sea", "lake"])] as never },
  },
  {
    id: "waterway-major", type: "line", ch: "ink", width: [[8, HAIR], [14, 1.6], [17, 6]], artW: [[8, 1], [14, 1.4], [17, 2.9]], lod: "river",
    pm: { layer: "water", filter: ["all", LINE, kindIn("kind", ["river"])] as never },
    omt: { layer: "waterway", filter: kindIn("class", ["river"]) as never },
  },
  {
    id: "waterway-canal", type: "line", ch: "ink", width: 1, lod: "canal", dash: LOD.canal.dash,
    pm: { layer: "water", filter: ["all", LINE, kindIn("kind", ["canal"])] as never },
    omt: { layer: "waterway", filter: kindIn("class", ["canal"]) as never },
  },
  {
    id: "boundary-country", type: "line", ch: "ink", role: "peak", width: HAIR, minzoom: BORDER_TILE_MINZOOM,
    pm: { layer: "boundaries", filter: COUNTRY_BORDER_PM },
    omt: { layer: "boundary", filter: COUNTRY_BORDER_OMT },
  },
];

/** Static zoom range of a spec. A class with a level of detail has none: it is switched on and off by `layer-switch.ts`, with a hysteresis. */
export function zoomRangeOf(spec: Spec): { minzoom?: number; maxzoom?: number } {
  const min = spec.lod || spec.fade ? undefined : spec.minzoom;
  return { ...(min ? { minzoom: min } : {}), ...(spec.maxzoom ? { maxzoom: spec.maxzoom } : {}) };
}

/** Width of a spec in art pixels, floored at one art pixel; hollow interiors derived from the casing. */
export function artWidthStopsOf(spec: Spec): Stops | number {
  if (spec.hollowOf) return hollowFillStops(spec.hollowOf);
  if (spec.artW !== undefined) return typeof spec.artW === "number" ? Math.max(1, spec.artW) : spec.artW.map(([z, w]) => [z, Math.max(1, w)] as const);
  if (typeof spec.width === "number") return Math.max(1, spec.width / DESIGN_CELL_CSS);
  return artStops(spec.width ?? [[0, 1]]);
}

/** MapLibre `line-width` value of a spec for an art cell of `cellCss` CSS px. */
function artWidthPaint(spec: Spec, cellCss: number): number | ExpressionSpecification {
  const w = artWidthStopsOf(spec);
  return typeof w === "number" ? w * cellCss : zoomInterp(cssStops(w, cellCss));
}

/** Layer ids of the lines that follow the art cell (world data and routes included). */
const CELL_LAYERS = ["world-coast", "world-borders", "graticule"] as const;
/**
 * A route is two art pixels wide, dashed with the globe's 7 px period (62 % ink): the same stroke the Three.js globe
 * draws, so the curated routes keep their weight through the handover. Its erasing halo is four art pixels wide.
 */
const ROUTE_ART = 2;
const ROUTE_HALO_ART = 4;

/** Re-apply the art widths after the art cell size changed (viewport crossing 520 px, DPR change). */
export function applyCell(map: MLMap, cellCss: number): void {
  for (const spec of SPECS) {
    if (spec.type !== "line" || !map.getLayer(spec.id)) continue;
    map.setPaintProperty(spec.id, "line-width", artWidthPaint(spec, cellCss) as never);
  }
  for (const id of CELL_LAYERS) if (map.getLayer(id)) map.setPaintProperty(id, "line-width", cellCss);
  if (map.getLayer("routes-line")) map.setPaintProperty("routes-line", "line-width", ROUTE_ART * cellCss);
  if (map.getLayer("routes-halo")) map.setPaintProperty("routes-halo", "line-width", ROUTE_HALO_ART * cellCss);
}

/** `layout.visibility` of a switched layer: on or off as the switch says (a style built for tests has them all on). */
const visibility = (id: string, visible: ReadonlySet<string> | undefined) => (visible && !visible.has(id) ? { visibility: "none" } : {});
/** Whether a spec is one of the switched layers (a class with a level of detail or a fill): the others (the sea outline, country borders, hollow road interiors, ...) are always on, whatever `visible` says. */
const switched = (spec: Spec) => Boolean(spec.lod || spec.fade);

function build(spec: Spec, schema: Schema, handoff: number, cellCss: number, visible: ReadonlySet<string> | undefined): LayerSpecification | null {
  const src = schema === "protomaps" ? spec.pm : spec.omt;
  if (!src) return null;
  let minzoom = zoomRangeOf(spec).minzoom;
  // tile based water edges only take over from the world-scale geodata coastline at the hand-over zoom
  if (spec.id === "water-edge") minzoom = handoff;
  // the same for country borders: the bundled Natural Earth lines up to the hand-over, the tile lines from it. Never both at once (two
  // geometries of the same frontier, up to tens of km apart where it is disputed, read as a doubled border).
  if (spec.id === "boundary-country") minzoom = borderHandoff(handoff);
  if (spec.hollowOf) {
    const w = artWidthStopsOf(spec);
    if (typeof w !== "number") minzoom = w.find(([, v]) => v > 0)?.[0] ?? minzoom;
  }
  const base = {
    id: spec.id,
    source: "tiles",
    "source-layer": src.layer,
    ...(minzoom ? { minzoom } : {}),
    ...(spec.maxzoom ? { maxzoom: spec.maxzoom } : {}),
    ...(src.filter ? { filter: src.filter } : {}),
  };
  if (spec.type === "fill") {
    const look = spec.fade ?? { role: spec.role ?? "wash", pattern: "flat" as Pattern };
    return {
      ...base,
      type: "fill",
      layout: switched(spec) ? visibility(spec.id, visible) : {},
      paint: { "fill-color": fillColor(toneLevel(look), look.pattern), "fill-opacity": 1, "fill-antialias": false },
    } as LayerSpecification;
  }
  const line = linePaint(spec, cellCss);
  return { ...base, type: "line", ...line, layout: { ...line.layout, ...(switched(spec) ? visibility(spec.id, visible) : {}) } } as LayerSpecification;
}

/** Layout and paint of a line spec: the one place widths, dashes, colour (level) and opacity (thin / wide) are decided. */
export function linePaint(spec: Spec, cellCss: number): { layout: Record<string, unknown>; paint: Record<string, unknown> } {
  const dash = spec.dash ? { "line-dasharray": spec.dash } : {};
  const layout = { "line-cap": "butt", "line-join": "miter" };
  if (spec.ch === "erase") {
    return { layout, paint: { "line-color": ERASE, "line-opacity": 1, "line-width": artWidthPaint(spec, cellCss) } };
  }
  // The colour is the tone: the level of the class's role (a class is on or off, never half way: lod.ts).
  const color = lineColor(spec.lod ? toneLevel(LOD[spec.lod]) : roleLevel(spec.role ?? "peak"));
  // One-pixel lines are painted weaker than wide ones: that is how the pass knows which cells it may thin.
  const w = artWidthStopsOf(spec);
  const fill = spec.hollowBy ? SPECS.find((x) => x.id === spec.hollowBy) : undefined;
  const fillStops = fill ? artWidthStopsOf(fill) : null;
  const hollowFrom = fillStops && typeof fillStops !== "number" ? (fillStops.find(([, v]) => v > 0)?.[0] ?? null) : null;
  const opacity: number | ExpressionSpecification =
    typeof w === "number"
      ? inkOpacityFor(w)
      : (["interpolate", ["linear"], ["zoom"], ...inkOpacityStops(w, 1.5, 0.25, hollowFrom).flatMap(([z, v]) => [z, v])] as unknown as ExpressionSpecification);
  return { layout, paint: { "line-color": color, "line-opacity": opacity, "line-width": artWidthPaint(spec, cellCss), ...dash } };
}

export function graticule(stepDeg = 15, sampleDeg = 3): GeoJSON.FeatureCollection {
  const lines: [number, number][][] = [];
  for (let lon = -180; lon <= 180; lon += stepDeg) {
    const l: [number, number][] = [];
    for (let lat = -84; lat <= 84; lat += sampleDeg) l.push([lon, lat]);
    lines.push(l);
  }
  for (let lat = -90 + stepDeg; lat < 90; lat += stepDeg) {
    if (Math.abs(lat) > 84) continue;
    const l: [number, number][] = [];
    for (let lon = -180; lon <= 180; lon += sampleDeg) l.push([lon, lat]);
    lines.push(l);
  }
  return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: lines } }] };
}

export function buildStreetStyle(o: StreetStyleOptions): StyleSpecification {
  const handoff = o.handoffZoom ?? DEFAULT_HANDOFF[o.schema];
  const noTiles = o.tiles === null;
  const placeholder = hasPlaceholder(handoff, !noTiles);
  const cell = o.cellCss ?? DESIGN_CELL_CSS;
  const tileLayers = noTiles ? [] : SPECS.map((s) => build(s, o.schema, handoff, cell, o.visible)).filter((l): l is LayerSpecification => l !== null);

  // Layer order: background, graticule, tile fills, tile lines, routes, world lines.
  const lineIds = new Set(SPECS.filter((s) => s.ch !== "fill").map((s) => s.id));
  const tones = tileLayers.filter((l) => !lineIds.has(l.id));
  const lines = tileLayers.filter((l) => lineIds.has(l.id));
  const ink = lineColor(roleLevel("ink"));
  // The map's own loudest tone (coastlines, borders) stays below the ink, which is kept for routes (and markers and labels).
  const peak = lineColor(roleLevel("peak"));
  // World-scale coastline (110m) up to the hand-over zoom, then the tile geometry: one solid peak line on both sides. (A
  // dashed band between the two used to dither the handover; it read as a dotted coast, see docs/palette/.)
  const worldCoastInk: LayerSpecification = {
    id: "world-coast", type: "line", source: "coast", maxzoom: noTiles ? 24 : placeholder ? WORLD_PLACEHOLDER_BELOW : handoff,
    ...(placeholder ? { layout: { visibility: "none" } } : {}),
    paint: { "line-color": peak, "line-width": cell, "line-opacity": THIN_INK },
  } as LayerSpecification;
  // Country borders are peak at street scale at every latitude (the globe eases them in below that, engine/scene.ts). Natural Earth
  // lines run up to the hand-over zoom (where the tile boundary takes over), exactly like the coastline: one line per frontier.
  const bordersInk = (max: number): LayerSpecification => ({
    id: "world-borders", type: "line", source: "borders", maxzoom: max,
    ...(placeholder ? { layout: { visibility: "none" } } : {}),
    paint: { "line-color": peak, "line-width": cell, "line-opacity": THIN_INK },
  }) as LayerSpecification;
  // Graticule: the faint level, on while the earth is visibly curved and off once the view is close to flat (layer-switch.ts, core/flatness.ts).
  const grid: LayerSpecification = {
    id: "graticule", type: "line", source: "grid",
    layout: visibility("graticule", o.visible),
    paint: { "line-color": lineColor(roleLevel("faint")), "line-opacity": THIN_INK, "line-width": cell, "line-dasharray": [1.5, 2.5] },
  } as LayerSpecification;
  // Curated routes: an erasing halo (so a route reads over a road of the same ink) and a dashed two-pixel ink line.
  const routesHalo: LayerSpecification = {
    id: "routes-halo", type: "line", source: "routes",
    layout: { "line-cap": "butt", "line-join": "round" },
    paint: { "line-color": ERASE, "line-width": ROUTE_HALO_ART * cell },
  } as LayerSpecification;
  const routesLine: LayerSpecification = {
    id: "routes-line", type: "line", source: "routes",
    layout: { "line-cap": "butt", "line-join": "miter" },
    paint: { "line-color": ink, "line-opacity": 1, "line-width": ROUTE_ART * cell, "line-dasharray": [2.2, 1.3] },
  } as LayerSpecification;

  const sources: StyleSpecification["sources"] = {
    coast: { type: "geojson", data: o.coastlines as never },
    borders: { type: "geojson", data: o.borders as never },
    grid: { type: "geojson", data: o.graticule as never },
    routes: { type: "geojson", data: o.routes as never },
  };
  if (o.tiles) {
    sources.tiles = {
      type: "vector",
      tiles: o.tiles.tiles,
      minzoom: o.tiles.minzoom,
      maxzoom: o.tiles.maxzoom,
      ...(o.tiles.bounds ? { bounds: o.tiles.bounds } : {}),
    } as never;
  }

  return {
    version: 8,
    projection: { type: o.projection ?? "globe" },
    sources,
    layers: [
      { id: "background", type: "background", paint: { "background-color": ERASE } },
      grid,
      ...tones,
      ...lines,
      routesHalo,
      routesLine,
      worldCoastInk,
      bordersInk(noTiles ? 24 : placeholder ? WORLD_PLACEHOLDER_BELOW : borderHandoff(handoff)),
    ],
  };
}

/** Ids of every layer in a built style, for tests and docs. */
export function layerIds(style: StyleSpecification): string[] {
  return style.layers.map((l) => l.id);
}
