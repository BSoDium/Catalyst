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
import { activeLevels, roleLevel, type Role } from "../core/palette";
import { ERASE, fillColor, lineColor } from "../core/palette";
import { FILL_LOD, LOD, stepZoom, type LodKey } from "./lod";

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
}

/** Fade stops of a colour over zoom: level k from `at[k]` (ascending zooms), as a MapLibre `step` expression. */
function stepColors(levels: number[], zooms: number[], color: (level: number) => string): string | ExpressionSpecification {
  if (levels.length === 1) return color(levels[0]!);
  return ["step", ["zoom"], color(levels[0]!), ...levels.slice(1).flatMap((lv, i) => [zooms[i + 1]!, color(lv)])] as unknown as ExpressionSpecification;
}

/** Colour of a fade-in over zoom: the faintest level first, stepping up to the role's level at `full` (equal zoom steps). */
export function fadeInColor(e: { from: number; full: number; role: Role }, color: (level: number) => string, n: number = activeLevels()): string | ExpressionSpecification {
  const final = roleLevel(e.role, n);
  const levels = Array.from({ length: final }, (_, i) => i + 1);
  return stepColors(levels, levels.map((k) => stepZoom(e, k, n)), color);
}

/** Colour of a fade-out over zoom [from, gone]: the role's level first, stepping down to the faintest one (the layer ends at `gone`). */
export function fadeOutColor(e: { from: number; gone: number; role: Role }, color: (level: number) => string, n: number = activeLevels()): string | ExpressionSpecification {
  const start = roleLevel(e.role, n);
  const levels = Array.from({ length: start }, (_, i) => start - i);
  return stepColors(levels, levels.map((_, i) => e.from + (i / start) * (e.gone - e.from)), color);
}

/** Handover zoom per schema: the PMTiles extract only has tiles around the place, OpenFreeMap is global. */
export const DEFAULT_HANDOFF: Record<Schema, number> = { protomaps: 8.5, openmaptiles: 4.5 };

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
  /** level of detail class (lod.ts): fades in over [from, full] in tone, final look from `full` */
  lod?: LodKey;
  /** (fills) fade-in range and tone */
  fade?: { from: number; full: number; role: Role };
  /** this is the erasing interior of a hollow road whose casing follows these ART-pixel stops */
  hollowOf?: Stops;
}

const LINE = ["==", ["geometry-type"], "LineString"] as const;
const POLY = ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "MultiPolygon"]] as const;
const kindIn = (key: string, v: string[]) => ["in", ["get", key], ["literal", v]] as const;

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
const MAJOR_ART: Stops = [[5, 1], [14.6, 1], [15.2, 1.7], [16, 2.4], [17, 4.2], [18, 9]];
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
    id: "water-fill", type: "fill", ch: "fill", fade: FILL_LOD.water, minzoom: FILL_LOD.water.from,
    pm: { layer: "water", filter: POLY as never }, omt: { layer: "water" },
  },
  {
    id: "park-fill", type: "fill", ch: "fill", fade: FILL_LOD.park, minzoom: FILL_LOD.park.from,
    pm: { layer: "landuse", filter: kindIn("kind", ["park", "forest", "wood", "grass", "garden", "nature_reserve", "golf_course", "cemetery", "farmland"]) as never },
    omt: { layer: "park" },
  },
  {
    id: "building-fill", type: "fill", ch: "fill", fade: FILL_LOD.building, minzoom: FILL_LOD.building.from,
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
    pm: { layer: "boundaries", filter: ["==", ["get", "kind"], "region"] as never },
    omt: { layer: "boundary", filter: ["all", [">=", ["to-number", ["get", "admin_level"], 99], 3], ["<=", ["to-number", ["get", "admin_level"], 99], 6], ["!=", ["get", "maritime"], 1]] as never },
  },
  {
    id: "road-minor-dotted", type: "line", ch: "ink", width: 1, lod: "minor", maxzoom: LOD.minorSolid.full, dash: LOD.minor.dash,
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
    id: "road-secondary-case", type: "line", ch: "ink", width: MAJOR_CASE, artW: MAJOR_ART, lod: "secondary", hollowBy: "road-major-fill",
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
    id: "water-edge", type: "line", ch: "ink", role: "ink", width: HAIR, minzoom: 0,
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
    id: "boundary-country", type: "line", ch: "ink", role: "ink", width: HAIR, minzoom: 3.3,
    pm: { layer: "boundaries", filter: ["==", ["get", "kind"], "country"] as never },
    omt: { layer: "boundary", filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]] as never },
  },
];

