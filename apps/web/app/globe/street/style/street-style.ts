/**
 * Monochrome MapLibre style for the pixel pass. Hand-written (no `protomaps-themes-base`: it emits coloured fills and
 * label layers that need glyphs; this one paints only the four channels the pass understands):
 *
 *   R  hard ink          (#ff0000)               -> foreground, never dithered
 *   G  foreground tone   (#00ff00 * opacity)     -> screen-anchored lattice (fills)
 *   B  muted tone        (#0000ff * opacity)     -> muted colour (graticule, rail)
 *   black                (#000000)               -> erases (hollow road interiors, route halos)
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
import { FILL_LOD, LOD, rampStops, type LodEntry, type LodKey } from "./lod";

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

export const CHANNEL = { ink: "#ff0000", fg: "#00ff00", muted: "#0000ff", erase: "#000000" } as const;

/** Handover zoom per schema: the PMTiles extract only has tiles around the place, OpenFreeMap is global. */
export const DEFAULT_HANDOFF: Record<Schema, number> = { protomaps: 8.5, openmaptiles: 4.5 };

const zoomInterp = (stops: Stops, base = 1.5): ExpressionSpecification =>
  ["interpolate", ["exponential", base], ["zoom"], ...stops.flatMap(([z, v]) => [z, v])] as ExpressionSpecification;

export interface Spec {
  id: string;
  type: "fill" | "line";
  /** which channel */
  ch: keyof typeof CHANNEL;
  /** constant tone, or fade stops over zoom */
  tone?: number | Stops;
  /** nominal CSS width (or stops) before the art floor */
  width?: number | Stops;
  minzoom?: number;
  maxzoom?: number;
  /** schema specific source layer + filter */
  pm?: { layer: string; filter?: unknown[] };
  omt?: { layer: string; filter?: unknown[] };
  /** dash pattern in line widths (= art px). Tone lines become full-strength ink dashes; undefined = solid */
  dash?: readonly number[];
  /** tone lines drawn solid at full strength even though `tone` is set (rail) */
  solid?: boolean;
  /** width in art px (a number, or stops over zoom), overriding the nominal CSS width */
  artW?: number | Stops;
  /** this casing is hollowed out by the interior spec of the given id; from that zoom it is two thin outlines */
  hollowBy?: string;
  /** level of detail class: the spec is the FINAL look (from `LOD[lod].full`), a ramp layer is derived (RAMP_SPECS) */
  lod?: LodKey;
  /** (ramp layers) the entry whose tone ramp this layer draws */
  ramp?: LodEntry;
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
  // --- areas (tones first, ink on top) ---
  {
    id: "water-fill", type: "fill", ch: "fg", tone: [[8, 0], [10, 0.14]], minzoom: 8,
    pm: { layer: "water", filter: POLY as never }, omt: { layer: "water" },
  },
  {
    id: "park-fill", type: "fill", ch: "fg", tone: [[9, 0], [12, 0.09]], minzoom: 9,
    pm: { layer: "landuse", filter: kindIn("kind", ["park", "forest", "wood", "grass", "garden", "nature_reserve", "golf_course", "cemetery", "farmland"]) as never },
    omt: { layer: "park" },
  },
  {
    id: "building-fill", type: "fill", ch: "fg", tone: [[FILL_LOD.building.from, 0], [FILL_LOD.building.to, FILL_LOD.building.tone]], minzoom: FILL_LOD.building.from,
    pm: { layer: "buildings" }, omt: { layer: "building" },
  },
  // --- lines: dashes and muted ---
  {
    id: "waterway-minor", type: "line", ch: "fg", tone: 0.5, width: 1, lod: "stream", dash: LOD.stream.dash,
    pm: { layer: "water", filter: ["all", LINE, kindIn("kind", ["stream", "drain", "ditch"])] as never },
    omt: { layer: "waterway", filter: kindIn("class", ["stream", "drain", "ditch"]) as never },
  },
  {
    id: "boundary-region", type: "line", ch: "fg", tone: 0.4, width: 1, lod: "regionBorder", dash: LOD.regionBorder.dash,
    pm: { layer: "boundaries", filter: ["==", ["get", "kind"], "region"] as never },
    omt: { layer: "boundary", filter: ["all", [">=", ["get", "admin_level"], 3], ["<=", ["get", "admin_level"], 6], ["!=", ["get", "maritime"], 1]] as never },
  },
  {
    id: "road-minor-dotted", type: "line", ch: "fg", tone: 0.33, width: 1, lod: "minor", maxzoom: LOD.minorSolid.full, dash: LOD.minor.dash,
    pm: { layer: "roads", filter: MINOR_PM }, omt: { layer: "transportation", filter: MINOR_OMT },
  },
  {
    id: "road-link-dotted", type: "line", ch: "fg", tone: 0.25, width: 1, lod: "link", dash: LOD.link.dash,
    pm: { layer: "roads", filter: LINK_PM }, omt: { layer: "transportation", filter: LINK_OMT },
  },
  {
    id: "road-other-dotted", type: "line", ch: "fg", tone: 0.25, width: 1, lod: "service", dash: LOD.service.dash,
    pm: { layer: "roads", filter: SERVICE_PM }, omt: { layer: "transportation", filter: SERVICE_OMT },
  },
  {
    id: "path-dotted", type: "line", ch: "fg", tone: 0.25, width: 1, lod: "path", dash: LOD.path.dash,
    pm: { layer: "roads", filter: PATH_PM }, omt: { layer: "transportation", filter: PATH_OMT },
  },
  {
    id: "rail", type: "line", ch: "fg", tone: 0.8, width: 1, lod: "rail", dash: LOD.rail.dash,
    pm: { layer: "roads", filter: RAIL_PM }, omt: { layer: "transportation", filter: RAIL_OMT },
  },
  // --- lines: hard ink ---
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
    id: "water-edge", type: "line", ch: "ink", width: HAIR, minzoom: 0,
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
    id: "waterway-canal", type: "line", ch: "fg", tone: 0.6, width: 1, lod: "canal", dash: LOD.canal.dash,
    pm: { layer: "water", filter: ["all", LINE, kindIn("kind", ["canal"])] as never },
    omt: { layer: "waterway", filter: kindIn("class", ["canal"]) as never },
  },
  {
    id: "boundary-country", type: "line", ch: "ink", width: HAIR, minzoom: 3.3,
    pm: { layer: "boundaries", filter: ["==", ["get", "kind"], "country"] as never },
    omt: { layer: "boundary", filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]] as never },
  },
];

