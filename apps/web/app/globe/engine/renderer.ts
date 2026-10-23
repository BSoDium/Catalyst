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
import { ColorManagement, Color, PerspectiveCamera, Vector3, WebGLRenderer } from "three";
import type { Polylines } from "@catalyst/geodata";
import type { CoverBlock, GlobePlace, GlobeRoute } from "../types";
import { TrailDotsLayer, dotLegs } from "../paths/trail-dots-layer";
import { legFeatures } from "../paths/leg-features";
import type { GlobeTheme } from "./colors";
import { anchorZoom, unprojectOffset } from "./anchor";
import { attachControls, type ControlsHost, type PointerKind } from "./controls";
import { watchDevicePixelRatio } from "./dpr";
import { groupFitZoom, radiusFitZoom } from "./framing";
import {
  DEG,
  FOV_DEG,
  cameraDistance,
  clamp,
  fitZoom,
  focalPx,
  radiusPxToZoom,
  silhouetteRadiusPx,
  silhouetteZoom,
  normalizeLon,
  projectLonLat,
  viewBasis,
  zoomCorrection,
  zoomToRadiusPx,
  type ScreenPoint,
  type ViewBasis,
  type ViewState,
} from "./geo";
import { placeKey } from "../paths/network";
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
import { Grace } from "./grace";
import { IdleSpin, SPIN, pacedByRotation, spinBlock, spinFrameDue, type SpinContext } from "./idle-spin";
import { CINEMATIC } from "./cinematic";
import { blendPose, flightOffsetShare, flightPose } from "./flight";
import { landingScale, liftFor, placeAbove, type Placement } from "./lift";
import { routeLift } from "./view";
import { newLodCamera, setLodCamera, type LodTree } from "./lod-tree";
import { NodeScreen } from "./node-screen";
import { CaptionLayer } from "./caption-layer";
import { SHOWCASE_STATE, bandLat, inBand, shellWindowFactor, type CaptionContent } from "./caption";
import { CAP_HEIGHT_EM, ringAlpha, ringFloorZoom, ringRoomRadius, RING_STATE } from "./ring";
import { RingLayer } from "./ring-layer";
import { GlobeScene } from "./scene";
import { CAPTION, ENERGY, INSET_EASE, CAPTION_LOAD, RING, SKY, START_VIEW, TUNING } from "./tuning";
import { QualityGovernor } from "./quality";
import { FpsOverlay } from "./fps-overlay";
import { fromViewState } from "./view";
import { markerShown } from "./visibility";
import { perfEnd, perfStart } from "./perf";

// Our ShaderMaterials write raw sRGB values and there is no lighting, so skip Three's linear-sRGB conversion;
// otherwise ink and background drift away from the CSS colours.
ColorManagement.enabled = false;

