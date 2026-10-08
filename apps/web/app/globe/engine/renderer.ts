/**
 * Standalone Three.js globe: pixelated, monochrome, on-demand rendering.
 *
 * - Pixelation: the drawing buffer is `cssSize / pixelSize` and the canvas is upscaled with
 *   `image-rendering: pixelated`. Lines are 1 buffer pixel wide, antialiasing is off.
 * - A depth-writing disc hides the graticule, borders and coastlines on the far hemisphere. Markers and routes are
 *   not depth-tested against it (a depth test cuts the off-centre pixels of a sprite or a stroke on a tilted
 *   surface): markers are placed and shown or hidden as a whole on the CPU (`visibility.ts`), routes are hidden
 *   by an analytic test on the line itself (see materials.ts).
 * - Frames are only scheduled when something changed or animates (`requestRender` / `tick`). While the tab is
 *   hidden or the GL context is lost nothing is scheduled; the first frame after recovery repaints.
 * - Imperative and framework-free: React only owns the lifecycle (see ../globe-canvas.tsx).
 */
import { ColorManagement, Color, PerspectiveCamera, WebGLRenderer } from "three";
import type { Polylines } from "@catalyst/geodata";
import type { GlobePlace, GlobeRoute } from "../types";
import type { GlobeTheme } from "./colors";
import { attachControls, type ControlsHost, type PointerKind } from "./controls";
import { watchDevicePixelRatio } from "./dpr";
import { FRAME_CLOCK } from "./governor";
import { groupFitZoom, radiusFitZoom } from "./framing";
import {
  DEG,
  FOV_DEG,
  clamp,
  fitZoom,
  normalizeLon,
  projectLonLat,
  viewBasis,
  zoomCorrection,
  zoomToRadiusPx,
  type ScreenPoint,
  type ViewBasis,
  type ViewState,
} from "./geo";
import { isRouteStop, routesForPlace } from "./geometry";
import { clampInset, fadeMask, freeWidth, insetShiftBuf } from "./inset";
import {
  createFlight,
  cubicBezier,
  isStill,
  releaseVelocity,
  sampleFlight,
  STILL,
  stepInertia,
  type DragSample,
  type Flight,
  type Velocity,
} from "./motion";
import { snapBox } from "./group-square";
import { IdleSpin, spinBlock, spinFrameMs, type SpinContext } from "./idle-spin";
import { newLodCamera, setLodCamera, type LodTree } from "./lod-tree";
import { NodeScreen } from "./node-screen";
import { GlobeScene } from "./scene";
import { INSET_EASE, TUNING } from "./tuning";
import { fromViewState } from "./view";
import { markerShown } from "./visibility";
import { perfEnd, perfStart } from "./perf";

// Our ShaderMaterials write raw sRGB values and there is no lighting, so skip Three's linear-sRGB conversion;
// otherwise ink and background drift away from the CSS colours.
ColorManagement.enabled = false;

const MARKER_RADIUS = 1;
const easeInset = cubicBezier(...INSET_EASE);

export interface RendererOptions {
  /** Positioned, overflow-hidden element the canvas is appended to; its size is the globe's size. */
  container: HTMLElement;
  places: readonly GlobePlace[];
  routes: readonly GlobeRoute[];
  /** The semantic-zoom hierarchy (places and groups): decides, per frame, which markers and squares are drawn. Shared with the street overlay. */
  lod: LodTree;
  coastlines: Polylines;
  borders: Polylines;
  theme: GlobeTheme;
  reducedMotion: boolean;
  /** Initial zoom limit (see `setZoomLimit`); default the Three.js globe's maximum. */
  zoomLimit?: number;
  /** CSS px covered by UI on the right edge of the container at start; the globe centres on the rest. */
  insetRight: number;
  /** Called synchronously after every drawn frame (labels and view reporting hang off it). */
  onFrame(): void;
  /** The node under the point (its box and label, engine/hit-area.ts), or null. */
  pickLabel(x: number, y: number, kind: PointerKind): string | null;
  /**
   * Replaces picking altogether (markers and labels) when it returns a value other than `undefined`; `null` = nothing.
   * The handover uses it while the street map's overlay is the visible one.
   */
  pickOverride?(x: number, y: number, kind: PointerKind): string | null | undefined;
  onSelect(slug: string): void;
  /** A group's square (or label) was clicked: the handover flies the camera to frame its circle. */
  onSelectGroup(slug: string): void;
  /** The pointer is over a group (its slug) or not (null): highlight only. */
  onHover?(slug: string | null): void;
  /** The GL context was lost (true) or restored (false). */
  onContextChange(lost: boolean): void;
}

export interface StartView {
  lon: number;
  lat: number;
  /** In [0, 1] (`GlobeViewState` zoom); null = the select zoom. */
  zoom01: number | null;
  /** Street-scale levels beyond `zoom01` = 1 (`GlobeViewState.street`). */
  street?: number;
  /** Frame the circle of this radius (km) around the view centre instead (`GlobeFitView`); `zoom01` is ignored. */
  fitRadiusKm?: number;
}

