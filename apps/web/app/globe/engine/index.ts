/**
 * Wires the renderer, the label overlay and the app-level view state together. This is the only module the
 * React component talks to; it is imported dynamically so that `three` stays in its own client chunk.
 */
import type { Polylines } from "@catalyst/geodata";
import { isFitView, type CoverBlock, type GlobeCaption, type GlobeInitialView, type GlobePlace, type GlobeProps, type GlobeRoute, type GlobeViewState } from "../types";
import { readTheme } from "./colors";
import { BoxScene } from "./box-scene";
import { placeFraming } from "./framing";
import type { LodTree } from "./lod-tree";
import { GlobeRenderer, type RendererOptions, type StartView } from "./renderer";
import { SPIN } from "./idle-spin";
import { TUNING } from "./tuning";
import { sameView, toViewState } from "./view";
import { isWebGLAvailable } from "./webgl";

class WebGLUnavailableError extends Error {
  constructor() {
    super("WebGL is not available");
    this.name = "WebGLUnavailableError";
  }
}

interface GlobeOptions {
  /** Receives the canvas. Must be positioned and `overflow: hidden`. */
  stage: HTMLElement;
  /** Receives the label overlay (the component marks it `aria-hidden`). */
  labelsRoot: HTMLElement;
  places: readonly GlobePlace[];
  routes: readonly GlobeRoute[];
  /** The semantic-zoom hierarchy (shared with the street overlay): what is drawn at the current zoom. */
  lod: LodTree;
  coastlines: Polylines;
  borders: Polylines;
  initialView: GlobeInitialView | null;
  selectedSlug: string | null;
  reducedMotion: boolean;
  /** `GlobeProps.insetRight` at start. */
  insetRight: number;
  onSelect: GlobeProps["onSelect"];
  /** A group's square or label was clicked (the handover flies to frame it). */
  onSelectGroup(slug: string): void;
  /** The pointer is over a group (slug) or nothing (null); both overlays highlight it. */
  onHover?(slug: string | null): void;
  onViewChange: GlobeProps["onViewChange"];
  /** The GL context was lost (true) or restored (false). */
  onContextChange(lost: boolean): void;
  /** Initial zoom limit (see `GlobeRenderer.setZoomLimit`). */
  zoomLimit?: number;
  /** After every camera tick (drawn or not), once the labels and the view report are updated. The handover hangs off it. */
  onFrame?(): void;
  /** See `RendererOptions.pickOverride`. */
  pickOverride?: RendererOptions["pickOverride"];
  /** The line of the ring of type (see `RendererOptions.ringText`); absent = no ring. */
  ringText?: string;
  /** The lines of the caption that floats over the planet (see `RendererOptions.captionPhrases`). */
  captionPhrases?: GlobeCaption;
  /** See `GlobeProps.coverBottom` and `GlobeProps.showcase`: read at creation. */
  coverBottom?: number;
  coverBlocks?: readonly CoverBlock[];
  showcase?: boolean;
}

