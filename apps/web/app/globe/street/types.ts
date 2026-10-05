/**
 * Public contract of the street map. Type-only: importing this file costs nothing at runtime.
 * Like everything under app/globe/, nothing here imports from the rest of the app.
 */
import type { GlobePlace, GlobeRoute } from "../types";
import type { HealthThresholds } from "./core/tile-health";
import type { ManagerTimings, SourceId, TileReason, TileState, TileStatus } from "./core/tile-source-manager";

export type { GlobePlace, GlobeRoute, HealthThresholds, ManagerTimings, SourceId, TileReason, TileState, TileStatus };

/** MapLibre camera: zoom is the MapLibre zoom (512 px tiles); use `core/registration` to convert from/to the globe. */
export interface StreetView {
  lon: number;
  lat: number;
  zoom: number;
}

/**
 * Tile sources, as the server hands them to the client at runtime (docs/self-hosting.md, section 6). All are PUBLIC
 * URLs. Produced by `app/lib/tiles-config.server.ts`.
 */
export interface StreetTileConfig {
  /** TileJSON (z/x/y) or `.pmtiles` URL of the primary source. */
  primaryUrl: string;
  /** `.pmtiles` archive of the fallback, or null when none is configured (chain: primary then the globe floor). */
  fallbackPmtilesUrl: string | null;
  /** Highest zoom served from the fallback archive; beyond it the map over-zooms instead of requesting missing tiles. */
  maxFallbackZoom: number;
}

export interface StreetMapOptions {
  /** Initial camera. */
  view: StreetView;
  places: readonly GlobePlace[];
  routes: readonly GlobeRoute[];
  selectedSlug: string | null;
  focusedSlug: string | null;
  reducedMotion: boolean;
  tiles: StreetTileConfig;
  /**
   * CSS px at the right edge of the box that the app covers (the detail panel): the projection centre moves to the
   * free area, by a whole number of art pixels, animated like the globe's (see GlobeProps.insetRight).
   */
  insetRight: number;
  onSelect(slug: string): void;
  onViewChange?(view: StreetView): void;
  /** Every tile source transition (including the first, `connecting`). `maxZoom` tells how far the experience may go. */
  onTileStatus?(status: TileStatus): void;
  /** The map's or the overlay's WebGL context was lost (true) or both are back (false). */
  onContextChange?(lost: boolean): void;

  /**
   * Embedded in the globe handover (app/globe/handover): the host owns the camera and the input. The map root is
   * transparent (so `setBlend` shows the globe underneath), takes no pointer events, never eases the camera back to
   * the cap by itself (the host reads `getMaxZoom()` and does it) and does not animate the inset (the host passes the
   * animated value through `setCamera`).
   */
  embedded?: boolean;

  // ---- advanced / testing -------------------------------------------------------------------------------------
  minZoom?: number;
  maxZoom?: number;
  projection?: "globe" | "mercator";
  /** Bundled world lines; when omitted they are loaded from @catalyst/geodata (a separate chunk). */
  world?: { coastlines: GeoJSON.FeatureCollection; borders: GeoJSON.FeatureCollection };
  /** Pin a source: no probing, failover or recovery (dev and visual tests). */
  forceSource?: SourceId | null;
  timings?: Partial<ManagerTimings>;
  thresholds?: Partial<HealthThresholds>;
  /** Timeout of the probes, ms (default 3000). */
  probeTimeoutMs?: number;
  /** Timeout of every tile request, ms (default `thresholds.requestTimeoutMs`, 10000). */
  requestTimeoutMs?: number;
  /**
   * Render the map at device resolution and sample the art cells from it (the sharp reveal and the sharp dissolve
   * need it). Default false: native art-resolution rendering, one map pixel per art cell, scaled up with
   * nearest-neighbour; `setReveal` / `setSharp` are then no-ops.
   */
  highResolution?: boolean;
  /** Pan in whole art cells while the zoom is steady (default true; `STREET_TUNING.snapPanFromZoom`). Measurement knob. */
  snapPan?: boolean;
  /** Native mode: map pixels per art cell per axis, 1 to 3 (default `STREET_TUNING.renderScale`). */
  renderScale?: number;
  /** Start values of the compositor's capabilities. */
  initialBlend?: number;
  initialSharp?: number;
}

export interface AnimateOptions {
  /** Animate (default true; always instant under reduced motion). */
  animate?: boolean;
  durationMs?: number;
}

