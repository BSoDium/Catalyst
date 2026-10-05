/**
 * Standalone Three.js globe: pixelated, monochrome, on-demand rendering.
 *
 * - Pixelation: the drawing buffer is `cssSize / pixelSize` and the canvas is upscaled with
 *   `image-rendering: pixelated`. Lines are 1 buffer pixel wide, antialiasing is off.
 * - A depth-writing disc hides every line, marker and route on the far hemisphere.
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
import {
  DEG,
  FOV_DEG,
  clamp,
  fitZoom,
  normalizeLon,
  projectLonLat,
  viewBasis,
  zoomToRadiusPx,
  type ScreenPoint,
  type ViewState,
} from "./geo";
import { isRouteStop, routeForPlace } from "./geometry";
import { clampInset, fadeMask, freeWidth, insetShiftBuf, scissorBufWidth } from "./inset";
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
import { GlobeScene } from "./scene";
import { INSET_EASE, TUNING } from "./tuning";
import { zoomFrom01 } from "./view";

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
  coastlines: Polylines;
  borders: Polylines;
  theme: GlobeTheme;
  reducedMotion: boolean;
  /** CSS px covered by UI on the right edge of the container at start; the globe centres on the rest. */
  insetRight: number;
  /** Called synchronously after every drawn frame (labels and view reporting hang off it). */
  onFrame(): void;
  /** A label under the point (the labels are DOM, so the controller knows them), or null. */
  pickLabel(x: number, y: number, kind: PointerKind): string | null;
  onSelect(slug: string): void;
  /** The GL context was lost (true) or restored (false). */
  onContextChange(lost: boolean): void;
}

export interface StartView {
  lon: number;
  lat: number;
  /** In [0, 1] (`GlobeViewState` zoom); null = the select zoom. */
  zoom01: number | null;
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
  private pixel = 3;
  /** Current (animated) and target inset, CSS px; see `setInset`. */
  private inset: number;
  private insetTarget: number;
  private insetAnim: { from: number; to: number; start: number } | null = null;
  /** Projection-centre shift (buffer px) and scissor width (buffer px, null = none) derived from `inset`. */
  private shiftBuf = 0;
  private scissorBuf: number | null = null;
  private scissorOn = true;
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
  private lastRenderMs = 0;
  private loseExt: WEBGL_lose_context | null = null;
  private cleanups: (() => void)[] = [];

  private places: readonly GlobePlace[];
  private routes: readonly GlobeRoute[];
  private placeBySlug = new Map<string, GlobePlace>();
  private selected: string | null = null;
  private focused: string | null = null;
  private flight: Flight | null = null;
  private velocity: Velocity = STILL;
  private inertiaLast = 0;

