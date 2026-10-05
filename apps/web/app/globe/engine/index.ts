/**
 * Wires the renderer, the label overlay and the app-level view state together. This is the only module the
 * React component talks to; it is imported dynamically so that `three` stays in its own client chunk.
 */
import type { Polylines } from "@catalyst/geodata";
import { isFitView, type GlobeInitialView, type GlobePlace, type GlobeProps, type GlobeRoute, type GlobeViewState } from "../types";
import { readTheme } from "./colors";
import { LabelLayer } from "./label-layer";
import { labelPriorityFloor } from "./labels";
import { GlobeRenderer, type RendererOptions, type StartView } from "./renderer";
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
  coastlines: Polylines;
  borders: Polylines;
  initialView: GlobeInitialView | null;
  selectedSlug: string | null;
  reducedMotion: boolean;
  /** `GlobeProps.insetRight` at start. */
  insetRight: number;
  onSelect: GlobeProps["onSelect"];
  onViewChange: GlobeProps["onViewChange"];
  /** The GL context was lost (true) or restored (false). */
  onContextChange(lost: boolean): void;
  /** Initial zoom limit (see `GlobeRenderer.setZoomLimit`). */
  zoomLimit?: number;
  /** After every camera tick (drawn or not), once the labels and the view report are updated. The handover hangs off it. */
  onFrame?(): void;
  /** See `RendererOptions.pickOverride`. */
  pickOverride?: RendererOptions["pickOverride"];
}

/** Read-only introspection for automated checks (exposed on `window` only with `?globe-debug`). */
export interface GlobeDebug {
  minZoom(): number;
  maxZoom(): number;
  /** Internal zoom (globe zoom levels), not the [0, 1] app zoom. */
  view(): { lon: number; lat: number; zoom: number };
  setView(view: { lon?: number; lat?: number; zoom?: number }): void;
  /** Viewport (client) coordinates of a place and whether it is on the visible hemisphere. */
  project(slug: string): { x: number; y: number; visible: boolean } | null;
  labelsShown(): string[];
  frames(): number;
  /** Camera ticks, drawn or suspended (idle must not increase it). */
  ticks(): number;
  isAnimating(): boolean;
  /** One synchronous frame (render + label update); returns the JS ms of the render call alone. */
  renderNow(): number;
  gpuSync(): void;
  info(): ReturnType<GlobeRenderer["renderInfo"]>;
  loseContext(lose: boolean): void;
  /** Inset state: current / target inset (CSS px), centre shift and scissor width (buffer px; null = none). */
  inset(): ReturnType<GlobeRenderer["insetInfo"]>;
  /** Measurement only: turn the scissor on or off. */
  setScissor(on: boolean): void;
  /** Measurement only: draw marker ink in pure red and fill in pure blue, for pixel readouts. */
  setMarkerProbe(on: boolean): void;
}

export interface GlobeHandle {
  /** The renderer, for the handover controller that sits next to this module (the app never touches it). */
  readonly renderer: GlobeRenderer;
  /** Pause or resume updating the label overlay (it is hidden while the street map's overlay is the visible one). */
  setLabelsActive(on: boolean): void;
  /** Highlight or clear the selected place. The camera is not moved: the handover controller flies it (handover/controller.ts). */
  setSelected(slug: string | null): void;
  setFocused(slug: string | null): void;
  setReducedMotion(on: boolean): void;
  /** `GlobeProps.insetRight` changed. */
  setInset(px: number): void;
  debug(): GlobeDebug;
  /** Frees all GL resources, DOM nodes and listeners. */
  dispose(): void;
}

export function createGlobe(opts: GlobeOptions): GlobeHandle {
  if (!isWebGLAvailable()) throw new WebGLUnavailableError();

  const places = new Map(opts.places.map((p) => [p.slug, p]));
  const labels = new LabelLayer(
    opts.labelsRoot,
    opts.places.map((p) => ({ id: p.slug, text: p.name, lon: p.lon, lat: p.lat, priority: p.labelPriority })),
    opts.reducedMotion,
  );

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
      labels.update(
        renderer,
        renderer.getVisibleSize(),
        labelPriorityFloor(Math.min(v.zoom, TUNING.maxZoom), renderer.getMinZoom(), TUNING.allLabelsZoom),
      );
    }
    const next = toViewState(v, renderer.getMinZoom(), TUNING.maxZoom);
    if (!sameView(lastReported, next)) {
      lastReported = next;
      opts.onViewChange(next);
    }
    opts.onFrame?.();
  };

  const selectedAtStart = opts.selectedSlug ? places.get(opts.selectedSlug) : undefined;
  const iv = opts.initialView;
  const start: StartView | null = isFitView(iv)
    ? { lon: iv.lon, lat: iv.lat, zoom01: null, fitRadiusKm: iv.fitRadiusKm }
    : iv
      ? { lon: iv.lon, lat: iv.lat, zoom01: iv.zoom, street: iv.street }
      : selectedAtStart
      ? { lon: selectedAtStart.lon, lat: selectedAtStart.lat, zoom01: null }
      : null;

  try {
    renderer = new GlobeRenderer(
      {
        container: opts.stage,
        places: opts.places,
        routes: opts.routes,
        coastlines: opts.coastlines,
        borders: opts.borders,
        theme: readTheme(opts.stage),
        reducedMotion: opts.reducedMotion,
        zoomLimit: opts.zoomLimit,
        insetRight: opts.insetRight,
        onFrame: syncOverlay,
        pickLabel: (x, y, kind) => labels.hit(x, y, TUNING.labelSlop[kind]),
        pickOverride: opts.pickOverride,
        onSelect: opts.onSelect,
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

  // Colours come from CSS variables that switch with the OS colour scheme.
  const scheme = matchMedia("(prefers-color-scheme: dark)");
  const onScheme = () => renderer.setTheme(readTheme(opts.stage));
  scheme.addEventListener("change", onScheme);
  let disposed = false;
  void document.fonts?.ready.then(() => {
    if (disposed) return;
    labels.remeasure();
    renderer.requestRender();
  });

  return {
    renderer,
    setLabelsActive(on) {
      labelsActive = on;
      if (on) renderer.requestRender();
    },
    setSelected(slug) {
      renderer.setSelected(slug, true);
      labels.setSelected(slug);
    },
    setFocused(slug) {
      renderer.setFocused(slug);
      labels.setFocused(slug);
    },
    setReducedMotion(on) {
      renderer.setReducedMotion(on);
      labels.setReducedMotion(on);
    },
    setInset: (px) => renderer.setInset(px),
    debug: () => ({
      minZoom: () => renderer.getMinZoom(),
      maxZoom: () => TUNING.maxZoom,
      view: () => renderer.getView(),
      ticks: () => renderer.tickCount(),
      setView: (v) => renderer.setView(v),
      project(slug) {
        const p = places.get(slug);
        if (!p) return null;
        const s = renderer.project(p.lon, p.lat);
        const r = opts.stage.getBoundingClientRect();
        return { x: r.left + s.x, y: r.top + s.y, visible: s.visible };
      },
      labelsShown: () => [...labels.shown()],
      frames: () => renderer.frameCount(),
      isAnimating: () => renderer.isAnimating(),
      renderNow() {
        renderer.renderNow();
        return renderer.lastRenderJsMs();
      },
      gpuSync: () => renderer.gpuSync(),
      info: () => renderer.renderInfo(),
      loseContext: (lose) => renderer.loseContext(lose),
      inset: () => renderer.insetInfo(),
      setScissor: (on) => renderer.setScissorEnabled(on),
      setMarkerProbe: (on) => renderer.setMarkerProbe(on),
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