/** Read-only introspection for automated checks (exposed on `window` only with `?globe-debug`). */
export interface GlobeDebug {
  /**
   * The whole-globe fit (internal zoom): the 0 of the app's zoom and "the world view" of every older check (they start sweeps from it). With the
   * ring of type the camera can go below it: `floorZoom()`.
   */
  minZoom(): number;
  /** The same number as `minZoom()` (the fit), under the name that says what it is. */
  fitZoom(): number;
  /** The lowest zoom the camera can reach: the fit, or the ring's floor below it when the ring is on (debug pages have it off unless `?ring`). */
  floorZoom(): number;
  maxZoom(): number;
  /** Internal zoom (globe zoom levels), not the [0, 1] app zoom. */
  view(): { lon: number; lat: number; zoom: number };
  setView(view: { lon?: number; lat?: number; zoom?: number }): void;
  /** Viewport (client) coordinates of a place and whether it is on the visible hemisphere. */
  project(slug: string): { x: number; y: number; visible: boolean } | null;
  /** Like `project` for any lon/lat (a point of the map, not a place): the snapped cell centre in client px and whether it passes the whole-or-nothing rule. */
  projectAt(lon: number, lat: number): { x: number; y: number; visible: boolean };
  /** Where the globe model puts any lon/lat for the current view, client px, exact (not snapped to the art pixel, not capped at the globe's own maximum zoom: the street map's registration). */
  projectExact(lon: number, lat: number): { x: number; y: number };
  /** The surface point under a client-px point for the current view (the inverse of `projectExact`; on the limb when off the disc). */
  unprojectExact(x: number, y: number): { lon: number; lat: number; onDisc: boolean };
  labelsShown(): string[];
  /** The boxes as drawn in the last frame: per node, its rectangle in cells, its label's plate in CSS px, name, second line and state. */
  labelCells(): ReturnType<BoxScene["snapshot"]>;
  /** The label elements as they are in the DOM now (text, transform, opacity, mode, bounding box). */
  labelsDom(): ReturnType<BoxScene["labelsDom"]>;
  /** The node a click or hover at a container CSS-px point would pick (engine/hit-area.ts), or null. */
  pick(x: number, y: number, kind?: "mouse" | "touch"): string | null;
  /** Frames the box canvas drew / skipped (nothing changed), label element writes, full re-plans and labels placed in the gaps, since creation. */
  labelStats(): ReturnType<BoxScene["stats"]>;
  /** The theme's palette, level 0 (page colour) to the ink, as [r, g, b] 0..255. */
  ramp(): number[][];
  frames(): number;
  /** Size of one art pixel in CSS px (the globe's grid): a function of the viewport and the device pixel ratio only (`TUNING.pixelSize`); checks assert it never moves. */
  cell(): number;
  /** Camera ticks, drawn or suspended (idle must not increase it). */
  ticks(): number;
  isAnimating(): boolean;
  /** One synchronous frame (render + label update); returns the JS ms of the render call alone. */
  renderNow(): number;
  /** Run every timed transition (boxes, masks, labels, dims, borders) to its end and draw the resting frame: for checks that sample a camera instantly. */
  settle(): void;
  /**
   * The state of every timed thing for the CURRENT frame, for the at-rest checks: the borders' fade (0..1) and their target, whether any
   * transition is still running, and a frame is pending.
   */
  layers(): { borders: { value: number; on: boolean }; animating: boolean; framePending: boolean };
  /** The idle rotation: turning now (phase, current speed in deg/s), why not (null = allowed), whether its idle timer is armed, and the configured delay, speed and ease times. */
  spin(): ReturnType<GlobeRenderer["spinInfo"]> & { idleMs: number; degPerSec: number; easeInMs: number; stopMs: number; enabled: boolean };
  /** The sky: the earth rotation angle, its timed value (0..1), whether it is wanted and drawn, the farthest corner in earth radii; null when switched off (debug pages default to off, `?sky`). */
  sky(): ReturnType<GlobeRenderer["skyState"]>;
  /** The ring of type: whether it is drawn, its tone, glyphs, repeats, canvas size and the zoom numbers behind it; null when there is none (`?no-ring`, a debug page without `?ring`). */
  ring(): ReturnType<GlobeRenderer["ringState"]>;
  /** The caption (lines wrapped on the sphere): its face, lines (turn, visibility, extent), phase and the showcase's state; null without one (`?no-ring`, a debug page without `?showcase`). */
  caption(): ReturnType<GlobeRenderer["captionState"]>;
  /** Hold the caption's entrance at `ms` after its start (null releases it): captures and checks. */
  pinCaption(ms: number | null): void;
  /** Hold every caption line at `deg` degrees east of its place (null releases it): the limb close-ups. */
  pinCaptionAngle(deg: number | null): void;
  /** Hold the interlude's camera at this point of its flight, 0..1 (null releases it). */
  pinFlight(u: number | null): void;
  /** Lay the caption on a shell of this radius (1.001: on the surface, over the graticule's parallels; null: the tuned one): the alignment check. */
  captionRadius(r: number | null): void;
  /** The seed of the sides the caption's lines come in from, per entrance (null: all from the east): captures and checks. */
  captionSeed(seed: number | null): void;
  /** Begin the next swap of the caption's phrase sets now (the page's timer does it after a dwell): captures and checks. */
  captionSwap(): boolean;
  /** The real layout of the caption on the screen (the rows' top and bottom edges through the camera, the planet's centre and radius): the measurements. */
  captionProbe(): ReturnType<GlobeRenderer["captionProbe"]>;
  /** How the caption leaves when the showcase ends: "fade" (the page's) or "orbit" (kept for words that cycle; the measurements compare them). */
  captionExit(exit: "fade" | "orbit"): void;
  /** Where the caption's widest line is on the screen and the planet's radius there (checks: the words are locked to the globe, in a fade as at rest). */
  captionExtent(): ReturnType<GlobeRenderer["captionExtent"]>;
  /** The dimming behind the caption's words: "ellipse", "bands", "none" (null: the tuned `CAPTION.dim.mode`): the comparison captures. */
  captionDim(mode: "ellipse" | "bands" | "none" | null): void;
  /** The thickness's look: "page", "mix" or "edge" (null: the tuned one): the comparison captures. */
  captionSide(mode: "page" | "mix" | "edge" | null): void;
  /** The ring of type's highlight: "blue", "ink" or "none" (null: the tuned one). */
  ringHighlight(mode: "blue" | "ink" | "none" | null): void;
  /** One caption frame including the GPU's work on it, ms (measurements). */
  captionGpuMs(): number;
  /** Record (true) or take (false) the caption's drawn frames as [timestamp, delta, draw ms]. */
  traceCaption(on: boolean): [number, number, number][];
  /** Hold the caption on a rung of the quality ladder (null: the governor decides). */
  quality(level: number | null): void;
  /** The energy knobs (`ENERGY`): set for measurements. */
  energy(patch: Record<string, unknown>): void;
  /** Turn the showcase (the caption in, the boxes out) on or off as the app's hero would (checks and the perf scenarios). */
  showcase(on: boolean): void;
  /** Set the earth rotation angle in degrees (moves the sky against the earth) and draw. */
  setSkyEra(deg: number): void;
  gpuSync(): void;
  info(): ReturnType<GlobeRenderer["renderInfo"]>;
  loseContext(lose: boolean): void;
  /** Inset state: current / target inset (CSS px), centre shift (buffer px), and the lift (CSS px, buffer px) with the cover it answers. */
  inset(): ReturnType<GlobeRenderer["insetInfo"]>;
  /** The semantic zoom for the CURRENT camera: one entry per drawn node (alpha, tone level, size in CSS px, whether its centre is shown, and whether the cut wants it), in tree order. Allocates; for checks. */
  lod(): LodDebugNode[];
  /** Evaluations / cache hits / nodes visited by the last evaluation, and the nodes and squares drawn in the last frame. */
  lodStats(): { evaluations: number; cacheHits: number; visited: number; nodes: number; groups: number; drawnMarkers: number; drawnGroups: number };
  /** Ids of the routes drawn now (only the ones through the selected place). */
  routesShown(): string[];
  /** The paths layer: leg and vertex counts, segments per level, buffer bytes, the level and segments drawn, draw calls. */
  pathStats(): ReturnType<GlobeRenderer["pathStats"]>;
  /** Hierarchy in tree order: slug, kind, parent slug (or null), radius km. */
  tree(): { slug: string; kind: string; parent: string | null; radiusKm: number; lon: number; lat: number }[];
  /** Measurement: cost in ms of `n` forced semantic-zoom evaluations at the current camera (the pure O(visible) pass, no drawing). */
  benchLod(n: number): { msPerEval: number; visited: number; nodes: number };
}