export interface FlyOptions {
  /**
   * Allow the target to be above the current zoom limit (the street map is on its way): the flight then waits at the
   * limit, its clock paused, until the limit is lifted, instead of being cut short.
   */
  beyondLimit?: boolean;
}

export class GlobeRenderer {
  readonly canvas: HTMLCanvasElement;

  private gl: WebGLRenderer;
  private globe: GlobeScene;
  private camera = new PerspectiveCamera(FOV_DEG, 1, 0.05, 20);
  private view: ViewState = { lon: 15, lat: 28, zoom: 0 };
  private width = 1;
  private height = 1;
  private bufW = 1;
  private bufH = 1;
  private canvasLeft = 0;
  private canvasTop = 0;
  private minZoom = 1;
  /** Highest zoom reachable now (the globe's maximum unless the street map is available); see `setZoomLimit`. */
  private zoomLimit: number = TUNING.maxZoom;
  /** Skip drawing the Three.js scene (the street map covers it); the camera, flights and `onFrame` still run. */
  private suspended = false;
  private flightLast = 0;
  private pixel = 3;
  /** Current (animated) and target inset, CSS px; see `setInset`. */
  private inset: number;
  private insetTarget: number;
  private insetAnim: { from: number; to: number; start: number } | null = null;
  /** Projection-centre shift (buffer px) derived from `inset`. */
  private shiftBuf = 0;
  private containerMask: string | null = null;
  private reduced: boolean;
  private disposed = false;
  /** False until the container has a real size; nothing is drawn or clamped before that. */
  private sized = false;
  private start: StartView | null;
  private theme: GlobeTheme;
  private lost = false;
  private hidden = document.hidden;
  private dirty = false;
  private raf = 0;
  private frames = 0;
  private ticks = 0;
  private lastRenderMs = 0;
  private loseExt: WEBGL_lose_context | null = null;
  private cleanups: (() => void)[] = [];

  private places: readonly GlobePlace[];
  private routes: readonly GlobeRoute[];
  private placeBySlug = new Map<string, GlobePlace>();
  private selected: string | null = null;
  private focused: string | null = null;
  private hovered = -1;
  private drawnBoxes = 0;
  /** Semantic zoom: what is drawn this frame, and where (per node index; see `syncNodes`). */
  private lod: LodTree;
  private lodCam = newLodCamera();
  private selIdx = -1;
  private focIdx = -1;
  readonly nodeScreen: NodeScreen;
  private flight: Flight | null = null;
  private flightBeyond = false;
  private velocity: Velocity = STILL;
  private inertiaLast = 0;
  /** Idle rotation of the unzoomed world view (engine/idle-spin.ts): the clock, the timer that wakes the frame loop, the pointers held down. */
  private spin = new IdleSpin(performance.now());
  private spinTimer = 0;
  private pressed = new Set<number>();

