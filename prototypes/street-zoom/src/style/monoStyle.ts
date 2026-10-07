/**
 * Monochrome MapLibre style for the pixel pass. Hand-written (no `protomaps-themes-base`: that package emits
 * coloured fills and label layers that need glyphs; ours is about 150 lines and paints only the four channels the
 * pass understands, see `core/pixel.ts`).
 *
 *   R  hard ink          (#ff0000)               -> foreground, never dithered
 *   G  foreground tone   (#00ff00 * opacity)     -> ordered dither
 *   B  muted tone        (#0000ff * opacity)     -> ordered dither, drawn in the muted token
 *   black                (#000000)               -> erases (hollow road interiors)
 *
 * Two tile schemas map to the same visual spec, so the pass and the look are identical:
 *   "protomaps"    Protomaps basemap v4 (self-hosted PMTiles extract)
 *   "openmaptiles" OpenMapTiles (OpenFreeMap hosted, planet, max zoom 14)
 */
import type { ExpressionSpecification, LayerSpecification, Map as MLMap, StyleSpecification } from "maplibre-gl";
import { DESIGN_CELL_CSS, THIN_INK, artStops, cssStops, hollowFillStops, inkOpacityFor, inkOpacityStops, type Stops } from "../core/artLine";

export type Schema = "protomaps" | "openmaptiles";

/**
 * "art": every line width is authored in ART pixels and floored at one art pixel (docs/pixel-line-rules.md); tone
 * lines become dashes along the line at full strength; hollow roads get exactly one-pixel outlines.
 * "legacy": the spike's nominal CSS widths (0.6 px hairlines, tone-dithered dotted lines), kept for before/after.
 */
export type WidthMode = "art" | "legacy";

export interface MonoStyleOptions {
  schema: Schema;
  /** TileJSON / PMTiles URL for the vector source named `tiles` */
  /** null = no tile source at all (degraded mode): only the bundled world data is drawn */
  tilesUrl: string | null;
  coastlines: GeoJSON.FeatureCollection;
  borders: GeoJSON.FeatureCollection;
  graticule: GeoJSON.FeatureCollection;
  /** zoom at which the world-scale coastline (110m, @catalyst/geodata) hands over to tile geometry */
  handoffZoom?: number;
  projection?: "globe" | "mercator";
  /**
   * Paint real colours instead of channel codes: the engine's NATIVE look (anti-aliased greys), used to compare
   * against the pixel pass and for the no-pass fallback. Tones become alpha over the background.
   */
  nativePalette?: { bg: string; fg: string; muted: string };
  /** default "art" */
  widths?: WidthMode;
  /** CSS px of one art pixel (whole device px / dpr); only used by the "art" widths. Default 3. */
  cellCss?: number;
}

export const CHANNEL = { ink: "#ff0000", fg: "#00ff00", muted: "#0000ff", erase: "#000000" } as const;

/** Handover zoom per schema: Protomaps extract only has tiles around the place, OpenFreeMap is global. */
export const DEFAULT_HANDOFF: Record<Schema, number> = { protomaps: 8.5, openmaptiles: 4.5 };

const zoomInterp = (stops: Stops, base = 1.5): ExpressionSpecification => [
  "interpolate",
  ["exponential", base],
  ["zoom"],
  ...stops.flatMap(([z, v]) => [z, v]),
] as ExpressionSpecification;

export interface Spec {
  id: string;
  type: "fill" | "line";
  /** which channel */
  ch: keyof typeof CHANNEL;
  /** constant tone, or fade stops over zoom */
  tone?: number | Stops;
  width?: number | Stops;
  minzoom?: number;
  maxzoom?: number;
  /** schema specific source layer + filter */
  pm?: { layer: string; filter?: unknown[] };
  omt?: { layer: string; filter?: unknown[] };
  /** art mode: dash pattern in line widths (= art px). Tone lines become full-strength dashes; undefined = solid */
  dash?: number[];
  /** art mode: tone lines are drawn solid at full strength even though `tone` is set (rail) */
  solid?: boolean;
  /** art mode: width in art px (a number, or stops over zoom), overriding the nominal CSS width */
  artW?: number | Stops;
  /** art mode: this casing is hollowed out by the interior spec of the given id; from that zoom it is two thin outlines */
  hollowBy?: string;
  /** art mode: this is the erasing interior of a hollow road whose casing follows these ART-pixel stops */
  hollowOf?: Stops;
}

