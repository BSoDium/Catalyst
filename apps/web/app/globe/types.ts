/**
 * Renderer-agnostic globe contract. The app talks to the globe ONLY through
 * these types; the implementation behind `Globe` can be swapped freely.
 * Nothing under app/globe/ may import from the rest of the app.
 */
import type { ComponentType } from "react";

export interface GlobeViewState {
  lon: number;
  lat: number;
  /**
   * In [0, 1]. 0 = whole globe, 1 = the closest the world-scale globe goes (regional scale). The camera may go further out than the whole
   * globe (the ring of type's regime, docs/web-architecture.md "Ring of type"): that is still 0.
   */
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
  /**
   * The entries (published articles, projects, artworks; poems later) linked to the place, each once. The place's label counts them by kind in
   * its second line ("France · 2 articles · 1 artwork · 3 software") and a group's label counts the distinct ones below it. Absent or empty =
   * none linked: the label then shows only the country. Derived by the web app from the projection (`lib/projection.ts` `placeEntries`), never
   * invented.
   */
  entries?: readonly GlobeEntryRef[];
}

/** An entry linked to a place: its kind (`article`, `project`, `artwork`, or a kind the labels do not know yet, which they ignore) and its slug. */
export interface GlobeEntryRef {
  kind: string;
  slug: string;
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
  /**
   * One per consecutive pair of `points` (`points.length - 1`): how the leg is travelled and, optionally, its geometry
   * (a precision-5 polyline, docs/api-contract.md "Route legs"). Absent, or a leg without a polyline: the geodesic arc.
   */
  legs?: GlobeLeg[];
  /**
   * The trail palette (0 blue, 1 green, 2 ocre, 3 violet; `globe/paths/trail.ts`): the route's position among the published routes, modulo 4.
   * Absent: its position in the list the globe was given.
   */
  palette?: number;
}

