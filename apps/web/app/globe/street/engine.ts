/**
 * The street map engine: MapLibre (globe -> Web Mercator) drawing plain channels, the pixel-pass compositor on a
 * separate overlay context, an HTML overlay of markers and labels, the tile source manager. (The credits are the host's
 * info button, components/attribution-button.tsx.)
 * Imperative and framework-free; `street-map-canvas.tsx` is the React lifecycle around it. This module (and
 * everything it imports) is the lazy street chunk: it never loads on the server or with the globe.
 *
 * Lifecycle (docs/street-architecture.md has the long version):
 *  1. create: DOM, tile-less style (world lines draw at once), compositor, HUD, listeners; start the source manager;
 *  2. the manager probes the primary (TileJSON); on success the style gets the tile source; every later transition
 *     (fallback, capped, recovery) swaps the style under a held overlay frame;
 *  3. frames are on demand: the overlay redraws on the map's `render` event or while a reveal / dissolve animates;
 *  4. dispose: unregister protocols, observers, timers; remove the map (frees its context), dispose the compositor
 *     (frees the overlay context), remove all DOM. Safe to call twice.
 */
import { Map as MLMap, setWorkerUrl, type StyleSpecification } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { readTheme, type GlobeTheme } from "../engine/colors";
import { applyDebugLevels } from "../engine/palette";
import { watchDevicePixelRatio } from "../engine/dpr";
import { INSET_EASE } from "../engine/tuning";
import { LodTree, buildLodNodes, newLodCamera, setLodCamera } from "../engine/lod-tree";
import { registerMapToGlobe } from "./core/registration";
import { perfEnd, perfStart } from "../engine/perf";
import { clampInset, fadeMask, insetShiftBuf } from "../engine/inset";
import { INK_THRESHOLD, SOLID_FROM } from "./core/art-line";
import { cellCssFor, cellDevicePx, EasedValue, revealRadiusDevice } from "./core/pixel";
import { isPmtilesUrl, type SourceDescriptor } from "./core/source-descriptor";
import { TileSourceManager, type SourceId, type TileStatus } from "./core/tile-source-manager";
import { routeFeatures } from "./core/routes";
import { isRouteStop, routesForPlace } from "../engine/geometry";
import { Compositor, type OutputSize } from "./gl/compositor";
import type { WarpCamera } from "./core/warp";
import { buildPalette } from "./core/palette";
import { snapCenter } from "./core/snap";
import type { PassParams } from "./gl/pixel-pass";
import { createTileNetwork } from "./net/tile-protocols";
import { probeSource, type ProbeConfig, type ProbeOutcome } from "./net/probe";
import { HudLayer } from "./overlay/hud-layer";
import { DEFAULT_HANDOFF, PLACEHOLDER_LAYERS, WORLD_PLACEHOLDER_BELOW, applyCell, buildStreetStyle, graticule, hasPlaceholder, type StyleTiles } from "./style/street-style";
import { STREET_TUNING } from "./tuning";
import type { AnimateOptions, FlyOptions, RevealOptions, StreetDebug, StreetMap, StreetMapOptions, StreetView } from "./types";

export class StreetUnavailableError extends Error {
  constructor(message = "WebGL2 is not available") {
    super(message);
    // Same name as the globe's error, so one check in the React wrapper covers both.
    this.name = "WebGLUnavailableError";
  }
}

let webgl2: boolean | undefined;
/** Whether a WebGL2 context can be created at all (probed once per page, released at once). */
function isWebGL2Available(): boolean {
  if (webgl2 !== undefined) return webgl2;
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    webgl2 = gl !== null;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webgl2 = false;
  }
  return webgl2;
}

let instances = 0;
let workerReady = false;

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const lineFc = (polylines: readonly (readonly (readonly [number, number])[])[]): GeoJSON.FeatureCollection => ({
  type: "FeatureCollection",
  features: [{ type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: polylines.map((l) => l.map((p) => [p[0], p[1]])) } }],
});

