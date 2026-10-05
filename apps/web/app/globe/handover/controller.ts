/**
 * The handover controller: one camera, two renderers. Owns the Three.js globe (engine/) and, once needed, the street
 * map (street/), and keeps them registered while one dissolves into the other. See maths.ts for the model and
 * docs/street-architecture.md ("Handover") for the long version.
 *
 *  - The globe renderer is the only owner of the camera, the input (drag, wheel, pinch, tap) and the flights. Its
 *    canvas stays the pointer target at every scale; the street map is non-interactive (`embedded`). So a gesture that
 *    crosses the threshold simply keeps going: nothing is handed over, only what is drawn changes.
 *  - After every camera tick (`onFrame`) the street map is told the registered camera (and the globe's animated inset),
 *    rendered synchronously, and (dissolve mode) given the dissolve value, so the two never differ by a frame.
 *  - Default: a CUT. Once the camera is past `HANDOVER.cutZoom` and the street map has its tiles, renderer, markers and
 *    labels swap in ONE task (one paint): the street map is rendered synchronously for the exact camera first, and
 *    on the way back the globe is drawn synchronously before the street map is hidden. `HANDOVER.dissolve` brings the
 *    dither dissolve back.
 *  - The street chunk (MapLibre, PMTiles, the pass: ~450 KB gzip) is loaded only when the camera gets close or a
 *    place is selected; until it works the zoom limit is the globe's own maximum and nothing waits visibly.
 */