const LINE = ["==", ["geometry-type"], "LineString"] as const;
const POLY = ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "MultiPolygon"]] as const;
const kindIn = (key: string, v: string[]) => ["in", ["get", key], ["literal", v]] as const;

/** Road width ramps in CSS px. Casing and interior are separate layers so big roads come out hollow. */
/** Hairline: ~1.2 source px at 2x. After max pooling and a 0.5 threshold this lands on 1 art pixel most of the time. */
const HAIR = 0.6;
const MAJOR_CASE: Stops = [[5, HAIR], [12, 1.1], [14, 2.2], [15, 3.4], [16, 7], [17, 14], [18, 30]];
const MAJOR_FILL: Stops = [[16, 0], [16.6, 2.6], [17, 8], [18, 22]];
const MED_CASE: Stops = [[12, HAIR], [14, 1], [15, 2], [16, 5], [17, 10], [18, 24]];
/**
 * The same ramps in ART pixels (art mode). The spike's CSS ramps divided by 3 would collapse the road hierarchy:
 * its max-pooled lines were about one art pixel wider than their nominal width, and the hierarchy was tuned on that.
 * These are the widths the old look really had: highways and major roads 2 px at z15, 3 at z16, hollow from z16.4;
 * medium roads one step lighter; everything else one pixel. Never below 1.
 */
const MAJOR_ART: Stops = [[5, 1], [12, 1.3], [14, 1.6], [15, 2], [16, 3.2], [17, 5.6], [18, 10]];
const MED_ART: Stops = [[12, 1], [14, 1.2], [15, 1.5], [16, 2.6], [17, 4.2], [18, 8.9]];
const MED_FILL: Stops = [[16.4, 0], [17, 3], [18, 14]];

