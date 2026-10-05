/**
 * The handover controller: one camera, two renderers. Owns the Three.js globe (engine/) and, once needed, the street
 * map (street/), and keeps them registered while one dissolves into the other. See maths.ts for the model and
 * docs/street-architecture.md ("Handover") for the long version.
 *
 *  - The globe renderer is the only owner of the camera, the input (drag, wheel, pinch, tap) and the flights. Its
 *    canvas stays the pointer target at every scale; the street map is non-interactive (`embedded`). So a gesture that
 *    crosses the threshold simply keeps going: nothing is handed over, only what is drawn changes.
 *  - After every camera tick (`onFrame`) the street map is told the registered camera (and the globe's animated inset),
 *    rendered synchronously, and given the dissolve value, so the two never differ by a frame.
 *  - The street chunk (MapLibre, PMTiles, the pass: ~450 KB gzip) is loaded only when the camera gets close or a
 *    place is selected; until it works the zoom limit is the globe's own maximum and nothing waits visibly.
 */
import type { Polylines } from "@catalyst/geodata";
import { createGlobe, type GlobeDebug, type GlobeHandle } from "../engine";
import { TUNING } from "../engine/tuning";
import { clamp } from "../engine/geo";
import type { StreetMap, StreetTileConfig, TileStatus } from "../street/types";
import type { GlobePlace, GlobeProps, GlobeRoute, GlobeViewState } from "../types";
import {
  GLOBE_MAX_ZOOM,
  HANDOVER,
  blendTarget,
  mountWanted,
  overlayOwner,
  slew,
  streetSelectZoom,
  toMapZoom,
  type OverlayOwner,
} from "./maths";

export type Notice = "street-unavailable";

export interface HandoverOptions {
  stage: HTMLElement;
  labelsRoot: HTMLElement;
  /** Receives the street map. Positioned, `inset: 0`, `pointer-events: none`, above `stage` and below `labelsRoot`. */
  streetRoot: HTMLElement;
  places: readonly GlobePlace[];
  routes: readonly GlobeRoute[];
  coastlines: Polylines;
  borders: Polylines;
  initialView: GlobeViewState | null;
  selectedSlug: string | null;
  focusedSlug: string | null;
  reducedMotion: boolean;
  insetRight: number;
  tiles: StreetTileConfig | null;
  onSelect: GlobeProps["onSelect"];
  onViewChange: GlobeProps["onViewChange"];
  /** A WebGL context of either renderer was lost (true) or all are back (false). */
  onContextChange(lost: boolean): void;
  /** The small HUD notice: street detail is not available (null = nothing to say). */
  onNotice(notice: Notice | null): void;
  /** Testing and tuning: street engine options (pinned source, timings ...). */
  streetOptions?: Record<string, unknown>;
}

export interface HandoverDebug {
  globe: GlobeDebug;
  street(): StreetMap | null;
  /** Dissolve value shown now (0 Three.js, 1 street) and its target. */
  blend(): { shown: number; target: number };
  owner(): OverlayOwner;
  /** Unified (internal) zoom. */
  zoom(): number;
  /** Street map zoom of the current camera, if the map exists. */
  mapZoom(): number | null;
  streetState(): "none" | "loading" | "ready" | "failed";
  tile(): TileStatus | null;
  limit(): number;
  suspended(): boolean;
  /** Distance in CSS px between where the two renderers put a place (unsnapped), or null when the street map is not following. */
  registrationError(lon: number, lat: number): number | null;
  /** Measurement: force the dissolve value (null = back to the zoom-driven one). */
  forceBlend(value: number | null): void;
  /** Camera ticks (idle must not increase it). */
  ticks(): number;
  revealOpen(): boolean;
  /** Measurement: fly the camera to a unified view as a place selection would (street scale allowed), without selecting anything. */
  fly(view: { lon: number; lat: number; zoom: number }): void;
}

export interface HandoverHandle {
  /** Highlight a place; `fly` also moves the camera to it (into street scale when the street map can show it). */
  setSelected(slug: string | null, fly: boolean): void;
  setFocused(slug: string | null): void;
  setReducedMotion(on: boolean): void;
  setInset(px: number): void;
  debug(): HandoverDebug;
  dispose(): void;
}

type StreetState = "none" | "loading" | "ready" | "failed";

