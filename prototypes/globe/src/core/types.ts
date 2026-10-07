import type { PlaceSummary, PublishedRoute } from "@catalyst/schemas";
import type { Polylines } from "@catalyst/geodata";
import type { ScreenPoint, ViewState } from "./geo";

export type { ViewState, ScreenPoint };

export interface Theme {
  name: "light" | "dark";
  /** Page / ocean colour. */
  bg: string;
  /** Linework, markers, text. */
  ink: string;
}

export const THEMES: Record<Theme["name"], Theme> = {
  light: { name: "light", bg: "#f2f1ec", ink: "#16161a" },
  dark: { name: "dark", bg: "#0c0c0e", ink: "#e8e7e1" },
};

/** Tuned constants shared by both renderers. See docs/renderer-decision.md for how they were chosen. */
export const TUNING = {
  /** Size of one art pixel in CSS px, as a function of the smaller viewport side. */
  pixelSize(minSide: number, dpr = 1): number {
    const base = minSide < 520 ? 2 : 3;
    // Make one art pixel an integer number of device pixels, otherwise nearest-neighbour upscaling shimmers
    // on fractional DPRs (Android 2.625, some Windows scales).
    return Math.max(1, Math.round(base * dpr)) / dpr;
  },
  /** Borders: hidden below `start`, dotted (50%) from `start`, solid from `end`. Zoom = globe zoom, see geo.ts. */
  borderZoom: { start: 3.0, end: 3.3 },
  maxZoom: 6.5,
  /** Latitude clamp for the view centre. */
  maxLat: 82,
  /** Zoom used when rotating to a selected place (never zooms out). */
  selectZoom: 3.2,
  /** Route draw-on animation duration in ms. */
  routeDrawMs: 2200,
} as const;

export interface FrameStats {
  /** Number of GL frames rendered since mount. */
  frames: number;
  /** JS time of the last render call, ms. */
  lastRenderMs: number;
}

export interface GlobeInit {
  container: HTMLElement;
  places: readonly PlaceSummary[];
  routes: readonly PublishedRoute[];
  coastlines: Polylines;
  borders: Polylines;
  initialView: ViewState;
  pixelSize: number;
  reducedMotion: boolean;
  theme: Theme;
  /** Route playback: "once" draws on then rests (default), "loop" keeps marching dashes (benchmark only). */
  routeMode?: "once" | "loop";
  onSelect(slug: string | null): void;
  /** Called after the camera or size changed and the frame was drawn. */
  onViewChange(): void;
}

export interface GlobeRenderer {
  readonly kind: "three" | "maplibre";
  readonly canvas: HTMLCanvasElement;
  readonly stats: FrameStats;
  getView(): ViewState;
  getSize(): { width: number; height: number };
  /** Minimum zoom currently allowed (whole globe visible). */
  getMinZoom(): number;
  /** Instant camera move. */
  setView(view: Partial<ViewState>): void;
  /** Animated camera move; becomes an instant jump under reduced motion. */
  flyTo(view: Partial<ViewState>): void;
  select(slug: string | null): void;
  /** Show the curated route (ids from PublishedRoute) or hide it. */
  setRoute(id: string | null): void;
  setReducedMotion(on: boolean): void;
  /** Project a lon/lat into container CSS px with front-hemisphere flag. */
  project(lon: number, lat: number): ScreenPoint;
  /** Marker under a CSS-px point (front hemisphere only), or null. */
  pick(x: number, y: number, radius?: number): string | null;
  /** True while an rAF is pending (any animation, inertia or deferred render). */
  isAnimating(): boolean;
  requestRender(): void;
  dispose(): void;
}