const HIGHWAY_PM = kindIn("kind", ["highway"]) as never;
const HIGHWAY_OMT = kindIn("class", ["motorway", "trunk"]) as never;
const MAJOR_PM = kindIn("kind", ["major_road"]) as never;
const MAJOR_OMT = kindIn("class", ["primary", "secondary"]) as never;
const MEDIUM_PM = ["==", ["get", "kind"], "medium_road"] as never;
const MEDIUM_OMT = ["==", ["get", "class"], "tertiary"] as never;
const BIG_PM = kindIn("kind", ["highway", "major_road"]) as never;
const BIG_OMT = kindIn("class", ["motorway", "trunk", "primary", "secondary"]) as never;

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
    id: "building-fill", type: "fill", ch: "fg", tone: [[15, 0], [16, 0.14], [17.5, 0.22]], minzoom: 15,
    pm: { layer: "buildings" }, omt: { layer: "building" },
  },
  // --- lines: tones ---
  {
    id: "waterway-minor", type: "line", ch: "fg", tone: 0.5, width: 1, minzoom: 12.5, dash: [3, 1.5],
    pm: { layer: "water", filter: ["all", LINE, kindIn("kind", ["stream", "drain", "ditch"])] as never },
    omt: { layer: "waterway", filter: kindIn("class", ["stream", "drain", "ditch"]) as never },
  },
  {
    id: "boundary-region", type: "line", ch: "fg", tone: 0.4, width: 1, minzoom: 5, dash: [4, 1.5],
    pm: { layer: "boundaries", filter: ["==", ["get", "kind"], "region"] as never },
    omt: { layer: "boundary", filter: ["all", [">=", ["get", "admin_level"], 3], ["<=", ["get", "admin_level"], 6], ["!=", ["get", "maritime"], 1]] as never },
  },
  {
    id: "road-minor-dotted", type: "line", ch: "fg", tone: 0.33, width: 1, minzoom: 15, maxzoom: 16.2, dash: [1.8, 2.4],
    pm: { layer: "roads", filter: ["==", ["get", "kind"], "minor_road"] as never },
    omt: { layer: "transportation", filter: kindIn("class", ["minor", "service", "track"]) as never },
  },
  {
    id: "road-other-dotted", type: "line", ch: "fg", tone: 0.25, width: 1, minzoom: 15.5, dash: [1.8, 3.6],
    pm: { layer: "roads", filter: ["==", ["get", "kind"], "other"] as never },
    omt: { layer: "transportation", filter: kindIn("class", ["service", "track"]) as never },
  },
  {
    id: "path-dotted", type: "line", ch: "fg", tone: 0.25, width: 1, minzoom: 16, dash: [1.8, 3.6],
    pm: { layer: "roads", filter: ["==", ["get", "kind"], "path"] as never },
    omt: { layer: "transportation", filter: ["==", ["get", "class"], "path"] as never },
  },
  {
    id: "rail", type: "line", ch: "muted", tone: 0.8, width: 1, minzoom: 11, solid: true, artW: 1.8,
    pm: { layer: "roads", filter: ["==", ["get", "kind"], "rail"] as never },
    omt: { layer: "transportation", filter: kindIn("class", ["rail", "transit"]) as never },
  },
  // --- lines: hard ink ---
  {
    id: "road-minor", type: "line", ch: "ink", width: 0.8, minzoom: 16.2,
    pm: { layer: "roads", filter: ["==", ["get", "kind"], "minor_road"] as never },
    omt: { layer: "transportation", filter: kindIn("class", ["minor"]) as never },
  },
  {
    id: "road-medium-case", type: "line", ch: "ink", width: MED_CASE, artW: MED_ART, minzoom: 13, hollowBy: "road-medium-fill",
    pm: { layer: "roads", filter: MEDIUM_PM }, omt: { layer: "transportation", filter: MEDIUM_OMT },
  },
  {
    id: "road-major-case", type: "line", ch: "ink", width: MAJOR_CASE, artW: MAJOR_ART, minzoom: 12.5, hollowBy: "road-major-fill",
    pm: { layer: "roads", filter: MAJOR_PM }, omt: { layer: "transportation", filter: MAJOR_OMT },
  },
  {
    id: "road-highway-case", type: "line", ch: "ink", width: MAJOR_CASE, artW: MAJOR_ART, minzoom: 5, hollowBy: "road-major-fill",
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
    id: "building-outline", type: "line", ch: "ink", width: HAIR, minzoom: 17,
    pm: { layer: "buildings" }, omt: { layer: "building" },
  },
  {
    id: "water-edge", type: "line", ch: "ink", width: HAIR, minzoom: 0, maxzoom: 12.5,
    pm: { layer: "water", filter: ["all", POLY, kindIn("kind", ["ocean", "sea", "lake", "water"])] as never },
    omt: { layer: "water", filter: kindIn("class", ["ocean", "sea", "lake"]) as never },
  },
  {
    id: "water-edge-detail", type: "line", ch: "ink", width: HAIR, minzoom: 12.5,
    pm: { layer: "water", filter: POLY as never }, omt: { layer: "water" },
  },
  {
    id: "waterway-major", type: "line", ch: "ink", width: [[8, HAIR], [14, 1.6], [17, 6]], artW: [[8, 1], [14, 1.4], [17, 2.9]], minzoom: 11,
    pm: { layer: "water", filter: ["all", LINE, kindIn("kind", ["river"])] as never },
    omt: { layer: "waterway", filter: kindIn("class", ["river"]) as never },
  },
  {
    id: "waterway-canal", type: "line", ch: "fg", tone: 0.6, width: 1, minzoom: 13, dash: [6, 1.5],
    pm: { layer: "water", filter: ["all", LINE, kindIn("kind", ["canal"])] as never },
    omt: { layer: "waterway", filter: kindIn("class", ["canal"]) as never },
  },
  {
    id: "boundary-country", type: "line", ch: "ink", width: HAIR, minzoom: 3.3,
    pm: { layer: "boundaries", filter: ["==", ["get", "kind"], "country"] as never },
    omt: { layer: "boundary", filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]] as never },
  },
];