  constructor(
    private opts: RendererOptions,
    start: StartView | null,
  ) {
    this.reduced = opts.reducedMotion;
    this.zoomLimit = opts.zoomLimit ?? TUNING.maxZoom;
    this.inset = this.insetTarget = Math.max(0, opts.insetRight);
    this.start = start;
    this.theme = opts.theme;
    this.places = opts.places;
    this.routes = opts.routes;
    this.lod = opts.lod;
    this.nodeScreen = new NodeScreen(opts.lod.size);
    for (const p of opts.places) this.placeBySlug.set(p.slug, p);

    this.gl = new WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    });
    this.gl.setPixelRatio(1);
    this.canvas = this.gl.domElement;
    Object.assign(this.canvas.style, {
      position: "absolute",
      imageRendering: "pixelated",
      touchAction: "none",
      display: "block",
      outline: "none",
      cursor: "grab",
      // A canvas that has not drawn yet is opaque black (alpha: false): invisible until the first frame is on it (`renderNow`),
      // so no unfinished frame is ever presented, whatever the stage's own opacity does.
      opacity: "0",
    } satisfies Partial<CSSStyleDeclaration>);
    this.canvas.setAttribute("aria-hidden", "true");
    opts.container.append(this.canvas);

    this.globe = new GlobeScene(opts);
    this.setTheme(opts.theme);

    const ro = new ResizeObserver(() => this.resize(true));
    ro.observe(opts.container);
    this.cleanups.push(() => ro.disconnect());
    this.cleanups.push(watchDevicePixelRatio(() => this.resize(true)));
    this.listen(document, "visibilitychange", () => this.setHidden(document.hidden));
    // Any input anywhere on the page restarts the idle clock and stops the idle rotation (passive: nothing here may delay a gesture).
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "wheel", "touchstart", "keydown"]) {
      window.addEventListener(type, this.onInput, { passive: true, capture: true });
      this.cleanups.push(() => window.removeEventListener(type, this.onInput, { capture: true }));
    }
    this.cleanups.push(() => window.clearTimeout(this.spinTimer));
    this.listen(this.canvas, "webglcontextlost", () => this.onContextLost());
    this.listen(this.canvas, "webglcontextrestored", () => this.onContextRestored());
    this.cleanups.push(attachControls(this.canvas, opts.container, this.controlsHost()));

    this.resize(false);
    this.refreshMarkers();
    this.requestRender();
  }

  private listen<T extends EventTarget>(target: T, type: string, fn: () => void) {
    target.addEventListener(type, fn);
    this.cleanups.push(() => target.removeEventListener(type, fn));
  }

  /* ------------------------------ sizing ------------------------------ */

  /** Re-derive the art pixel size and the buffers (the frame governor changed `QUALITY`). */
  refit(): void {
    this.resize(true);
  }

  private resize(redraw: boolean) {
    if (this.disposed) return;
    const w = this.opts.container.clientWidth;
    const h = this.opts.container.clientHeight;
    // Not laid out yet (or display: none): wait for the ResizeObserver instead of fitting a 1px globe.
    if (w < 1 || h < 1) return;
    this.width = w;
    this.height = h;
    const P = (this.pixel = TUNING.pixelSize(Math.min(w, h), window.devicePixelRatio || 1));
    this.bufW = Math.ceil(w / P);
    this.bufH = Math.ceil(h / P);
    this.gl.setSize(this.bufW, this.bufH, false);
    const cw = this.bufW * P;
    const ch = this.bufH * P;
    this.canvasLeft = -Math.round((cw - w) / 2);
    this.canvasTop = -Math.round((ch - h) / 2);
    Object.assign(this.canvas.style, {
      width: `${cw}px`,
      height: `${ch}px`,
      left: `${this.canvasLeft}px`,
      top: `${this.canvasTop}px`,
    });
    this.globe.routes.setPixelSize(this.bufW, this.bufH);
    this.applyInset();
    if (!this.sized) {
      this.sized = true;
      this.view = this.clampView(this.startView());
    } else {
      this.view = { ...this.view, zoom: clamp(this.view.zoom, this.minZoom, this.maxZoomAt(this.view.lat)) };
    }
    // Resizing clears the drawing buffer: repaint synchronously so there is no blank frame.
    if (redraw) this.renderNow();
  }

  /**
   * Everything that depends on the inset: the projection-centre shift, the minimum zoom (the whole globe fits
   * the free area) and the dissolving right edge. Cheap; called on resize and per tween frame.
   */
  private applyInset() {
    const { width: w, height: h, pixel: P } = this;
    const inset = clampInset(this.inset, w);
    this.shiftBuf = insetShiftBuf(inset, P);
    this.minZoom = fitZoom(freeWidth(w, inset), h, TUNING.fitMargin);
    this.containerMask = fadeMask(w, inset);
    const mask = fadeMask(w, inset, this.canvasLeft) ?? "";
    this.canvas.style.maskImage = mask;
    this.canvas.style.setProperty("-webkit-mask-image", mask);
  }

  /**
   * UI covers `px` CSS px of the container's right edge (the detail panel): centre the globe on the free area.
   * Appearing or disappearing (zero <-> non-zero) is eased like the panel's slide; any other change (a viewport
   * resize) and reduced motion apply at once.
   */
  setInset(px: number) {
    const next = Math.max(0, px);
    if (next === this.insetTarget) return;
    this.noteActivity();
    const toggles = (this.insetTarget === 0) !== (next === 0);
    this.insetTarget = next;
    if (this.sized && toggles && !this.reduced) {
      this.insetAnim = { from: this.inset, to: next, start: performance.now() };
    } else {
      this.insetAnim = null;
      this.inset = next;
      if (this.sized) {
        this.applyInset();
        this.view = { ...this.view, zoom: clamp(this.view.zoom, this.minZoom, this.maxZoomAt(this.view.lat)) };
      }
    }
    this.requestRender();
  }

  /** Size of the area the globe is centred on (the container minus the inset), for label placement. */
  getVisibleSize() {
    return { width: freeWidth(this.width, this.inset), height: this.height };
  }

  /** `mask-image` for overlays that must dissolve with the canvas (container coordinates), or null. */
  getContainerMask() {
    return this.containerMask;
  }

  /** Where the camera starts, once the minimum zoom is known. */
  private startView(): ViewState {
    const s = this.start;
    if (!s) return { lon: 15, lat: 28, zoom: this.minZoom };
    if (s.fitRadiusKm !== undefined) return { lon: s.lon, lat: s.lat, zoom: Math.max(this.minZoom, this.fitZoomFor(s.fitRadiusKm)) };
    if (s.zoom01 === null) return { lon: s.lon, lat: s.lat, zoom: TUNING.selectZoom };
    return fromViewState({ lon: s.lon, lat: s.lat, zoom: s.zoom01, street: s.street }, this.minZoom, TUNING.maxZoom);
  }

  /** The animated inset now (CSS px). */
  getInset() {
    return this.inset;
  }
  /** The inset the animation is heading for (CSS px): what framing a place for the panel must use. */
  getInsetTarget() {
    return this.insetTarget;
  }
  /**
   * Unified zoom at which the circle of `radiusKm` fits the free area once the inset has settled (unclamped above;
   * not below the whole-globe fit). See engine/framing.ts.
   */
  fitZoomFor(radiusKm: number): number {
    const z = radiusFitZoom(radiusKm, this.width, this.height, this.insetTarget);
    return Math.max(z, this.wholeFit());
  }
  /**
   * The zoom a flight to group `i` ends at: its circle (`viewRadiusKm`) fits the free area with `GROUP_FRAMING_MARGIN` of room,
   * which is far more than the box needs to open: its children are showing on arrival.
   */
  fitZoomForGroup(i: number): number {
    return Math.max(groupFitZoom(this.lod.radiusKm[i]!, this.width, this.height, this.insetTarget), this.wholeFit());
  }
  private wholeFit() {
    return fitZoom(freeWidth(this.width, clampInset(this.insetTarget, this.width)), this.height, TUNING.fitMargin);
  }
  isFlying() {
    return this.flight !== null;
  }

  getMinZoom() {
    return this.minZoom;
  }
  getView(): ViewState {
    return { ...this.view };
  }

  /* ------------------------------ camera API ------------------------------ */

  /** Highest internal zoom at a latitude: the zoom limit, and never past the street map's own maximum. */
  private maxZoomAt(lat: number): number {
    return Math.min(this.zoomLimit, TUNING.streetMapMaxZoom - zoomCorrection(lat));
  }

  private clampView(v: ViewState, beyondLimit = false): ViewState {
    const lat = clamp(v.lat, -TUNING.maxLat, TUNING.maxLat);
    const top = beyondLimit ? TUNING.streetMapMaxZoom - zoomCorrection(lat) : this.maxZoomAt(lat);
    return { lon: normalizeLon(v.lon), lat, zoom: clamp(v.zoom, this.minZoom, top) };
  }

  /**
   * Highest zoom reachable (default: the Three.js globe's maximum). The handover raises it to the street map's
   * maximum while a tile source works. Lowering it below the current zoom clamps the view at once.
   */
  setZoomLimit(zoom: number) {
    this.zoomLimit = zoom;
    this.noteActivity();
    const next = this.clampView(this.view);
    if (next.zoom !== this.view.zoom) {
      this.view = next;
      this.requestRender();
    }
  }
  getZoomLimit() {
    return this.zoomLimit;
  }

  /** True while the Three.js scene is not being drawn. */
  setSuspended(on: boolean) {
    if (on === this.suspended) return;
    this.suspended = on;
    this.noteActivity();
    // A suspended canvas keeps its last frame, which is stale as soon as the camera moves: it must not show through the
    // street map's dissolving edge (the inset fade) or anywhere else. Made transparent here (NOT `visibility: hidden`: the
    // canvas is the pointer target at every scale and a hidden element gets no pointer events), shown again by the next drawn
    // frame (renderNow), never before: a canvas that never drew is black.
    if (on) this.canvas.style.opacity = "0";
    else this.requestRender();
  }
  isSuspended() {
    return this.suspended;
  }

  /** The view the Three.js scene is drawn with: the globe cannot go closer than its own maximum. */
  private drawView(): ViewState {
    return this.view.zoom > TUNING.maxZoom ? { ...this.view, zoom: TUNING.maxZoom } : this.view;
  }

  setView(v: Partial<ViewState>) {
    this.noteActivity();
    this.flight = null;
    this.velocity = STILL;
    this.view = this.clampView({ ...this.view, ...v });
    this.requestRender();
  }

  /** Animated camera move; a jump under reduced motion. */
  flyTo(v: Partial<ViewState>, o?: FlyOptions) {
    this.noteActivity();
    const beyond = o?.beyondLimit === true;
    const to = this.clampView({ ...this.view, ...v }, beyond);
    if (this.reduced) {
      this.flight = null;
      this.velocity = STILL;
      this.view = this.clampView(to);
      this.requestRender();
      return;
    }
    this.velocity = STILL;
    this.flight = createFlight(this.view, to, performance.now(), this.height);
    this.flightBeyond = beyond;
    this.flightLast = performance.now();
    this.requestRender();
  }

  /** The target of the flight in progress, or null. */
  flightTarget(): ViewState | null {
    return this.flight ? { ...this.flight.to } : null;
  }

  setReducedMotion(on: boolean) {
    this.reduced = on;
    this.noteActivity();
    if (on) {
      if (this.flight) this.view = this.clampView(this.flight.to);
      this.flight = null;
      this.velocity = STILL;
      this.globe.routes.finishAll();
    }
    this.requestRender();
  }

  getTheme(): GlobeTheme {
    return this.theme;
  }

  setTheme(theme: GlobeTheme) {
    this.theme = theme;
    // Tones of the semantic zoom: group squares in map levels per kind (below the ink), a place marker the ink.
    this.lod.setTones(theme.ramp.length);
    this.gl.setClearColor(new Color(...theme.background), 1);
    this.globe.applyTheme(theme);
    this.requestRender();
  }

  /* ------------------------------ selection ------------------------------ */

  /** `animateRoute`: play the draw-on of the selected place's route (ignored under reduced motion). */
  setSelected(slug: string | null, animateRoute: boolean) {
    this.selected = slug;
    this.noteActivity();
    this.selIdx = this.lod.indexOf(slug);
    this.selectRoute(slug, animateRoute);
  }

  setFocused(slug: string | null) {
    if (slug === this.focused) return;
    this.focused = slug;
    this.noteActivity();
    this.focIdx = this.lod.indexOf(slug);
    this.refreshMarkers();
    this.requestRender();
  }

  /** Highlight (full ink) the node under the pointer. */
  setHovered(slug: string | null) {
    const next = this.lod.indexOf(slug);
    if (next === this.hovered) return;
    this.hovered = next;
    this.requestRender();
  }

  /** The routes through the selected place: the only ones drawn (engine/geometry.ts `routesForPlace`). */
  private selectedRoutes(): GlobeRoute[] {
    return routesForPlace(this.routes, this.selected ? this.placeBySlug.get(this.selected) : undefined);
  }

  private selectRoute(slug: string | null, animate: boolean) {
    const routes = this.selectedRoutes();
    this.globe.routes.show(new Set(routes.map((r) => r.id)), animate && !this.reduced && !!slug, performance.now());
    this.refreshMarkers();
    this.requestRender();
  }

  private refreshMarkers() {
    const stops = new Set<string>();
    for (const route of this.selectedRoutes()) for (const p of this.places) if (isRouteStop(route, p)) stops.add(p.slug);
    this.lod.setExtraForced([...stops].map((slug) => this.lod.indexOf(slug)));
  }

  /* ------------------------------ projection / picking ------------------------------ */

  /**
   * Where a place's marker is: the art-pixel cell (`col`, `row` in drawing-buffer pixels, row 0 at the top) its
   * centre falls in, and whether the marker is drawn at all. The ONE source for drawing, labels and picking.
   * Visible = front hemisphere and clear of the limb (`visibility.ts`), decided from the unsnapped centre.
   */
  private markerCell(lon: number, lat: number, basis: ViewBasis) {
    const P = this.pixel;
    const cw = this.bufW * P;
    const ch = this.bufH * P;
    const centreX = cw / 2 - this.shiftBuf * P;
    const p = projectLonLat(lon, lat, basis, cw, ch, MARKER_RADIUS, centreX);
    const shown = markerShown(p, basis, centreX, ch / 2, TUNING.markerLimbClearance * P);
    return { col: Math.floor(p.x / P), row: Math.floor(p.y / P), shown, facing: p.facing };
  }

  /** Where the globe model puts a place for the CURRENT view (not capped at the globe's maximum zoom, not snapped), container CSS px. */
  projectExact(lon: number, lat: number): { x: number; y: number } {
    const P = this.pixel;
    const cw = this.bufW * P;
    const ch = this.bufH * P;
    const p = projectLonLat(lon, lat, viewBasis(this.view, ch), cw, ch, MARKER_RADIUS, cw / 2 - this.shiftBuf * P);
    return { x: p.x + this.canvasLeft, y: p.y + this.canvasTop };
  }

  /** Container CSS px of the art pixel the marker is drawn in (its centre), and whether it is drawn. */
  project(lon: number, lat: number): ScreenPoint {
    const P = this.pixel;
    const c = this.markerCell(lon, lat, viewBasis(this.drawView(), this.bufH * P));
    return {
      x: (c.col + 0.5) * P + this.canvasLeft,
      y: (c.row + 0.5) * P + this.canvasTop,
      visible: c.shown,
      facing: c.shown ? c.facing : 0,
    };
  }

  /** The art-pixel grid of the canvas: what the pixel-text overlay must match cell for cell (engine/pixel-labels.ts). */
  pixelGrid() {
    return { cols: this.bufW, rows: this.bufH, cell: this.pixel, left: this.canvasLeft, top: this.canvasTop };
  }

  /**
   * The camera of the declutter clusters for this frame: the unified view (NOT capped at the globe's maximum zoom) in the
   * canvas's own projection space (the one `syncNodes` projects the markers in), so the tree decides from exactly the cells
   * the markers are drawn in.
   */
  private lodCamera() {
    const P = this.pixel;
    const cw = this.bufW * P;
    const ch = this.bufH * P;
    setLodCamera(this.lodCam, this.view, { width: cw, height: ch, centreX: cw / 2 - this.shiftBuf * P }, freeWidth(cw, this.inset), P);
    return this.lodCam;
  }

  /** A copy of the camera of the declutter clusters for the current view (measurement). */
  lodCameraNow() {
    return { ...this.lodCamera() };
  }

  /** The tree evaluated for the current camera (cached: free when a frame has just been drawn). */
  lodFrame(): LodTree {
    this.lod.update(this.lodCamera(), this.selIdx, this.focIdx, this.reduced);
    return this.lod;
  }

  /**
   * Per frame, before drawing: evaluate the detection boxes (engine/lod-tree.ts) and hand every DRAWN node its rectangle in
   * whole art cells (`snapBox`): a place and a group are the same kind of thing. The label layer draws them on the pixel
   * canvas, and picking reads these rectangles, so what is drawn, labelled and clickable cannot disagree. A node is drawn
   * whole or not at all: the tree counted only places that passed the whole-or-nothing visibility rule (`markerShown`).
   * O(drawn nodes): nothing else is touched or allocated.
   */
  private syncNodes() {
    const lod = this.lodFrame();
    lod.advance(performance.now());
    const P = this.pixel;
    const screen = this.nodeScreen;
    let boxes = 0;
    for (let k = 0; k < lod.count; k++) {
      const i = lod.visible[k]!;
      const r = snapBox(lod.boxX0[i]!, lod.boxY0[i]!, lod.boxX1[i]!, lod.boxY1[i]!, P);
      screen.bx0[i] = r.c0 * P + this.canvasLeft;
      screen.by0[i] = r.r0 * P + this.canvasTop;
      screen.bx1[i] = r.c1 * P + this.canvasLeft;
      screen.by1[i] = r.r1 * P + this.canvasTop;
      screen.x[i] = (screen.bx0[i]! + screen.bx1[i]!) / 2;
      screen.y[i] = (screen.by0[i]! + screen.by1[i]!) / 2;
      // Drawn = the node's places passed the visibility rule and its rectangle touches the buffer.
      const drawn = (lod.isGroup[i] ? lod.members[i]! > 0 : !!lod.shown[i]) && r.c1 > 0 && r.r1 > 0 && r.c0 < this.bufW && r.r0 < this.bufH;
      screen.shown[i] = drawn ? 1 : 0;
      screen.facing[i] = 1;
      if (drawn) boxes++;
    }
    this.drawnBoxes = boxes;
  }

  /** Ids of the routes drawn now: only those through the selected place (checks). */
  routesShown(): string[] {
    return this.globe.routes.shown();
  }

  /** The globe layers' timed state (checks): the borders' fade value now and whether it is going to / at the on state. */
  layerState() {
    return { borders: this.globe.borderState(), animating: this.globe.animating };
  }

  /** Run the borders' fade to its end (checks). */
  settleBorders() {
    this.globe.settleBorders();
  }

  /** Rectangles drawn in the last frame: measurement. */
  drawnCounts() {
    return { markers: 0, groups: this.drawnBoxes };
  }

  /* ------------------------------ input ------------------------------ */

  private controlsHost(): ControlsHost {
    return {
      stopMotion: () => {
        this.flight = null;
        this.velocity = STILL;
      },
      panPixels: (dx, dy) => this.panPixels(dx, dy),
      zoomBy: (d) => this.setView({ zoom: this.view.zoom + d }),
      fling: (samples, now) => this.fling(samples, now),
      pickAt: (x, y, kind) => {
        const over = this.opts.pickOverride?.(x, y, kind);
        return over !== undefined ? over : this.opts.pickLabel(x, y, kind);
      },
      hover: (slug) => {
        this.setHovered(slug);
        this.opts.onHover?.(slug);
      },
      select: (slug) => {
        const i = this.lod.indexOf(slug);
        if (i >= 0 && this.lod.isGroup[i]) this.opts.onSelectGroup(slug);
        else this.opts.onSelect(slug);
      },
    };
  }

  private panPixels(dx: number, dy: number) {
    const r = zoomToRadiusPx(this.view.zoom);
    const cosLat = Math.max(0.15, Math.cos(this.view.lat * DEG));
    this.setView({ lon: this.view.lon - dx / (r * cosLat) / DEG, lat: this.view.lat + dy / r / DEG });
  }

  private fling(samples: readonly DragSample[], now: number) {
    if (this.reduced) return;
    const v = releaseVelocity(samples, now, zoomToRadiusPx(this.view.zoom), this.view.lat, TUNING.maxFlingPxPerMs);
    if (!v) return;
    this.velocity = v;
    this.inertiaLast = performance.now();
    this.requestRender();
  }

  /* ------------------------------ frame scheduling ------------------------------ */

  /** True while a frame is pending (any animation, inertia or deferred render). */
  isAnimating() {
    return this.raf !== 0;
  }

  requestRender() {
    if (this.disposed) return;
    if (this.hidden || this.lost) {
      this.dirty = true;
      return;
    }
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  private cancelFrame() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private setHidden(hidden: boolean) {
    this.hidden = hidden;
    this.noteActivity();
    if (hidden) {
      window.clearTimeout(this.spinTimer);
      this.spinTimer = 0;
      this.cancelFrame();
      this.dirty = true;
    } else if (this.dirty) {
      this.dirty = false;
      this.requestRender();
    }
  }

  private onContextLost() {
    this.lost = true;
    this.noteActivity();
    this.cancelFrame();
    this.dirty = true;
    this.opts.onContextChange(true);
  }

  private onContextRestored() {
    // Three re-initialises its GL state on restore and re-uploads geometry and programs lazily on the next render.
    // That reset also drops the clear colour, so it is set again.
    this.gl.setClearColor(new Color(...this.theme.background), 1);
    this.lost = false;
    this.noteActivity();
    this.opts.onContextChange(false);
    this.dirty = false;
    this.requestRender();
  }

  /** Advance animations; returns true if another frame is needed. */
  private advance(now: number): boolean {
    let more = false;
    if (this.insetAnim) {
      const a = this.insetAnim;
      const t = clamp((now - a.start) / TUNING.insetMs, 0, 1);
      this.inset = t >= 1 ? a.to : a.from + (a.to - a.from) * easeInset(t);
      this.applyInset();
      this.view = { ...this.view, zoom: clamp(this.view.zoom, this.minZoom, this.maxZoomAt(this.view.lat)) };
      if (t >= 1) this.insetAnim = null;
      else more = true;
    }
    if (this.flight) {
      const dt = now - this.flightLast;
      this.flightLast = now;
      const s = sampleFlight(this.flight, now, this.minZoom);
      const lat = clamp(s.view.lat, -TUNING.maxLat, TUNING.maxLat);
      if (this.flightBeyond && s.view.zoom > this.maxZoomAt(lat) + 1e-6) {
        // The street map is not available yet: hold at the limit and pause the flight's clock; it resumes from here.
        this.flight = { ...this.flight, start: this.flight.start + dt };
        this.view = this.clampView(s.view);
        more = true;
      } else {
        this.view = this.clampView(s.view, this.flightBeyond);
        if (s.done) this.flight = null;
        else more = true;
      }
    }
    if (!isStill(this.velocity)) {
      const dt = now - this.inertiaLast;
      this.inertiaLast = now;
      const step = stepInertia(this.velocity, dt, zoomToRadiusPx(this.view.zoom), TUNING.inertiaMs);
      this.view = this.clampView({ ...this.view, lon: this.view.lon + step.move.lon, lat: this.view.lat + step.move.lat });
      this.velocity = step.velocity;
      if (!isStill(this.velocity)) more = true;
    }
    if (this.globe.routes.advance(now, zoomToRadiusPx(this.view.zoom))) more = true;
    return more;
  }

  /* ------------------------------ idle rotation ------------------------------ */

  /** One object, refilled on each call: the pointer events that ask must not allocate. */
  private spinCtx: SpinContext = { reduced: false, hidden: false, lost: false, suspended: false, selected: false, focused: false, inset: 0, zoom: 0, minZoom: 0, busy: false };
  private spinContext(): SpinContext {
    const c = this.spinCtx;
    c.reduced = this.reduced;
    c.hidden = this.hidden;
    c.lost = this.lost;
    c.suspended = this.suspended;
    c.selected = this.selected !== null;
    c.focused = this.focused !== null;
    c.inset = this.insetTarget;
    c.zoom = this.view.zoom;
    c.minZoom = this.minZoom;
    c.busy = this.flight !== null || !isStill(this.velocity) || this.insetAnim !== null || this.pressed.size > 0;
    return c;
  }

  /** Why the globe is not turning (checks), or null while it is allowed to. */
  spinInfo() {
    return { spinning: this.spin.spinning, blockedBy: spinBlock(this.spinContext()), timerArmed: this.spinTimer !== 0 };
  }

  /** Input or camera motion, or any change of the conditions: the globe stops turning now and the idle clock restarts. */
  private noteActivity() {
    const was = this.spin.spinning;
    this.spin.activity(performance.now());
    if (was) {
      window.clearTimeout(this.spinTimer);
      this.spinTimer = 0;
    }
    // Nothing is waiting (a block just lifted: a pointer released, a place deselected ...): look at when it may start. With a timer pending that is a no-op.
    this.armSpin();
  }

  private onInput = (e: Event) => {
    if (e instanceof PointerEvent) {
      if (e.type === "pointerdown") this.pressed.add(e.pointerId);
      else if (e.type === "pointerup" || e.type === "pointercancel" || (e.pointerType === "mouse" && e.buttons === 0)) this.pressed.delete(e.pointerId);
    }
    this.noteActivity();
  };

  /**
   * Wake the frame loop when the idle delay is over, or, while turning, for the next redraw: with a timer, never a rAF chain, so
   * the loop is asleep in between (a redraw every `spinFrameMs`, about three a second) and an unconditionally idle page stays at zero frames.
   */
  private armSpin() {
    if (this.disposed || (!this.spin.spinning && this.spinTimer)) return; // the pending timer looks again when it fires
    window.clearTimeout(this.spinTimer);
    this.spinTimer = 0;
    const wait = this.spin.spinning ? spinFrameMs(this.pixel, zoomToRadiusPx(this.view.zoom)) : this.spin.wait(performance.now(), this.spinContext());
    if (wait !== null) this.spinTimer = window.setTimeout(this.onSpinTimer, wait);
  }

  private onSpinTimer = () => {
    this.spinTimer = 0;
    if (this.disposed) return;
    if (!this.spin.spinning) {
      const wait = this.spin.wait(performance.now(), this.spinContext());
      if (wait === null) return;
      if (wait > 0) {
        this.spinTimer = window.setTimeout(this.onSpinTimer, wait);
        return;
      }
    }
    this.requestRender(); // the tick turns the globe (`stepSpin`)
  };

  /** Once per tick: turn the globe by the idle rotation's step for now. Writes the view directly (`setView` would count as input). */
  private stepSpin(now: number) {
    const was = this.spin.spinning;
    const yaw = this.spin.step(now, this.spinContext());
    if (!was && this.spin.spinning) {
      // The pointer has not moved for the whole delay, but whatever was under it is about to slide away: drop the hover highlight.
      this.setHovered(null);
      this.opts.onHover?.(null);
    }
    if (yaw !== 0) this.view = { ...this.view, lon: normalizeLon(this.view.lon - yaw) };
  }

  /** Whether the last tick asked for another frame: the next tick is then part of a running animation (see `FRAME_CLOCK`). */
  private chained = false;

  private tick = () => {
    this.raf = 0;
    if (this.disposed || this.hidden || this.lost) {
      this.chained = false;
      return;
    }
    // The frame governor (engine/governor.ts) must tell a slow device from a quiet one: a frame that is not part of a running
    // animation was caused by an input event, and its interval says nothing about the device.
    FRAME_CLOCK.live = true;
    FRAME_CLOCK.continuous = this.chained;
    const now = performance.now();
    const moving = this.advance(now);
    if (moving) this.spin.activity(now); // a flight, inertia or the inset slide is camera motion: not idle
    this.stepSpin(now);
    this.renderNow();
    FRAME_CLOCK.continuous = false;
    // A timed transition of the boxes or of the borders (engine/fade.ts) that has not reached its end keeps the loop going, camera or not.
    // While the street map owns the view the globe draws nothing and its transitions are not advanced here (the street engine runs the
    // boxes' own), so they must not keep this loop spinning.
    const more = moving || (!this.suspended && (this.lod.animating || this.globe.animating));
    this.chained = more;
    if (more) this.requestRender();
    else this.armSpin();
  };

  /** Synchronous render (also used by resize and by the measurement hooks). */
  renderNow() {
    if (this.disposed || this.lost || !this.sized) return;
    this.cancelFrame();
    const w0 = performance.now();
    if (this.suspended) {
      this.ticks++;
      this.opts.onFrame();
      FRAME_CLOCK.workMs = performance.now() - w0;
      return;
    }
    const tp = perfStart();
    this.syncCamera();
    this.syncNodes();
    perfEnd("three.sync", tp);
    // The whole buffer is drawn: a GL scissor limited to the free area saved nothing measurable (docs/web-architecture.md)
    // and left the area outside it stale, which the CSS edge-fade mask then revealed.
    const t0 = performance.now();
    this.gl.render(this.globe.scene, this.camera);
    this.lastRenderMs = performance.now() - t0;
    this.frames++;
    if (this.canvas.style.opacity === "0") this.canvas.style.opacity = "";
    perfEnd("three.render", t0);
    const t1 = perfStart();
    this.opts.onFrame();
    perfEnd("frame.callbacks", t1);
    FRAME_CLOCK.workMs = performance.now() - w0;
    // Whoever drew this frame (the tick, a resize, a check), the transitions run to their end.
    if (this.lod.animating || this.globe.animating) this.requestRender();
  }

  private syncCamera() {
    const v = this.drawView();
    const b = viewBasis(v, this.bufH * this.pixel);
    const cam = this.camera;
    cam.fov = FOV_DEG;
    cam.aspect = this.bufW / this.bufH;
    cam.near = Math.max(0.02, b.d - 1.05);
    cam.far = b.d + 1.05;
    cam.position.set(b.c[0] * b.d, b.c[1] * b.d, b.c[2] * b.d);
    cam.up.set(b.north[0], b.north[1], b.north[2]);
    cam.lookAt(0, 0, 0);
    // Shift the projection centre left by `shiftBuf` pixels: render the window of a same-sized virtual frame
    // that starts `shiftBuf` pixels to the right.
    if (this.shiftBuf) cam.setViewOffset(this.bufW, this.bufH, this.shiftBuf, 0, this.bufW, this.bufH);
    else cam.clearViewOffset();
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    this.globe.syncCamera(b, v.zoom, this.pixel, performance.now(), this.reduced);
  }

  /* ------------------------------ diagnostics ------------------------------ */

  /** Frames drawn since creation (suspended ticks are not frames). */
  frameCount() {
    return this.frames;
  }

  /** Camera ticks since creation, drawn or suspended. */
  tickCount() {
    return this.ticks + this.frames;
  }

  /** JS time of the last `WebGLRenderer.render` call, ms. */
  lastRenderJsMs() {
    return this.lastRenderMs;
  }

  /** Blocking 1px read: forces the driver to finish all queued GPU work (measurement only). */
  gpuSync() {
    const gl = this.gl.getContext();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  }


  /** Inset state for checks: current inset and centre shift. */
  insetInfo() {
    return { inset: this.inset, target: this.insetTarget, shiftBuf: this.shiftBuf, bufW: this.bufW, pixel: this.pixel };
  }

  /** Draw-call and triangle counts of the last frame (WebGLRenderer.info). */
  renderInfo() {
    const { calls, triangles, points, lines } = this.gl.info.render;
    return { calls, triangles, points, lines, geometries: this.gl.info.memory.geometries };
  }

  /** Simulate losing and restoring the GL context (test only). */
  loseContext(lose: boolean) {
    // A lost context returns null from getExtension, so the handle is kept from the loss call.
    this.loseExt ??= this.gl.getContext().getExtension("WEBGL_lose_context");
    if (lose) this.loseExt?.loseContext();
    else this.loseExt?.restoreContext();
  }

  /* ------------------------------ teardown ------------------------------ */

  /** Frees every GL resource, the listeners and the canvas. Safe to call twice. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelFrame();
    for (const c of this.cleanups) c();
    this.cleanups = [];
    this.globe.dispose();
    this.gl.dispose();
    this.gl.forceContextLoss();
    this.canvas.remove();
  }
}
