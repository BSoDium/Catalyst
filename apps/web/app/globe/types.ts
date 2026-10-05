/**
 * Renderer-agnostic globe contract. The app talks to the globe ONLY through
 * these types; the implementation behind `Globe` can be swapped freely.
 * Nothing under app/globe/ may import from the rest of the app.
 */
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

export interface GlobeProps {
  places: GlobePlace[];
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
  onSelect(slug: string): void;
  onViewChange(view: GlobeViewState): void;
}
