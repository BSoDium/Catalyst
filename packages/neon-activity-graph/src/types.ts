import type { Cell, Matrix } from "./layout";
import type { OverlayOptions } from "./overlay";

/** One day of one layer. `date` is an ISO day (`2026-11-19`), read in UTC. */
export interface DayValue {
  date: string;
  value: number;
}

/** A layer of blocks: one number a day. */
export interface GraphLayer {
  /** What it is called (used for the hover and the accessible label; not drawn on the picture). */
  label?: string;
  /** The unit, if any ("contributions", "h"). */
  unit?: string;
  days: DayValue[];
}

/**
 * What the graph draws: two layers, one block of each a day, stacked in one column. `bottom` is the lower block (coding time, in the original), `top` the upper one (contributions). Either can be empty.
 * The graph shows the last `weeks` weeks ending at the latest day of either layer.
 */
export interface GraphData {
  top: GraphLayer;
  bottom: GraphLayer;
}

/** A colour as `#rrggbb`, or a number (`0xrrggbb`). */
export type ColorInput = string | number;

/** A layer's colours: the glass of a quiet day and of the busiest one (what lies between is mixed). */
export type Tones = [low: ColorInput, high: ColorInput];

export interface LayerColors {
  light: Tones;
  dark: Tones;
}

/** What the graph says about the day under the pointer (or the arrow keys). Positions are CSS pixels of the container. */
export interface HoverInfo {
  /** Index in the grid of days (weeks x 7, oldest first). */
  index: number;
  date: string;
  /** The values of the two layers on that day. */
  top: number;
  bottom: number;
  /** SVG `points` of the column's silhouette (a hull of 64 points: outlines of two days can be interpolated). */
  outline: string;
  /** A point on the column's top to hang a card on. */
  x: number;
  y: number;
  /** When several days are under the pointer, one behind another: which one this is (0 the nearest) and how many there are. */
  behind?: { index: number; count: number };
}

/** What `rodColor` is asked about. */
export interface RodContext {
  layer: "top" | "bottom";
  /** Index in the grid of days (the same for both layers of a day). */
  index: number;
  date: string;
  /** 0..1, how busy the day was in this layer. */
  t: number;
}

export type Rgb = readonly [r: number, g: number, b: number];

export interface Startup {
  start?(): void;
  stop?(): void;
}