import type { Polylines } from "@catalyst/geodata";
import { createGlobe, type GlobeDebug, type GlobeHandle } from "../engine";
import { QUALITY, TUNING } from "../engine/tuning";
import { FrameGovernor } from "../engine/governor";
import { STREET_TUNING } from "../street/tuning";
import { perfEnd, perfStart } from "../engine/perf";
import { clamp } from "../engine/geo";
import type { StreetMap, StreetTileConfig, TileStatus } from "../street/types";
import { effectiveRadiusKm } from "../engine/framing";
import { isFitView, type GlobeInitialView, type GlobePlace, type GlobeProps, type GlobeRoute } from "../types";
import {
  GLOBE_MAX_ZOOM,
  HANDOVER,
  blendTarget,
  cutWanted,
  mountWanted,
  overlayOwner,
  selectionZoom,
  slew,
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
  /** A `GlobeFitView` starts framed on a place; with none, a selected place is framed too (nothing flies on load). */
  initialView: GlobeInitialView | null;
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
  /** Testing: override `HANDOVER.dissolve` (true = the dither dissolve instead of the cut). */
  dissolve?: boolean;
  /**
   * Called ONCE, when the first correct frame has been drawn: the final framing of a direct load. With a start view at
   * street scale it waits for the street map to be shown (the cut), but at most `HANDOVER.revealWaitMs`, then reveals
   * whichever correct frame exists (the globe at its own maximum; the cut still applies later). The host keeps the stage
   * invisible until then (a fade from the page colour instead of a flash of planet). Never called after `dispose`.
   */
  onReveal?(): void;
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
  /** Select a place as a click would (highlight and fly to its framing). */
  select(slug: string | null): void;
  /** The zoom the place's view radius is framed at now (free area, inset target), unclamped by the street range. */
  framingZoom(slug: string): number | null;
  /** The renderer swap is a dissolve (true) or a cut (false). */
  dissolve(): boolean;
  /** Frame governor level now (0 = full quality) and a measurement hook to force one. */
  quality(): number;
  forceQuality(level: number): void;
  /** Cuts so far: 0 to 1 swaps to the street map, 1 to 0 swaps back, and how many frames waited for tiles. */
  cuts(): { toStreet: number; toGlobe: number; waitedFrames: number };
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
  const dissolve = opts.dissolve ?? HANDOVER.dissolve;
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
  let streetActive = true;
  // Adaptive quality (engine/governor.ts): level 1 = street map at one fewer map pixel per art cell per axis, level 2 = a larger art pixel.
  const governor = opts.streetOptions?.governor === false ? null : new FrameGovernor();
  let qualityLevel = 0;
  const renderScaleFor = (level: number) => (level >= 1 ? Math.max(1, STREET_TUNING.renderScale - 1) : STREET_TUNING.renderScale);
  /** Visible street map: pan in whole art cells (street/core/snap.ts). */
  const snapPan = STREET_TUNING.snapPanFromZoom > 0;
  let notice: Notice | null = null;
  // The view to start from. A selected place with no view is framed on (no 0.7 s beat, no flight): a direct load.
  // Without tiles there is no street scale to frame at: a fit view degrades to the regional select zoom.
  const startPlace = opts.selectedSlug ? places.get(opts.selectedSlug) : undefined;
  let initialView: GlobeInitialView | null =
    opts.initialView ?? (startPlace ? { lon: startPlace.lon, lat: startPlace.lat, fitRadiusKm: effectiveRadiusKm(startPlace.viewRadiusKm) } : null);
  if (isFitView(initialView) && !tiles) initialView = null;
  /**
   * The start view may be at street scale (a saved street view, or a place's framing): the street map is wanted from
   * the first frame and the zoom limit is lifted. The globe is drawn (at its own maximum, centred on the place) until
   * the street map has its tiles, then the cut happens: no flight. Settled on the first frame, when the size is known.
   */
  let restoring = !!tiles && (isFitView(initialView) || (initialView?.street ?? 0) > 0);
  let restoreCheck = restoring;
  let restoreTimer = 0;
  let warmTimer = 0;
  // First reveal (opts.onReveal): see tryReveal.
  const needsStreet = restoring;
  const createdAt = performance.now();
  let revealed = !opts.onReveal;
  let revealWaitTimer = 0;
  let cutSince = 0;
  const cutStats = { toStreet: 0, toGlobe: 0, waitedFrames: 0 };
  let inFrame = false;
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
    initialView,
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

  // Dissolve mode: both overlays fade with the dissolve (an opacity cross-fade of text cannot be a pixel dissolve;
  // positions agree). Cut mode: no transition at all, the swap is instant.
  const fadeCss = () => (reduced || !dissolve ? "none" : "opacity var(--duration-fast, 120ms) linear");
  const setFade = (el: HTMLElement) => {
    el.style.transition = fadeCss();
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
      const tc = perfStart();
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
        // Native art-resolution render unless the sharp reveal (which shows the device-resolution render) is on.
        highResolution: HANDOVER.revealFocus,
        renderScale: renderScaleFor(qualityLevel),
        initialBlend: dissolve ? 0 : 1, // cut mode: always opaque, shown or hidden as a whole by `streetRoot`
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
      perfEnd("street.create", tc);
      if (disposed || token !== streetToken) {
        map.dispose();
        return;
      }
      street = map;
      streetState = "ready";
      streetActive = false;
      map.setActive(false); // hidden until the cut (or the dissolve) shows it
      map.overlay.style.opacity = "0";
      map.overlay.style.transition = fadeCss();
      lastPush = null;
      if (restoring) shown = -1; // first frame: take the target at once (a restored view does not dissolve)
      cutSince = 0;
      lastBlend = dissolve ? -1 : 1; // cut mode: the map was created opaque
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
      if (p && v.zoom < placeZoom(p) - 0.5) renderer.flyTo({ lon: p.lon, lat: p.lat, zoom: placeZoom(p) });
    }
    if (restoring && (streetOk() || streetDead())) {
      restoring = false;
      window.clearTimeout(restoreTimer);
    }
    updateNotice();
    renderer.requestRender();
  }

  /** Zoom a selection of `p` ends at with a street map: its view radius fitted to the free area (inset target included). */
  const placeFit = (p: GlobePlace) => renderer.fitZoomFor(effectiveRadiusKm(p.viewRadiusKm));
  const placeZoom = (p: GlobePlace) => selectionZoom(placeFit(p), p.lat, true, view().zoom);

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
    const t0 = perfStart();
    street.setCamera(c, { inset, sync, snap: sync && snapPan });
    perfEnd(sync ? "street.setCamera(sync)" : "street.setCamera", t0);
  }

  function applyOwner(next: OverlayOwner) {
    if (next === owner) return;
    owner = next;
    if (!street) return;
    window.clearTimeout(labelsOffTimer);
    if (owner === "street") {
      opts.labelsRoot.style.opacity = "0";
      street.overlay.style.opacity = "1";
      // Stop placing the globe's labels once they have faded out (at once when there is no fade).
      if (dissolve && !reduced) labelsOffTimer = window.setTimeout(() => globe.setLabelsActive(false), 200);
      else globe.setLabelsActive(false);
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
      HANDOVER.revealFocus && !reduced && !!p && shown >= 1 && !renderer.isFlying() && v.zoom >= placeZoom(p) - 1.5 && streetOk() && coversSelected();
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

  /** The street map has drawn the camera it was last given with all its tiles (the cut must not show a half-loaded map). */
  function streetFramed(): boolean {
    if (!street || !lastPush) return false;
    try {
      const m = street.debug().map();
      return m.loaded() && m.areTilesLoaded();
    } catch {
      return true; // cannot tell: never block the swap on it (cutMaxWaitMs is the backstop anyway)
    }
  }

  /**
   * Cut mode: the target is 0 (globe) or 1 (street), applied at once. Going to the street waits (up to `cutMaxWaitMs`)
   * until the street map has its tiles for the exact camera, rendering it synchronously while it waits.
   */
  function cutTarget(zoom: number, ok: boolean, now: number): number {
    const showing = shown >= 1;
    if (!cutWanted(showing, zoom, ok)) {
      cutSince = 0;
      return 0;
    }
    if (showing) return 1;
    if (!cutSince) cutSince = now;
    pushCamera(true); // invisible but exact (deduplicated while the camera rests)
    if (streetFramed() || now - cutSince >= HANDOVER.cutMaxWaitMs) return 1;
    cutStats.waitedFrames++;
    renderer.requestRender(); // frames are on demand: keep polling until the tiles are in (or the wait is over)
    return 0;
  }

  /**
   * Reveal the stage (once) when there is a correct frame to show: the street map's cut for a start at street scale, the
   * globe's first frame otherwise; a start that needs the street map gives it `revealWaitMs`, then shows the globe.
   */
  function tryReveal(force: boolean) {
    if (revealed || disposed || !renderer) return;
    const streetUp = shown >= 1 && !!street;
    if (!streetUp && renderer.frameCount() === 0) return; // nothing drawn yet: nothing to show
    const waiting = needsStreet && !streetUp && !streetDead();
    if (waiting && !force && performance.now() - createdAt < HANDOVER.revealWaitMs) return;
    revealed = true;
    window.clearTimeout(revealWaitTimer);
    opts.onReveal?.();
  }

  function onFrame() {
    if (disposed || !renderer || inFrame) return;
    inFrame = true;
    try {
      frame();
      tryReveal(false);
    } finally {
      inFrame = false;
    }
  }

  /** Apply a governor level to both renderers (the art pixel change re-fits the globe and the street grid). */
  function applyQuality(level: number) {
    if (level === qualityLevel) return;
    const boost = level >= 2 ? 1 : 0;
    qualityLevel = level;
    street?.setRenderScale(renderScaleFor(level));
    if (boost !== QUALITY.cellBoost) {
      QUALITY.cellBoost = boost;
      renderer.refit();
      street?.resize();
      lastPush = null;
    }
    renderer.requestRender();
  }

  function frame() {
    const tf = perfStart();
    try {
      frameInner();
    } finally {
      perfEnd("handover.frame", tf);
    }
  }

  function frameInner() {
    const now = performance.now();
    if (governor) {
      const next = governor.sample(now);
      if (next !== null) applyQuality(next);
    }
    const dt = lastFrameAt ? Math.min(60, now - lastFrameAt) : 16;
    lastFrameAt = now;
    const v = view();

    // First frame (the size is known): does the start view need the street map at all?
    if (restoreCheck) {
      restoreCheck = false;
      if (v.zoom <= GLOBE_MAX_ZOOM + 1e-3) {
        restoring = false;
        renderer.setZoomLimit(GLOBE_MAX_ZOOM);
      } else {
        void mountStreet();
        // If the street map does not come back in time the start view is clamped to the regional scale.
        restoreTimer = window.setTimeout(() => {
          restoring = false;
          streetState = streetState === "ready" ? streetState : streetState === "loading" ? "failed" : streetState;
          reconcile();
        }, 12_000);
      }
    }

    // Retreat finished: the street map is no longer usable and the camera is back on the globe's range.
    if (retreating && !renderer.isFlying()) {
      retreating = false;
      if (!streetOk()) renderer.setZoomLimit(GLOBE_MAX_ZOOM);
      reconcile();
    }
    if (wantStreet && !renderer.isFlying()) {
      const p = selected ? places.get(selected) : undefined;
      if (streetDead() || !p || v.zoom >= placeZoom(p) - 0.5) wantStreet = false;
    }

    // Mount / unmount the street map.
    if (tiles && streetState !== "failed") {
      const mounted = streetState !== "none";
      const wants = mountWanted(mounted, v.zoom, wantStreet || restoring);
      if (wants && streetState === "none" && !streetDead()) void mountStreet();
    }

    if (!street || streetState !== "ready") {
      // Waiting for the street map to exist: the Three.js globe stays, drawn at its own maximum when the camera is
      // further in (a start view at street scale shows the place on the globe until the cut).
      renderer.setSuspended(false);
      return;
    }

    const ok = streetOk();
    const prevShown = shown;
    let target: number;
    if (forced !== null) target = forced;
    else if (streetLost) target = 0;
    else if (dissolve) target = blendTarget(v.zoom, ok);
    else target = cutTarget(v.zoom, ok, now);
    if (shown < 0 || reduced || forced !== null || !dissolve) shown = target;
    else shown = slew(shown, target, dt);

    // Cut back to the globe: draw the Three.js frame for this exact camera BEFORE the street map is hidden, so the
    // globe underneath is never a stale frame (the globe's labels are placed in that frame too).
    if (!dissolve && prevShown >= 1 && shown < 1) {
      cutStats.toGlobe++;
      globe.setLabelsActive(true);
      renderer.setSuspended(false);
      renderer.renderNow();
    }
    // Cut to the street map: it is rendered synchronously for this exact camera, then everything flips below.
    if (!dissolve && prevShown < 1 && shown >= 1) {
      cutStats.toStreet++;
      lastPush = null;
    }

    // A map that is not shown renders (tiles load) but copies and draws nothing; the DOM overlay is not updated either.
    if (shown > 0 !== streetActive) {
      streetActive = shown > 0;
      street.setActive(streetActive);
    }
    const following = v.zoom >= HANDOVER.followZoom - 1e-9;
    // Hidden, the street map only follows once the camera rests (debounced below), except while a dissolve is about to start.
    if (shown > 0 || (dissolve && v.zoom >= HANDOVER.blendStart - 0.02)) {
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

    const blend = dissolve || forced !== null ? shown : 1;
    if (blend !== lastBlend) {
      lastBlend = blend;
      void street.setBlend(blend, { animate: false });
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

  // ---- chunk warm-up ---------------------------------------------------------------------------------------------------
  // Fetching and evaluating the street chunk (MapLibre, ~450 KB gzip) is a 40+ ms task. Doing it in an idle period after
  // the globe is up keeps it out of the first flight or zoom (the frame that mounts the street map). Skipped on data-saver
  // connections, where the chunk stays lazy.
  if (tiles && !import.meta.env.SSR) {
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (!conn?.saveData && !/(^|-)2g$/.test(conn?.effectiveType ?? "")) {
      const warm = () => {
        if (!disposed) void import("../street/engine").catch(() => {});
      };
      const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      warmTimer = window.setTimeout(() => (ric ? ric.call(window, warm, { timeout: 4000 }) : warm()), 2500);
    }
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
    const zoom = selectionZoom(placeFit(place), place.lat, possible, v.zoom);
    retreating = false;
    renderer.flyTo({ lon: place.lon, lat: place.lat, zoom }, { beyondLimit: possible });
    if (possible && streetState === "none") void mountStreet();
    updateNotice();
  }

  if (!revealed) revealWaitTimer = window.setTimeout(() => tryReveal(true), HANDOVER.revealWaitMs);

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
        select: (slug) => select(slug, true),
        framingZoom: (slug) => {
          const p = places.get(slug);
          return p ? placeFit(p) : null;
        },
        dissolve: () => dissolve,
        quality: () => qualityLevel,
        forceQuality(level) {
          governor?.force(level, performance.now());
          applyQuality(level);
        },
        cuts: () => ({ ...cutStats }),
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
      QUALITY.cellBoost = 0; // module state: a remount starts at full quality
      streetToken++;
      for (const t of [followTimer, unmountTimer, labelsOffTimer, revealTimer, restoreTimer, warmTimer, revealWaitTimer]) window.clearTimeout(t);
      street?.dispose();
      street = null;
      globe.dispose();
    },
  };
}