/** Final-look zoom range of a spec: a class with a level of detail exists from `from` (its fade-in is part of the layer). */
export function zoomRangeOf(spec: Spec): { minzoom?: number; maxzoom?: number } {
  const min = spec.lod ? LOD[spec.lod].from : spec.minzoom;
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
/** The graticule eases out through the palette levels between these map zooms (regional scale to street scale). */
export const GRATICULE_FADE = { from: 6.5, gone: 9.5 } as const;
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

function build(spec: Spec, schema: Schema, handoff: number, cellCss: number): LayerSpecification | null {
  const src = schema === "protomaps" ? spec.pm : spec.omt;
  if (!src) return null;
  let minzoom = zoomRangeOf(spec).minzoom;
  // tile based water edges only take over from the world-scale geodata coastline at the hand-over zoom
  if (spec.id === "water-edge") minzoom = handoff;
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
    const fade = spec.fade ?? { from: 0, full: 0, role: spec.role ?? "wash" };
    return {
      ...base,
      type: "fill",
      paint: { "fill-color": fadeInColor(fade, fillColor), "fill-opacity": 1, "fill-antialias": false },
    } as LayerSpecification;
  }
  return { ...base, type: "line", ...linePaint(spec, cellCss) } as LayerSpecification;
}

/** Layout and paint of a line spec: the one place widths, dashes, colour (level) and opacity (thin / wide) are decided. */
export function linePaint(spec: Spec, cellCss: number): { layout: Record<string, unknown>; paint: Record<string, unknown> } {
  const dash = spec.dash ? { "line-dasharray": spec.dash } : {};
  const layout = { "line-cap": "butt", "line-join": "miter" };
  if (spec.ch === "erase") {
    return { layout, paint: { "line-color": ERASE, "line-opacity": 1, "line-width": artWidthPaint(spec, cellCss) } };
  }
  // The colour is the tone: a class with a level of detail fades in through the levels, any other line has its role's level.
  const color = spec.lod ? fadeInColor(LOD[spec.lod], lineColor) : lineColor(roleLevel(spec.role ?? "ink"));
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
  const cell = o.cellCss ?? DESIGN_CELL_CSS;
  const tileLayers = noTiles ? [] : SPECS.map((s) => build(s, o.schema, handoff, cell)).filter((l): l is LayerSpecification => l !== null);

  // Layer order: background, graticule, tile fills, tile lines, routes, world lines.
  const lineIds = new Set(SPECS.filter((s) => s.ch !== "fill").map((s) => s.id));
  const tones = tileLayers.filter((l) => !lineIds.has(l.id));
  const lines = tileLayers.filter((l) => lineIds.has(l.id));
  const ink = lineColor(roleLevel("ink"));
  // World-scale coastline (110m) up to the hand-over zoom, then the tile geometry: one solid ink line on both sides. (A
  // dashed band between the two used to dither the handover; it read as a dotted coast, see docs/palette/.)
  const worldCoastInk: LayerSpecification = {
    id: "world-coast", type: "line", source: "coast", maxzoom: noTiles ? 24 : handoff,
    paint: { "line-color": ink, "line-width": cell, "line-opacity": THIN_INK },
  } as LayerSpecification;
  // Country borders are full ink at street scale at every latitude (the globe eases them in below that, engine/scene.ts).
  const bordersInk = (max: number): LayerSpecification => ({
    id: "world-borders", type: "line", source: "borders", maxzoom: max,
    paint: { "line-color": ink, "line-width": cell, "line-opacity": THIN_INK },
  }) as LayerSpecification;
  // Graticule: the faint level, easing out through the levels while the map zooms from regional to street scale.
  const grid: LayerSpecification = {
    id: "graticule", type: "line", source: "grid", maxzoom: GRATICULE_FADE.gone,
    paint: { "line-color": fadeOutColor({ ...GRATICULE_FADE, role: "faint" }, lineColor) as never, "line-opacity": THIN_INK, "line-width": cell, "line-dasharray": [1.5, 2.5] },
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
      bordersInk(noTiles ? 24 : 8),
    ],
  };
}

/** Ids of every layer in a built style, for tests and docs. */
export function layerIds(style: StyleSpecification): string[] {
  return style.layers.map((l) => l.id);
}