/**
 * The ramp layer of every spec with a level of detail: the same geometry, filter and widths, painted in the TONE
 * channel with an opacity that climbs from 0 at `from` to 1 at `full`, where the final ink spec takes over.
 */
export const RAMP_SPECS: Spec[] = SPECS.filter((s) => s.type === "line" && s.lod).map((s) => ({
  ...s,
  id: `${s.id}-ramp`,
  ch: "fg" as const,
  tone: undefined,
  ramp: LOD[s.lod!],
  lod: undefined,
  minzoom: LOD[s.lod!].from,
  maxzoom: LOD[s.lod!].full,
  hollowBy: undefined,
  hollowOf: undefined,
  solid: undefined,
  dash: LOD[s.lod!].dash,
  width: s.width ?? 1,
}));

/** Final-look zoom range of a spec: ink from `full` (or its own minzoom/maxzoom for classes without a ramp). */
export function zoomRangeOf(spec: Spec): { minzoom?: number; maxzoom?: number } {
  const min = spec.lod ? LOD[spec.lod].full : spec.minzoom;
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
const CELL_LAYERS = ["world-coast", "world-coast-band", "world-borders", "world-borders-band", "graticule"] as const;
/**
 * A route is two art pixels wide, dashed with the globe's 7 px period (62 % ink): the same stroke the Three.js globe
 * draws, so the curated routes keep their weight through the handover. Its erasing halo is four art pixels wide.
 */
const ROUTE_ART = 2;
const ROUTE_HALO_ART = 4;

/** Re-apply the art widths after the art cell size changed (viewport crossing 520 px, DPR change). */
export function applyCell(map: MLMap, cellCss: number): void {
  for (const spec of [...SPECS, ...RAMP_SPECS]) {
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
    const tone = spec.tone ?? 1;
    return {
      ...base,
      type: "fill",
      paint: { "fill-color": CHANNEL[spec.ch], "fill-opacity": typeof tone === "number" ? tone : zoomInterp(tone), "fill-antialias": false },
    } as LayerSpecification;
  }
  return { ...base, type: "line", ...linePaint(spec, cellCss) } as LayerSpecification;
}

/** Layout and paint of a line spec: the one place widths, dashes and opacity are decided. */
export function linePaint(spec: Spec, cellCss: number): { layout: Record<string, unknown>; paint: Record<string, unknown> } {
  if (spec.ramp) {
    // Ramp layer: the class in the tone channel. The pass dithers it with the screen-anchored lattice of the tone, so it
    // fades in without swimming; the width is the final one (art px, floor 1) and the dashes are the final dashes.
    const dash = spec.dash ? { "line-dasharray": spec.dash } : {};
    const opacity = ["interpolate", ["linear"], ["zoom"], ...rampStops(spec.ramp).flatMap(([z, v]) => [z, v])] as unknown as ExpressionSpecification;
    return {
      layout: { "line-cap": "butt", "line-join": "miter" },
      paint: { "line-color": CHANNEL.fg, "line-opacity": opacity, "line-width": artWidthPaint(spec, cellCss), ...dash },
    };
  }
  const toneLine = spec.tone !== undefined;
  // A dashed "tone" line is a one-pixel INK dash (hard threshold, stair-thinned like every thin line); a muted line
  // (rail) stays in the muted channel at full strength. Tone dithering is for fills only.
  const ch: keyof typeof CHANNEL = toneLine && spec.ch === "fg" ? "ink" : spec.ch;
  let opacity: number | ExpressionSpecification = toneLine ? (spec.ch === "muted" ? 1 : THIN_INK) : 1;
  if (spec.ch === "ink") {
    // one-pixel lines are painted weaker than wide ones: that is how the pass knows which cells it may thin
    const w = artWidthStopsOf(spec);
    const fill = spec.hollowBy ? SPECS.find((x) => x.id === spec.hollowBy) : undefined;
    const fillStops = fill ? artWidthStopsOf(fill) : null;
    const hollowFrom = fillStops && typeof fillStops !== "number" ? (fillStops.find(([, v]) => v > 0)?.[0] ?? null) : null;
    opacity =
      typeof w === "number"
        ? inkOpacityFor(w)
        : (["interpolate", ["linear"], ["zoom"], ...inkOpacityStops(w, 1.5, 0.25, hollowFrom).flatMap(([z, v]) => [z, v])] as unknown as ExpressionSpecification);
  }
  const dash = toneLine && !spec.solid && spec.dash ? { "line-dasharray": spec.dash } : {};
  return {
    layout: { "line-cap": "butt", "line-join": "miter" },
    paint: { "line-color": CHANNEL[ch], "line-opacity": opacity, "line-width": artWidthPaint(spec, cellCss), ...dash },
  };
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
  const tileLayers = noTiles ? [] : [...SPECS, ...RAMP_SPECS].map((s) => build(s, o.schema, handoff, cell)).filter((l): l is LayerSpecification => l !== null);

  // Layer order: background, graticule, tile tones, tile ink, routes, world ink.
  const inkIds = new Set(SPECS.filter((s) => s.ch === "ink" || s.ch === "erase").map((s) => s.id));
  const tones = tileLayers.filter((l) => !inkIds.has(l.id));
  const inks = tileLayers.filter((l) => inkIds.has(l.id));
  const worldCoastInk: LayerSpecification = {
    id: "world-coast", type: "line", source: "coast", maxzoom: noTiles ? 24 : handoff - 0.5,
    paint: { "line-color": CHANNEL.ink, "line-width": cell, "line-opacity": THIN_INK },
  } as LayerSpecification;
  const worldCoastBand: LayerSpecification = {
    id: "world-coast-band", type: "line", source: "coast", minzoom: noTiles ? 24 : handoff - 0.5, maxzoom: noTiles ? 24 : handoff,
    paint: { "line-color": CHANNEL.ink, "line-opacity": THIN_INK, "line-width": cell, "line-dasharray": [2, 2] },
  } as LayerSpecification;
  const bordersInk = (min: number, max: number): LayerSpecification => ({
    id: "world-borders", type: "line", source: "borders", minzoom: min, maxzoom: max,
    paint: { "line-color": CHANNEL.ink, "line-width": cell, "line-opacity": THIN_INK },
  }) as LayerSpecification;
  const bordersBand: LayerSpecification = {
    id: "world-borders-band", type: "line", source: "borders", minzoom: 3, maxzoom: 3.3,
    paint: { "line-color": CHANNEL.ink, "line-opacity": THIN_INK, "line-width": cell, "line-dasharray": [2, 2] },
  } as LayerSpecification;
  const grid: LayerSpecification = {
    id: "graticule", type: "line", source: "grid", maxzoom: 9,
    paint: { "line-color": CHANNEL.muted, "line-width": cell, "line-dasharray": [1.5, 2.5] },
  } as LayerSpecification;
  // Curated routes: an erasing halo (so a route reads over a road of the same ink) and a dashed two-pixel ink line.
  const routesHalo: LayerSpecification = {
    id: "routes-halo", type: "line", source: "routes",
    layout: { "line-cap": "butt", "line-join": "round" },
    paint: { "line-color": CHANNEL.erase, "line-width": ROUTE_HALO_ART * cell },
  } as LayerSpecification;
  const routesLine: LayerSpecification = {
    id: "routes-line", type: "line", source: "routes",
    layout: { "line-cap": "butt", "line-join": "miter" },
    paint: { "line-color": CHANNEL.ink, "line-opacity": 1, "line-width": ROUTE_ART * cell, "line-dasharray": [2.2, 1.3] },
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
      { id: "background", type: "background", paint: { "background-color": CHANNEL.erase } },
      grid,
      ...tones,
      ...inks,
      routesHalo,
      routesLine,
      worldCoastInk,
      worldCoastBand,
      bordersBand,
      bordersInk(3.3, noTiles ? 24 : 8),
    ],
  };
}

/** Ids of every layer in a built style, for tests and docs. */
export function layerIds(style: StyleSpecification): string[] {
  return style.layers.map((l) => l.id);
}