export interface LodDebugNode {
  slug: string;
  kind: string;
  /** The node's own opacity now (0..1): 0 or 1 at rest, in between only while its timed transition runs. */
  alpha: number;
  /** The cut wants it drawn (else it is fading out). */
  wanted: boolean;
  /** Opacity of its interior mask now, node alpha included. */
  fillAlpha: number;
  level: number;
  /** A marker is drawn (it passed the whole-or-nothing rule) or a box touches the buffer, in the last frame. */
  shown: boolean;
  /** Container CSS px of the snapped cell centre (a place) or of the box (a group) in the last frame. */
  x: number;
  y: number;
  /** The node's rectangle, container CSS px, whole cells; for a group, the visible places it wraps and the places below it. */
  box: { x0: number; y0: number; x1: number; y1: number };
  members: number;
  total: number;
}

export interface GlobeHandle {
  /** The renderer, for the handover controller that sits next to this module (the app never touches it). */
  readonly renderer: GlobeRenderer;
  /** Pause or resume updating the label overlay (it is hidden while the street map's overlay is the visible one). */
  setLabelsActive(on: boolean): void;
  /** Highlight or clear the selected place. The camera is not moved: the handover controller flies it (handover/controller.ts). */
  setSelected(slug: string | null): void;
  /** The "Paths" layer on or off. */
  setPaths(on: boolean): void;
  setFocused(slug: string | null): void;
  /** Highlight (or clear) the group under the pointer. */
  setHovered(slug: string | null): void;
  setReducedMotion(on: boolean): void;
  /** `GlobeProps.insetRight` changed. */
  setInset(px: number): void;
  /** `GlobeProps.coverBottom` changed. */
  setCover(px: number, blocks?: readonly CoverBlock[]): void;
  /** `GlobeProps.showcase` changed. */
  setShowcase(on: boolean): void;
  debug(): GlobeDebug;
  /** Frees all GL resources, DOM nodes and listeners. */
  dispose(): void;
}