const MARKER_RADIUS = 1;
/** The unified zoom from which the legs wear the picture of their mode on the globe (from far away they are lines in a tangle: a picture each would be worse). */
const LEG_ICON_FROM_ZOOM = 4.5;
/** The smallest planet radius (CSS px, at the lowest zoom) the ring's and the caption's letters are drawn for: their letters have a smallest size, under it they would be cut by the planet's edge. */
const MIN_TEXT_PLANET_PX = 60;
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
  /** True while a label is still gliding to its place (engine/label-track.ts): the frame loop keeps running until it is false, and not a frame longer. */
  labelsAnimating?(): boolean;
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
  /**
   * The line that goes round the planet in the zoomed-out regime (engine/ring.ts `ringText`). Absent or empty, or `RING_STATE.enabled` false
   * (`?no-ring`): no ring, and the lowest zoom is the whole-globe fit.
   */
  ringText?: string;
  /** The lines of the caption that floats over the planet (engine/caption.ts): each a list of words in styles; absent or empty: no caption. */
  captionPhrases?: CaptionContent;
  /** CSS px of the container's bottom that the app covers at start (`GlobeProps.coverBottom`); the planet is lifted clear of them as far as there is room. */
  coverBottom?: number;
  /** The blocks of the home screen over the globe at start (`GlobeProps.showcase`'s `blocks`). */
  coverBlocks?: readonly CoverBlock[];
  /** The home screen starts at rest: the caption is in and the boxes and labels are out from the first frame (`GlobeProps.showcase`). */
  showcase?: boolean;
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
  private view: ViewState = { lon: START_VIEW.lon, lat: START_VIEW.lat, zoom: 0 };
  private width = 1;
  private height = 1;
  private bufW = 1;
  private bufH = 1;
  private canvasLeft = 0;
  private canvasTop = 0;
  /** Lowest zoom the camera may go to: the whole-globe `fit`, or (with the ring) the zoom at which the ring fits, below it. */
  private minZoom = 1;
  /** The zoom at which the whole globe fits the free area (`TUNING.fitMargin`): the 0 of `GlobeViewState.zoom`, the world view of the idle rotation, the floor of programmatic framing. */
  private fit = 1;
  /** The ring of type, when there is one (engine/ring-layer.ts: a flat circle of text round the disc, unchanged by the showcase). */
  private ring: RingLayer | null = null;
  /** The pictures of the modes on the legs (street/overlay/trail-dots-layer.ts, lines off: the shader draws the lines): a canvas over the globe's, null without routes. */
  private legIcons: TrailDotsLayer | null = null;
  /** The caption: lines wrapped on a sphere in the globe's own scene (engine/caption-layer.ts), when the showcase is on this page. */
  private caption: CaptionLayer | null = null;
  /**
   * The showcase: the home screen is at rest, so the boxes and labels are out (`LodTree.setSuppressed`) and the caption is in. `showcaseOn` is
   * what is wanted now; `showcaseActive` whether this page has a showcase at all (a ring, and not a debug page without `?showcase`).
   */
  private showcaseOn = false;
  /** Whether the caption is wanted AND shown now (the showcase is on and the camera's latitude is in its band) and the camera's latitude glide towards the band, if any. */
  private captionOn = false;
  private latSnap: { from: number; to: number; t0: number } | null = null;
  private showcaseActive = false;
  /** The planet at the lowest zoom is big enough for the ring's and the caption's letters (they have a smallest size): when it is not, they are not drawn rather than cut. */
  private textFits = true;
  /** A press began while the showcase was on: its tap is not a click on a box nobody could see (cleared a moment after the press ends). */
  private inertPress = false;
  /** CSS px of the container's bottom the app covers (the hero), the lift it asks for now, and the animated lift (see `setCover`). */
  private cover = 0;
  /** What the home screen's content occupies over the globe (`GlobeShowcase.blocks`), and where the globe goes above it (`placeAbove`; null: no blocks given). */
  private blocks: readonly CoverBlock[] = [];
  private placement: Placement | null = null;
  private liftTarget = 0;
  /** True while `setCover` applies a new cover: the lift that follows is eased, not snapped. */
  private easeLift = false;
  private lift = 0;
  private liftAnim: { from: number; to: number; start: number } | null = null;
  /** The lift in whole buffer pixels, like `shiftBuf`. */
  private liftBuf = 0;
  private liftKey = "";
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
  /** Idle rotation of the unzoomed world view (engine/idle-spin.ts): the clock and velocity, the timer that wakes the frame loop for the idle delay, the pointers held down. */
  private spin = new IdleSpin(performance.now());
  private spinTimer = 0;
  /** Something other than the rotation's own frame chain asked for the pending frame (so it is drawn whatever `SPIN.minFrameMs` says), and when the last one was drawn. */
  private forced = false;
  private lastTickAt = 0;
  private pressed = new Set<number>();
  /**
   * The earth rotation angle (degrees, engine/sky.ts): where the sky is relative to the earth-fixed frame the view is expressed in. A camera orbit
   * leaves it alone (the stars turn with the view); the idle rotation adds to it what it takes off the view's longitude (the stars stay put on screen).
   */
  private era: number = SKY.eraDeg;

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
    this.lod = opts.lod;
    this.nodeScreen = new NodeScreen(opts.lod.size);
    for (const p of opts.places) this.placeBySlug.set(p.slug, p);

    this.gl = new WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: ENERGY.gpu,
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
    if (opts.ringText && RING_STATE.enabled) this.ring = new RingLayer(opts.container, opts.ringText, opts.theme, this.reduced);
    if (opts.routes.length > 0) {
      this.legIcons = new TrailDotsLayer(opts.container, { lines: false, iconFromZoom: LEG_ICON_FROM_ZOOM, onTop: true });
      this.legIcons.setLegs(dotLegs(legFeatures(opts.routes)));
      this.legIcons.setTrail(opts.theme.trail);
      this.legIcons.setPage(opts.theme.background);
    }
    this.showcaseActive = !!this.ring && SHOWCASE_STATE.enabled;
    this.cover = Math.max(0, opts.coverBottom ?? 0);
    this.blocks = opts.coverBlocks ?? [];
    if (this.showcaseActive && opts.captionPhrases && opts.captionPhrases.sets.length + opts.captionPhrases.fixed.length > 0) {
      try {
        this.caption = new CaptionLayer({
          content: opts.captionPhrases,
          host: opts.container,
          theme: opts.theme,
          reduced: this.reduced,
          maxAnisotropy: this.gl.capabilities.getMaxAnisotropy(),
          onChange: () => this.requestRender(),
        });
      } catch {
        // No second WebGL context: the caption is not there, and neither is the showcase (the page is the one without it: boxes and the how-to line).
        this.caption = null;
        this.showcaseActive = false;
      }
    }
    // The interlude fills the continents: their picture is made when one is planned, in an idle moment, and not in the frame that starts it.
    if (this.caption?.eggPlanned) {
      const make = () => {
        if (!this.disposed) this.globe.prepareLand();
      };
      if (typeof requestIdleCallback === "function") requestIdleCallback(make, { timeout: 4000 });
      else window.setTimeout(make, 1500);
    }
    if (opts.showcase && this.showcaseActive) {
      // The home screen opens in its showcase: the boxes are out from the first frame (nothing fades), and the caption comes in with the first frame.
      this.showcaseOn = true;
      this.lod.setSuppressed(true, true);
      this.captionOn = true;
      this.caption?.show(null);
    }
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
    try {
      if (new URLSearchParams(location.search).has("caption-fps")) {
        this.overlay = new FpsOverlay(opts.container, () => ({ period: this.governor.period, lateShare: this.governor.lateShare, rung: { level: this.governor.level, ...this.governor.rung }, held: this.held }));
        this.cleanups.push(() => this.overlay?.dispose());
      }
    } catch {
      // no location: no overlay
    }
    // The energy pass: what makes the resting home screen stand still (docs/performance.md, "Energy").
    this.listen(window, "blur", () => this.blurGrace.start());
    this.listen(window, "focus", () => this.blurGrace.cancel());
    this.cleanups.push(() => this.blurGrace.dispose());
    if (typeof IntersectionObserver !== "undefined") {
      const io = new IntersectionObserver((entries) => {
        const last = entries[entries.length - 1];
        if (last) this.setOffscreen(!last.isIntersecting);
      });
      io.observe(opts.container);
      this.cleanups.push(() => io.disconnect());
    }
    this.cleanups.push(() => window.clearTimeout(this.freezeTimer));
    this.cleanups.push(() => window.clearTimeout(this.paceTimer));
    this.cleanups.push(() => window.clearTimeout(this.parkTimer));
    this.armFreeze();
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
    this.fit = fitZoom(freeWidth(w, inset), h, TUNING.fitMargin);
    const lowest = this.lowestFor(inset);
    this.placement = lowest.placement;
    this.minZoom = lowest.zoom;
    this.textFits = silhouetteRadiusPx(this.minZoom, h) >= MIN_TEXT_PLANET_PX;
    this.containerMask = fadeMask(w, inset);
    this.ring?.setMask(this.containerMask);
    this.layoutRing();
    // The lift follows the viewport and the lowest zoom: a change of those applies at once, but a change of the cover (the home screen coming or
    // going: `setCover` moves the lowest zoom with it) is eased like the inset, so the planet glides into its place instead of jumping.
    const key = `${w}x${h}@${this.minZoom.toFixed(4)}`;
    if (key !== this.liftKey) {
      this.liftKey = key;
      this.retargetLift(this.easeLift);
    }
    this.liftBuf = Math.round(this.lift / P);
    const mask = fadeMask(w, inset, this.canvasLeft) ?? "";
    this.canvas.style.maskImage = mask;
    this.canvas.style.setProperty("-webkit-mask-image", mask);
  }

  /** The number of times the line goes round follows the viewport and the panel's SETTLED inset (not the animated one: the text must not reflow while the panel slides). */
  private ringLayoutKey = "";
  private layoutRing() {
    if (!this.ring) return;
    const { width: w, height: h } = this;
    // (the art cell is part of it: a device-pixel-ratio change moves the cell and so which face reads, and a bitmap pixel's size)
    const key = `${w}x${h}@${this.insetTarget}x${this.pixel}@${this.blocks.map((b) => `${Math.round(b.x0)},${Math.round(b.x1)},${Math.round(b.top)}`).join(";")}`;
    if (key === this.ringLayoutKey) return;
    this.ringLayoutKey = key;
    const { zoom: floor } = this.lowestFor(clampInset(this.insetTarget, w));
    this.ring.setLayout(silhouetteRadiusPx(floor, h));
    this.caption?.setSizing(this.pixel, silhouetteRadiusPx(floor, h), cameraDistance(floor, this.bufH * this.pixel));
  }

  /**
   * The lowest zoom (where the home screen rests) for an inset, and where the globe goes above the home screen's content then (`placeAbove`): the
   * biggest planet whose caption clears the blocks the app reported, with the ring's top inside the window. Without blocks (a page that gave none) it
   * is the ring's floor, as it was; without a ring, the whole-globe fit.
   */
  private lowestFor(inset: number): { zoom: number; placement: Placement | null } {
    const { width: w, height: h } = this;
    const free = freeWidth(w, inset);
    const fit = fitZoom(free, h, TUNING.fitMargin);
    if (!this.ring) return { zoom: fit, placement: null };
    const floor = Math.min(fit, ringFloorZoom({ fit, freeWidth: free, height: h }));
    if (!this.showcaseActive || this.blocks.length === 0) return { zoom: floor, placement: null };
    const t = RING.type.targetEmPx;
    const extra = CAP_HEIGHT_EM * t * (1 + RING.type.emSlack) + t;
    const placement = placeAbove({ height: h, cx: free / 2, blocks: this.blocks, rMax: Math.max(silhouetteRadiusPx(floor, h), ringRoomRadius({ freeWidth: free, height: h })) * landingScale(w), reachTop: (r) => r * (1 + RING.gap) + extra });
    return { zoom: placement ? silhouetteZoom(placement.r, h) : floor, placement };
  }

  /**
   * How far the planet's centre should be lifted for the cover now (engine/lift.ts): the planet at the lowest zoom (where the home screen
   * rests) clear of the cover as far as the room above allows, the ring's top included (the flat ring's outer edge, as `ringFloorZoom` has it).
   */
  private liftWanted(): number {
    // The lift belongs to the showcase: on a page without it (`?no-ring`, a debug page) the page is the one of before it.
    if (!this.showcaseActive || this.width < 1 || this.height < 1) return 0;
    if (this.placement) return this.placement.lift;
    if (this.cover <= 0) return 0;
    const h = this.height;
    const rPx = silhouetteRadiusPx(this.minZoom, h);
    const t = RING.type.targetEmPx;
    const ringTop = rPx * (1 + RING.gap) + CAP_HEIGHT_EM * t * (1 + RING.type.emSlack) + t;
    return liftFor({ cover: this.cover, height: h, planetPx: rPx, reachTopPx: Math.max(rPx, ringTop) });
  }

  private retargetLift(animate: boolean) {
    const next = this.liftWanted();
    if (next === this.liftTarget) return;
    this.liftTarget = next;
    if (animate && this.sized && !this.reduced && Math.abs(next - this.lift) > 0.5) {
      this.liftAnim = { from: this.lift, to: next, start: performance.now() };
    } else {
      this.liftAnim = null;
      this.lift = next;
      this.liftBuf = Math.round(this.lift / this.pixel);
    }
    this.requestRender();
  }

  /**
   * UI covers the bottom `px` CSS px of the container (the landing hero at rest): the planet's centre goes up by what clears it, as far as the room
   * above allows (`liftFor`), eased like the inset (zero <-> non-zero), and back down when it goes. Reduced motion: at once.
   */
  setCover(px: number, blocks?: readonly CoverBlock[]) {
    const next = Math.max(0, Number.isFinite(px) ? px : 0);
    const nextBlocks = blocks ?? [];
    const same = nextBlocks.length === this.blocks.length && nextBlocks.every((b, i) => b.x0 === this.blocks[i]!.x0 && b.x1 === this.blocks[i]!.x1 && b.top === this.blocks[i]!.top);
    if (next === this.cover && same) return;
    const prevBlocks = this.blocks;
    this.cover = next;
    this.blocks = nextBlocks;
    this.noteChange();
    if (this.sized && this.showcaseActive) {
      // The lowest zoom keeps the planet and the ring above the cover (`ringFloorZoom`): a new cover moves it, and a view resting at it moves with it.
      // When the cover goes away (the home screen gives way to the globe) the planet keeps its size and only glides to its new place: the lowest
      // zoom is lower then, and snapping the view to it made the planet shrink and jump while the boxes faded in (owner, 2026-10-21).
      const atFloor = Math.abs(this.view.zoom - this.minZoom) < 1e-6;
      const leaving = nextBlocks.length === 0 && prevBlocks.length > 0;
      this.easeLift = !this.reduced;
      this.applyInset();
      this.easeLift = false;
      this.view = { ...this.view, zoom: atFloor && !leaving ? this.minZoom : clamp(this.view.zoom, this.minZoom, this.maxZoomAt(this.view.lat)) };
    }
    this.retargetLift(true);
  }

  /**
   * UI covers `px` CSS px of the container's right edge (the detail panel): centre the globe on the free area.
   * Appearing or disappearing (zero <-> non-zero) is eased like the panel's slide; any other change (a viewport
   * resize) and reduced motion apply at once.
   */
  setInset(px: number) {
    const next = Math.max(0, px);
    if (next === this.insetTarget) return;
    this.noteChange();
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
    // The home screen opens fully zoomed OUT (the lowest zoom: the fit when there is no ring): the ring and the caption are there from the first frame.
    // The world view is the whole-globe fit on a page without the showcase, as before it.
    // (a showcase at the start holds the latitude inside the caption's band: the caption is there from the first frame, nothing glides)
    if (!s) return { lon: START_VIEW.lon, lat: START_VIEW.lat, zoom: this.showcaseActive ? this.minZoom : this.fit };
    if (s.fitRadiusKm !== undefined) return { lon: s.lon, lat: s.lat, zoom: Math.max(this.fit, this.fitZoomFor(s.fitRadiusKm)) };
    if (s.zoom01 === null) return { lon: s.lon, lat: s.lat, zoom: TUNING.selectZoom };
    const v = fromViewState({ lon: s.lon, lat: s.lat, zoom: s.zoom01, street: s.street }, this.fit, TUNING.maxZoom);
    return this.showcaseOn ? { ...v, lat: bandLat(v.lat) } : v;
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

  /** The lowest zoom the camera may go to (below `getFitZoom()` by the ring's room when the ring is on). */
  getMinZoom() {
    return this.minZoom;
  }
  /** The whole-globe fit: the 0 of `GlobeViewState.zoom` (the zoomed-out regime of the ring below it reports 0 too). */
  getFitZoom() {
    return this.fit;
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
    this.noteChange();
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
    this.caption?.setPaused(this.hidden || this.lost || this.suspended);
    // Nothing of the caption may keep the frame loop alive while the street map owns the view: its timed things run to their end now.
    if (on) this.caption?.settle();
    this.noteActivity();
    // A suspended canvas keeps its last frame, which is stale as soon as the camera moves: it must not show through the
    // street map's dissolving edge (the inset fade) or anywhere else. Made transparent here (NOT `visibility: hidden`: the
    // canvas is the pointer target at every scale and a hidden element gets no pointer events), shown again by the next drawn
    // frame (renderNow), never before: a canvas that never drew is black.
    if (on) {
      this.canvas.style.opacity = "0";
      this.caption?.hideCrisp();
    } else this.requestRender();
  }
  isSuspended() {
    return this.suspended;
  }

  /** The view the Three.js scene is drawn with: the globe cannot go closer than its own maximum. */
  private drawView(): ViewState {
    // (the cinematic interlude pulls the globe back for a while: below the page's floor, for the picture only)
    const back = this.caption?.zoomOutLevels() ?? 0;
    // (and it leans the planet, the words and the stars together, as the studio's globe does: the same eased value, `CaptionLayer.rollRad`)
    const roll = this.caption?.rollRad() ?? 0;
    const zoom = Math.min(this.view.zoom, TUNING.maxZoom) - back;
    return zoom === this.view.zoom && roll === 0 ? this.view : { ...this.view, zoom, ...(roll !== 0 ? { roll } : {}) };
  }

  setView(v: Partial<ViewState>) {
    this.noteActivity();
    this.flight = null;
    this.latSnap = null;
    this.velocity = STILL;
    this.view = this.clampView({ ...this.view, ...v });
    this.requestRender();
  }

  /** Animated camera move; a jump under reduced motion. */
  flyTo(v: Partial<ViewState>, o?: FlyOptions) {
    this.noteChange();
    const beyond = o?.beyondLimit === true;
    const to = this.clampView({ ...this.view, ...v }, beyond);
    this.latSnap = null;
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
    this.ring?.setReduced(on);
    this.caption?.setReduced(on);
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
    this.ring?.setTheme(theme);
    this.caption?.setTheme(theme);
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
    this.noteChange();
    this.selIdx = this.lod.indexOf(slug);
    this.selectRoute(slug, animateRoute);
  }

  setFocused(slug: string | null) {
    if (slug === this.focused) return;
    this.focused = slug;
    this.noteChange();
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

  /**
   * The selected place's legs (the ones that arrive at it and leave it, on every route through it) go to full ink with the draw-on;
   * every other leg stays faint (engine/route-layer.ts). The same call serves the first selection and a change of it: the geometry is
   * never rebuilt, only the state of the legs.
   */
  private selectRoute(slug: string | null, animate: boolean) {
    const place = slug ? this.placeBySlug.get(slug) : undefined;
    this.globe.routes.select(place ? placeKey(place.lat, place.lon) : null, animate && !this.reduced && !!slug, performance.now());
    this.refreshMarkers();
    this.requestRender();
  }

  /** The places at the far ends of the lit legs are drawn at any zoom, so a lit leg never runs between missing markers. */
  private refreshMarkers() {
    const stops = new Set<string>();
    const net = this.globe.routes.network;
    for (const id of this.globe.routes.litLegs()) {
      const leg = net.legs[id]!;
      for (const key of [leg.fromKey, leg.toKey]) {
        const slug = this.placeByKey().get(key);
        if (slug) stops.add(slug);
      }
    }
    this.lod.setExtraForced([...stops].map((slug) => this.lod.indexOf(slug)));
  }

  private keyIndex: Map<string, string> | null = null;
  private placeByKey(): Map<string, string> {
    if (!this.keyIndex) {
      this.keyIndex = new Map();
      for (const p of this.places) this.keyIndex.set(placeKey(p.lat, p.lon), p.slug);
    }
    return this.keyIndex;
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
    const centreY = ch / 2 - this.liftBuf * P;
    const p = projectLonLat(lon, lat, basis, cw, ch, MARKER_RADIUS, centreX, centreY);
    const shown = markerShown(p, basis, centreX, centreY, TUNING.markerLimbClearance * P);
    return { col: Math.floor(p.x / P), row: Math.floor(p.y / P), shown, facing: p.facing };
  }

  /** Where the globe model puts a place for the CURRENT view (not capped at the globe's maximum zoom, not snapped), container CSS px. */
  projectExact(lon: number, lat: number): { x: number; y: number } {
    const P = this.pixel;
    const cw = this.bufW * P;
    const ch = this.bufH * P;
    const p = projectLonLat(lon, lat, viewBasis(this.view, ch), cw, ch, MARKER_RADIUS, cw / 2 - this.shiftBuf * P, ch / 2 - this.liftBuf * P);
    return { x: p.x + this.canvasLeft, y: p.y + this.canvasTop };
  }

  /** The surface point under a container CSS-px point for the CURRENT view (the inverse of `projectExact`; clamped to the limb when off the disc): measurement of the anchored zoom. */
  unprojectExact(x: number, y: number): { lon: number; lat: number; onDisc: boolean } {
    const P = this.pixel;
    const cw = this.bufW * P;
    const ch = this.bufH * P;
    return unprojectOffset(this.view, ch, { u: x - this.canvasLeft - (cw / 2 - this.shiftBuf * P), v: ch / 2 - this.liftBuf * P - (y - this.canvasTop) });
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
    setLodCamera(this.lodCam, this.view, { width: cw, height: ch, centreX: cw / 2 - this.shiftBuf * P, centreY: ch / 2 - this.liftBuf * P }, freeWidth(cw, this.inset), P);
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
    // the paths come and go with the boxes and labels: the same timed value, in the same frame
    this.globe.routes.setPresence(lod.overlayAlpha);
    const P = this.pixel;
    const screen = this.nodeScreen;
    let boxes = 0;
    for (let k = 0; k < lod.count; k++) {
      const i = lod.visible[k]!;
      const r = snapBox(lod.drawX0[i]!, lod.drawY0[i]!, lod.drawX1[i]!, lod.drawY1[i]!, P);
      screen.bx0[i] = r.c0 * P + this.canvasLeft;
      screen.by0[i] = r.r0 * P + this.canvasTop;
      screen.bx1[i] = r.c1 * P + this.canvasLeft;
      screen.by1[i] = r.r1 * P + this.canvasTop;
      // the box as projected, for the labels (they move smoothly; the drawn box steps by cells)
      screen.fx0[i] = lod.drawX0[i]! + this.canvasLeft;
      screen.fy0[i] = lod.drawY0[i]! + this.canvasTop;
      screen.fx1[i] = lod.drawX1[i]! + this.canvasLeft;
      screen.fy1[i] = lod.drawY1[i]! + this.canvasTop;
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

  /** Ids of the routes with a lit leg now: only those through the selected place (checks). */
  routesShown(): string[] {
    return this.globe.routes.shown();
  }

  /** The "Paths" layer: every leg of every route (the lit ones included) is drawn or not. */
  setPathsVisible(on: boolean) {
    this.globe.routes.setEnabled(on);
    this.requestRender();
  }

  /** Buffer sizes, level and counts of the paths layer (measurement). */
  pathStats() {
    return this.globe.routes.stats();
  }

  /** The globe layers' timed state (checks): the borders' fade value now and whether it is going to / at the on state. */
  layerState() {
    return { borders: this.globe.borderState(), animating: this.globe.animating };
  }

  /** Run the borders' fade to its end (checks). */
  settleBorders() {
    this.globe.settleBorders();
  }

  /** The sky (checks): the earth rotation angle, its timed on/off value and whether it is drawn; null when switched off. */
  skyState() {
    const s = this.globe.sky?.state();
    return s ? { era: this.era, ...s } : null;
  }

  /** Set the earth rotation angle (checks): moves the sky relative to the earth. */
  setSkyEra(deg: number) {
    this.era = normalizeLon(deg);
    this.requestRender();
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
      zoomAt: (d, x, y) => this.zoomAt(d, x, y),
      fling: (samples, now) => this.fling(samples, now),
      pickAt: (x, y, kind) => {
        if (this.inertPress || this.showcaseOn) return null;
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

  /**
   * Zoom by `dLog2` levels with the point of the surface under the container-relative CSS-px point (x, y) held under it (engine/anchor.ts): the cursor's, or
   * the midpoint of a pinch. The projection centre is the one the drawing uses (the inset's and the lift's shifts included), in the unified zoom that goes on
   * past the globe into the street map, so the same step anchors at every scale and the street map, which only follows the camera, is anchored with it. When
   * the centre cannot follow (past the poles), or the zoom cannot change, only the zoom does.
   */
  private zoomAt(dLog2: number, x: number, y: number) {
    this.noteActivity();
    const zoom = this.clampView({ ...this.view, zoom: this.view.zoom + dLog2 }).zoom;
    if (zoom === this.view.zoom) {
      // At a limit: still an input (the idle rotation stops, a flight ends), nothing moves.
      this.setView({});
      return;
    }
    const P = this.pixel;
    const cw = this.bufW * P;
    const ch = this.bufH * P;
    const offset = { u: x - this.canvasLeft - (cw / 2 - this.shiftBuf * P), v: ch / 2 - this.liftBuf * P - (y - this.canvasTop) };
    const next = anchorZoom(this.view, zoom, ch, offset);
    this.setView(next ? { lon: next.lon, lat: next.lat, zoom } : { zoom });
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
    this.forced = true;
    if (this.hidden || this.lost) {
      this.dirty = true;
      return;
    }
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  /**
   * Another frame is wanted by a running animation. While the globe turns and the camera itself is not under way (a flight, inertia or the inset slide),
   * that animation is the boxes' own transitions that the turn causes (limb crossings), and its frames are paced like the turn's: not faster than `SPIN.minFrameMs`.
   */
  private keepGoing(cameraMoving: boolean) {
    if (!cameraMoving && pacedByRotation({ spinning: this.spin.spinning, forced: false, captionAnimating: this.caption?.animating ?? false })) this.chainSpin();
    else this.requestRender();
  }

  /** Keep the idle rotation's frame chain going: the next frame is not forced (`requestRender` would), so `SPIN.minFrameMs` can skip it. */
  private chainSpin() {
    if (this.disposed || this.hidden || this.lost || this.raf) return;
    this.raf = requestAnimationFrame(this.tick);
  }

  private cancelFrame() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private setHidden(hidden: boolean) {
    this.hidden = hidden;
    this.governor.reset(performance.now());
    this.capLastRaf = 0;
    this.caption?.setPaused(this.hidden || this.lost || this.suspended);
    this.noteActivity();
    if (hidden) {
      if (this.capRaf) window.clearTimeout(this.capRaf);
      this.capRaf = 0;
      window.clearTimeout(this.spinTimer);
      this.spinTimer = 0;
      this.cancelFrame();
      this.dirty = true;
    } else if (this.dirty) {
      this.dirty = false;
      this.requestRender();
    } else this.armCaption();
  }

  private onContextLost() {
    this.lost = true;
    this.caption?.setPaused(true);
    // (the second canvas must not sit over the context-lost notice with its last frame)
    this.caption?.hideCrisp();
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
    this.caption?.setPaused(this.hidden || this.suspended);
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
    if (this.liftAnim) {
      const a = this.liftAnim;
      const t = clamp((now - a.start) / TUNING.insetMs, 0, 1);
      this.lift = t >= 1 ? a.to : a.from + (a.to - a.from) * easeInset(t);
      this.liftBuf = Math.round(this.lift / this.pixel);
      if (t >= 1) this.liftAnim = null;
      else more = true;
    }
    if (this.flight) {
      const dt = now - this.flightLast;
      this.flightLast = now;
      const s = sampleFlight(this.flight, now, this.fit);
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
    if (this.latSnap) {
      const a = this.latSnap;
      const t = clamp((now - a.t0) / CAPTION.band.snapMs, 0, 1);
      const e = 1 - (1 - t) ** 3;
      this.view = this.clampView({ ...this.view, lat: a.from + (a.to - a.from) * e });
      if (t >= 1) this.latSnap = null;
      else more = true;
    }
    if (this.overlayHeld) {
      // (the globe is still on its way home from the interlude: the boxes begin to fade in when it has arrived, and not before)
      if (this.caption?.pulledBack) more = true;
      else {
        this.overlayHeld = false;
        this.lod.setSuppressed(false);
        more = true;
      }
    }
    if (this.showcaseOn) this.guardCaption(now);
    if (this.latSnap) more = true;
    if (this.globe.routes.advance(now)) more = true;
    return more;
  }

  /* ------------------------------ idle rotation ------------------------------ */

  /** One object, refilled on each call: the pointer events that ask must not allocate. */
  private spinCtx: SpinContext = { reduced: false, hidden: false, lost: false, suspended: false, selected: false, focused: false, inset: 0, zoom: 0, minZoom: 0, busy: false };
  private spinContext(): SpinContext {
    const c = this.spinCtx;
    c.reduced = this.reduced || this.held;
    c.hidden = this.hidden;
    c.lost = this.lost;
    c.suspended = this.suspended;
    c.selected = this.selected !== null;
    c.focused = this.focused !== null;
    c.inset = this.insetTarget;
    c.zoom = this.view.zoom;
    c.minZoom = this.fit; // the world view is the whole-globe fit; the ring's regime below it is part of it
    c.busy = this.flight !== null || !isStill(this.velocity) || this.insetAnim !== null || this.liftAnim !== null || this.pressed.size > 0;
    return c;
  }

  /** The idle rotation is turning the globe now (a plain read: asked every camera frame, so it builds nothing, unlike `spinInfo`). */
  get spinning(): boolean {
    return this.spin.spinning;
  }

  /** Why the globe is not turning (checks), or null while it is allowed to. */
  spinInfo() {
    return { spinning: this.spin.spinning, phase: this.spin.phase, speed: this.spin.speed, blockedBy: spinBlock(this.spinContext()), timerArmed: this.spinTimer !== 0 };
  }

  /** An input, or a change that cannot let it go on (hidden, context lost, reduced motion, street): the globe stops turning now, with no coasting, and the idle clock restarts. */
  private noteActivity() {
    this.spin.activity(performance.now());
    this.armSpin();
    if (this.parkTimer) {
      // the settle was under way: the rows go back to the roll from where they are
      window.clearTimeout(this.parkTimer);
      this.parkTimer = 0;
      this.caption?.unpark(performance.now());
      this.armCaption();
    }
    if (this.idleFrozen) {
      this.idleFrozen = false;
      this.applyHold();
    }
    this.armFreeze();
  }

  /* ------------------------------ the energy pass's hold ------------------------------ */

  private idleFrozen = false;
  private blurred = false;
  /** A window that lost focus is held only after `ENERGY.blurGraceMs` of it (engine/grace.ts). */
  private blurGrace = new Grace(ENERGY.blurGraceMs, (on) => this.setBlurred(on));
  private offscreen = false;
  private freezeTimer = 0;
  private paceTimer = 0;

  /** Whether everything that moves at rest (the roll, the ring's turn, the idle rotation) stands still now. */
  private get held(): boolean {
    const saveData = ENERGY.holdOnSaveData && typeof navigator !== "undefined" && (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
    return this.idleFrozen || (ENERGY.holdWhenBlurred && this.blurred) || (ENERGY.holdWhenOffscreen && this.offscreen) || saveData;
  }

  /** `ENERGY.idleFreezeMs` without an input: the hold begins. Re-armed by every input. */
  private armFreeze() {
    window.clearTimeout(this.freezeTimer);
    this.freezeTimer = 0;
    if (!(ENERGY.idleFreezeMs > 0) || this.disposed) return;
    this.freezeTimer = window.setTimeout(this.freezeWhenIdle, ENERGY.idleFreezeMs);
  }

  /** The idle period has run out: hold, unless the cinematic interlude is under way (it is 21 s long and may begin late: it is not idle, the hold waits for its end). */
  private freezeWhenIdle = () => {
    this.freezeTimer = 0;
    if (this.caption?.interluding) {
      this.freezeTimer = window.setTimeout(this.freezeWhenIdle, 1000);
      return;
    }
    this.settleThenHold();
  };

  /**
   * The idle budget is spent: the rows ease to the middle of the globe, fully visible (`CAPTION.park`), and only then does everything stop; a
   * caption that is not rolling (hidden, the showcase off) is held at once. An input meanwhile cancels the settle and the rows go back to the roll.
   */
  private settleThenHold() {
    const now = performance.now();
    if (this.caption?.park(now)) {
      this.parkTimer = window.setTimeout(() => {
        this.parkTimer = 0;
        this.idleFrozen = true;
        this.applyHold();
      }, CAPTION.park.parkMs + 150);
      this.armCaption();
    } else {
      this.idleFrozen = true;
      this.applyHold();
    }
  }
  private parkTimer = 0;

  private setBlurred(on: boolean) {
    if (on === this.blurred) return;
    this.blurred = on;
    // (a window that lost focus has throttled frames: not an overload; when it is back the window starts again)
    this.governor.reset(performance.now());
    this.capLastRaf = 0;
    this.applyHold();
  }

  private setOffscreen(on: boolean) {
    if (on === this.offscreen) return;
    this.offscreen = on;
    this.applyHold();
  }

  /** Hand the hold to the caption, the ring and the idle rotation (a frame is asked for when they may go on). */
  private applyHold() {
    const h = this.held;
    this.caption?.setFrozen(h);
    this.ring?.setFrozen(h);
    if (h) {
      this.spin.settle(performance.now());
      if (this.capRaf) window.clearTimeout(this.capRaf);
      this.capRaf = 0;
    } else {
      this.caption?.unpark(performance.now());
      this.governor.reset(performance.now());
      this.capLastRaf = 0;
      this.armSpin();
      this.armCaption();
      this.requestRender();
    }
  }

  /** A change that is not an input (a place selected or focused from the URL or the list, the inset, a flight, the zoom limit): the idle clock restarts and a turning globe coasts to rest. */
  private noteChange() {
    this.spin.settle(performance.now());
    this.armSpin();
  }

  private onInput = (e: Event) => {
    // A gesture ON the globe (the hero's own definition: a press or a wheel over the stage) ends the showcase at once: the boxes come back and the
    // press that began it is no click (nobody could see what was under it).
    if ((e.type === "pointerdown" || e.type === "wheel") && this.showcaseOn && e.target instanceof Node && this.opts.container.contains(e.target)) {
      this.inertPress = e.type === "pointerdown";
      this.dropShowcase();
    }
    if (e.type === "pointerup" || e.type === "pointercancel") {
      if (this.inertPress) window.setTimeout(() => (this.inertPress = false), 0);
    }
    if (e instanceof PointerEvent) {
      if (e.type === "pointerdown") this.pressed.add(e.pointerId);
      else if (e.type === "pointerup" || e.type === "pointercancel" || (e.pointerType === "mouse" && e.buttons === 0)) this.pressed.delete(e.pointerId);
    }
    this.noteActivity();
  };

  /**
   * While idle, wake the frame loop when the idle delay is over: a timer, not a frame, so a page at rest stays at zero frames. While
   * turning there is no timer: the frame chain itself (`tick`) carries on, one frame per display refresh.
   */
  private armSpin() {
    if (this.disposed || this.spin.spinning || this.spinTimer) return; // the pending timer looks again when it fires
    const wait = this.spin.wait(performance.now(), this.spinContext());
    if (wait !== null) this.spinTimer = window.setTimeout(this.onSpinTimer, wait);
  }

  private onSpinTimer = () => {
    this.spinTimer = 0;
    if (this.disposed) return;
    const wait = this.spin.wait(performance.now(), this.spinContext());
    if (wait === null) return;
    if (wait > 0) {
      this.spinTimer = window.setTimeout(this.onSpinTimer, wait);
      return;
    }
    this.requestRender(); // the tick starts the turn (`stepSpin`) and keeps the frame chain going
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
    if (yaw !== 0) {
      // The earth turns under a camera that stays where it is: the view's longitude goes down by what the earth's rotation angle goes up by,
      // so the camera's longitude in the inertial frame (view + era) and with it every star on the screen does not change.
      if (this.flight) {
        // A flight owns the view's position (it is sampled from its endpoints each frame): the coasting turns its start instead, so the camera keeps
        // coasting at first, the flight takes over as it proceeds, and it lands exactly on its target.
        this.flight = { ...this.flight, from: { ...this.flight.from, lon: this.flight.from.lon - yaw } };
      } else {
        this.view = { ...this.view, lon: normalizeLon(this.view.lon - yaw) };
      }
      this.era = normalizeLon(this.era + yaw);
    }
  }

  private tick = () => {
    this.raf = 0;
    if (this.disposed || this.hidden || this.lost) return;
    const now = performance.now();
    // The rotation's own frame chain follows the display (a frame per refresh) but not faster than `SPIN.minFrameMs`: a frame that nothing else asked for is skipped when it is too soon.
    if (pacedByRotation({ spinning: this.spin.spinning, forced: this.forced, captionAnimating: this.caption?.animating ?? false }) && !spinFrameDue(now, this.lastTickAt, { ...SPIN, minFrameMs: Math.max(SPIN.minFrameMs, ENERGY.spinFrameMs) })) {
      // (paced by a timer: no wake at the display's rate for a frame that is not due)
      if (!this.paceTimer) {
        const wait = Math.max(4, Math.max(SPIN.minFrameMs, ENERGY.spinFrameMs) - (now - this.lastTickAt));
        this.paceTimer = window.setTimeout(() => {
          this.paceTimer = 0;
          this.chainSpin();
        }, wait);
      }
      return;
    }
    this.forced = false;
    this.lastTickAt = now;
    const flying = this.flight !== null;
    const moving = this.advance(now);
    const fading = !this.suspended && (this.caption?.animating ?? false);
    if (moving) this.spin.settle(now); // a flight, inertia or the inset slide is camera motion: not idle (a turning globe coasts to rest)
    // The flight has just landed exactly on its target: whatever is left of the coasting is dropped, so the camera stays on it.
    if (flying && this.flight === null) this.spin.activity(now);
    this.stepSpin(now);
    this.renderNow();
    // A timed transition of the boxes or of the borders (engine/fade.ts) that has not reached its end keeps the loop going, camera or not.
    // While the street map owns the view the globe draws nothing and its transitions are not advanced here (the street engine runs the
    // boxes' own), so they must not keep this loop spinning.
    const more = moving || fading || (!this.suspended && (this.lod.animating || this.globe.animating || !!this.opts.labelsAnimating?.()));
    if (more) this.keepGoing(moving);
    else if (this.spin.spinning) this.chainSpin();
    else this.armSpin();
  };

  /**
   * The crisp caption (a canvas of its own over the globe's, same camera): drawn into a window round the planet only (the lines never leave the
   * shell's disc), by the same camera narrowed to that window (`setViewOffset` composed with the lift and the inset's shift). Nothing in pixel mode.
   */
  /**
   * The caption's own frame loop, for the steady roll only (`CaptionLayer.drifting`): at most one frame every `CAPTION.drift.frameMs` (30 a second,
   * like the ring's own clock), and a frame that draws NOTHING but the caption (the globe's canvas keeps its last frame, no labels, no tree): the
   * camera has not moved or a full frame would have been asked for. It stands down for a full frame that is pending (that one draws the caption
   * too) and stops entirely while the tab is hidden, the context is lost, the street map owns the view or nothing is drawn.
   */
  private capRaf = 0;
  private governor = new QualityGovernor();
  private capFrames = 0;
  /** JS ms spent in the caption's own frames (checks). */
  private capMs = 0;
  private lastBasis: { d: number; lon: number; lat: number; cam?: { lon: number; lat: number } } | null = null;

  private armCaption() {
    const c = this.caption;
    if (!c || this.capRaf || this.disposed || this.hidden || this.lost || this.suspended || !this.lastBasis) return;
    if (!c.drifting) return;
    // The caption moves: it is drawn on EVERY display frame (rAF, positions a function of the frame's own timestamp), never on a timer: a timer's
    // period against the display's vsync gives uneven frame intervals, which at a slow roll is visible judder.
    this.capRaf = requestAnimationFrame(this.captionTick);
  }

  /** Whether the caption was drawn by a full frame in this very display frame (the loop does not draw it twice). */
  private capDrawnAny = 0;
  private capLastRaf = 0;
  /** The `?caption-fps` overlay (debug): null without the flag. */
  private overlay: FpsOverlay | null = null;
  private capSkip = 0;
  /** Checks and measurements: every drawn caption frame as [timestamp, delta, draw JS ms] (null: not recording). */
  private capTrace: [number, number, number][] | null = null;

  /** Start (`true`), or stop and take (`false`), the recording of the caption's drawn frames. */
  traceCaption(on: boolean): [number, number, number][] {
    if (on) {
      this.capTrace = [];
      return [];
    }
    const out = this.capTrace ?? [];
    this.capTrace = null;
    return out;
  }

  private captionTick = (ts: number) => {
    this.capRaf = 0;
    const c = this.caption;
    if (!c || this.disposed || this.hidden || this.lost || this.suspended || !this.sized || !c.drifting) {
      this.capLastRaf = 0;
      return;
    }
    const rung = this.governor.rung;
    const since = this.capLastRaf > 0 ? ts - this.capLastRaf : 0;
    this.capLastRaf = ts;
    // every `skip`th display frame at the last rung of the ladder (exactly 30 a second at 60 Hz, aligned to the display)
    const due = ++this.capSkip >= rung.skip;
    if (due && ts - this.capDrawnAny > 3) {
      this.capSkip = 0;
      const t0 = performance.now();
      const b = this.lastBasis!;
      c.sync(b.d, b.lon, b.lat, ts, b.cam);
      this.renderCrispCaption();
      this.capFrames++;
      const js = performance.now() - t0;
      this.capMs += js;
      this.overlay?.frame(ts, since, js);
      if (this.capTrace) {
        this.capTrace.push([ts, since, js]);
        if (this.capTrace.length > 4000) this.capTrace.shift();
      }
      // the quality governor: a real overload (many late frames) steps the caption down a rung, a calm stretch back up; never from jitter, never from a stall
      if (CAPTION_LOAD.enabled && ENERGY.qualityEnabled && !this.blurred && !document.hidden) {
        const next = this.governor.sample(ts, since > 0 ? since : 0, js);
        if (next !== null) this.applyLoadRung();
      }
    } else if (due) this.capSkip = 0;
    this.armCaption();
  };

  /** Hand the governor's rung to the caption's canvas and strips. */
  private applyLoadRung() {
    const r = this.governor.rung;
    this.caption?.setQuality(r.dpr, r.slices);
    this.qualityChanges++;
  }
  private qualityChanges = 0;

  /** Checks and measurements: hold the caption on a rung of the quality ladder (null: the governor decides again). */
  holdLoadRung(level: number | null) {
    if (level === null) {
      this.governor.reset(performance.now());
      return;
    }
    this.governor.level = Math.max(0, Math.min(CAPTION_LOAD.ladder.length - 1, level));
    this.applyLoadRung();
  }

  private captionRect = { w: 0, h: 0, left: 0, top: 0, mask: "", full: { w: 0, h: 0 }, at: { x: 0, y: 0 } };
  private renderCrispCaption() {
    const caption = this.caption;
    if (!caption) return;
    // Hidden, or nothing in view: no window, no view offset, no projection update (the canvas is hidden once and left alone).
    if (!caption.visible) {
      caption.hideCrisp();
      return;
    }
    const P = this.pixel;
    const cw = this.bufW * P;
    const ch = this.bufH * P;
    // The window covers the SHELL's silhouette, not a fixed share of the planet's (the shell is above the surface: a row near the limb is
    // farther from the centre than the planet is wide; a window cut through it shows as a vertical edge on the letters).
    const dist = cameraDistance(this.drawView().zoom, ch);
    const R = silhouetteRadiusPx(this.drawView().zoom, ch) * shellWindowFactor(dist, caption.maxRadius) * 1.03 + 4;
    const cx = cw / 2 - this.shiftBuf * P;
    const cy = ch / 2 - this.liftBuf * P;
    // The window: the planet's whole box (`planet`) or only its horizontal reach by the caption's own vertical band (`band`: the rows' edges over
    // their whole parallels and the dimming's reach: a third to a half of the pixels, the rows stay centred on the equator).
    let wy0 = cy - R;
    let wy1 = cy + R;
    // (a flying camera is not on the planet's axis: the window round the shell's silhouette is the whole picture)
    const wholeX = this.flying;
    if (wholeX) {
      wy0 = 0;
      wy1 = ch;
    }
    if (!wholeX && ENERGY.captionWindow === "band" && this.lastBasis) {
      const e = caption.extentTan(this.drawView().lat);
      if (e) {
        const perTan = silhouetteRadiusPx(this.drawView().zoom, ch) * Math.sqrt(Math.max(1.0001, this.lastBasis.d * this.lastBasis.d - 1));
        const pad = 6;
        wy0 = Math.max(wy0, cy - e.top * perTan - pad);
        wy1 = Math.min(wy1, cy - e.bottom * perTan + pad);
      }
    }
    const x0 = wholeX ? 0 : Math.max(0, Math.floor(cx - R));
    const y0 = Math.max(0, Math.floor(wy0));
    const x1 = wholeX ? cw : Math.min(cw, Math.ceil(cx + R));
    const y1 = Math.min(ch, Math.ceil(wy1));
    if (x1 - x0 < 1 || y1 - y0 < 1) return;
    const cam = this.camera;
    cam.setViewOffset(this.bufW, this.bufH, this.camShift + x0 / P, this.camLift + y0 / P, (x1 - x0) / P, (y1 - y0) / P);
    cam.updateProjectionMatrix();
    const rect = this.captionRect;
    rect.w = x1 - x0;
    rect.h = y1 - y0;
    rect.left = this.canvasLeft + x0;
    rect.top = this.canvasTop + y0;
    rect.mask = this.canvas.style.maskImage;
    rect.full.w = cw;
    rect.full.h = ch;
    rect.at.x = x0;
    rect.at.y = y0;
    caption.renderCrisp(cam, rect, window.devicePixelRatio || 1);
    this.capDrawnAny = performance.now();
    if (this.camShift || this.camLift) cam.setViewOffset(this.bufW, this.bufH, this.camShift, this.camLift, this.bufW, this.bufH);
    else cam.clearViewOffset();
    cam.updateProjectionMatrix();
  }

  /** Synchronous render (also used by resize and by the measurement hooks). */
  renderNow() {
    if (this.disposed || this.lost || !this.sized) return;
    this.cancelFrame();
    if (this.suspended) {
      this.ticks++;
      this.syncRing();
      this.opts.onFrame();
      return;
    }
    const tp = perfStart();
    this.syncCamera();
    this.syncNodes();
    this.syncRing();
    this.syncLegIcons();
    perfEnd("three.sync", tp);
    // The whole buffer is drawn: a GL scissor limited to the free area saved nothing measurable (docs/web-architecture.md)
    // and left the area outside it stale, which the CSS edge-fade mask then revealed.
    const t0 = performance.now();
    this.gl.render(this.globe.scene, this.camera);
    // The caption (a canvas of its own over the globe's, same camera and rectangle).
    this.renderCrispCaption();
    this.lastRenderMs = performance.now() - t0;
    this.frames++;
    if (this.canvas.style.opacity === "0") this.canvas.style.opacity = "";
    perfEnd("three.render", t0);
    const t1 = perfStart();
    this.opts.onFrame();
    perfEnd("frame.callbacks", t1);
    // Whoever drew this frame (the tick, a resize, a check), the transitions run to their end, and the idle rotation's chain (cancelled above) goes on.
    if (this.lod.animating || this.globe.animating || (this.caption?.animating ?? false) || this.opts.labelsAnimating?.()) this.keepGoing(false);
    else if (this.spin.spinning) this.chainSpin();
    this.armCaption();
  }

  /**
   * The ring goes where the planet is, in the same frame (a camera frame, drawn or suspended). Cheap when it is not shown: one comparison.
   * It runs on its own clock for the slow turn (engine/ring-layer.ts) and never asks for a frame of the globe.
   */
  private syncRing() {
    const ring = this.ring;
    if (!ring) return;
    const alpha = this.ringPresence();
    if (alpha <= 0 && !ring.isShown) return;
    const P = this.pixel;
    const ch = this.bufH * P;
    ring.update({
      cx: (this.bufW * P) / 2 - this.shiftBuf * P + this.canvasLeft,
      cy: ch / 2 - this.liftBuf * P + this.canvasTop,
      r: silhouetteRadiusPx(this.drawView().zoom, ch),
      alpha,
      width: this.width,
      height: this.height,
    });
  }

  /**
   * The pictures of the modes go where the legs are, in the same frame: the middle of each leg that stays at this zoom and is long enough, lifted like
   * its arc, not where the planet hides it. Cheap when the camera has not moved (the layer keys its drawing on the view).
   */
  private syncLegIcons() {
    const icons = this.legIcons;
    if (!icons) return;
    const routes = this.globe.routes;
    const shown = routes.visible;
    icons.setVisible(shown);
    if (!shown) return;
    const P = this.pixel;
    const cw = this.bufW * P;
    const ch = this.bufH * P;
    const v = this.drawView();
    const basis = viewBasis(v, ch);
    const cx = cw / 2 - this.shiftBuf * P;
    const cy = ch / 2 - this.liftBuf * P;
    const lift = routeLift(v.zoom);
    icons.setKept(this.globe.kept);
    icons.setQuiet(routes.quietLegs);
    icons.setOrigin(this.canvasLeft, this.canvasTop);
    icons.setFocus(this.globe.routes.litKeys());
    const camera = `${v.lon.toFixed(4)},${v.lat.toFixed(4)},${v.zoom.toFixed(4)},${this.shiftBuf},${this.liftBuf},${cw}x${ch},${lift.toFixed(3)},${routes.overlayPresence}`;
    icons.draw(
      (p, l) => {
        const s = projectLonLat(p[0], p[1], basis, cw, ch, 1 + l, cx, cy);
        return s.visible ? { x: s.x, y: s.y } : null;
      },
      cw,
      ch,
      P,
      v.zoom,
      camera,
      lift,
    );
  }

  /**
   * How present the flat ring is: its zoom's alpha, taken away by the overlay's own presence (the boxes and labels, `LodTree.overlayAlpha`: the same
   * timed value, in the same frames, that fades them in), so the ring and the labels cross-fade and are never on the planet together. On a page
   * without the showcase (a debug page, `?no-ring` has no ring at all) the ring is a function of the zoom alone, as it was.
   */
  private ringPresence(): number {
    const a = this.textFits ? ringAlpha(this.view.zoom, this.fit, this.minZoom) : 0;
    // (and it is out for the whole of the cinematic interlude, while the globe is pulled back: `CaptionLayer.ringShare`)
    const share = this.ringCut ? 0 : (this.caption?.ringShare() ?? 1);
    return (this.showcaseActive ? a * (1 - this.lod.overlayAlpha) : a) * share;
  }

  /** The ring's state (checks): shown, tone, glyphs, size of its canvas; null when there is none. */
  ringState() {
    const ring = this.ring;
    if (!ring) return null;
    const alpha = this.ringPresence();
    return { ...ring.state(), overlay: this.lod.overlayAlpha, zoomAlpha: ringAlpha(this.view.zoom, this.fit, this.minZoom), presence: alpha, fit: this.fit, floor: this.minZoom, silhouettePx: silhouetteRadiusPx(this.view.zoom, this.bufH * this.pixel) };
  }

  /** Checks and captures: hold the interlude's camera at this point of its flight, 0..1 (null releases it), and draw. */
  pinFlight(u: number | null) {
    this.caption?.pinFlight(u);
    this.requestRender();
  }

  /** Checks and captures: hold the caption's entrance at `ms` after its start (null releases it) and draw. */
  pinCaption(ms: number | null) {
    this.caption?.pin(ms);
    this.requestRender();
  }

  /** Checks and captures: hold every caption line at `deg` degrees east of its place (null releases it). */
  pinCaptionAngle(deg: number | null) {
    this.caption?.pinAngle(deg);
    this.requestRender();
  }

  /**
   * The real layout of the caption on the screen now, projected through the camera as drawn (CSS px, container coordinates): per row the top and
   * bottom edge of its ink box, the planet's centre and radius. The checks measure the clearances between rows and where the block sits from it.
   */
  captionProbe() {
    const c = this.caption;
    if (!c) return null;
    const cam = this.camera;
    const P = this.pixel;
    const toPx = (v: [number, number, number]) => {
      const p = new Vector3(v[0], v[1], v[2]).project(cam);
      return [((p.x + 1) / 2) * this.bufW * P + this.canvasLeft, ((1 - p.y) / 2) * this.bufH * P + this.canvasTop] as [number, number];
    };
    const ch = this.bufH * P;
    return {
      rows: c.edges().map((e) => ({ row: e.row, top: e.top.map(toPx), bottom: e.bottom.map(toPx), base: e.base.map(toPx) })),
      centre: [(this.bufW * P) / 2 - this.shiftBuf * P + this.canvasLeft, ch / 2 - this.liftBuf * P + this.canvasTop],
      radius: silhouetteRadiusPx(this.drawView().zoom, ch),
      zoom: this.view.zoom,
      lat: this.view.lat,
      fit: this.fit,
      floor: this.minZoom,
      viewport: [this.width, this.height],
    };
  }

  /** The silhouette's radius in px from the camera as it was last drawn (so a measure against `project` is from one and the same frame). */
  private silhouetteFromCamera(): number {
    const d = this.camera.position.length();
    const f = (this.bufH * this.pixel) / 2 / Math.tan((FOV_DEG * Math.PI) / 360);
    return f / Math.sqrt(Math.max(1.0001, d * d - 1));
  }

  /**
   * Where the widest line of the caption is on the screen now (CSS px, container coordinates), and the planet's silhouette radius: the checks'
   * measure that the words are locked to the globe (their width goes with its radius, in a fade as at rest). Null without a caption.
   */
  captionExtent() {
    const c = this.caption;
    if (!c) return null;
    const ends = c.widestEnds();
    if (!ends) return null;
    const cam = this.camera;
    const P = this.pixel;
    const toPx = (v: [number, number, number]) => {
      const p = new Vector3(v[0], v[1], v[2]).project(cam);
      return { x: ((p.x + 1) / 2) * this.bufW * P + this.canvasLeft, y: ((1 - p.y) / 2) * this.bufH * P + this.canvasTop };
    };
    const a = toPx(ends.left);
    const b = toPx(ends.right);
    return { left: a, right: b, width: Math.hypot(b.x - a.x, b.y - a.y), chord: Math.abs(b.x - a.x), radiusPx: this.silhouetteFromCamera(), zoom: this.view.zoom, lat: this.view.lat, lon: this.view.lon };
  }

  /** How the caption leaves when the showcase ends: a fade (the page's own exit), or the orbit (kept: a caption that cycles its words uses it; the checks compare the two). */
  private captionExit: "fade" | "orbit" = "fade";

  setCaptionExit(exit: "fade" | "orbit") {
    this.captionExit = exit;
  }

  /** Checks and captures: begin the next swap of the caption's phrase sets now (the timer does it on the page). Returns whether one began. */
  swapCaption(): boolean {
    const began = this.caption?.swapNow(performance.now()) ?? false;
    if (began) this.requestRender();
    return began;
  }

  /** Checks and measurements: one caption frame INCLUDING the GPU's work on it (ms: the sync, the draw and a read back). */
  captionGpuMs(): number {
    const c = this.caption;
    if (!c || !this.lastBasis) return 0;
    const t = performance.now();
    const b = this.lastBasis;
    c.sync(b.d, b.lon, b.lat, t);
    this.renderCrispCaption();
    c.finishGpu();
    return performance.now() - t;
  }

  /** Checks and measurements: set the energy knobs (`ENERGY`) now; the idle rotation's frame period follows. */
  setEnergy(patch: Partial<typeof ENERGY>) {
    Object.assign(ENERGY, patch);
    SPIN.minFrameMs = ENERGY.spinFrameMs;
    this.armFreeze();
    this.applyHold();
    this.requestRender();
  }

  /** Checks and captures: the ring's highlight ("blue", "ink", "none"; null: the tuned one). */
  setRingHighlight(mode: "blue" | "ink" | "none" | null) {
    this.ring?.setHighlight(mode);
  }

  /** Checks and captures: the thickness's look ("page", "mix", "edge"; null: the tuned one). */
  setCaptionSide(mode: "page" | "mix" | "edge" | null) {
    this.caption?.setSideMode(mode);
    this.requestRender();
  }

  /** Checks and captures: the dimming behind the words ("ellipse", "bands", "none"; null: the tuned one). */
  setCaptionDim(mode: "ellipse" | "bands" | "none" | null) {
    this.caption?.setDimMode(mode);
    this.requestRender();
  }

  /** Checks and captures: the seed of the sides the caption's lines come in from (null: all from the east); drawn again at once. */
  setCaptionSeed(seed: number | null) {
    this.caption?.setSeed(seed);
    this.requestRender();
  }

  /** Checks only: lay the caption on a shell of this radius (null: the tuned one). */
  setCaptionRadius(r: number | null) {
    this.caption?.setRadius(r);
    this.requestRender();
  }

  /** Whether there is a caption (the page has the showcase and the app gave it lines). */
  hasCaption(): boolean {
    return this.caption !== null;
  }

  /** The caption's state and the showcase's (checks): null when there is none. */
  captionState() {
    const c = this.caption;
    if (!c) return null;
    return { ...c.state(), showcase: this.showcaseOn, captionFrames: this.capFrames, captionMs: this.capMs, quality: { level: this.governor.level, changes: this.qualityChanges, period: this.governor.period, lateShare: this.governor.lateShare, ...this.caption!.quality }, drifting: c.drifting, band: { shown: this.captionOn, snapping: this.latSnap !== null, deg: CAPTION.band.deg }, overlayHidden: this.lod.isSuppressed, animating: c.animating, zoom: this.view.zoom, fit: this.fit, floor: this.minZoom };
  }

  /* ------------------------------ showcase ------------------------------ */

  /**
   * The home screen is at rest (`GlobeProps.showcase`): every box and label fades out (the tree's targets go off: engine/lod-tree.ts
   * `setSuppressed`, inert by the pick rules) and the caption comes in, each line round from behind the planet (engine/caption.ts); the camera,
   * when it is not at the lowest zoom (the home screen's own composition), comes back to it. Off: the other way round, quickly. On a page without
   * the showcase (`?no-ring`, a debug page) this does nothing: the boxes stay.
   */
  setShowcase(on: boolean) {
    const want = on && this.showcaseActive;
    if (want === this.showcaseOn) return;
    this.showcaseOn = want;
    this.applyShowcase();
    if (want && this.view.zoom > this.minZoom + 0.02 && this.view.zoom <= this.fit + SPIN.unzoomedSlack && this.flight === null) this.flyTo({ zoom: this.minZoom });
  }

  /** The showcase ends on its own (a gesture on the globe): the same, without asking the app. */
  private dropShowcase() {
    if (!this.showcaseOn) return;
    this.showcaseOn = false;
    this.applyShowcase();
  }

  /**
   * The overlay stays out after the showcase ends because a gesture cut the cinematic interlude short: the globe is still coming back to its size
   * (`CaptionLayer.pulledBack`), and the boxes are placed from the page's camera, so they would fade in where the planet WILL be. They wait for it.
   */
  private overlayHeld = false;
  /** The interlude was cut short by a gesture: the ring, already out, does not come back for the boxes' arrival (it would flash, then fade again). */
  private ringCut = false;

  private applyShowcase() {
    this.overlayHeld = !this.showcaseOn && !this.reduced && !!this.caption?.pulledBack;
    this.ringCut = this.showcaseOn ? false : this.ringCut || this.overlayHeld;
    this.lod.setSuppressed(this.showcaseOn || this.overlayHeld);
    const now = performance.now();
    if (this.showcaseOn) this.guardCaption(now);
    else {
      this.latSnap = null;
      this.captionOn = false;
      this.caption?.hide(now, this.captionExit);
    }
    if (this.suspended) this.caption?.settle();
    this.requestRender();
  }

  /** Where a camera outside the band glides to: its nearest edge, or the equator (`CAPTION.band.snapTo`). */
  private snapTarget(lat: number): number {
    return CAPTION.band.snapTo === "equator" ? 0 : bandLat(lat);
  }

  /**
   * The caption needs the camera inside its latitude band (`CAPTION.band`: the rows are fixed parallels about the equator). While the showcase is
   * on: a camera outside the band glides its latitude (only: never the longitude, the zoom is the page's) to the band's nearest edge, ease-out,
   * and the entrance starts when it has landed (`show` is not called before); a camera that leaves the band under a caption (a flight) fades
   * it, and it comes back, entering again, once the camera is in the band. A gesture ends the showcase (`dropShowcase`), which drops the glide.
   * Runs every frame (a few comparisons) and when the showcase changes.
   */
  private guardCaption(now: number) {
    const caption = this.caption;
    if (!caption || !this.showcaseOn) return;
    if (!this.textFits) {
      if (this.captionOn) {
        this.captionOn = false;
        caption.hide(performance.now(), "fade");
      }
      return;
    }
    const lat = this.view.lat;
    if (this.captionOn) {
      if (!inBand(lat, CAPTION.band.hysteresisDeg)) {
        this.captionOn = false;
        caption.hide(now, "fade");
      }
      return;
    }
    if (this.latSnap || this.flight !== null) return; // (the glide, or somebody else's flight, is under way: wait for it)
    if (inBand(lat)) {
      this.captionOn = true;
      caption.show(now);
      this.requestRender();
      return;
    }
    if (this.reduced) {
      this.view = this.clampView({ ...this.view, lat: this.snapTarget(lat) });
      this.captionOn = true;
      caption.show(now);
      this.requestRender();
      return;
    }
    this.noteChange();
    this.velocity = STILL;
    this.latSnap = { from: lat, to: this.snapTarget(lat), t0: now };
    this.requestRender();
  }

  private sunVec = new Vector3();

  /** The `--interlude` the page's hero is following (0 outside the interlude). */
  private interludeVar = 0;

  /** The projection's shift and lift in buffer px as the camera is drawn with now: the page's (`shiftBuf`, `liftBuf`) except during the flight. */
  private camShift = 0;
  private camLift = 0;

  /** The camera's flight is under way (engine/flight.ts): the camera is not on the orbit round the planet's centre. */
  private flying = false;

  private syncCamera() {
    const v = this.drawView();
    const h = this.bufH * this.pixel;
    let b = viewBasis(v, h);
    // The interlude's flight (engine/flight.ts): a free camera, whose last pose is this orbit camera; `u` is 1 outside it and then nothing differs.
    const u = this.caption?.flightProgress() ?? 1;
    const end = { lon: v.lon, lat: v.lat, alt: b.d - 1, roll: v.roll ?? 0 };
    let pose = u < 1 ? flightPose(u, end) : null;
    // (a flight cut short glides from where it is to the page's own camera, which is the flight's end: its pose at 1)
    const cut = pose ? (this.caption?.flightCut() ?? 0) : 0;
    if (pose && cut > 0) pose = blendPose(pose, flightPose(1, end), cut);
    this.flying = pose !== null;
    // what the rest of the frame reads: the camera's distance from the centre, the longitude and latitude it is over, and the zoom that distance is
    let d = b.d;
    let lon = v.lon;
    let lat = v.lat;
    let zoom = v.zoom;
    let skyBasis = b;
    const cam = this.camera;
    cam.fov = FOV_DEG;
    cam.aspect = this.bufW / this.bufH;
    // (the caption's shell is above the planet: its nearest point must be inside the near plane)
    const reach = this.caption ? this.caption.maxRadius + 0.05 : 1.05;
    if (pose) {
      const [px, py, pz] = pose.pos;
      d = Math.hypot(px, py, pz);
      lon = pose.lon;
      lat = pose.lat;
      zoom = radiusPxToZoom(focalPx(h) / Math.max(1e-3, d - 1));
      cam.near = Math.max(0.004, (d - 1) * 0.25);
      cam.far = d + reach;
      cam.position.set(px, py, pz);
      cam.up.set(pose.up[0], pose.up[1], pose.up[2]);
      cam.lookAt(pose.target[0], pose.target[1], pose.target[2]);
      // the horizon ring is a circle of the sphere seen from this POSITION (any pair square to it will do for its axes); the sky takes the camera's own axes
      const c: [number, number, number] = [px / d, py / d, pz / d];
      const e = viewBasis({ lon, lat, zoom: 0 }, h);
      b = { c, east: e.east, north: e.north, d, f: b.f };
      cam.updateMatrixWorld();
      const m = cam.matrixWorld.elements;
      skyBasis = { c: [m[8]!, m[9]!, m[10]!], east: [m[0]!, m[1]!, m[2]!], north: [m[4]!, m[5]!, m[6]!], d, f: b.f };
    } else {
      cam.near = Math.max(0.02, b.d - reach);
      cam.far = b.d + reach;
      cam.position.set(b.c[0] * b.d, b.c[1] * b.d, b.c[2] * b.d);
      cam.up.set(b.north[0], b.north[1], b.north[2]);
      cam.lookAt(0, 0, 0);
    }
    // Shift the projection centre left by `shiftBuf` pixels: render the window of a same-sized virtual frame
    // that starts `shiftBuf` pixels to the right.
    // and the same up by `liftBuf` (the window starts that many pixels lower in the virtual frame).
    // (the flight keeps the page's layout offset at its two ends only: `flightOffsetShare`)
    const k = pose ? flightOffsetShare(u) + (1 - flightOffsetShare(u)) * cut : 1;
    // (the continents are filled for the whole interlude)
    const land = this.caption?.landShare() ?? 0;
    this.globe.setLand(land);
    this.globe.setCity(this.caption?.cityShare() ?? 0);
    // the page's own hero steps back with it (app.css `--interlude`): written when it moves by a hundredth
    if (Math.abs(land - this.interludeVar) >= 0.01 || (land === 0 && this.interludeVar !== 0)) {
      this.interludeVar = land;
      this.opts.container.ownerDocument.documentElement.style.setProperty("--interlude", land.toFixed(3));
    }
    this.camShift = this.shiftBuf * k;
    this.camLift = this.liftBuf * k;
    if (this.camShift || this.camLift) cam.setViewOffset(this.bufW, this.bufH, this.camShift, this.camLift, this.bufW, this.bufH);
    else cam.clearViewOffset();
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    // the sun: one direction in the camera's frame (the letters' key light), which is a direction in the earth's frame for the planet
    const sun = this.sunVec.set(...CINEMATIC.light.key).normalize().transformDirection(cam.matrixWorld);
    this.globe.setSun(sun.x, sun.y, sun.z);
    const now = performance.now();
    this.globe.syncCamera(b, zoom, this.pixel, now, this.reduced, lat, Math.max(this.width, this.height));
    // (the caption's lines stay on the page's meridian and latitude; only what is hidden is the flying camera's)
    const over = pose ? { lon, lat } : undefined;
    this.lastBasis = { d, lon: v.lon, lat: v.lat, cam: over };
    this.caption?.sync(d, v.lon, v.lat, now, over);
    this.globe.syncSky(cam, skyBasis, this.era, { w: this.bufW, h: this.bufH, shift: this.camShift, lift: this.camLift }, now, this.reduced);
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
    return { inset: this.inset, target: this.insetTarget, shiftBuf: this.shiftBuf, bufW: this.bufW, pixel: this.pixel, lift: this.lift, liftTarget: this.liftTarget, liftBuf: this.liftBuf, cover: this.cover };
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
    // (the hero must not stay a ghost if the globe goes away mid-interlude)
    if (this.interludeVar !== 0) this.opts.container.ownerDocument.documentElement.style.removeProperty("--interlude");
    this.ring?.dispose();
    this.ring = null;
    this.legIcons?.dispose();
    this.legIcons = null;
    this.caption?.dispose();
    this.caption = null;
    this.globe.dispose();
    this.gl.dispose();
    this.gl.forceContextLoss();
    this.canvas.remove();
  }
}