export interface RevealOptions extends AnimateOptions {
  /** Centre of the circle: the selected place (default) or a point. */
  center?: "selected" | { lon: number; lat: number };
}

export interface FlyOptions {
  /** Duration in ms; default scales with distance and zoom change, 0 under reduced motion. */
  durationMs?: number;
}

export interface StreetMap {
  /** The overlay of markers and labels (aria-hidden): the handover may fade it together with the dissolve. */
  readonly overlay: HTMLElement;
  /** The visible pixel-pass canvas. */
  readonly canvas: HTMLCanvasElement;

  jumpTo(view: Partial<StreetView>): void;
  /**
   * Host-driven camera (embedded use): jump to `view` and, when given, apply `inset` (CSS px, no easing) in the same
   * step. `sync` renders, composites and updates the overlay before returning, so the map is never a frame behind a
   * renderer drawn in the same task.
   */
  setCamera(view: StreetView, options?: { inset?: number; sync?: boolean; snap?: boolean }): void;
  /** The place under a CSS-px point of the container (markers, then labels), or null: what a click would select. */
  hit(x: number, y: number, kind: "mouse" | "touch"): string | null;
  /** Whether the active tile source has tiles at this point (false while connecting / capped, and outside a fallback archive's bounds). */
  covers(lon: number, lat: number): boolean;
  flyTo(view: Partial<StreetView>, options?: FlyOptions): void;
  /** Highlight the selected place. `fly` also moves the camera there (zoom: given, else at least 14.5; a jump under reduced motion). */
  setSelected(slug: string | null, options?: { fly?: boolean; zoom?: number }): void;
  setFocused(slug: string | null): void;
  setReducedMotion(on: boolean): void;
  setInset(px: number): void;
  getView(): StreetView;

  /**
   * Capability: the sharp reveal. Inside a circle around the selected place (or a point) the source render replaces
   * the pixel art, cell by cell through the Bayer mask, edge feathered. `false` closes it. Resolves when it ends.
   */
  setReveal(on: boolean, options?: RevealOptions): Promise<void>;
  /** Capability: dither dissolve of the whole pixel art into the sharp render, 0..1 (the spike's "all sharp"). */
  setSharp(value: number, options?: AnimateOptions): Promise<void>;
  /**
   * Capability: dither dissolve of the whole street map into whatever is underneath it, 0..1 (0 = transparent, 1 =
   * opaque). On the same art-pixel grid, so a Three.js globe below it shows through cell by cell.
   */
  setBlend(value: number, options?: AnimateOptions): Promise<void>;

  /**
   * false: keep rendering the map (tiles keep loading) but copy and draw nothing. The handover does this while the
   * globe is the visible renderer, so the street map costs a hidden art-resolution map render and no pass.
   */
  setActive(on: boolean): void;

  /** Native mode: map pixels per art cell per axis (1 to 3) from now on; the frame governor lowers it on slow devices. */
  setRenderScale(n: number): void;

  getTileStatus(): TileStatus;
  /** Highest zoom the experience should offer right now (the cap while no tile source works). */
  getMaxZoom(): number;
  /** Re-measure after the container changed size in a way ResizeObserver cannot see (rare). */
  resize(): void;
  /** Frees both WebGL contexts, the tile protocols, timers, observers and DOM. Safe to call twice. */
  dispose(): void;
  /** Read-only introspection and test hooks. */
  debug(): StreetDebug;
}

export interface StreetDebug {
  /** Map renders since creation (idle must not increase it). */
  renders(): number;
  /** Pass runs since creation. */
  passes(): number;
  isAnimating(): boolean;
  cellCss(): number;
  /** Projected snapped marker centre (client coordinates) if drawn. */
  project(slug: string): { x: number; y: number } | null;
  shown(): { markers: string[]; labels: string[] };
  /** Art class codes of the last frame (a GPU stall). */
  readCodes(): { cols: number; rows: number; codes: Uint8Array } | null;
  gpuSync(): void;
  lastPassMs(): number;
  /** Lose or restore the `map` or the `overlay` context through WEBGL_lose_context. */
  loseContext(which: "map" | "overlay", lose: boolean): void;
  contexts(): { mapLost: boolean; overlayLost: boolean; overlayLosses: number; overlayRestores: number };
  tile(): { status: TileStatus; failures: Record<SourceId, number>; health: Record<string, unknown> };
  attribution(): string;
  /** The MapLibre map (tests and measurement only). */
  map(): import("maplibre-gl").Map;
  /** Synchronous map render (benchmark). */
  renderNow(): void;
}