export function createGlobe(opts: GlobeOptions): GlobeHandle {
  if (!isWebGLAvailable()) throw new WebGLUnavailableError();

  const places = new Map(opts.places.map((p) => [p.slug, p]));
  const lod = opts.lod;
  const labels = new BoxScene(opts.labelsRoot, lod);
  labels.setReducedMotion(opts.reducedMotion);
  const theme0 = readTheme(opts.stage);
  labels.setTheme(theme0);

  let renderer: GlobeRenderer;
  let lastReported: GlobeViewState | null = null;
  let lastMask: string | null = null;

  let labelsActive = true;
  const syncOverlay = () => {
    const v = renderer.getView();
    // Labels dissolve with the canvas at the panel's edge.
    const mask = renderer.getContainerMask();
    if (mask !== lastMask) {
      lastMask = mask;
      opts.labelsRoot.style.maskImage = mask ?? "";
      opts.labelsRoot.style.setProperty("-webkit-mask-image", mask ?? "");
    }
    if (labelsActive) {
      labels.setDrifting(renderer.spinning);
      labels.update(renderer.nodeScreen, renderer.pixelGrid());
    }
    const next = toViewState(v, renderer.getFitZoom(), TUNING.maxZoom);
    if (!sameView(lastReported, next)) {
      lastReported = next;
      opts.onViewChange(next);
    }
    opts.onFrame?.();
  };

  const selectedAtStart = opts.selectedSlug ? places.get(opts.selectedSlug) : undefined;
  const framingAtStart = selectedAtStart && placeFraming(selectedAtStart);
  const iv = opts.initialView;
  const start: StartView | null = isFitView(iv)
    ? { lon: iv.lon, lat: iv.lat, zoom01: null, fitRadiusKm: iv.fitRadiusKm }
    : iv
      ? { lon: iv.lon, lat: iv.lat, zoom01: iv.zoom, street: iv.street }
      : framingAtStart
      ? { lon: framingAtStart.lon, lat: framingAtStart.lat, zoom01: null }
      : null;

  try {
    renderer = new GlobeRenderer(
      {
        container: opts.stage,
        places: opts.places,
        routes: opts.routes,
        lod,
        coastlines: opts.coastlines,
        borders: opts.borders,
        theme: theme0,
        reducedMotion: opts.reducedMotion,
        zoomLimit: opts.zoomLimit,
        insetRight: opts.insetRight,
        onFrame: syncOverlay,
        labelsAnimating: () => labelsActive && labels.animating,
        pickLabel: (x, y, kind) => labels.hit(x, y, kind),
        pickOverride: opts.pickOverride,
        ringText: opts.ringText,
        captionPhrases: opts.captionPhrases,
        coverBottom: opts.coverBottom,
        coverBlocks: opts.coverBlocks,
        showcase: opts.showcase,
        onSelect: opts.onSelect,
        onSelectGroup: opts.onSelectGroup,
        onHover: (slug) => {
          labels.setHovered(slug);
          opts.onHover?.(slug);
        },
        onContextChange: opts.onContextChange,
      },
      start,
    );
  } catch (e) {
    labels.dispose();
    throw e instanceof Error && /WebGL/i.test(e.message) ? new WebGLUnavailableError() : e;
  }

  renderer.setSelected(opts.selectedSlug, false);
  labels.setSelected(opts.selectedSlug);
  labels.setWake(() => renderer.requestRender()); // a plan run by the labels' timer on a map at rest started a glide

  // Colours come from CSS variables that switch with the OS colour scheme.
  const scheme = matchMedia("(prefers-color-scheme: dark)");
  const onScheme = () => {
    const t = readTheme(opts.stage);
    labels.setTheme(t);
    renderer.setTheme(t);
  };
  scheme.addEventListener("change", onScheme);
  let disposed = false;

  return {
    renderer,
    setLabelsActive(on) {
      labelsActive = on;
      if (on) renderer.requestRender();
      else labels.park();
    },
    setSelected(slug) {
      renderer.setSelected(slug, true);
      labels.setSelected(slug);
    },
    setPaths(on) {
      renderer.setPathsVisible(on);
    },
    setFocused(slug) {
      renderer.setFocused(slug);
      labels.setFocused(slug);
    },
    setHovered(slug) {
      renderer.setHovered(slug);
      labels.setHovered(slug);
    },
    setReducedMotion(on) {
      renderer.setReducedMotion(on);
      labels.setReducedMotion(on);
    },
    setInset: (px) => renderer.setInset(px),
    setCover: (px, blocks) => renderer.setCover(px, blocks),
    setShowcase: (on) => renderer.setShowcase(on),
    debug: () => ({
      minZoom: () => renderer.getFitZoom(),
      fitZoom: () => renderer.getFitZoom(),
      floorZoom: () => renderer.getMinZoom(),
      maxZoom: () => TUNING.maxZoom,
      view: () => renderer.getView(),
      ticks: () => renderer.tickCount(),
      setView: (v) => renderer.setView(v),
      projectAt(lon, lat) {
        const p = renderer.project(lon, lat);
        return { x: p.x, y: p.y, visible: p.visible };
      },
      project(slug) {
        const p = places.get(slug);
        if (!p) return null;
        const s = renderer.project(p.lon, p.lat);
        const r = opts.stage.getBoundingClientRect();
        return { x: r.left + s.x, y: r.top + s.y, visible: s.visible };
      },
      projectExact(lon, lat) {
        const p = renderer.projectExact(lon, lat);
        const r = opts.stage.getBoundingClientRect();
        return { x: r.left + p.x, y: r.top + p.y };
      },
      unprojectExact(x, y) {
        const r = opts.stage.getBoundingClientRect();
        return renderer.unprojectExact(x - r.left, y - r.top);
      },
      labelsShown: () => [...labels.shown()],
      labelCells: () => labels.snapshot(),
      labelsDom: () => labels.labelsDom(),
      pick: (x, y, kind = "mouse") => labels.hit(x, y, kind),
      labelStats: () => labels.stats(),
      ramp: () => renderer.getTheme().ramp.map((c) => c.map((v) => Math.round(v * 255))),
      frames: () => renderer.frameCount(),
      cell: () => renderer.pixelGrid().cell,
      isAnimating: () => renderer.isAnimating(),
      renderNow() {
        renderer.renderNow();
        return renderer.lastRenderJsMs();
      },
      settle() {
        lod.settle();
        renderer.settleBorders();
        renderer.renderNow();
        lod.settle();
        renderer.settleBorders(); // a state the first frame just decided (the sky's switch) runs to its end too
        renderer.renderNow();
        if (labelsActive) labels.settle(); // and the labels are planned for this camera and at their places, as after the camera has been still for good
      },
      layers: () => ({ ...renderer.layerState(), animating: lod.animating || renderer.layerState().animating, framePending: renderer.isAnimating() }),
      spin: () => ({ ...renderer.spinInfo(), idleMs: SPIN.idleMs, degPerSec: SPIN.degPerSec, easeInMs: SPIN.easeInMs, stopMs: SPIN.stopMs, enabled: SPIN.enabled }),
      sky: () => renderer.skyState(),
      ring: () => renderer.ringState(),
      caption: () => renderer.captionState(),
      showcase: (on) => renderer.setShowcase(on),
      pinCaption: (ms) => renderer.pinCaption(ms),
      pinCaptionAngle: (deg) => renderer.pinCaptionAngle(deg),
      pinFlight: (u) => renderer.pinFlight(u),
      captionRadius: (r) => renderer.setCaptionRadius(r),
      captionSeed: (seed) => renderer.setCaptionSeed(seed),
      captionSwap: () => renderer.swapCaption(),
      captionProbe: () => renderer.captionProbe(),
      captionExit: (exit) => renderer.setCaptionExit(exit),
      captionDim: (mode) => renderer.setCaptionDim(mode),
      captionSide: (mode) => renderer.setCaptionSide(mode),
      ringHighlight: (mode) => renderer.setRingHighlight(mode),
      energy: (patch) => renderer.setEnergy(patch as never),
      captionGpuMs: () => renderer.captionGpuMs(),
      traceCaption: (on) => renderer.traceCaption(on),
      quality: (level) => renderer.holdLoadRung(level),
      captionExtent: () => renderer.captionExtent(),
      setSkyEra: (deg) => renderer.setSkyEra(deg),
      gpuSync: () => renderer.gpuSync(),
      info: () => renderer.renderInfo(),
      loseContext: (lose) => renderer.loseContext(lose),
      inset: () => renderer.insetInfo(),
      lod() {
        const t = renderer.lodFrame();
        const sc = renderer.nodeScreen;
        const out: LodDebugNode[] = [];
        for (let k = 0; k < t.count; k++) {
          const i = t.visible[k]!;
          out.push({
            slug: t.slug[i]!,
            kind: t.kind[i]!,
            alpha: t.alpha[i]!,
            wanted: t.life.target[i] === 1,
            fillAlpha: t.fillAlpha[i]!,
            level: t.level[i]!,
            shown: !!sc.shown[i],
            x: sc.x[i]!,
            y: sc.y[i]!,
            box: { x0: sc.bx0[i]!, y0: sc.by0[i]!, x1: sc.bx1[i]!, y1: sc.by1[i]! },
            members: t.members[i]!,
            total: t.total[i]!,
          });
        }
        return out;
      },
      lodStats() {
        const d = renderer.drawnCounts();
        return {
          evaluations: lod.evaluations,
          cacheHits: lod.cacheHits,
          visited: lod.visited,
          nodes: lod.size,
          groups: lod.groupCount,
          drawnMarkers: d.markers,
          drawnGroups: d.groups,
        };
      },
      routesShown: () => renderer.routesShown(),
      pathStats: () => renderer.pathStats(),
      tree: () => Array.from({ length: lod.size }, (_, i) => ({ slug: lod.slug[i]!, kind: lod.kind[i]!, parent: lod.parent[i]! >= 0 ? lod.slug[lod.parent[i]!]! : null, radiusKm: lod.radiusKm[i]!, lon: lod.lon[i]!, lat: lod.lat[i]! })),
      benchLod(n) {
        const cam = renderer.lodCameraNow();
        const t0 = performance.now();
        for (let k = 0; k < n; k++) {
          cam.zoom += (k & 1 ? -1 : 1) * 1e-9; // defeat the cache: every call is a real evaluation
          lod.update(cam, -1, -1, false);
        }
        const dt = performance.now() - t0;
        return { msPerEval: dt / n, visited: lod.visited, nodes: lod.size };
      },
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      scheme.removeEventListener("change", onScheme);
      renderer.dispose();
      labels.dispose();
    },
  };
}
