/**
 * Wires the renderer, the label overlay and the app-level view state together. This is the only module the
 * React component talks to; it is imported dynamically so that `three` stays in its own client chunk.
 */
import type { Polylines } from "@catalyst/geodata";
import { isFitView, type GlobeInitialView, type GlobePlace, type GlobeProps, type GlobeRoute, type GlobeViewState } from "../types";
import { readTheme } from "./colors";
import { BoxScene } from "./box-scene";
import { placeFraming } from "./framing";
import type { LodTree } from "./lod-tree";
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
  /** Like `project` for any lon/lat (a point of the map, not a place): the snapped cell centre in client px and whether it passes the whole-or-nothing rule. */
  projectAt(lon: number, lat: number): { x: number; y: number; visible: boolean };
  labelsShown(): string[];
  /** The boxes as drawn in the last frame: per node, its rectangle and label in cells, text, chip and tones. */
  labelCells(): ReturnType<BoxScene["snapshot"]>;
  /** The node a click or hover at a container CSS-px point would pick (engine/hit-area.ts), or null. */
  pick(x: number, y: number, kind?: "mouse" | "touch"): string | null;
  /** Frames the label canvas drew / skipped (nothing changed) since creation. */
  labelStats(): { drawn: number; skipped: number };
  /** The theme's palette, level 0 (page colour) to the ink, as [r, g, b] 0..255. */
  ramp(): number[][];
  frames(): number;
  /** Camera ticks, drawn or suspended (idle must not increase it). */
  ticks(): number;
  isAnimating(): boolean;
  /** One synchronous frame (render + label update); returns the JS ms of the render call alone. */
  renderNow(): number;
  gpuSync(): void;
  info(): ReturnType<GlobeRenderer["renderInfo"]>;
  loseContext(lose: boolean): void;
  /** Inset state: current / target inset (CSS px), centre shift (buffer px). */
  inset(): ReturnType<GlobeRenderer["insetInfo"]>;
  /** The semantic zoom for the CURRENT camera: one entry per drawn node (alpha, tone level, size in CSS px, and whether its centre is shown), in tree order. Allocates; for checks. */
  lod(): LodDebugNode[];
  /** Evaluations / cache hits / nodes visited by the last evaluation, and the nodes and squares drawn in the last frame. */
  lodStats(): { evaluations: number; cacheHits: number; visited: number; nodes: number; groups: number; drawnMarkers: number; drawnGroups: number };
  /** Ids of the routes drawn now (only the ones through the selected place). */
  routesShown(): string[];
  /** Hierarchy in tree order: slug, kind, parent slug (or null), radius km. */
  tree(): { slug: string; kind: string; parent: string | null; radiusKm: number }[];
  /** Measurement: cost in ms of `n` forced semantic-zoom evaluations at the current camera (the pure O(visible) pass, no drawing). */
  benchLod(n: number): { msPerEval: number; visited: number; nodes: number };
}

export interface LodDebugNode {
  slug: string;
  kind: string;
  alpha: number;
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
  setFocused(slug: string | null): void;
  /** Highlight (or clear) the group under the pointer. */
  setHovered(slug: string | null): void;
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
  const lod = opts.lod;
  const labels = new BoxScene(opts.labelsRoot, lod);
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
      labels.update(renderer.nodeScreen, renderer.pixelGrid());
    }
    const next = toViewState(v, renderer.getMinZoom(), TUNING.maxZoom);
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
        pickLabel: (x, y, kind) => labels.hit(x, y, kind),
        pickOverride: opts.pickOverride,
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
    },
    setSelected(slug) {
      renderer.setSelected(slug, true);
      labels.setSelected(slug);
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
    },
    setInset: (px) => renderer.setInset(px),
    debug: () => ({
      minZoom: () => renderer.getMinZoom(),
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
      labelsShown: () => [...labels.shown()],
      labelCells: () => labels.snapshot(),
      pick: (x, y, kind = "mouse") => labels.hit(x, y, kind),
      labelStats: () => labels.stats(),
      ramp: () => renderer.getTheme().ramp.map((c) => c.map((v) => Math.round(v * 255))),
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
      tree: () => Array.from({ length: lod.size }, (_, i) => ({ slug: lod.slug[i]!, kind: lod.kind[i]!, parent: lod.parent[i]! >= 0 ? lod.slug[lod.parent[i]!]! : null, radiusKm: lod.radiusKm[i]! })),
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
