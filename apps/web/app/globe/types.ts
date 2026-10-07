/**
 * Renderer-agnostic globe contract. The app talks to the globe ONLY through
 * these types; the implementation behind `Globe` can be swapped freely.
 * Nothing under app/globe/ may import from the rest of the app.
 */
import type { ComponentType } from "react";

export interface GlobeViewState {
  lon: number;
  lat: number;
  /** In [0, 1]. 0 = whole globe, 1 = the closest the world-scale globe goes (regional scale). */
  zoom: number;
  /**
   * Street scale: extra zoom levels beyond `zoom` = 1 (>= 0, about 0 to 11). Absent (or 0) on every view that
   * has not gone past the regional scale, so views saved before street scale existed stay valid. Together,
   * (`zoom`, `street`) is one continuous zoom scale: the renderer decides which engine draws it.
   */
  street?: number;
}

/**
 * A view given by what it should show instead of by a zoom: centred on (`lon`, `lat`) with the circle of
 * `fitRadiusKm` around it fitted into the free map area (with a margin; see engine/framing.ts). Input only (the
 * renderer reports plain `GlobeViewState`s). It is how a direct load starts already framed on a place, whatever the
 * viewport and the panel.
 */
export interface GlobeFitView {
  lon: number;
  lat: number;
  fitRadiusKm: number;
}

export type GlobeInitialView = GlobeViewState | GlobeFitView;

export const isFitView = (v: GlobeInitialView | null | undefined): v is GlobeFitView => !!v && "fitRadiusKm" in v;

/**
 * Whether the globe's first paint is the page colour alone, with the pixel-art globe fading in once its first frame is drawn:
 * every start but a remount with a saved view (a reload or a direct load: no view, or a view fitted on a place). Nothing else
 * may show before that frame: no placeholder, no unfinished full-resolution canvas.
 */
export const startsVeiled = (v: GlobeInitialView | null | undefined): boolean => !v || isFitView(v);

export interface GlobePlace {
  slug: string;
  name: string;
  lat: number;
  lon: number;
  labelPriority: number;
  /**
   * Radius in km of the area that should fit on screen when the place is shown (published `viewRadiusKm`).
   * Absent = `DEFAULT_VIEW_RADIUS_KM` (12 km, a typical city-wide framing).
   */
  viewRadiusKm?: number;
  /**
   * The true bounding box `[west, south, east, north]` (degrees, WGS84; no antimeridian crossing) of the city or area the place
   * sits in (published `bbox`), independent of where its recorded point lies. When present it is the place's rectangle on the
   * map (engine/lod-tree.ts); absent or invalid = a square of `viewRadiusKm` around the point. The camera centres on the
   * centre of this box (`placeFraming`, engine/framing.ts), not on `lat`/`lon`, which stay the anchor of the marker and the
   * label. The projection mapping (lib/projection.ts) also sets `viewRadiusKm` to the radius that frames this box around its
   * centre, so every framing consumer frames the box.
   */
  bbox?: readonly [number, number, number, number];
  /**
   * Slug of the innermost automatic group that contains the place (published `group`), or absent when the place is in no
   * group (or the group is not in `GlobeProps.groups`). The place is a child of that group in the semantic zoom: its marker
   * appears when the group's square has grown enough to hand over to its contents. A place with no group is a root: always
   * drawn, like before groups existed.
   */
  groupSlug?: string;
  /** ISO 3166-1 alpha-2 country code, uppercase (published `countryCode`). Absent when the country is unknown. */
  countryCode?: string;
}

/** Level of the automatic place hierarchy, widest first: continent > subregion | region > country > area > place. */
export type GlobeGroupKind = "continent" | "subregion" | "region" | "country" | "area";

/**
 * A node of the automatic place hierarchy (published `groups`): a region, country or area that stands for the places
 * below it. The globe draws it as a hollow square (see "Semantic zoom" in docs/web-architecture.md) that grows as you zoom
 * in, hands over to the squares and markers of its children, and fades away. Groups have no detail page: clicking one
 * flies the camera to frame its circle. Group slugs never clash with place slugs.
 */