let NATIVE: MonoStyleOptions["nativePalette"];
function colorFor(ch: keyof typeof CHANNEL): string {
  if (!NATIVE) return CHANNEL[ch];
  return ch === "muted" ? NATIVE.muted : ch === "erase" ? NATIVE.bg : NATIVE.fg;
}

/** Nominal CSS width (or stops) of a spec in art pixels, floored at one art pixel; hollow interiors derived from the casing. */
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

/** The spike's nominal CSS `line-width` of a spec (before/after measurements restore it). */
export function legacyWidthPaint(spec: Spec): number | ExpressionSpecification {
  return typeof spec.width === "number" ? spec.width : spec.width ? zoomInterp(spec.width) : 1;
}

/** Re-apply the art widths after the art cell size changed (viewport crossing 520 px, DPR change). */
export function applyCell(map: MLMap, cellCss: number): void {
  for (const spec of SPECS) {
    if (spec.type !== "line" || !map.getLayer(spec.id)) continue;
    map.setPaintProperty(spec.id, "line-width", artWidthPaint(spec, cellCss) as never);
  }
  for (const id of ["world-coast", "world-coast-band", "world-borders", "world-borders-band", "graticule"]) {
    if (map.getLayer(id)) map.setPaintProperty(id, "line-width", cellCss);
  }
}

function build(spec: Spec, schema: Schema, handoff: number, mode: WidthMode, cellCss: number): LayerSpecification | null {
  const src = schema === "protomaps" ? spec.pm : spec.omt;
  if (!src) return null;
  const art = mode === "art";
  const tone = spec.tone ?? 1;
  // art mode: lines carry full strength (a dash or a solid line), the tone only fades fills
  const toneLine = spec.type === "line" && spec.tone !== undefined;
  const opacity = art && toneLine ? 1 : typeof tone === "number" ? tone : zoomInterp(tone);
  let minzoom = spec.minzoom;
  // tile based water edges only take over from the world-scale geodata coastline at the hand-over zoom
  if (spec.id === "water-edge") minzoom = handoff;
  if (art && spec.hollowOf) {
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
    return {
      ...base,
      type: "fill",
      paint: { "fill-color": colorFor(spec.ch), "fill-opacity": opacity, "fill-antialias": false },
    } as LayerSpecification;
  }
  return {
    ...base,
    type: "line",
    ...linePaint(spec, mode, cellCss),
  } as LayerSpecification;
}