/** `cubic-bezier(x1, y1, x2, y2)` easing, solved with Newton / bisection (the app's standard curve for the inset). */
function bezier([x1, y1, x2, y2]: readonly [number, number, number, number]): (t: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0, hi = 1, t = x;
    for (let i = 0; i < 24; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}
const insetEase = bezier(INSET_EASE);

/** Map zoom change (levels) below which a pan counts as steady: the scale error stays under a fifth of a cell at the screen edge. */
const STEADY_ZOOM = 3e-4;

export function createStreetMap(container: HTMLElement, opts: StreetMapOptions): StreetMap {
  if (!isWebGL2Available()) throw new StreetUnavailableError();
  applyDebugLevels();
  const tAll = perfStart();
  const instance = ++instances;
  if (!workerReady) {
    setWorkerUrl(workerUrl);
    workerReady = true;
  }

  // ---- DOM -----------------------------------------------------------------------------------------------------
  const root = document.createElement("div");
  root.dataset.streetRoot = "";
  Object.assign(root.style, {
    position: "absolute",
    inset: "0",
    overflow: "hidden",
    background: opts.embedded ? "transparent" : "var(--background)",
    pointerEvents: opts.embedded ? "none" : "",
  } satisfies Partial<CSSStyleDeclaration>);
  const mapEl = document.createElement("div");
  mapEl.setAttribute("aria-hidden", "true");
  Object.assign(mapEl.style, { position: "absolute", left: "0", top: "0" } satisfies Partial<CSSStyleDeclaration>);
  const hudRoot = document.createElement("div");
  hudRoot.dataset.streetOverlay = "";
  hudRoot.setAttribute("aria-hidden", "true");
  root.append(mapEl);
  container.append(root);

  // ---- state ---------------------------------------------------------------------------------------------------
  let disposed = false;
  let reduced = opts.reducedMotion;
  let theme: GlobeTheme = readTheme(root);
  let inset = 0;
  let mapLost = false;
  let renders = 0;
  let heldZoom: number | null = null;
  /** false: the host shows something else; the map renders (tiles load) but no overlay work and no pass happen. */
  let active = true;
  let selected = opts.selectedSlug;
  let focused = opts.focusedSlug;
  const places = new Map(opts.places.map((p) => [p.slug, p]));
  const primaryIsPmtiles = isPmtilesUrl(opts.tiles.primaryUrl);
  const hasFallback = opts.tiles.fallbackPmtilesUrl !== null;
  const dprNow = () => window.devicePixelRatio || 1;
  const cellNow = () => cellCssFor(root.clientWidth, root.clientHeight, dprNow());
  let cellCss = cellNow();
  /**
   * Native art-resolution mode (default): MapLibre renders ONE PIXEL PER ART CELL (pixelRatio = 1 / cell) and the pass runs
   * on that grid; the overlay canvas is `cols x rows` and the browser scales it up with nearest-neighbour. `highResolution`
   * keeps the device-resolution render the sharp reveal and the sharp dissolve need.
   */
  const native = !opts.highResolution;
  /**
   * The art grid: `cols x rows` cells covering the root (a partial cell at the right/bottom edge is clipped by the root).
   * MapLibre reads an INTEGER container size, so the map box is `cssW x cssH` css px (the grid rounded up to whole css px)
   * and its pixel ratio is `cols / cssW`: one canvas pixel per cell, an exact 1:1 between the map, the pass and the screen.
   * The box is a little larger than the root; padding `gridPadR` / `gridPadB` keeps the projection centre on the root's centre.
   */
  interface Grid { cols: number; rows: number; cssW: number; cssH: number; cell: number; pr: number }
  /** Map pixels per art cell per axis (native mode). 2 keeps short dashes alive; 1 is the cheapest. */
  const clampScale = (n: number) => (native ? Math.max(1, Math.min(3, Math.round(n))) : 1);
  let scale = clampScale(opts.renderScale ?? STREET_TUNING.renderScale);
  const gridNow = (): Grid => {
    const w = Math.max(1, root.clientWidth);
    const h = Math.max(1, root.clientHeight);
    if (!native) return { cols: w, rows: h, cssW: w, cssH: h, cell: 1, pr: Math.min(dprNow(), 2) };
    const cell = cellNow();
    const cols = Math.max(1, Math.ceil(w / cell - 1e-6));
    const rows = Math.max(1, Math.ceil(h / cell - 1e-6));
    const cssW = Math.max(w, Math.ceil(cols * cell - 1e-6));
    const cssH = Math.max(h, Math.ceil(rows * cell - 1e-6));
    return { cols, rows, cssW, cssH, cell, pr: (scale * cols + 1e-6) / cssW };
  };
  let artGrid = gridNow();
  let gridPadR = native ? artGrid.cssW - root.clientWidth : 0;
  let gridPadB = native ? artGrid.cssH - root.clientHeight : 0;
  /** CSS px of one art cell as the MAP sees it (style widths are authored against it). */
  const mapCell = () => (native ? artGrid.cssW / artGrid.cols : cellCss);

  let world: { coastlines: GeoJSON.FeatureCollection; borders: GeoJSON.FeatureCollection } = opts.world ?? { coastlines: EMPTY_FC, borders: EMPTY_FC };
  const grid = graticule(15, 3);
  // Curated routes are drawn only while the selected place is one of their stops (engine/geometry.ts `routesForPlace`).
  const routesOf = (slug: string | null) => routeFeatures(routesForPlace(opts.routes, slug ? opts.places.find((p) => p.slug === slug) : undefined));
  let routes = routesOf(opts.selectedSlug);
  // The stops of the shown routes are drawn at any zoom (the route would otherwise run between missing markers).
  let lodRef: LodTree;
  const syncRouteStops = (slug: string | null) =>
    lodRef.setExtraForced(
      routesForPlace(opts.routes, slug ? opts.places.find((p) => p.slug === slug) : undefined).flatMap((r) => opts.places.filter((p) => isRouteStop(r, p)).map((p) => lodRef.indexOf(p.slug))),
    );
  const descriptors: Partial<Record<SourceId, SourceDescriptor>> = {};

  // ---- tile network + source manager ----------------------------------------------------------------------------
  const requestTimeoutMs = opts.requestTimeoutMs ?? opts.thresholds?.requestTimeoutMs ?? 10_000;
  const probeTimeoutMs = opts.probeTimeoutMs ?? 3000;
  const probeConfig = (role: SourceId): ProbeConfig | null => {
    if (role === "primary") return { role, kind: primaryIsPmtiles ? "pmtiles" : "tilejson", url: opts.tiles.primaryUrl, maxZoomCap: null, timeoutMs: probeTimeoutMs };
    const url = opts.tiles.fallbackPmtilesUrl;
    return url ? { role, kind: "pmtiles", url, maxZoomCap: opts.tiles.maxFallbackZoom, timeoutMs: probeTimeoutMs } : null;
  };
  const manager: TileSourceManager = new TileSourceManager({
    hasFallback,
    cappedMaxZoom: STREET_TUNING.cappedMaxZoom,
    fullMaxZoom: opts.maxZoom ?? STREET_TUNING.maxZoom,
    force: opts.forceSource ?? null,
    timings: opts.timings,
    thresholds: { ...opts.thresholds, requestTimeoutMs },
    io: {
      now: () => performance.now(),
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (h) => window.clearTimeout(h as number),
      probe: async (role) => {
        const cfg = probeConfig(role);
        if (!cfg) return { ok: false, ms: 0, reason: "invalid" as const };
        const r: ProbeOutcome = await probeSource(cfg);
        if (r.ok && r.descriptor) descriptors[role] = r.descriptor;
        return { ok: r.ok, ms: r.ms, reason: r.reason };
      },
    },
    onStatus: (status, previous) => applyStatus(status, previous),
  });
  const net = createTileNetwork({ instance, manager, requestTimeoutMs });

  const styleTiles = (d: SourceDescriptor | undefined): StyleTiles | null =>
    d ? { tiles: net.styleTiles(d), minzoom: d.minzoom, maxzoom: d.maxzoom, bounds: d.bounds } : null;
  /** The active style keeps the world lines as a hidden placeholder (street/style/street-style.ts WORLD_PLACEHOLDER_BELOW). */
  let placeholderStyle = false;
  let placeholderOn = false;
  const buildStyle = (d: SourceDescriptor | undefined): StyleSpecification => {
    const schema = d?.schema ?? "openmaptiles";
    placeholderStyle = hasPlaceholder(DEFAULT_HANDOFF[schema], d !== undefined);
    placeholderOn = false;
    return buildStreetStyle({
      schema: d?.schema ?? "openmaptiles",
      tiles: styleTiles(d),
      coastlines: world.coastlines,
      borders: world.borders,
      graticule: grid,
      routes,
      projection: opts.projection ?? "globe",
      cellCss: mapCell(),
    });
  };

  // ---- map -----------------------------------------------------------------------------------------------------
  const sizeMapBox = () => {
    mapEl.style.width = `${artGrid.cssW}px`;
    mapEl.style.height = `${artGrid.cssH}px`;
  };
  sizeMapBox();
  perfEnd("street.create.setup", tAll);
  const tMap = perfStart();
  const map = new MLMap({
    container: mapEl,
    style: buildStyle(undefined),
    center: [opts.view.lon, opts.view.lat],
    zoom: opts.view.zoom,
    pixelRatio: artGrid.pr,
    minZoom: opts.minZoom ?? STREET_TUNING.minZoom,
    maxZoom: opts.maxZoom ?? STREET_TUNING.maxZoom,
    attributionControl: false,
    renderWorldCopies: false,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    keyboard: false,
    fadeDuration: 0,
    canvasContextAttributes: { antialias: false, preserveDrawingBuffer: false },
  });
  perfEnd("street.create.maplibre", tMap);
  map.touchZoomRotate.disableRotation();
  // MapLibre's stylesheet is not used, so what it would give the canvas container is set here.
  const canvasBox = map.getCanvasContainer();
  Object.assign(canvasBox.style, { position: "absolute", inset: "0", touchAction: "none", cursor: "grab" } satisfies Partial<CSSStyleDeclaration>);
  const mapCanvas = map.getCanvas();
  Object.assign(mapCanvas.style, { position: "absolute", left: "0", top: "0" } satisfies Partial<CSSStyleDeclaration>);
  // The canvas is decoration: no tab stop, no accessible name (the places list is the accessible path).
  mapCanvas.tabIndex = -1;
  mapCanvas.removeAttribute("aria-label");
  mapCanvas.removeAttribute("role");
  // Kept from creation: `getExtension` returns null once the context is lost (test hook).
  const mapLoseExt = (mapCanvas.getContext("webgl2") as WebGL2RenderingContext | null)?.getExtension("WEBGL_lose_context") ?? null;

  // ---- compositor capabilities -------------------------------------------------------------------------------------
  const revealV = new EasedValue(STREET_TUNING.revealMs, reduced);
  const sharpV = new EasedValue(STREET_TUNING.dissolveMs, reduced, opts.initialSharp ?? 0);
  const blendV = new EasedValue(STREET_TUNING.dissolveMs, reduced, opts.initialBlend ?? 1);
  let revealCenter: "selected" | { lon: number; lat: number } = "selected";
  let reportedLost = false;
  const waiters: { value: EasedValue; resolve(): void }[] = [];

  const compositorOptions = { native, scale };
  const tComp = perfStart();
  const compositor = new Compositor(
    map,
    root,
    {
      size(): OutputSize {
        if (native) return { w: artGrid.cols, h: artGrid.rows, cssW: artGrid.cssW, cssH: artGrid.cssH };
        const dpr = dprNow();
        const w = Math.max(1, Math.round(root.clientWidth * dpr));
        const h = Math.max(1, Math.round(root.clientHeight * dpr));
        return { w, h, cssW: w / dpr, cssH: h / dpr };
      },
      camera: (): WarpCamera => {
        // The projection centre moves with the padding (the host's inset, the grid's overhang): the same maths as MapLibre's edge insets.
        const c = map.getCenter();
        const pd = map.getPadding();
        return {
          lon: c.lng,
          lat: c.lat,
          zoom: map.getZoom(),
          cx: (artGrid.cssW + (pd.left ?? 0) - (pd.right ?? 0)) / 2,
          cy: (artGrid.cssH + (pd.top ?? 0) - (pd.bottom ?? 0)) / 2,
          cell: mapCell(),
        };
      },
      params(outW: number, outH: number): PassParams {
        const dpr = native ? 1 : dprNow();
        const palette = buildPalette(theme);
        let focus = { x: 0, y: 0, radius: 0, feather: 1 };
        if (!native && revealV.value > 0) {
          const c = revealCenter === "selected" ? (selected ? places.get(selected) : undefined) : revealCenter;
          if (c) {
            const p = map.project([c.lon, c.lat]);
            const r = revealRadiusDevice(outW, outH, dpr) * revealV.eased;
            focus = { x: p.x * dpr, y: p.y * dpr, radius: r, feather: Math.max(1, r * 0.4) };
          }
        }
        return {
          levels: palette.rgb,
          limbLevel: palette.limbLevel,
          cellOut: native ? 1 : cellDevicePx(cellCss, dpr),
          inkThreshold: INK_THRESHOLD,
          solidThreshold: SOLID_FROM,
          sharp: native ? 0 : sharpV.eased,
          focus,
          blend: blendV.eased,
          anchor: [0, 0],
        };
      },
      onContextChange: () => reportContext(),
    },
    compositorOptions,
  );
  perfEnd("street.create.compositor", tComp);
  compositor.canvas.setAttribute("aria-hidden", "true");
  compositor.setFade(!reduced && opts.tileFade !== false);
  root.append(hudRoot);

  const tHud = perfStart();
  // The semantic-zoom hierarchy: the globe's (shared with it, so the set drawn is the same on both sides of the handover)
  // when embedded, else one of our own (places only, unless `groups` are given).
  const lod = opts.lod ?? new LodTree(buildLodNodes(opts.places, opts.groups ?? []));
  lodRef = lod;
  syncRouteStops(selected);
  const lodCam = newLodCamera();
  const applyTones = (t: GlobeTheme) => lod.setTones(t.ramp.length);
  applyTones(theme);
  const hud = new HudLayer(hudRoot, lod, reduced, opts.embedded ? "globe" : "hud");
  hud.setTheme(theme);
  perfEnd("street.create.hud", tHud);
  const tRest = perfStart();
  hud.setCell(cellCss);
  hud.setSelected(selected);
  hud.setFocused(focused);

  const reportContext = () => {
    const lost = mapLost || compositor.isLost;
    if (lost !== reportedLost) {
      reportedLost = lost;
      opts.onContextChange?.(lost);
    }
  };

  // ---- animation loop for the capabilities (the only rAF this module owns) ---------------------------------------
  let raf = 0;
  let lastTs = 0;
  const animating = () => revealV.animating || sharpV.animating || blendV.animating;
  const settle = () => {
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (!waiters[i]!.value.animating) {
        waiters[i]!.resolve();
        waiters.splice(i, 1);
      }
    }
  };
  const tick = (ts: number) => {
    raf = 0;
    if (disposed) return;
    const dt = lastTs ? ts - lastTs : 16;
    lastTs = ts;
    revealV.step(dt);
    sharpV.step(dt);
    blendV.step(dt);
    if (!compositor.redraw()) map.triggerRepaint();
    settle();
    if (animating() && !document.hidden) raf = requestAnimationFrame(tick);
    else lastTs = 0;
  };
  const kick = () => {
    if (!raf && !document.hidden && !disposed) raf = requestAnimationFrame(tick);
  };
  const driven = (value: EasedValue, target: number, o: AnimateOptions | undefined): Promise<void> => {
    value.reducedMotion = reduced;
    const instant = o?.animate === false;
    value.set(target, instant ? 0 : o?.durationMs);
    if (!value.animating) {
      if (!compositor.redraw()) map.triggerRepaint();
      return Promise.resolve();
    }
    kick();
    return new Promise<void>((resolve) => waiters.push({ value, resolve }));
  };

  // ---- tile source transitions ---------------------------------------------------------------------------------
  let holdTimer = 0;
  const holdOverlay = () => {
    compositor.hold(true);
    window.clearTimeout(holdTimer);
    const release = () => {
      window.clearTimeout(holdTimer);
      map.off("idle", release);
      if (!disposed) compositor.hold(false);
    };
    map.once("idle", release);
    holdTimer = window.setTimeout(release, 2500);
  };

  let capTimer: (() => void) | null = null;
  const applyZoomCap = (max: number) => {
    if (capTimer) {
      map.off("moveend", capTimer);
      capTimer = null;
    }
    if (map.getZoom() <= max + 1e-6) {
      map.setMaxZoom(max);
      return;
    }
    // Deeper than the cap: ease back to it (a jump under reduced motion), then lock the maximum.
    capTimer = () => {
      capTimer = null;
      map.setMaxZoom(max);
    };
    map.once("moveend", capTimer);
    map.easeTo({ zoom: max, duration: reduced ? 0 : 900, essential: true });
  };

  function applyStatus(status: TileStatus, previous: TileStatus | null) {
    if (disposed) return;
    if (status.state !== "connecting") {
      const d = status.source ? descriptors[status.source] : undefined;
      // A swap blanks the tile layers for a few frames: keep the last overlay frame until the new tiles land.
      holdOverlay();
      map.setStyle(buildStyle(d), { diff: false });
      if (!opts.embedded) applyZoomCap(status.maxZoom);
    }
    if (previous?.state !== status.state || previous?.source !== status.source) canvasBox.dataset.tileState = status.state;
    opts.onTileStatus?.(status);
  }

  // ---- events ---------------------------------------------------------------------------------------------------
  const mapListeners: [string, (e: never) => void][] = [];
  const onMap = <K extends string>(type: K, fn: (e: never) => void) => {
    map.on(type as never, fn as never);
    mapListeners.push([type, fn]);
  };

  let lastView: StreetView | null = null;
  const viewNow = (): StreetView => {
    const c = map.getCenter();
    return { lon: c.lng, lat: c.lat, zoom: map.getZoom() };
  };
  /** Right padding that comes from the inset (the grid's own overhang excluded). */
  const pad = () => Math.max(0, (map.getPadding().right ?? 0) - gridPadR);
  const padObj = (insetPad: number) => ({ top: 0, bottom: gridPadB, left: 0, right: insetPad + gridPadR });
  const syncOverlay = () => {
    const t0 = perfStart();
    syncOverlayInner();
    perfEnd("street.overlay", t0);
  };
  const syncOverlayInner = () => {
    const w = root.clientWidth;
    const h = root.clientHeight;
    if (w <= 0 || h <= 0) return; // a container that is not laid out (a route change hid it): nothing to place, and a zero-size image throws
    const v = viewNow();
    // The declutter clusters read the unified camera (the globe's own zoom), registered from the map's, projected in the
    // container's own space with the projection centre the map uses; the free area is the box minus the inset the host passed.
    setLodCamera(lodCam, registerMapToGlobe(v), { width: w, height: h, centreX: (w - pad()) / 2 }, w - clampInset(inset, w), cellCss);
    hud.update(
      { width: w, height: h, cellCss, cam: lodCam },
      // Embedded in the handover the overlay only shows from regional scale, where the globe already shows every label.
      opts.embedded ? 0 : HudLayer.priorityFloor(v.zoom),
    );
    // The map dissolves into the page under the covered strip (same mask as the globe's).
    const mask = fadeMask(w, pad());
    if (mask !== lastMask) {
      lastMask = mask;
      for (const el of [compositor.canvas, hudRoot]) {
        el.style.maskImage = mask ?? "";
        el.style.setProperty("-webkit-mask-image", mask ?? "");
      }
    }
    if (!lastView || lastView.lon !== v.lon || lastView.lat !== v.lat || lastView.zoom !== v.zoom) {
      lastView = v;
      opts.onViewChange?.(v);
    }
  };
  let lastMask: string | null = null;

  /** The world lines stand in for tiles that are not there yet (and only then): the ease cross-fades them to the tile lines when those arrive. */
  const updatePlaceholder = () => {
    if (!placeholderStyle) return;
    const want = map.getZoom() < WORLD_PLACEHOLDER_BELOW && !map.areTilesLoaded();
    if (want === placeholderOn) return;
    placeholderOn = want;
    for (const id of PLACEHOLDER_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", want ? "visible" : "none");
  };
  onMap("render", () => {
    renders++;
    updatePlaceholder();
    if (active) syncOverlay();
  });
  /** A place opens its page; a group (its square or its label) is the host's to frame. */
  const selectNode = (slug: string) => {
    const i = lod.indexOf(slug);
    if (i >= 0 && lod.isGroup[i]) opts.onSelectGroup?.(slug);
    else opts.onSelect(slug);
  };
  onMap("click", (e: { point: { x: number; y: number }; originalEvent?: Event }) => {
    const touch = (e.originalEvent as PointerEvent | undefined)?.pointerType === "touch";
    const hit = hud.hit(e.point.x, e.point.y, touch ? "touch" : "mouse");
    if (hit) selectNode(hit);
  });
  onMap("mousemove", (e: { point: { x: number; y: number }; originalEvent?: MouseEvent }) => {
    if (e.originalEvent && e.originalEvent.buttons) return;
    canvasBox.style.cursor = hud.hit(e.point.x, e.point.y, "mouse") ? "pointer" : "grab";
  });
  let errorsSeen = 0;
  onMap("error", (e: { error?: Error; sourceId?: string; tile?: unknown }) => {
    const err = e.error;
    if (!err || err.name === "AbortError") return;
    // Tile failures are scored by the request layer; here only what the layer cannot see matters.
    if (e.tile !== undefined) return;
    if (e.sourceId === "tiles" && manager.status.source) {
      manager.reportStyleError(manager.status.source, err.message);
      return;
    }
    if (errorsSeen++ < 3) console.warn("[street] map error:", err.message);
  });
  onMap("webglcontextlost", () => {
    mapLost = true;
    reportContext();
  });
  onMap("webglcontextrestored", () => {
    mapLost = false;
    reportContext();
  });

  /** The root or the device pixel ratio changed: new cell, new grid, new map box and pixel ratio, widths re-applied. */
  const refreshGrid = () => {
    if (disposed) return;
    const c = cellNow();
    const g = gridNow();
    const changed = Math.abs(c - cellCss) > 1e-6 || g.cols !== artGrid.cols || g.rows !== artGrid.rows || g.cssW !== artGrid.cssW || g.cssH !== artGrid.cssH || Math.abs(g.pr - artGrid.pr) > 1e-9;
    if (!changed) return;
    const keepInsetPad = pad();
    cellCss = c;
    artGrid = g;
    gridPadR = native ? artGrid.cssW - root.clientWidth : 0;
    gridPadB = native ? artGrid.cssH - root.clientHeight : 0;
    sizeMapBox();
    map.setPixelRatio(artGrid.pr);
    map.resize();
    map.setPadding(padObj(keepInsetPad));
    applyCell(map, mapCell());
    hud.setCell(cellCss);
    map.triggerRepaint();
  };
  const ro = new ResizeObserver(() => {
    if (disposed) return;
    refreshGrid();
    // The inset's art-pixel rounding depends on the cell and its fraction on the width.
    if (inset > 0) setPadding(inset, false);
  });
  ro.observe(root);

  const stopDpr = watchDevicePixelRatio(refreshGrid);

  const scheme = matchMedia("(prefers-color-scheme: dark)");
  const onScheme = () => {
    theme = readTheme(root);
    applyTones(theme);
    hud.setTheme(theme);
    if (!compositor.repool()) map.triggerRepaint();
  };
  scheme.addEventListener("change", onScheme);

  let hiddenAt = 0;
  const onVisibility = () => {
    if (document.hidden) {
      hiddenAt = performance.now();
      cancelAnimationFrame(raf);
      raf = 0;
      lastTs = 0;
    } else {
      if (hiddenAt) manager.pausedFor(performance.now() - hiddenAt);
      hiddenAt = 0;
      map.triggerRepaint();
      if (animating()) kick();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  void document.fonts?.ready.then(() => {
    if (disposed) return;
    hud.remeasure();
    map.triggerRepaint();
  });

  // ---- world data (separate chunk, shared with the globe) ---------------------------------------------------------------
  if (!opts.world) {
    void (async () => {
      try {
        const geo = await import("@catalyst/geodata");
        const [coast, borders] = await Promise.all([geo.loadCoastlines(), geo.loadBorders()]);
        if (disposed) return;
        world = { coastlines: lineFc(geo.polylinesToMultiLineString(coast)), borders: lineFc(geo.polylinesToMultiLineString(borders)) };
        const set = (id: string, fc: GeoJSON.FeatureCollection) => (map.getSource(id) as { setData?(d: unknown): void } | undefined)?.setData?.(fc);
        set("coast", world.coastlines);
        set("borders", world.borders);
        map.triggerRepaint();
      } catch {
        // No world lines: the tiles still draw. Nothing to report.
      }
    })();
  }

  // ---- camera --------------------------------------------------------------------------------------------------------
  const flightMs = (to: StreetView): number => {
    if (reduced) return 0;
    const c = map.getCenter();
    const dist = Math.hypot(c.lng - to.lon, c.lat - to.lat);
    return Math.min(STREET_TUNING.flightMaxMs, Math.max(STREET_TUNING.flightMinMs, 1800 + dist * 90 + Math.abs(map.getZoom() - to.zoom) * 260));
  };
  const merge = (v: Partial<StreetView>): StreetView => ({ ...viewNow(), ...v });
  /** Padding that moves the projection centre left by half the inset, rounded to whole art pixels (the globe's rule). */
  const setPadding = (px: number, animate: boolean) => {
    const w = root.clientWidth;
    const target = 2 * insetShiftBuf(clampInset(px, w), cellCss) * cellCss;
    if (Math.abs(pad() - target) < 1e-6) return;
    if (!animate || reduced) {
      map.setPadding(padObj(target));
      return;
    }
    map.easeTo({ padding: padObj(target), duration: STREET_TUNING.insetMs, easing: insetEase, essential: true });
  };

  // The initial inset is read at creation (a direct load with the panel open starts centred).
  inset = clampInset(opts.insetRight, root.clientWidth || 1);
  map.setPadding(padObj(inset > 0 ? 2 * insetShiftBuf(inset, cellCss) * cellCss : 0));

  // ---- go ------------------------------------------------------------------------------------------------------------
  void (async () => {
    if (opts.forceSource) {
      // A pinned source needs its descriptor before the manager enters it.
      const role = opts.forceSource;
      const cfg = probeConfig(role);
      if (cfg) {
        const r = await probeSource(cfg);
        if (r.descriptor) descriptors[role] = r.descriptor;
      }
    }
    if (!disposed) manager.start();
  })();

  const map_: StreetMap = {
    overlay: hudRoot,
    canvas: compositor.canvas,
    jumpTo(v) {
      const t = merge(v);
      map.jumpTo({ center: [t.lon, t.lat], zoom: t.zoom });
    },
    flyTo(v, o?: FlyOptions) {
      const t = merge(v);
      const duration = o?.durationMs ?? flightMs(t);
      map.flyTo({ center: [t.lon, t.lat], zoom: t.zoom, duration: reduced ? 0 : duration, essential: true, curve: 1.5 });
    },
    setCamera(v, o) {
      if (o?.inset !== undefined) {
        inset = clampInset(o.inset, root.clientWidth || 1);
      }
      const right = 2 * insetShiftBuf(inset, cellCss) * cellCss;
      // Steady zoom: the centre moves by whole art cells (core/snap.ts), so the picture translates rigidly. The map zoom
      // follows the latitude a little (the unified zoom is constant), which would make the grid drift under the snap:
      // within STEADY_ZOOM the zoom of the last unsnapped frame is held. A real zoom change (and the frame it starts
      // on) cannot be snapped to a common translation: it is applied as is and the zoom is held again once it rests.
      let { lon, lat } = v;
      let zoom = v.zoom;
      const snapOk = !!o?.snap && opts.snapPan !== false && STREET_TUNING.snapPanFromZoom > 0 && v.zoom >= STREET_TUNING.snapPanFromZoom;
      if (snapOk && heldZoom !== null && Math.abs(v.zoom - heldZoom) < STEADY_ZOOM) {
        zoom = heldZoom;
        ({ lon, lat } = snapCenter(lon, lat, zoom, mapCell()));
      } else heldZoom = snapOk ? v.zoom : null;
      map.jumpTo({ center: [lon, lat], zoom, padding: padObj(right) });
      if (o?.sync) map.redraw();
    },
    hit: (x, y, kind) => hud.hit(x, y, kind),
    covers(lon, lat) {
      const st = manager.status;
      if (!st.source) return false;
      const b = descriptors[st.source]?.bounds;
      return !b || (lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3]);
    },
    setSelected(slug, o) {
      selected = slug;
      hud.setSelected(slug);
      routes = routesOf(slug);
      syncRouteStops(slug);
      (map.getSource("routes") as { setData?(d: unknown): void } | undefined)?.setData?.(routes);
      const place = slug ? places.get(slug) : undefined;
      if (place && o?.fly) map_.flyTo({ lon: place.lon, lat: place.lat, zoom: o.zoom ?? Math.max(map.getZoom(), 14.5) });
      else map.triggerRepaint();
    },
    setFocused(slug) {
      focused = slug;
      hud.setFocused(slug);
      map.triggerRepaint();
    },
    setHovered(slug) {
      hud.setHovered(slug);
    },
    setReducedMotion(on) {
      reduced = on;
      revealV.reducedMotion = on;
      sharpV.reducedMotion = on;
      blendV.reducedMotion = on;
      hud.setReducedMotion(on);
      compositor.setFade(!on && opts.tileFade !== false);
      if (on) {
        for (const v of [revealV, sharpV, blendV]) v.set(v.target);
        settle();
        if (!compositor.redraw()) map.triggerRepaint();
      }
    },
    setInset(px) {
      const was = inset;
      inset = clampInset(px, root.clientWidth || 1);
      // 0 <-> positive eases like the panel's slide; any other change (a viewport resize) applies at once.
      setPadding(inset, (was === 0) !== (inset === 0) && !opts.embedded);
    },
    getView: viewNow,
    setReveal(on, o?: RevealOptions) {
      if (native) return Promise.resolve(); // needs the device-resolution render (StreetMapOptions.highResolution)
      if (o?.center) revealCenter = o.center;
      return driven(revealV, on ? 1 : 0, o);
    },
    setSharp: (value, o) => (native ? Promise.resolve() : driven(sharpV, value, o)),
    setBlend: (value, o) => driven(blendV, value, o),
    setActive(on) {
      if (on === active) return;
      active = on;
      compositor.suspend(!on);
      if (on) map.triggerRepaint();
    },
    seedFrom: (canvas, g) => compositor.seed(canvas, g),
    crossfadeTo: (canvas, g) => compositor.crossfadeTo(canvas, g),
    getTileStatus: () => manager.status,
    getMaxZoom: () => manager.status.maxZoom,
    resize() {
      refreshGrid();
      map.resize();
    },
    setRenderScale(n) {
      const next = clampScale(n);
      if (next === scale) return;
      scale = next;
      compositorOptions.scale = next;
      refreshGrid();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(holdTimer);
      for (const w of waiters.splice(0)) w.resolve();
      manager.dispose();
      ro.disconnect();
      stopDpr();
      scheme.removeEventListener("change", onScheme);
      document.removeEventListener("visibilitychange", onVisibility);
      for (const [type, fn] of mapListeners) map.off(type as never, fn as never);
      hud.dispose();
      compositor.dispose();
      map.remove();
      // After the map: tile requests still queued in its workers must find their protocol until the map is gone.
      net.dispose();
      root.remove();
    },
    debug(): StreetDebug {
      return {
        renders: () => renders,
        passes: () => compositor.stats.passes,
        isAnimating: () => animating() || map.isMoving() || compositor.easing > 0,
        cellCss: () => cellCss,
        project(slug) {
          const at = hud.markerAt(slug);
          if (!at) return null;
          const r = root.getBoundingClientRect();
          return { x: r.left + at.x, y: r.top + at.y };
        },
        shown: () => hud.shown(),
        lod: () => hud.snapshot(),
        readCodes: () => compositor.readCodes(),
        readPresentedLevels: () => compositor.readPresentedLevels(),
        easing: () => compositor.easing,
        easeStats: () => ({ eases: compositor.stats.eases, warp: { ...compositor.stats.lastWarp }, meshMs: compositor.stats.lastMeshMs }),
        gpuSync: () => compositor.sync(),
        profile: (on) => compositor.profile(on),
        passTimings: () => compositor.timings(),
        lastPassMs: () => compositor.stats.lastPassMs,
        loseContext(which, lose) {
          if (which === "overlay") compositor.loseContext(lose);
          else {
            if (lose) mapLoseExt?.loseContext();
            else mapLoseExt?.restoreContext();
          }
        },
        contexts: () => ({
          mapLost,
          overlayLost: compositor.isLost,
          overlayLosses: compositor.stats.contextLosses,
          overlayRestores: compositor.stats.contextRestores,
        }),
        tile: () => manager.debug() as ReturnType<StreetDebug["tile"]>,
        map: () => map,
        renderNow() {
          map.redraw();
        },
      };
    },
  };
  perfEnd("street.create.rest", tRest);
  perfEnd("street.create.total", tAll);
  return map_;
}