export function createHandover(opts: HandoverOptions): HandoverHandle {
  const places = new Map(opts.places.map((p) => [p.slug, p]));
  const tiles = opts.tiles;
  let reduced = opts.reducedMotion;
  let selected = opts.selectedSlug;
  let focused = opts.focusedSlug;
  let disposed = false;

  // ---- state -------------------------------------------------------------------------------------------------------
  let street: StreetMap | null = null;
  let streetState: StreetState = "none";
  let streetToken = 0;
  let tile: TileStatus | null = null;
  let streetLost = false;
  let globeLost = false;
  let shown = 0;
  let owner: OverlayOwner = "globe";
  let forced: number | null = null;
  let lastFrameAt = 0;
  let lastPush: { lon: number; lat: number; zoom: number; inset: number } | null = null;
  let followTimer = 0;
  let unmountTimer = 0;
  let labelsOffTimer = 0;
  let revealTimer = 0;
  let revealOn = false;
  let lastBlend = -1;
  let notice: Notice | null = null;
  let restoring = !!tiles && (opts.initialView?.street ?? 0) > 0;
  let restoreTimer = 0;
  let retreating = false;
  /** A flight toward street scale is under way (or wanted): keeps the street map mounted. */
  let wantStreet = false;

  // ---- globe ---------------------------------------------------------------------------------------------------------
  // `onFrame` can fire before `createGlobe` returns; it waits for the assignments below.
  let globe!: GlobeHandle;
  let renderer!: GlobeHandle["renderer"];
  globe = createGlobe({
    stage: opts.stage,
    labelsRoot: opts.labelsRoot,
    places: opts.places,
    routes: opts.routes,
    coastlines: opts.coastlines,
    borders: opts.borders,
    initialView: opts.initialView,
    selectedSlug: opts.selectedSlug,
    reducedMotion: opts.reducedMotion,
    insetRight: opts.insetRight,
    zoomLimit: restoring ? Infinity : GLOBE_MAX_ZOOM,
    onSelect: opts.onSelect,
    onViewChange: opts.onViewChange,
    onContextChange: (lost) => {
      globeLost = lost;
      reportContext();
    },
    onFrame: () => onFrame(),
    pickOverride: (x, y, kind) => (owner === "street" && street ? street.hit(x, y, kind) : undefined),
  });
  renderer = globe.renderer;
  globe.setFocused(focused);
  if (restoring) renderer.setSuspended(true);

  // Both overlays fade with the dissolve (an opacity cross-fade of text cannot be a pixel dissolve; positions agree).
  const setFade = (el: HTMLElement) => {
    el.style.transition = reduced ? "none" : "opacity var(--duration-fast, 120ms) linear";
  };
  setFade(opts.labelsRoot);
  // The globe's labels paint above the street map (which comes later in the DOM) until its own overlay takes over.
  opts.labelsRoot.style.zIndex = "1";
  opts.streetRoot.style.opacity = "0";
  opts.streetRoot.inert = true;

  const reportContext = () => opts.onContextChange(globeLost || streetLost);

  // ---- helpers -----------------------------------------------------------------------------------------------------
  const tileOk = () => !!tile && (tile.state === "primary" || tile.state === "fallback");
  const streetOk = () => streetState === "ready" && tileOk() && !streetLost;
  /** The street map can never help: no tiles configured, the chunk or WebGL2 failed, or the sources are all down. */
  const streetDead = () => !tiles || streetState === "failed" || tile?.state === "capped";
  const view = () => renderer.getView();

  const updateNotice = () => {
    const v = view();
    const near = v.zoom >= GLOBE_MAX_ZOOM - 0.6 || !!selected;
    const next: Notice | null = !!tiles && (streetState === "failed" || tile?.state === "capped") && near ? "street-unavailable" : null;
    if (next !== notice) {
      notice = next;
      opts.onNotice(next);
    }
  };

  // ---- street map: lazy create / dispose --------------------------------------------------------------------------------
  const mapCamera = () => {
    const v = view();
    return { lon: v.lon, lat: v.lat, zoom: clamp(toMapZoom(v.zoom, v.lat), 2, TUNING.streetMapMaxZoom) };
  };

  async function mountStreet() {
    if (!tiles || streetState !== "none" || disposed) return;
    streetState = "loading";
    const token = ++streetToken;
    try {
      // `import.meta.env.SSR` is statically true in the server build, which drops the import (and MapLibre) there.
      // The conditional form matters: Rollup only prunes a dynamic import that sits in a dead branch of an expression.
      const engine = await (import.meta.env.SSR ? Promise.reject(new Error("no street map on the server")) : import("../street/engine"));
      if (disposed || token !== streetToken) return;
      const map = engine.createStreetMap(opts.streetRoot, {
        view: mapCamera(),
        places: opts.places,
        routes: opts.routes,
        selectedSlug: selected,
        focusedSlug: focused,
        reducedMotion: reduced,
        tiles,
        insetRight: renderer.getInset(),
        embedded: true,
        initialBlend: 0,
        onSelect: opts.onSelect,
        onTileStatus: (s) => {
          tile = s;
          reconcile();
        },
        onContextChange: (lost) => {
          streetLost = lost;
          reportContext();
          reconcile();
        },
        ...opts.streetOptions,
      });
      if (disposed || token !== streetToken) {
        map.dispose();
        return;
      }
      street = map;
      streetState = "ready";
      map.overlay.style.opacity = "0";
      map.overlay.style.transition = reduced ? "none" : "opacity var(--duration-fast, 120ms) linear";
      lastPush = null;
      if (restoring) shown = -1; // first frame: take the target at once (a restored view does not dissolve)
      reconcile();
    } catch (e) {
      if (disposed || token !== streetToken) return;
      streetState = "failed";
      if (!(e instanceof Error && e.name === "WebGLUnavailableError")) console.error("Street map failed to start", e);
      reconcile();
    }
  }

  function unmountStreet() {
    streetToken++;
    street?.dispose();
    street = null;
    streetState = "none";
    shown = 0;
    lastBlend = -1;
    owner = "globe";
    window.clearTimeout(labelsOffTimer);
    opts.labelsRoot.style.opacity = "1";
    globe.setLabelsActive(true);
    opts.streetRoot.style.opacity = "0";
    opts.streetRoot.inert = true;
    tile = null;
    streetLost = false;
    lastPush = null;
    revealOn = false;
    window.clearTimeout(followTimer);
    window.clearTimeout(revealTimer);
    reportContext();
  }

  // ---- reconcile: react to anything that changes what the street map can do -----------------------------------------------
  // Note: the tile status can arrive while `createStreetMap` is still returning, i.e. before `street` is assigned.
  function reconcile() {
    if (disposed) return;
    const v = view();
    // 1. the zoom limit: the street map's range while a tile source works, else the globe's.
    const wantLimit = streetOk() || (restoring && streetState !== "failed" && !streetDead()) ? Infinity : GLOBE_MAX_ZOOM;
    if (wantLimit === Infinity && renderer.getZoomLimit() !== Infinity) renderer.setZoomLimit(Infinity);
    if (wantLimit !== Infinity && renderer.getZoomLimit() === Infinity && !retreating) {
      if (v.zoom > GLOBE_MAX_ZOOM + 1e-3) {
        // Up in street scale when it went away: ease back to the regional scale first, the camera is not cut.
        retreating = true;
        renderer.flyTo({ lon: v.lon, lat: v.lat, zoom: GLOBE_MAX_ZOOM }, { beyondLimit: true });
      } else {
        renderer.setZoomLimit(GLOBE_MAX_ZOOM);
      }
    }
    // 2. a flight toward street scale that can no longer get there ends at the regional scale
    const target = renderer.flightTarget();
    if (target && target.zoom > GLOBE_MAX_ZOOM + 1e-3 && !retreating && (streetDead() || (tileOk() && selected && street && !coversSelected()))) {
      const p = selected ? places.get(selected) : undefined;
      renderer.flyTo({ lon: p?.lon ?? target.lon, lat: p?.lat ?? target.lat, zoom: Math.min(GLOBE_MAX_ZOOM, Math.max(TUNING.selectZoom, v.zoom)) });
    }
    // 3. reduced motion cannot wait in a flight: when the street becomes usable, jump to the place that asked for it
    if (wantStreet && streetOk() && !renderer.isFlying() && coversSelected()) {
      const p = selected ? places.get(selected) : undefined;
      if (p && v.zoom < streetSelectZoom(p.lat) - 0.5) renderer.flyTo({ lon: p.lon, lat: p.lat, zoom: streetSelectZoom(p.lat) });
    }
    if (restoring && (streetOk() || streetDead())) {
      restoring = false;
      window.clearTimeout(restoreTimer);
    }
    updateNotice();
    renderer.requestRender();
  }

  const coversSelected = () => {
    const p = selected ? places.get(selected) : undefined;
    return !!p && !!street && street.covers(p.lon, p.lat);
  };

  // ---- the per-tick work ---------------------------------------------------------------------------------------------------
  function pushCamera(sync: boolean) {
    if (!street) return;
    const c = mapCamera();
    const inset = renderer.getInset();
    const l = lastPush;
    if (l && l.lon === c.lon && l.lat === c.lat && l.zoom === c.zoom && l.inset === inset) return;
    lastPush = { ...c, inset };
    street.setCamera(c, { inset, sync });
  }

  function applyOwner(next: OverlayOwner) {
    if (next === owner) return;
    owner = next;
    if (!street) return;
    window.clearTimeout(labelsOffTimer);
    if (owner === "street") {
      opts.labelsRoot.style.opacity = "0";
      street.overlay.style.opacity = "1";
      // Stop placing the globe's labels once they have faded out.
      labelsOffTimer = window.setTimeout(() => globe.setLabelsActive(false), reduced ? 0 : 200);
    } else {
      globe.setLabelsActive(true);
      opts.labelsRoot.style.opacity = "1";
      street.overlay.style.opacity = "0";
    }
  }

  function syncReveal() {
    if (!street) return;
    const v = view();
    const p = selected ? places.get(selected) : undefined;
    const want =
      HANDOVER.revealFocus && !reduced && !!p && shown >= 1 && !renderer.isFlying() && v.zoom >= streetSelectZoom(p.lat) - 1.5 && streetOk() && coversSelected();
    if (want === revealOn) return;
    revealOn = want;
    window.clearTimeout(revealTimer);
    if (want) revealTimer = window.setTimeout(() => void street?.setReveal(true), HANDOVER.revealDelayMs);
    else void street.setReveal(false);
  }

  /** Release the street map a while after the camera left its range and the dissolve is back at 0 (hysteresis). */
  function scheduleUnmount() {
    if (!tiles || streetState !== "ready") return;
    const wants = mountWanted(true, view().zoom, wantStreet || restoring);
    if (!wants && shown <= 0 && !unmountTimer) {
      unmountTimer = window.setTimeout(() => {
        unmountTimer = 0;
        if (!mountWanted(true, view().zoom, wantStreet || restoring) && shown <= 0) unmountStreet();
      }, HANDOVER.unmountDelayMs);
    }
    if (wants && unmountTimer) {
      window.clearTimeout(unmountTimer);
      unmountTimer = 0;
    }
  }

  function onFrame() {
    if (disposed || !renderer) return;
    const now = performance.now();
    const dt = lastFrameAt ? Math.min(60, now - lastFrameAt) : 16;
    lastFrameAt = now;
    const v = view();

    if (arrival === 0) {
      arrival = window.setTimeout(() => {
        arrival = null;
        if (!disposed && selected && !renderer.isFlying()) select(selected, true);
      }, HANDOVER.arrivalDelayMs);
    }

    // Retreat finished: the street map is no longer usable and the camera is back on the globe's range.
    if (retreating && !renderer.isFlying()) {
      retreating = false;
      if (!streetOk()) renderer.setZoomLimit(GLOBE_MAX_ZOOM);
      reconcile();
    }
    if (wantStreet && !renderer.isFlying()) {
      const p = selected ? places.get(selected) : undefined;
      if (streetDead() || !p || v.zoom >= streetSelectZoom(p.lat) - 0.5) wantStreet = false;
    }

    // Mount / unmount the street map.
    if (tiles && streetState !== "failed") {
      const mounted = streetState !== "none";
      const wants = mountWanted(mounted, v.zoom, wantStreet || restoring);
      if (wants && streetState === "none" && !streetDead()) void mountStreet();
    }

    if (!street || streetState !== "ready") {
      // Waiting for the street map to exist: the Three.js globe stays (nothing but a restored street view hides it).
      renderer.setSuspended(restoring && streetState !== "failed");
      return;
    }

    const ok = streetOk();
    const target = forced ?? (streetLost ? 0 : blendTarget(v.zoom, ok));
    if (shown < 0 || reduced || forced !== null) shown = target;
    else shown = slew(shown, target, dt);

    const following = v.zoom >= HANDOVER.followZoom - 1e-9;
    if (shown > 0 || v.zoom >= HANDOVER.blendStart - 0.02) {
      window.clearTimeout(followTimer);
      followTimer = 0;
      pushCamera(shown > 0);
    } else if (following) {
      // Invisible: just keep its tiles ready for where the camera rests.
      window.clearTimeout(followTimer);
      followTimer = window.setTimeout(() => {
        followTimer = 0;
        if (street && !disposed) pushCamera(false);
      }, HANDOVER.followDebounceMs);
    }

    if (shown !== lastBlend) {
      lastBlend = shown;
      void street.setBlend(shown, { animate: false });
    }
    renderer.setSuspended(shown >= 1 && !streetLost);
    const visible = shown > 0;
    opts.streetRoot.style.opacity = visible ? "1" : "0";
    if (opts.streetRoot.inert === visible) opts.streetRoot.inert = !visible;
    applyOwner(overlayOwner(owner, shown));
    syncReveal();
    updateNotice();
    scheduleUnmount();
    if (shown !== target) renderer.requestRender();
  }

  // ---- selection and flights -----------------------------------------------------------------------------------------------
  function select(slug: string | null, fly: boolean) {
    selected = slug;
    globe.setSelected(slug);
    street?.setSelected(slug);
    if (!slug) {
      wantStreet = false;
      syncReveal();
      return;
    }
    const place = places.get(slug);
    if (!place || !fly) return;
    const v = view();
    // Street scale is the goal unless it is known not to work for this place. While the street map is still starting
    // (no verdict yet) the flight starts anyway and waits at the regional scale if it has to.
    const possible = !!tiles && streetState !== "failed" && tile?.state !== "capped" && (!tileOk() || coversSelected() || !street);
    wantStreet = possible;
    const zoom = possible ? Math.max(v.zoom, streetSelectZoom(place.lat)) : Math.max(v.zoom, TUNING.selectZoom);
    retreating = false;
    renderer.flyTo({ lon: place.lon, lat: place.lat, zoom }, { beyondLimit: possible });
    if (possible && streetState === "none") void mountStreet();
    updateNotice();
  }

  // Direct load on a place (no saved view): the globe starts at the place, then continues into street scale.
  // Decided once the renderer has a size (first frame) and after a short beat, so the place is seen on the globe first.
  let arrival: number | null = opts.selectedSlug && !opts.initialView ? 0 : null;
  if (restoring) {
    void mountStreet();
    // If the street map does not come back in time the saved view is clamped to the regional scale.
    restoreTimer = window.setTimeout(() => {
      restoring = false;
      streetState = streetState === "ready" ? streetState : streetState === "loading" ? "failed" : streetState;
      reconcile();
    }, 12_000);
  }

  return {
    setSelected: select,
    setFocused(slug) {
      focused = slug;
      globe.setFocused(slug);
      street?.setFocused(slug);
    },
    setReducedMotion(on) {
      reduced = on;
      globe.setReducedMotion(on);
      street?.setReducedMotion(on);
      setFade(opts.labelsRoot);
      if (street) street.overlay.style.transition = on ? "none" : "opacity var(--duration-fast, 120ms) linear";
      if (on) {
        window.clearTimeout(revealTimer);
        if (revealOn) {
          revealOn = false;
          void street?.setReveal(false);
        }
      }
      renderer.requestRender();
    },
    setInset(px) {
      globe.setInset(px);
    },
    debug(): HandoverDebug {
      const g = globe.debug();
      return {
        globe: g,
        street: () => street,
        blend: () => ({ shown, target: forced ?? blendTarget(view().zoom, streetOk()) }),
        owner: () => owner,
        zoom: () => view().zoom,
        mapZoom: () => (street ? street.getView().zoom : null),
        streetState: () => streetState,
        tile: () => tile,
        limit: () => renderer.getZoomLimit(),
        suspended: () => renderer.isSuspended(),
        registrationError(lon, lat) {
          if (!street) return null;
          const a = renderer.projectExact(lon, lat);
          const m = street.debug().map().project([lon, lat]);
          const r = opts.streetRoot.getBoundingClientRect();
          const rs = opts.stage.getBoundingClientRect();
          return Math.hypot(a.x + rs.left - (m.x + r.left), a.y + rs.top - (m.y + r.top));
        },
        forceBlend(value) {
          forced = value;
          renderer.requestRender();
        },
        ticks: () => renderer.tickCount(),
        revealOpen: () => revealOn,
        fly(v) {
          wantStreet = !!tiles && streetState !== "failed";
          renderer.flyTo(v, { beyondLimit: wantStreet });
          if (wantStreet && streetState === "none") void mountStreet();
        },
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      streetToken++;
      for (const t of [followTimer, unmountTimer, labelsOffTimer, revealTimer, restoreTimer, arrival ?? 0]) window.clearTimeout(t);
      street?.dispose();
      street = null;
      globe.dispose();
    },
  };
}