/** Layout and paint of a line spec: the one place widths, dashes and opacity are decided. */
export function linePaint(spec: Spec, mode: WidthMode, cellCss: number): { layout: Record<string, unknown>; paint: Record<string, unknown> } {
  const art = mode === "art";
  const tone = spec.tone ?? 1;
  const toneLine = spec.tone !== undefined;
  // art mode: a dashed "tone" line is a one-pixel INK dash (hard threshold, stair-thinned like every thin line); a
  // muted line (rail) stays in the muted channel at full strength. Tone dithering is for fills only.
  const ch: keyof typeof CHANNEL = art && toneLine && spec.ch === "fg" ? "ink" : spec.ch;
  let opacity: number | ExpressionSpecification = art && toneLine ? (spec.ch === "muted" ? 1 : THIN_INK) : typeof tone === "number" ? tone : zoomInterp(tone);
  if (art && spec.ch === "ink") {
    // one-pixel lines are painted weaker than wide ones: that is how the pass knows which cells it may thin
    const w = artWidthStopsOf(spec);
    const fill = spec.hollowBy ? SPECS.find((x) => x.id === spec.hollowBy) : undefined;
    const fillStops = fill ? artWidthStopsOf(fill) : null;
    const hollowFrom = fillStops && typeof fillStops !== "number" ? (fillStops.find(([, v]) => v > 0)?.[0] ?? null) : null;
    opacity = typeof w === "number" ? inkOpacityFor(w) : (["interpolate", ["linear"], ["zoom"], ...inkOpacityStops(w, 1.5, 0.25, hollowFrom).flatMap(([z, v]) => [z, v])] as unknown as ExpressionSpecification);
  }
  const width = art ? artWidthPaint(spec, cellCss) : legacyWidthPaint(spec);
  const dash = art && toneLine && !spec.solid && spec.dash ? { "line-dasharray": spec.dash } : {};
  return {
    layout: { "line-cap": "butt", "line-join": "miter" },
    paint: { "line-color": colorFor(ch), "line-opacity": opacity, "line-width": width, ...dash },
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

export function buildMonoStyle(o: MonoStyleOptions): StyleSpecification {
  NATIVE = o.nativePalette;
  const col = (ch: keyof typeof CHANNEL) => colorFor(ch);
  const handoff = o.handoffZoom ?? DEFAULT_HANDOFF[o.schema];
  const noTiles = o.tilesUrl === null;
  const mode = o.widths ?? "art";
  const cell = o.cellCss ?? DESIGN_CELL_CSS;
  const art = mode === "art";
  const hair = art ? cell : HAIR;
  const tileLayers = noTiles ? [] : SPECS.map((s) => build(s, o.schema, handoff, mode, cell)).filter((l): l is LayerSpecification => l !== null);
  const sourceDef = { type: "vector", url: o.tilesUrl ?? "" } as const;

  // Layer order: background, world geodata tones, tile tones, tile ink, world ink.
  const inkIds = new Set(SPECS.filter((s) => s.ch === "ink" || s.ch === "erase").map((s) => s.id));
  const tones = tileLayers.filter((l) => !inkIds.has(l.id));
  const inks = tileLayers.filter((l) => inkIds.has(l.id));
  const worldCoastInk: LayerSpecification = {
    id: "world-coast", type: "line", source: "coast", maxzoom: noTiles ? 24 : handoff - 0.5,
    paint: { "line-color": col("ink"), "line-width": hair, ...(art ? { "line-opacity": THIN_INK } : {}) },
  } as LayerSpecification;
  const worldCoastBand: LayerSpecification = {
    id: "world-coast-band", type: "line", source: "coast", minzoom: noTiles ? 24 : handoff - 0.5, maxzoom: noTiles ? 24 : handoff,
    paint: { "line-color": col(art ? "ink" : "fg"), "line-opacity": art ? THIN_INK : 0.5, "line-width": art ? cell : 1, ...(art ? { "line-dasharray": [2, 2] } : {}) },
  } as LayerSpecification;
  const bordersInk = (min: number, max: number): LayerSpecification => ({
    id: "world-borders", type: "line", source: "borders", minzoom: min, maxzoom: max,
    paint: { "line-color": col("ink"), "line-width": hair, ...(art ? { "line-opacity": THIN_INK } : {}) },
  }) as LayerSpecification;
  const bordersBand: LayerSpecification = {
    id: "world-borders-band", type: "line", source: "borders", minzoom: 3, maxzoom: 3.3,
    paint: { "line-color": col(art ? "ink" : "fg"), "line-opacity": art ? THIN_INK : 0.5, "line-width": art ? cell : 1, ...(art ? { "line-dasharray": [2, 2] } : {}) },
  } as LayerSpecification;
  const grid: LayerSpecification = {
    id: "graticule", type: "line", source: "grid", maxzoom: 9,
    paint: art
      ? { "line-color": col("muted"), "line-width": cell, "line-dasharray": [1.5, 2.5] }
      : { "line-color": col("muted"), "line-width": HAIR, "line-dasharray": [5, 10] },
  } as LayerSpecification;

  const sources: StyleSpecification["sources"] = {
    coast: { type: "geojson", data: o.coastlines as never },
    borders: { type: "geojson", data: o.borders as never },
    grid: { type: "geojson", data: o.graticule as never },
  };
  if (!noTiles) sources.tiles = sourceDef as never;

  return {
    version: 8,
    projection: { type: o.projection ?? "globe" },
    sources,
    layers: [
      { id: "background", type: "background", paint: { "background-color": o.nativePalette ? o.nativePalette.bg : "#000000" } },
      grid,
      ...tones,
      ...inks,
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
