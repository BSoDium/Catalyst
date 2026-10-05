/**
 * Wires the renderer, the label overlay and the app-level view state together. This is the only module the
 * React component talks to; it is imported dynamically so that `three` stays in its own client chunk.
 */
import type { Polylines } from "@catalyst/geodata";
import type { GlobePlace, GlobeProps, GlobeRoute, GlobeViewState } from "../types";
import { readTheme } from "./colors";
import { LabelLayer } from "./label-layer";
import { labelPriorityFloor } from "./labels";
import { GlobeRenderer, type StartView } from "./renderer";
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
  initialView: GlobeViewState | null;
  selectedSlug: string | null;
  reducedMotion: boolean;
  /** `GlobeProps.insetRight` at start. */
  insetRight: number;
  onSelect: GlobeProps["onSelect"];
  onViewChange: GlobeProps["onViewChange"];
  /** The GL context was lost (true) or restored (false). */
  onContextChange(lost: boolean): void;
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
}

export interface GlobeHandle {
  /** Highlight or clear the selected place; `fly` rotates the camera to it (a jump under reduced motion). */
  setSelected(slug: string | null, fly: boolean): void;
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

  const syncOverlay = () => {
    const v = renderer.getView();
    // Labels dissolve with the canvas at the panel's edge.
    const mask = renderer.getContainerMask();
    if (mask !== lastMask) {
      lastMask = mask;
      opts.labelsRoot.style.maskImage = mask ?? "";
      opts.labelsRoot.style.setProperty("-webkit-mask-image", mask ?? "");
    }
    labels.update(
      renderer,
      renderer.getVisibleSize(),
      labelPriorityFloor(v.zoom, renderer.getMinZoom(), TUNING.allLabelsZoom),
    );
    const next = toViewState(v, renderer.getMinZoom(), TUNING.maxZoom);
    if (!sameView(lastReported, next)) {
      lastReported = next;
      opts.onViewChange(next);
    }
  };

  const selectedAtStart = opts.selectedSlug ? places.get(opts.selectedSlug) : undefined;
  const start: StartView | null = opts.initialView
    ? { lon: opts.initialView.lon, lat: opts.initialView.lat, zoom01: opts.initialView.zoom }
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
        insetRight: opts.insetRight,
        onFrame: syncOverlay,
        pickLabel: (x, y, kind) => labels.hit(x, y, TUNING.labelSlop[kind]),
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
    setSelected(slug, fly) {
      renderer.setSelected(slug, true);
      labels.setSelected(slug);
      const place = slug ? places.get(slug) : undefined;
      if (place && fly) {
        renderer.flyTo({ lon: place.lon, lat: place.lat, zoom: Math.max(renderer.getView().zoom, TUNING.selectZoom) });
      }
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
