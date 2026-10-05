/**
 * The street map engine: MapLibre (globe -> Web Mercator) drawing plain channels, the pixel-pass compositor on a
 * separate overlay context, an HTML overlay of markers and labels, the tile source manager and the attribution.
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
import { watchDevicePixelRatio } from "../engine/dpr";
import { INSET_EASE } from "../engine/tuning";
import { clampInset, fadeMask, insetShiftBuf } from "../engine/inset";
import { attributionFor, attributionText } from "./core/attribution";
import { INK_THRESHOLD, SOLID_FROM } from "./core/art-line";
import { cellCssFor, cellDevicePx, EasedValue, revealRadiusDevice } from "./core/pixel";
import { isPmtilesUrl, type SourceDescriptor } from "./core/source-descriptor";
import { TileSourceManager, type SourceId, type TileStatus } from "./core/tile-source-manager";
import { routeFeatures } from "./core/routes";
import { Compositor } from "./gl/compositor";
import type { PassParams } from "./gl/pixel-pass";
import { createTileNetwork } from "./net/tile-protocols";
import { probeSource, type ProbeConfig, type ProbeOutcome } from "./net/probe";
import { HudLayer } from "./overlay/hud-layer";
import { applyCell, buildStreetStyle, graticule, type StyleTiles } from "./style/street-style";
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

export function createStreetMap(container: HTMLElement, opts: StreetMapOptions): StreetMap {
  if (!isWebGL2Available()) throw new StreetUnavailableError();
  const instance = ++instances;
  if (!workerReady) {
    setWorkerUrl(workerUrl);
    workerReady = true;
  }

  // ---- DOM -----------------------------------------------------------------------------------------------------
  const root = document.createElement("div");
  root.dataset.streetRoot = "";
  Object.assign(root.style, { position: "absolute", inset: "0", overflow: "hidden", background: "var(--background)" } satisfies Partial<CSSStyleDeclaration>);
  const mapEl = document.createElement("div");
  mapEl.setAttribute("aria-hidden", "true");
  Object.assign(mapEl.style, { position: "absolute", inset: "0" } satisfies Partial<CSSStyleDeclaration>);
  const hudRoot = document.createElement("div");
  hudRoot.dataset.streetOverlay = "";
  hudRoot.setAttribute("aria-hidden", "true");
  const attributionEl = document.createElement("div");
  attributionEl.dataset.streetAttribution = "";
  Object.assign(attributionEl.style, {
    position: "absolute",
    bottom: "6px",
    right: "8px",
    zIndex: "2",
    padding: "1px 4px",
    font: "10px/1.3 var(--font-mono, ui-monospace, Menlo, monospace)",
    color: "var(--muted-foreground, var(--foreground))",
    background: "color-mix(in srgb, var(--background) 80%, transparent)",
    pointerEvents: "auto",
  } satisfies Partial<CSSStyleDeclaration>);
  root.append(mapEl);
  container.append(root);

  // ---- state ---------------------------------------------------------------------------------------------------
  let disposed = false;
  let reduced = opts.reducedMotion;
  let theme: GlobeTheme = readTheme(root);
  let inset = 0;
  let mapLost = false;
  let renders = 0;
  let selected = opts.selectedSlug;
  let focused = opts.focusedSlug;
  const places = new Map(opts.places.map((p) => [p.slug, p]));
  const primaryIsPmtiles = isPmtilesUrl(opts.tiles.primaryUrl);
  const hasFallback = opts.tiles.fallbackPmtilesUrl !== null;
  const dprNow = () => window.devicePixelRatio || 1;
  const mapScale = () => Math.min(dprNow(), 2);
  const cellNow = () => cellCssFor(root.clientWidth, root.clientHeight, dprNow());
  let cellCss = cellNow();

  let world: { coastlines: GeoJSON.FeatureCollection; borders: GeoJSON.FeatureCollection } = opts.world ?? { coastlines: EMPTY_FC, borders: EMPTY_FC };
  const grid = graticule(15, 3);
  const routes = routeFeatures(opts.routes);
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
  const buildStyle = (d: SourceDescriptor | undefined): StyleSpecification =>
    buildStreetStyle({
      schema: d?.schema ?? "openmaptiles",
      tiles: styleTiles(d),
      coastlines: world.coastlines,
      borders: world.borders,
      graticule: grid,
      routes,
      projection: opts.projection ?? "globe",
      cellCss,
    });

  // ---- map -----------------------------------------------------------------------------------------------------
  const map = new MLMap({
    container: mapEl,
    style: buildStyle(undefined),
    center: [opts.view.lon, opts.view.lat],
    zoom: opts.view.zoom,
    pixelRatio: mapScale(),
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

  const compositor = new Compositor(map, root, {
    params(outW: number, outH: number, dpr: number): PassParams {
      const cell = cellCssFor(outW / dpr, outH / dpr, dpr);
      if (Math.abs(cell - cellCss) > 1e-6) {
        cellCss = cell;
        // Re-apply the art widths after the pass was told the cell (never from inside a map render).
        queueMicrotask(() => {
          if (disposed) return;
          applyCell(map, cellCss);
          hud.setCell(cellCss);
        });
      }
      let focus = { x: 0, y: 0, radius: 0, feather: 1 };
      if (revealV.value > 0) {
        const c = revealCenter === "selected" ? (selected ? places.get(selected) : undefined) : revealCenter;
        if (c) {
          const p = map.project([c.lon, c.lat]);
          const r = revealRadiusDevice(outW, outH, dpr) * revealV.eased;
          focus = { x: p.x * dpr, y: p.y * dpr, radius: r, feather: Math.max(1, r * 0.4) };
        }
      }
      return {
        bg: theme.background,
        fg: theme.ink,
        muted: theme.outline,
        cellOut: cellDevicePx(cell, dpr),
        inkThreshold: INK_THRESHOLD,
        solidThreshold: SOLID_FROM,
        sharp: sharpV.eased,
        focus,
        blend: blendV.eased,
        anchor: [0, 0],
      };
    },
    onContextChange: () => reportContext(),
  });
  compositor.canvas.setAttribute("aria-hidden", "true");
  root.append(hudRoot, attributionEl);

  const hud = new HudLayer(
    hudRoot,
    opts.places.map((p) => ({ slug: p.slug, name: p.name, lat: p.lat, lon: p.lon, labelPriority: p.labelPriority })),
    reduced,
  );
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

  // ---- attribution ---------------------------------------------------------------------------------------------
  let attributionKey = "";
  const renderAttribution = (status: TileStatus) => {
    const parts = attributionFor({ state: status.state, source: status.source, primaryUrl: opts.tiles.primaryUrl, primaryIsPmtiles });
    const key = parts.map((p) => p.text).join("|");
    if (key === attributionKey) return;
    attributionKey = key;
    attributionEl.replaceChildren();
    parts.forEach((p, i) => {
      if (i > 0) attributionEl.append(" · ");
      if (p.href) {
        const a = document.createElement("a");
        a.href = p.href;
        a.textContent = p.text;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.style.color = "inherit";
        attributionEl.append(a);
      } else attributionEl.append(p.text);
    });
    attributionEl.dataset.streetAttribution = parts.map((p) => p.text).join(" · ");
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
    renderAttribution(status);
    if (status.state !== "connecting") {
      const d = status.source ? descriptors[status.source] : undefined;
      // A swap blanks the tile layers for a few frames: keep the last overlay frame until the new tiles land.
      holdOverlay();
      map.setStyle(buildStyle(d), { diff: false });
      applyZoomCap(status.maxZoom);
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
  const pad = () => map.getPadding().right ?? 0;
  const syncOverlay = () => {
    const w = root.clientWidth;
    const h = root.clientHeight;
    const v = viewNow();
    hud.update(
      {
        view: v,
        width: w,
        height: h,
        centreX: (w - pad()) / 2,
        cellCss,
        project: (lon, lat) => map.project([lon, lat]),
      },
      HudLayer.priorityFloor(v.zoom),
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

  onMap("render", () => {
    renders++;
    syncOverlay();
  });
  onMap("click", (e: { point: { x: number; y: number }; originalEvent?: Event }) => {
    const touch = (e.originalEvent as PointerEvent | undefined)?.pointerType === "touch";
    const hit = hud.hit(e.point.x, e.point.y, touch ? "touch" : "mouse");
    if (hit) opts.onSelect(hit);
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

  const ro = new ResizeObserver(() => {
    if (disposed) return;
    const c = cellNow();
    if (Math.abs(c - cellCss) > 1e-6) {
      cellCss = c;
      applyCell(map, cellCss);
      hud.setCell(cellCss);
      map.triggerRepaint();
    }
    // The inset's art-pixel rounding depends on the cell and its fraction on the width.
    if (inset > 0) setPadding(inset, false);
  });
  ro.observe(root);

  const stopDpr = watchDevicePixelRatio(() => {
    if (disposed) return;
    map.setPixelRatio(mapScale());
    cellCss = cellNow();
    applyCell(map, cellCss);
    hud.setCell(cellCss);
    map.triggerRepaint();
  });

  const scheme = matchMedia("(prefers-color-scheme: dark)");
  const onScheme = () => {
    theme = readTheme(root);
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
      map.setPadding({ top: 0, bottom: 0, left: 0, right: target });
      return;
    }
    map.easeTo({ padding: { top: 0, bottom: 0, left: 0, right: target }, duration: STREET_TUNING.insetMs, easing: insetEase, essential: true });
  };

  // The initial inset is read at creation (a direct load with the panel open starts centred).
  inset = clampInset(opts.insetRight, root.clientWidth || 1);
  if (inset > 0) map.setPadding({ top: 0, bottom: 0, left: 0, right: 2 * insetShiftBuf(inset, cellCss) * cellCss });
  renderAttribution(manager.status);
  attributionEl.style.right = `${8 + Math.max(0, inset)}px`;

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
    setSelected(slug, o) {
      selected = slug;
      hud.setSelected(slug);
      const place = slug ? places.get(slug) : undefined;
      if (place && o?.fly) map_.flyTo({ lon: place.lon, lat: place.lat, zoom: o.zoom ?? Math.max(map.getZoom(), 14.5) });
      else map.triggerRepaint();
    },
    setFocused(slug) {
      focused = slug;
      hud.setFocused(slug);
      map.triggerRepaint();
    },
    setReducedMotion(on) {
      reduced = on;
      revealV.reducedMotion = on;
      sharpV.reducedMotion = on;
      blendV.reducedMotion = on;
      hud.setReducedMotion(on);
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
      setPadding(inset, (was === 0) !== (inset === 0));
      attributionEl.style.right = `${8 + inset}px`;
    },
    getView: viewNow,
    setReveal(on, o?: RevealOptions) {
      if (o?.center) revealCenter = o.center;
      return driven(revealV, on ? 1 : 0, o);
    },
    setSharp: (value, o) => driven(sharpV, value, o),
    setBlend: (value, o) => driven(blendV, value, o),
    getTileStatus: () => manager.status,
    getMaxZoom: () => manager.status.maxZoom,
    resize() {
      map.resize();
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
        isAnimating: () => animating() || map.isMoving(),
        cellCss: () => cellCss,
        project(slug) {
          const at = hud.markerAt(slug);
          if (!at) return null;
          const r = root.getBoundingClientRect();
          return { x: r.left + at.x, y: r.top + at.y };
        },
        shown: () => hud.shown(),
        readCodes: () => compositor.readCodes(),
        gpuSync: () => compositor.sync(),
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
        attribution: () => attributionText(attributionFor({ state: manager.status.state, source: manager.status.source, primaryUrl: opts.tiles.primaryUrl, primaryIsPmtiles })),
        map: () => map,
        renderNow() {
          map.redraw();
        },
      };
    },
  };
  return map_;
}