/** A leg of a route: the mode picks the line style, the polyline (when there is one) is the path it follows. */
export interface GlobeLeg {
  mode: "road" | "rail" | "ferry" | "flight" | "walk" | "unknown";
  polyline?: string;
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
/** The moon's words and where it leads (`GlobeProps.moon`). */
export interface GlobeMoon {
  href: string;
  /** The card's first line, and the start of the link's name. */
  title: string;
  /** What is there: one sentence. */
  description: string;
  /** The card's last line: the call to action, with its arrow if it has one. */
  cta: string;
}

export interface GlobeAttributionProps {
  tiles: { primaryUrl: string; fallbackPmtilesUrl: string | null } | null;
  insetRight: number;
  reducedMotion: boolean;
  /** Which map the control sits on: the phone's credits line is shown once per page session per surface. */
  surface: "globe" | "street";
}

/** What the app tells the globe about the home screen: it is at rest (`on`), and how much of the bottom of the globe's box it covers then. */
export interface GlobeShowcase {
  on: boolean;
  coverBottom: number;
  /** What the home screen's text and links occupy, in the globe's container (CSS px): the globe is sized and placed so its caption stays above them. */
  blocks?: readonly CoverBlock[];
}

/** A block of the home screen over the globe: where it is across the container (`x0` to `x1`) and the y of its top edge, CSS px from the container's top. */
export interface CoverBlock {
  x0: number;
  x1: number;
  top: number;
}

/** A value that changes over time and is read by subscription (the shape of a `useSyncExternalStore` source): the globe follows it without a render. */
export interface GlobeSignal<T> {
  get(): T;
  subscribe(listener: () => void): () => void;
}

/**
 * What the caption says (`GlobeProps.captionPhrases`): `sets` are phrase sets that take turns in the upper rows (each a list of rows, each row a
 * list of spans: the app wraps its own phrases), `fixed` the rows that stay under them (the call to action). Four rows are in view at once.
 */
export interface GlobeCaption {
  sets: readonly (readonly (readonly GlobeCaptionSpan[])[])[];
  fixed: readonly (readonly GlobeCaptionSpan[])[];
}

/**
 * A stretch of a caption line in one style (`GlobeProps.captionPhrases`): the words and how they are set. `plain` is the reading serif in a medium
 * weight (the default), `heavy` and `heavy-italic` the same face at its heaviest (the words to highlight), `mono` the site's code face and `script`
 * a handwriting. Spans of a line are set one after the other on one baseline: put the spaces in the text.
 */
export interface GlobeCaptionSpan {
  text: string;
  style?: "plain" | "heavy" | "heavy-italic" | "mono" | "script";
  /** In the blue text tone (the caption's one palette) instead of the secondary text tone: sparingly, and weight or face is the other carrier (colour is never the only one). */
  accent?: "blue";
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
  /**
   * The "Paths" layer: every leg of every route drawn faintly, the selected place's in ink. false hides all of them (the visitor's switch);
   * default true. Follows without a rebuild.
   */
  paths?: boolean;
  selectedSlug: string | null;
  focusedSlug: string | null;
  /**
   * A group to frame (fly to, as a click on its label does), with no place selected: the country of an entry whose only location is its
   * country (`?country=BR`). Followed on change; a direct load starts framed by `initialView`. Optional: omitted or null = nothing to frame.
   */
  framedGroup?: string | null;
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
  /**
   * A small moon that circles the planet at the world view and is a link out (docs/landing.md, "The moon"): supplied by the app because it is the site's own
   * business (where it leads and what it says). A real link: opens in a new tab, reachable by the keyboard, and holds still while the pointer or the focus is on it
   * to show a card with `title`, `description` and `cta`. Read once. Optional: omitted = no moon.
   */
  moon?: GlobeMoon;
  /**
   * The words of the mono ring of type that circles the planet when it is zoomed out (engine/ring.ts), supplied by the app because they are the
   * site's identity (`ringPhrases` in ring-text.ts builds them from it): capitals, the separator and the closing dot are the engine's.
   * Read once, when the globe is created. Optional: omitted or empty = no ring (and no showcase, so no caption).
   */
  ringPhrases?: readonly string[];
  /**
   * The lines of the caption that wraps the planet in 3D, one under the other: short, what the site is and what the visitor should do. Set in the
   * reading serif, outlined and extruded, on real parallels of the globe (engine/caption.ts). Read once. Optional: omitted or empty = the ring alone.
   */
  captionPhrases?: GlobeCaption;
  /**
   * The home screen's showcase, as a signal the globe follows without the app re-rendering (a gesture starts it, a frame is not wanted from React):
   * while `on` the boxes and labels are out and the caption is in (the camera comes back to its lowest zoom, where the ring fits), and the
   * planet is lifted by what clears `coverBottom` px of the globe's bottom edge as far as there is room above (eased like `insetRight`; at once
   * under `reducedMotion`). Without the ring (`?no-ring`, or a debug page without `?showcase`) none of it applies: the page is the previous one. Optional: omitted = never.
   */
  showcase?: GlobeSignal<GlobeShowcase>;
  /**
   * Whether the caption exists (the globe was created with a ring and lines, and the page does not switch the showcase off): called once with the answer when the
   * globe is up, and with false when it could not start. The app takes its own words for the call to action out of the way only while this is true.
   */
  onOrbit?(available: boolean): void;
  onSelect(slug: string): void;
  onViewChange(view: GlobeViewState): void;
  /**
   * The visitor started a gesture on the globe itself: a pointer pressed on it (a drag, a pinch's fingers, a tap on a place) or a wheel
   * turned over it. Fired at the start of each press and for each wheel event, and only for input that reaches the globe: not for hovering, not for input
   * on the app's own controls laid over it, not for the globe's own motion (idle rotation, flights, inertia). Optional: the landing hero
   * steps back on it (`lib/hero-machine.ts`).
   */
  onInteract?(): void;
}