  constructor(
    private opts: RendererOptions,
    start: StartView | null,
  ) {
    this.reduced = opts.reducedMotion;
    this.inset = this.insetTarget = Math.max(0, opts.insetRight);
    this.start = start;
    this.theme = opts.theme;
    this.places = opts.places;
    this.routes = opts.routes;
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
      this.view = { ...this.view, zoom: clamp(this.view.zoom, this.minZoom, TUNING.maxZoom) };
    }
    // Resizing clears the drawing buffer: repaint synchronously so there is no blank frame.
    if (redraw) this.renderNow();
  }

  /**
   * Everything that depends on the inset: the projection-centre shift, the minimum zoom (the whole globe fits
   * the free area), the GL scissor and the dissolving right edge. Cheap; called on resize and per tween frame.
   */
  private applyInset() {
    const { width: w, height: h, pixel: P } = this;
    const inset = clampInset(this.inset, w);
    this.shiftBuf = insetShiftBuf(inset, P);
    this.minZoom = fitZoom(freeWidth(w, inset), h, TUNING.fitMargin);
    this.scissorBuf = scissorBufWidth(w, inset, P, this.canvasLeft, this.bufW);
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
    const toggles = (this.insetTarget === 0) !== (next === 0);
    this.insetTarget = next;
    if (this.sized && toggles && !this.reduced) {
      this.insetAnim = { from: this.inset, to: next, start: performance.now() };
    } else {
      this.insetAnim = null;
      this.inset = next;
      if (this.sized) {
        this.applyInset();
        this.view = { ...this.view, zoom: clamp(this.view.zoom, this.minZoom, TUNING.maxZoom) };
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
    const zoom = s.zoom01 === null ? TUNING.selectZoom : zoomFrom01(s.zoom01, this.minZoom, TUNING.maxZoom);
    return { lon: s.lon, lat: s.lat, zoom };
  }

  getMinZoom() {
    return this.minZoom;
  }
  getView(): ViewState {
    return { ...this.view };
  }

  /* ------------------------------ camera API ------------------------------ */

  private clampView(v: ViewState): ViewState {
    return {
      lon: normalizeLon(v.lon),
      lat: clamp(v.lat, -TUNING.maxLat, TUNING.maxLat),
      zoom: clamp(v.zoom, this.minZoom, TUNING.maxZoom),
    };
  }

  setView(v: Partial<ViewState>) {
    this.flight = null;
    this.velocity = STILL;
    this.view = this.clampView({ ...this.view, ...v });
    this.requestRender();
  }

  /** Animated camera move; a jump under reduced motion. */
  flyTo(v: Partial<ViewState>) {
    const to = this.clampView({ ...this.view, ...v });
    if (this.reduced) {
      this.setView(to);
      return;
    }
    this.velocity = STILL;
    this.flight = createFlight(this.view, to, performance.now());
    this.requestRender();
  }

  setReducedMotion(on: boolean) {
    this.reduced = on;
    if (on) {
      if (this.flight) this.view = this.clampView(this.flight.to);
      this.flight = null;
      this.velocity = STILL;
      this.globe.routes.finishAll();
    }
    this.requestRender();
  }

  setTheme(theme: GlobeTheme) {
    this.theme = theme;
    this.gl.setClearColor(new Color(...theme.background), 1);
    this.globe.applyTheme(theme);
    this.requestRender();
  }

  /* ------------------------------ selection ------------------------------ */

  /** `animateRoute`: play the draw-on of the selected place's route (ignored under reduced motion). */
  setSelected(slug: string | null, animateRoute: boolean) {
    this.selected = slug;
    this.selectRoute(slug, animateRoute);
  }

  setFocused(slug: string | null) {
    if (slug === this.focused) return;
    this.focused = slug;
    this.refreshMarkers();
    this.requestRender();
  }

  private selectedRoute(): GlobeRoute | null {
    return routeForPlace(this.routes, this.selected ? this.placeBySlug.get(this.selected) : undefined);
  }

  private selectRoute(slug: string | null, animate: boolean) {
    const route = this.selectedRoute();
    if (this.reduced || !animate || !slug) this.globe.routes.finishAll();
    else this.globe.routes.animate(route?.id ?? null, performance.now());
    this.refreshMarkers();
    this.requestRender();
  }

  private refreshMarkers() {
    const stops = new Set<string>();
    const route = this.selectedRoute();
    if (route) for (const p of this.places) if (isRouteStop(route, p)) stops.add(p.slug);
    this.globe.markers.setStates(this.selected, this.focused, stops);
  }

  /* ------------------------------ projection / picking ------------------------------ */

  /** Container CSS px, snapped to the art pixel the marker is drawn in. */
  project(lon: number, lat: number): ScreenPoint {
    const cw = this.bufW * this.pixel;
    const ch = this.bufH * this.pixel;
    const p = projectLonLat(lon, lat, viewBasis(this.view, ch), cw, ch, MARKER_RADIUS, cw / 2 - this.shiftBuf * this.pixel);
    const P = this.pixel;
    return {
      ...p,
      x: (Math.floor(p.x / P) + 0.5) * P + this.canvasLeft,
      y: (Math.floor(p.y / P) + 0.5) * P + this.canvasTop,
    };
  }

  /** Nearest front-hemisphere marker within `radius` CSS px; ties go to the higher label priority. */
  pick(x: number, y: number, radius: number): string | null {
    let best: GlobePlace | null = null;
    let bestD = radius;
    for (const place of this.places) {
      const p = this.project(place.lon, place.lat);
      if (!p.visible) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD || (d === bestD && best && place.labelPriority > best.labelPriority)) {
        bestD = d;
        best = place;
      }
    }
    return best?.slug ?? null;
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
      pickAt: (x, y, kind) => this.pick(x, y, TUNING.pickRadius[kind]) ?? this.opts.pickLabel(x, y, kind),
      select: (slug) => this.opts.onSelect(slug),
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
    if (hidden) {
      this.cancelFrame();
      this.dirty = true;
    } else if (this.dirty) {
      this.dirty = false;
      this.requestRender();
    }
  }

  private onContextLost() {
    this.lost = true;
    this.cancelFrame();
    this.dirty = true;
    this.opts.onContextChange(true);
  }

  private onContextRestored() {
    // Three re-initialises its GL state on restore and re-uploads geometry and programs lazily on the next render.
    // That reset also drops the clear colour, so it is set again.
    this.gl.setClearColor(new Color(...this.theme.background), 1);
    this.lost = false;
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
      this.view = { ...this.view, zoom: clamp(this.view.zoom, this.minZoom, TUNING.maxZoom) };
      if (t >= 1) this.insetAnim = null;
      else more = true;
    }
    if (this.flight) {
      const s = sampleFlight(this.flight, now, this.minZoom);
      this.view = this.clampView(s.view);
      if (s.done) this.flight = null;
      else more = true;
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

  private tick = () => {
    this.raf = 0;
    if (this.disposed || this.hidden || this.lost) return;
    const more = this.advance(performance.now());
    this.renderNow();
    if (more) this.requestRender();
  };

  /** Synchronous render (also used by resize and by the measurement hooks). */
  renderNow() {
    if (this.disposed || this.lost || !this.sized) return;
    this.cancelFrame();
    this.syncCamera();
    // Draw only the free area plus a margin: the rest is under the panel and masked out.
    const scissor = this.scissorOn ? this.scissorBuf : null;
    this.gl.setScissorTest(scissor !== null);
    if (scissor !== null) this.gl.setScissor(0, 0, scissor, this.bufH);
    const t0 = performance.now();
    this.gl.render(this.globe.scene, this.camera);
    this.lastRenderMs = performance.now() - t0;
    this.frames++;
    this.opts.onFrame();
  }

  private syncCamera() {
    const b = viewBasis(this.view, this.bufH * this.pixel);
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
    this.globe.syncCamera(b, this.view.zoom, this.pixel);
  }

  /* ------------------------------ diagnostics ------------------------------ */

  /** Frames drawn since creation. */
  frameCount() {
    return this.frames;
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

  /** Measurement only: turn the inset scissor off to compare its cost. */
  setScissorEnabled(on: boolean) {
    this.scissorOn = on;
    this.requestRender();
  }

  /** Inset state for checks: current inset, centre shift and scissor width. */
  insetInfo() {
    return { inset: this.inset, target: this.insetTarget, shiftBuf: this.shiftBuf, scissorBuf: this.scissorBuf, bufW: this.bufW, pixel: this.pixel };
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