export interface GlobeGroup {
  slug: string;
  name: string;
  kind: GlobeGroupKind;
  /** Slug of the enclosing group; absent on a root (a continent). An unknown parent makes a root. */
  parent?: string;
  lat: number;
  lon: number;
  /** Radius in km of the circle around (`lat`, `lon`) that covers every place of the group: the footprint of its square. */
  viewRadiusKm: number;
  /** Higher wins when labels collide, 0 to 100 (continents first). */
  labelPriority: number;
}

/** Resolved from `route.stops`: ordered points, never inferred. */
export interface GlobeRoute {
  id: string;
  title: string;
  points: { lat: number; lon: number }[];
}

/**
 * Where street-scale map tiles come from (all public URLs). Renderer-agnostic restatement of the shell loader's
 * `tiles`; with `null`/`undefined` the globe stays at world and regional scale.
 */
export interface GlobeTiles {
  /** TileJSON (z/x/y) or `.pmtiles` URL of the primary source. */
  primaryUrl: string;
  /** `.pmtiles` archive used when the primary fails, or null. */
  fallbackPmtilesUrl: string | null;
  /** Highest zoom served from the fallback archive. */
  maxFallbackZoom: number;
}

/**
 * What the app-supplied attribution control receives (see `GlobeProps.attribution`): the tile configuration that decides
 * which sources are credited (null = the globe alone), the right inset the control stays clear of, and the motion preference.
 */
export interface GlobeAttributionProps {
  tiles: { primaryUrl: string; fallbackPmtilesUrl: string | null } | null;
  insetRight: number;
  reducedMotion: boolean;
}

export interface GlobeProps {
  places: GlobePlace[];
  /**
   * The automatic place hierarchy, flat (`parent` links it into a tree). Empty = no grouping: every place is drawn as a
   * marker at every zoom, exactly as before groups existed. Semantic zoom: only the top level (continents and places in
   * no group) is drawn on the whole globe; zooming in swaps each group for its children, one level at a time, with a
   * cross-fade (engine/lod-tree.ts). Rebuilding the renderer is needed when this changes (pass a stable array).
   */
  groups: GlobeGroup[];
  routes: GlobeRoute[];
  selectedSlug: string | null;
  focusedSlug: string | null;
  /**
   * View to start from when the globe is (re)mounted; null = renderer default. A `GlobeFitView` starts already framed
   * on a place (direct load, reload): the first frame is the final framing, nothing flies.
   */
  initialView: GlobeInitialView | null;
  reducedMotion: boolean;
  /**
   * CSS px at the right edge of the globe's box that the app covers (the detail panel). The globe centres its
   * projection on the free area to the left: rotate-to-place, picking, label positions and the minimum zoom
   * (the whole globe fits the free area) all use that shifted centre. The box itself is not resized.
   * Going from 0 to a positive value (or back) is eased like the panel's slide; other changes (viewport
   * resizes) and `reducedMotion` apply at once. Read at mount as well, so a direct load with the panel
   * open starts centred. The renderer may also stop drawing under the covered strip and dissolve the
   * map's right edge into the page; the box stays full width. 0 = no inset.
   */
  insetRight: number;
  /**
   * Street-scale tile configuration. When present, zooming past the regional scale (or selecting a place) continues
   * into a street map in the same pixel look, handed over with a dither dissolve; when the tiles are unavailable the
   * zoom stops at the regional scale and a small notice says so. Optional: omitted = no street scale.
   */
  tiles?: GlobeTiles | null;
  /**
   * The map's credits control (the info button and its dialog), supplied by the app because it is app UI: the globe
   * renders it, absolutely positioned in its box, and never imports it. Optional: omitted = no credits control
   * (the app must pass one wherever the maps are shown, they carry licence-required credits).
   */
  attribution?: ComponentType<GlobeAttributionProps>;
  onSelect(slug: string): void;
  onViewChange(view: GlobeViewState): void;
}