export interface GraphOptions {
  /** The two layers, or `null` while they are being fetched: only the place-holder is shown, and the graph is built by `update(data)`. */
  data: GraphData | null;
  /** How many weeks are drawn (default 53). */
  weeks?: number;
  /** One long strip (1, default), or 4 staggered strips for a narrow, tall box (the picture is then about a third narrower; give the box an aspect of about 0.8). */
  strips?: number;
  /** `"auto"` (default) follows `prefers-color-scheme` (and its changes). */
  theme?: "light" | "dark" | "auto";
  /** The colours of each layer (defaults: GitHub-ish green on top, blue below). */
  colors?: { top?: Partial<LayerColors>; bottom?: Partial<LayerColors> };
  /** The page's own background, which the ground takes so that the picture has no seam with it: a CSS colour, or a function called at every (re)build with the theme. Default: the nearest opaque background of the container, else white / near black. */
  background?: string | ((theme: "light" | "dark") => string);
  /**
   * The colour of each rod's light in the dark theme, as linear-ish RGB around 0..1 (a busy day is brighter), or `null` for the default (green / blue neon). Giving this function turns on the "string of lights" look:
   * clear glass, no grey veil, a softer bloom, white lights that take the colour of their neighbours. The light theme ignores it.
   */
  rodColor?: (ctx: RodContext) => Rgb | null;
  /** The synthesised hum and dings of the start-up (default true; they play only once the browser lets the page make sound). */
  sound?: boolean;
  /** `"auto"` (default) follows `prefers-reduced-motion`; when reduced, there is no start-up, no flicker, no hover glow animation. */
  reducedMotion?: "auto" | boolean;
  /** The light version (a third of the frames, lower resolution, simpler blocks): `"auto"` (default) turns it on for coarse pointers and weak machines. */
  lite?: "auto" | boolean;
  /** Film grain strength (default 0.012; 0 turns it off). */
  grain?: number;
  /** Where the baked light of the dark theme is fetched from (a PNG). Default: embedded in the package. */
  templatesUrl?: string;
  /** The accessible name of the graph (default "Activity graph, one column a day. Use the arrow keys to move between days."). */
  label?: string;
  /** The day under the pointer (or the arrow keys), or null when there is none. */
  onHover?: (info: HoverInfo | null) => void;
  /** The blocks' bounds changed (the first layout, a resize). */
  onLayout?: (bounds: ContentBounds) => void;
  /** The first picture is on screen (fade your place-holder out). */
  onReady?: () => void;
  /** The picture has been drawn again and is in focus: after the first build, and after every rebuild (a new theme, new colours, a resize). Use it to time an effect to the moment the picture changes, not to the click that asked for it. */
  onRedrawn?: () => void;
  /** `false` while the neon start-up runs, `true` when the picture is lit (always, when there is no start-up). */
  onLit?: (lit: boolean) => void;
  /**
   * Called each time a start-up is prepared (dark theme, motion allowed). Return `{ start, stop }` to hook into it (a sound of your own, a greeting): `start` is called when the start-up begins,
   * `stop` when it is torn down. `inView()` tells whether the graph is on screen and the tab visible.
   */
  startup?: (ctx: { inView: () => boolean }) => Startup | void;
  /** Show the SVG place-holder (the flat days) until the first picture is on screen (default true; the React view renders it itself, so it is in server-rendered pages). */
  placeholder?: boolean;
  /** The day's outline and card, drawn over the graph (default off): `true`, or options. See `createHoverOverlay`. */
  overlay?: boolean | OverlayOptions;
  /** The highest pixel ratio the picture is rendered at (default 2; a `lite` device always gets 1). */
  maxPixelRatio?: number;
  /** The most pixels the picture is rendered at (default 8 million: the render is scaled down on a very large container). */
  maxPixels?: number;
  /** Development helpers: `metrics` writes `data-*` timings on the container and logs the ground light's cost, `wireframe` draws the glass as a cage, `neonHold` holds the picture half on, half off (a number between 0 and 1: the off half at that level). */
  debug?: { metrics?: boolean; wireframe?: boolean; neonHold?: boolean | number };
}

/** Where the blocks are on the screen, in CSS pixels of the container (not the box: the isometric view leaves empty ground at the corners). */
export interface ContentBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface ActivityGraph {
  /** Where the blocks are (null before the first picture is laid out). Also set on the container as the CSS variables `--nag-content-left`, `--nag-content-right`, `--nag-content-top` and `--nag-content-bottom` (px), kept up to date on resize. */
  readonly bounds: ContentBounds | null;
  /** Draws other data (the graph is rebuilt). */
  update(data: GraphData): void;
  /** One of the start-up's bell-like clicks on demand (`"big"`: a deeper bell with a high one over it), for a change the visitor made; honours the `sound` option, and stays silent in the light theme (the neon tubes are off there) and where the browser does not allow sound (call it from a click or key handler). */
  cling(size?: "small" | "big"): void;
  /** Changes the colours of one or both layers (see `colors`): the blocks are rebuilt once the changes settle (about 120 ms after the last call), without the start-up and without refetching; the old picture stays, softened, until the new one is in focus. */
  setColors(colors: { top?: Partial<LayerColors>; bottom?: Partial<LayerColors> }): void;
  /** Changes the theme (the graph is rebuilt, and the start-up plays again in the dark one). Call it again after the page's background changed. */
  setTheme(theme: "light" | "dark" | "auto"): void;
  /** Resolves when the graph has been built (or has failed). */
  ready: Promise<void>;
  /** Stops everything and frees the GPU resources and the listeners. */
  destroy(): void;
}

export type { Cell, Matrix };
