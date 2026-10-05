/**
 * Standalone Three.js globe: pixelated, monochrome, on-demand rendering.
 *
 * - Pixelation: the drawing buffer is `cssSize / pixelSize` and the canvas is upscaled with
 *   `image-rendering: pixelated`. Lines are 1 buffer pixel wide, antialiasing is off.
 * - A depth-only sphere hides every line, marker and route on the far hemisphere.
 * - Border visibility is ordered-dither coverage (off, 50% dotted, solid), not alpha, so the output stays 1-bit.
 * - Frames are only scheduled when something changed or animates (see `requestRender` / `tick`).
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  LineSegments,
  Mesh,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  WebGLRenderer,
  LineLoop,
  ColorManagement,
} from "three";
import type { Polylines } from "@catalyst/geodata";
import {
  DEG,
  FOV_DEG,
  angularDistance,
  clamp,
  easeInOutCubic,
  fitZoom,
  flightDuration,
  lonLatToVec3,
  normalizeLon,
  projectLonLat,
  sampleRoute,
  shortestLonDelta,
  viewBasis,
  zoomToRadiusPx,
  type SampledRoute,
} from "../core/geo";
import { TUNING, type FrameStats, type GlobeInit, type GlobeRenderer, type ScreenPoint, type ViewState } from "../core/types";

// Our ShaderMaterials write raw sRGB values and there is no lighting, so skip Three's linear-sRGB conversion;
// otherwise ink and background drift away from the CSS colours.
ColorManagement.enabled = false;

const LINE_R = 1.0;
const OCCLUDER_R = 0.998;
const MARKER_R = 1.0;
/** Route dash period in art pixels. */
const ROUTE_DASH_PX = 7;

const DITHER_GLSL = /* glsl */ `
  float dither2(vec2 a) { return fract(a.x * 0.5 + a.y * a.y * 0.75); }
  float dither4(vec2 a) { return dither2(0.5 * a) * 0.25 + dither2(a); }
  // Discard fragments so that roughly \`coverage\` of pixels survive (ordered dither, stays 1-bit).
  void ditherDiscard(float coverage) { if (dither4(floor(gl_FragCoord.xy)) >= coverage) discard; }
`;

function lineMaterial(ink: string, coverage: number, stipple = 0): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color(ink) }, uCoverage: { value: coverage }, uStipple: { value: stipple } },
    vertexShader: /* glsl */ `
      void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uCoverage; uniform float uStipple;
      ${DITHER_GLSL}
      void main() {
        ditherDiscard(uCoverage);
        // Regular stipple (every n-th pixel on the diagonal) reads as a dotted line at any angle.
        if (uStipple > 0.0 && mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), uStipple) > 0.5) discard;
        gl_FragColor = vec4(uColor, 1.0);
      }
    `,
  });
}

/** Polylines (lon/lat degrees) -> line segment pairs on the unit sphere. */
function polylinesToSegments(p: Polylines, radius: number): BufferGeometry {
  let segCount = 0;
  for (let i = 0; i < p.offsets.length - 1; i++) segCount += Math.max(0, p.offsets[i + 1]! - p.offsets[i]! - 1);
  const out = new Float32Array(segCount * 6);
  let o = 0;
  const v = (idx: number) => lonLatToVec3(p.positions[idx * 2]!, p.positions[idx * 2 + 1]!);
  for (let i = 0; i < p.offsets.length - 1; i++) {
    const s = p.offsets[i]!;
    const e = p.offsets[i + 1]!;
    for (let k = s; k < e - 1; k++) {
      const a = v(k);
      const b = v(k + 1);
      out[o++] = a[0] * radius;
      out[o++] = a[1] * radius;
      out[o++] = a[2] * radius;
      out[o++] = b[0] * radius;
      out[o++] = b[1] * radius;
      out[o++] = b[2] * radius;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(out, 3));
  return g;
}

function graticule(stepDeg: number, sampleDeg: number): BufferGeometry {
  const pts: number[] = [];
  const push = (lon: number, lat: number) => pts.push(...lonLatToVec3(lon, lat).map((c) => c * LINE_R));
  for (let lon = -180; lon < 180; lon += stepDeg) {
    for (let lat = -90 + sampleDeg; lat <= 90 - sampleDeg + 1e-6; lat += sampleDeg) {
      push(lon, lat - sampleDeg);
      push(lon, lat);
    }
  }
  for (let lat = -90 + stepDeg; lat < 90; lat += stepDeg) {
    for (let lon = -180; lon < 180; lon += sampleDeg) {
      push(lon, lat);
      push(lon + sampleDeg, lat);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(Float32Array.from(pts), 3));
  return g;
}

interface Flight {
  from: ViewState;
  to: ViewState;
  start: number;
  duration: number;
  dip: number;
}

export async function createThreeGlobe(init: GlobeInit): Promise<GlobeRenderer> {
  return new ThreeGlobe(init);
}

class ThreeGlobe implements GlobeRenderer {
  readonly kind = "three" as const;
  readonly stats: FrameStats = { frames: 0, lastRenderMs: 0 };
  readonly canvas: HTMLCanvasElement;

  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(FOV_DEG, 1, 0.05, 20);
  private view: ViewState;
  private width = 1;
  private height = 1;
  private bufW = 1;
  private bufH = 1;
  private canvasLeft = 0;
  private canvasTop = 0;
  private minZoom = 1;
  private pixel: number;
  private reduced: boolean;
  private disposed = false;
  private raf = 0;
  private ro: ResizeObserver;

  // objects
  private disposables: { dispose(): void }[] = [];
  private borders!: ShaderMaterial;
  private silhouette!: ShaderMaterial;
  private markers!: Points;
  private markerState!: Float32Array;
  private routeLine: LineSegments | null = null;
  private routeMat!: ShaderMaterial;
  private routeCache = new Map<string, SampledRoute>();

  // state
  private selected: string | null = null;
  private activeRoute: string | null = null;
  private routeStart = 0;
  private routeProgress = 1;
  private flight: Flight | null = null;
  private velocity = { lon: 0, lat: 0 }; // deg per ms
  private inertiaLast = 0;
  private placeIndex = new Map<string, number>();
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: { moved: number; lastT: number; samples: { t: number; dx: number; dy: number }[] } | null = null;
  private pinchDist = 0;
  private routeOnceDone = true;
  private lastTickT = 0;

  constructor(private init: GlobeInit) {
    this.view = { ...init.initialView };
    this.pixel = init.pixelSize;
    this.reduced = init.reducedMotion;

    this.renderer = new WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setClearColor(new Color(init.theme.bg), 1);
    this.canvas = this.renderer.domElement;
    Object.assign(this.canvas.style, {
      position: "absolute",
      imageRendering: "pixelated",
      touchAction: "none",
      display: "block",
      outline: "none",
    } satisfies Partial<CSSStyleDeclaration>);
    init.container.append(this.canvas);

    this.buildScene();
    this.attachInput();

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(init.container);
    this.resize();
  }

  /* ------------------------------ scene ------------------------------ */

  private track<T extends { dispose(): void }>(o: T): T {
    this.disposables.push(o);
    return o;
  }

  private buildScene() {
    const { theme, coastlines, borders, places } = this.init;

    // Depth-only occluder: hides everything on the far side, no colour (clear colour is the ocean).
    const occGeo = this.track(new SphereGeometry(OCCLUDER_R, 96, 48));
    const occMat = this.track(
      new ShaderMaterial({
        vertexShader: "void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
        fragmentShader: "void main(){ gl_FragColor = vec4(0.0); }",
        colorWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
    );
    const occ = new Mesh(occGeo, occMat);
    occ.renderOrder = 0;
    this.scene.add(occ);

    // Graticule (15 deg), stippled to a dotted look.
    const gridMat = this.track(lineMaterial(theme.ink, 1, 3));
    const grid = new LineSegments(this.track(graticule(15, 3)), gridMat);
    grid.renderOrder = 1;
    this.scene.add(grid);

    this.borders = this.track(lineMaterial(theme.ink, 0));
    const b = new LineSegments(this.track(polylinesToSegments(borders, LINE_R)), this.borders);
    b.renderOrder = 2;
    this.scene.add(b);

    const coastMat = this.track(lineMaterial(theme.ink, 1));
    const coast = new LineSegments(this.track(polylinesToSegments(coastlines, LINE_R)), coastMat);
    coast.renderOrder = 3;
    this.scene.add(coast);

    // Markers
    const pos = new Float32Array(places.length * 3);
    this.markerState = new Float32Array(places.length);
    places.forEach((p, i) => {
      const v = lonLatToVec3(p.coordinates.lon, p.coordinates.lat);
      pos.set([v[0] * MARKER_R, v[1] * MARKER_R, v[2] * MARKER_R], i * 3);
      this.placeIndex.set(p.slug, i);
    });
    const mg = this.track(new BufferGeometry());
    mg.setAttribute("position", new BufferAttribute(pos, 3));
    mg.setAttribute("aState", new BufferAttribute(this.markerState, 1));
    const mm = this.track(
      new ShaderMaterial({
        uniforms: { uColor: { value: new Color(theme.ink) }, uBg: { value: new Color(theme.bg) } },
        vertexShader: /* glsl */ `
          attribute float aState; varying float vState; varying float vSize;
          void main() {
            vState = aState;
            // buffer pixels, always odd so the marker is centred on a pixel
            float s = aState > 0.5 && aState < 1.5 ? 9.0 : (aState > 1.5 ? 5.0 : 3.0);
            vSize = s; gl_PointSize = s;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; uniform vec3 uBg; varying float vState; varying float vSize;
          void main() {
            vec2 q = floor(gl_PointCoord * vSize) - floor(vSize * 0.5); // integer offset from centre, -n..n
            float r = max(abs(q.x), abs(q.y));
            bool selected = vState > 0.5 && vState < 1.5;
            if (selected) {
              // hollow ring, 1px gap, centre dot
              if (r == 4.0 || r == 0.0) { gl_FragColor = vec4(uColor, 1.0); return; }
              if (r < 4.0 && r > 0.0) { gl_FragColor = vec4(uBg, 1.0); return; }
              discard;
            }
            gl_FragColor = vec4(uColor, 1.0);
          }`,
        depthTest: true,
      }),
    );
    this.markers = new Points(mg, mm);
    this.markers.renderOrder = 5;
    this.markers.frustumCulled = false;
    this.scene.add(this.markers);

    // Route material (geometry is created lazily per curated route). GL lines are 1 buffer px wide, so the route
    // is drawn four times at 1px offsets to get a 2x2 px stroke that reads as heavier than the coastline.
    // Dash period is set per frame in world units so dashes keep a constant on-screen length at any zoom.
    this.routeMat = this.track(
      new ShaderMaterial({
        uniforms: {
          uColor: { value: new Color(theme.ink) },
          uProgress: { value: 0 },
          uOffset: { value: 0 },
          uPeriod: { value: 0.016 },
          uPixel: { value: [0.01, 0.01] },
        },
        vertexShader: /* glsl */ `
          attribute float aDist; attribute vec2 aOff; uniform vec2 uPixel; varying float vDist;
          void main() {
            vDist = aDist;
            vec4 c = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            c.xy += aOff * uPixel * c.w;
            gl_Position = c;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; uniform float uProgress; uniform float uOffset; uniform float uPeriod; varying float vDist;
          void main() {
            if (vDist > uProgress) discard;
            if (fract((vDist - uOffset) / uPeriod) > 0.62) discard;
            gl_FragColor = vec4(uColor, 1.0);
          }`,
      }),
    );

    // Horizon silhouette: a circle in view space drawn without depth test.
    const N = 360;
    const ang = new Float32Array(N);
    for (let i = 0; i < N; i++) ang[i] = (i / N) * Math.PI * 2;
    const sg = this.track(new BufferGeometry());
    sg.setAttribute("position", new BufferAttribute(new Float32Array(N * 3), 3));
    sg.setAttribute("aAngle", new BufferAttribute(ang, 1));
    this.silhouette = this.track(
      new ShaderMaterial({
        uniforms: {
          uColor: { value: new Color(theme.ink) },
          uC: { value: [0, 0, 1] },
          uE: { value: [1, 0, 0] },
          uN: { value: [0, 1, 0] },
          uInvD: { value: 0.2 },
        },
        vertexShader: /* glsl */ `
          attribute float aAngle; uniform vec3 uC; uniform vec3 uE; uniform vec3 uN; uniform float uInvD;
          void main() {
            float rad = sqrt(max(0.0, 1.0 - uInvD * uInvD));
            vec3 p = uC * uInvD + rad * (cos(aAngle) * uE + sin(aAngle) * uN);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          }`,
        fragmentShader: "uniform vec3 uColor; void main(){ gl_FragColor = vec4(uColor, 1.0); }",
        depthTest: false,
      }),
    );
    const sil = new LineLoop(sg, this.silhouette);
    sil.renderOrder = 6;
    sil.frustumCulled = false;
    this.scene.add(sil);
  }

  /* ------------------------------ sizing ------------------------------ */

  private resize() {
    if (this.disposed) return;
    const w = Math.max(1, this.init.container.clientWidth);
    const h = Math.max(1, this.init.container.clientHeight);
    this.width = w;
    this.height = h;
    const P = this.pixel;
    this.bufW = Math.ceil(w / P);
    this.bufH = Math.ceil(h / P);
    this.renderer.setSize(this.bufW, this.bufH, false);
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
    this.routeMat.uniforms.uPixel!.value = [2 / this.bufW, -2 / this.bufH];
    this.minZoom = fitZoom(w, h, 0.12);
    this.view.zoom = clamp(this.view.zoom, this.minZoom, TUNING.maxZoom);
    this.requestRender();
  }

  getSize() {
    return { width: this.width, height: this.height };
  }
  getMinZoom() {
    return this.minZoom;
  }
  getView() {
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
    this.velocity = { lon: 0, lat: 0 };
    this.view = this.clampView({ ...this.view, ...v });
    this.requestRender();
  }

  flyTo(v: Partial<ViewState>) {
    const to = this.clampView({ ...this.view, ...v });
    if (this.reduced) {
      this.setView(to);
      return;
    }
    const from = { ...this.view };
    const angle = angularDistance(from.lon, from.lat, to.lon, to.lat);
    this.velocity = { lon: 0, lat: 0 };
    this.flight = {
      from,
      to: { ...to, lon: from.lon + shortestLonDelta(from.lon, to.lon) },
      start: performance.now(),
      duration: flightDuration(angle, to.zoom - from.zoom),
      // Pull back a little on long hops so the camera "arcs" over the surface.
      dip: Math.min(1.4, (angle / Math.PI) * 2.2),
    };
    this.requestRender();
  }

  setReducedMotion(on: boolean) {
    this.reduced = on;
    if (on) {
      if (this.flight) {
        this.view = this.clampView(this.flight.to);
        this.flight = null;
      }
      this.velocity = { lon: 0, lat: 0 };
      this.routeProgress = 1;
    }
    this.syncRoute();
    this.requestRender();
  }

  /* ------------------------------ selection and routes ------------------------------ */

  select(slug: string | null) {
    this.selected = slug;
    this.markerState.fill(0);
    const rs = this.routeStops();
    rs?.forEach((s) => {
      const i = this.placeIndex.get(s);
      if (i !== undefined) this.markerState[i] = 2;
    });
    if (slug) {
      const i = this.placeIndex.get(slug);
      if (i !== undefined) this.markerState[i] = 1;
    }
    (this.markers.geometry.getAttribute("aState") as BufferAttribute).needsUpdate = true;
    this.requestRender();
  }

  private routeStops(): string[] | null {
    const r = this.init.routes.find((x) => x.id === this.activeRoute);
    return r ? [...r.stops] : null;
  }

  setRoute(id: string | null) {
    if (id === this.activeRoute) return;
    this.activeRoute = id;
    if (this.routeLine) {
      this.scene.remove(this.routeLine);
      this.routeLine.geometry.dispose();
      this.routeLine = null;
    }
    const route = this.init.routes.find((r) => r.id === id);
    if (route) {
      // ONLY the explicit curated stop order is drawn.
      const coords = route.stops
        .map((s) => this.init.places.find((p) => p.slug === s))
        .filter((p): p is NonNullable<typeof p> => !!p)
        .map((p) => [p.coordinates.lon, p.coordinates.lat] as const);
      let sampled = this.routeCache.get(route.id);
      if (!sampled) {
        sampled = sampleRoute(coords, { stepDeg: 0.4, heightPerRadian: 0.12 });
        this.routeCache.set(route.id, sampled);
      }
      // Convert the strip into segment pairs, repeated for the four 1px offsets (2x2 px stroke).
      const n = sampled.positions.length / 3;
      const offs = [0, 0, 1, 0, 0, 1, 1, 1];
      const pos = new Float32Array((n - 1) * 6 * 4);
      const dist = new Float32Array((n - 1) * 2 * 4);
      const off = new Float32Array((n - 1) * 4 * 4);
      for (let k = 0; k < 4; k++) {
        const base = k * (n - 1);
        for (let i = 0; i < n - 1; i++) {
          pos.set(sampled.positions.subarray(i * 3, i * 3 + 6), (base + i) * 6);
          dist[(base + i) * 2] = sampled.distance[i]!;
          dist[(base + i) * 2 + 1] = sampled.distance[i + 1]!;
          off.set([offs[k * 2]!, offs[k * 2 + 1]!, offs[k * 2]!, offs[k * 2 + 1]!], (base + i) * 4);
        }
      }
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(pos, 3));
      g.setAttribute("aDist", new BufferAttribute(dist, 1));
      g.setAttribute("aOff", new BufferAttribute(off, 2));
      this.routeLine = new LineSegments(g, this.routeMat);
      this.routeLine.renderOrder = 4;
      this.routeLine.frustumCulled = false;
      this.scene.add(this.routeLine);
      this.routeStart = performance.now();
      this.routeOnceDone = false;
    }
    this.syncRoute();
    this.select(this.selected);
  }

  /** Reduced motion: static full route. Otherwise draw-on from the start. */
  private syncRoute() {
    const len = this.routeCache.get(this.activeRoute ?? "")?.length ?? 0;
    this.routeMat.uniforms.uOffset!.value = 0;
    if (!this.routeLine) return;
    if (this.reduced) {
      this.routeProgress = 1;
      this.routeOnceDone = true;
      this.routeMat.uniforms.uProgress!.value = len + 1;
    } else if (this.routeOnceDone) {
      this.routeMat.uniforms.uProgress!.value = len + 1;
    } else {
      this.routeProgress = 0;
      this.routeMat.uniforms.uProgress!.value = 0;
    }
  }

  /* ------------------------------ projection / picking ------------------------------ */

  project(lon: number, lat: number): ScreenPoint {
    const cw = this.bufW * this.pixel;
    const ch = this.bufH * this.pixel;
    const p = projectLonLat(lon, lat, viewBasis(this.view, ch), cw, ch, MARKER_R);
    // Snap to the centre of the art pixel the marker is drawn in, then express in container coordinates.
    const P = this.pixel;
    const sx = (Math.floor(p.x / P) + 0.5) * P + this.canvasLeft;
    const sy = (Math.floor(p.y / P) + 0.5) * P + this.canvasTop;
    return { ...p, x: sx, y: sy };
  }

  pick(x: number, y: number, radius = 14): string | null {
    let best: string | null = null;
    let bestD = radius;
    for (const place of this.init.places) {
      const p = this.project(place.coordinates.lon, place.coordinates.lat);
      if (!p.visible) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      // Prefer the nearest; ties broken by label priority so the more important place wins.
      if (d < bestD || (d === bestD && best && place.labelPriority > this.priority(best))) {
        bestD = d;
        best = place.slug;
      }
    }
    return best;
  }

  private priority(slug: string) {
    return this.init.places.find((p) => p.slug === slug)?.labelPriority ?? 0;
  }

  /* ------------------------------ input ------------------------------ */

  private cleanups: (() => void)[] = [];

  private on<K extends keyof HTMLElementEventMap>(
    el: HTMLElement,
    type: K,
    fn: (e: HTMLElementEventMap[K]) => void,
    opts?: AddEventListenerOptions,
  ) {
    el.addEventListener(type, fn as EventListener, opts);
    this.cleanups.push(() => el.removeEventListener(type, fn as EventListener, opts));
  }

  private localPoint(e: PointerEvent | WheelEvent | MouseEvent) {
    const r = this.init.container.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private attachInput() {
    const el = this.canvas;
    el.tabIndex = 0;
    el.setAttribute("role", "application");
    el.setAttribute("aria-label", "Interactive globe. Arrow keys rotate, plus and minus zoom.");

    this.on(el, "pointerdown", (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.flight = null;
      this.velocity = { lon: 0, lat: 0 };
      if (this.pointers.size === 1) this.drag = { moved: 0, lastT: e.timeStamp, samples: [] };
      if (this.pointers.size === 2) this.pinchDist = this.pointerDistance();
    });

    this.on(el, "pointermove", (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) {
        if (e.pointerType === "mouse") {
          const p = this.localPoint(e);
          this.canvas.style.cursor = this.pick(p.x, p.y, 12) ? "pointer" : "grab";
        }
        return;
      }
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size >= 2) {
        const dist = this.pointerDistance();
        if (this.pinchDist > 0) this.nudgeZoom(Math.log2(dist / this.pinchDist));
        this.pinchDist = dist;
        return;
      }
      if (!this.drag) return;
      this.drag.moved += Math.abs(dx) + Math.abs(dy);
      this.drag.samples.push({ t: e.timeStamp, dx, dy });
      if (this.drag.samples.length > 8) this.drag.samples.shift();
      this.panPixels(dx, dy);
    });

    const end = (e: PointerEvent) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      this.pinchDist = 0;
      const d = this.drag;
      if (this.pointers.size === 0 && d) {
        this.drag = null;
        const slop = e.pointerType === "mouse" ? 4 : 8;
        if (e.type === "pointerup" && d.moved <= slop) {
          const p = this.localPoint(e);
          this.init.onSelect(this.pick(p.x, p.y, e.pointerType === "mouse" ? 12 : 22));
        } else if (e.type === "pointerup" && !this.reduced) {
          this.startInertia(d.samples, e.timeStamp);
        }
      }
    };
    this.on(el, "pointerup", end);
    this.on(el, "pointercancel", end);

    this.on(
      el,
      "wheel",
      (e) => {
        e.preventDefault();
        const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
        const k = e.ctrlKey ? 0.012 : 0.0016;
        this.nudgeZoom(-e.deltaY * unit * k);
      },
      { passive: false },
    );

    this.on(el, "dblclick", (e) => {
      const p = this.localPoint(e);
      if (!this.pick(p.x, p.y, 12)) this.flyTo({ zoom: this.view.zoom + 1 });
    });

    this.on(el, "keydown", (e) => {
      const step = 40 / zoomToRadiusPx(this.view.zoom) / DEG; // ~40 css px worth of degrees
      const k = e.key;
      if (k === "ArrowLeft") this.panDegrees(-step, 0);
      else if (k === "ArrowRight") this.panDegrees(step, 0);
      else if (k === "ArrowUp") this.panDegrees(0, step);
      else if (k === "ArrowDown") this.panDegrees(0, -step);
      else if (k === "+" || k === "=") this.nudgeZoom(0.5);
      else if (k === "-" || k === "_") this.nudgeZoom(-0.5);
      else return;
      e.preventDefault();
    });
  }

  private pointerDistance() {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private panPixels(dx: number, dy: number) {
    const r = zoomToRadiusPx(this.view.zoom);
    const cosLat = Math.max(0.15, Math.cos(this.view.lat * DEG));
    this.setView({
      lon: this.view.lon - dx / (r * cosLat) / DEG,
      lat: this.view.lat + dy / r / DEG,
    });
  }

  private panDegrees(dLon: number, dLat: number) {
    const cosLat = Math.max(0.15, Math.cos(this.view.lat * DEG));
    if (this.reduced) this.setView({ lon: this.view.lon + dLon / cosLat, lat: this.view.lat + dLat });
    else this.flyTo({ lon: this.view.lon + dLon / cosLat, lat: this.view.lat + dLat });
  }

  private nudgeZoom(dz: number) {
    this.setView({ zoom: this.view.zoom + dz });
  }

  private startInertia(samples: { t: number; dx: number; dy: number }[], now: number) {
    const recent = samples.filter((s) => now - s.t < 90);
    if (recent.length < 2) return;
    const dt = Math.max(16, now - recent[0]!.t);
    const dx = recent.reduce((a, s) => a + s.dx, 0);
    const dy = recent.reduce((a, s) => a + s.dy, 0);
    const r = zoomToRadiusPx(this.view.zoom);
    const cosLat = Math.max(0.15, Math.cos(this.view.lat * DEG));
    // Cap the fling speed (px per ms) so a stray fast gesture cannot spin the globe out of control.
    const cap = (v: number) => clamp(v, -2.2, 2.2);
    this.velocity = { lon: -cap(dx / dt) / (r * cosLat) / DEG, lat: cap(dy / dt) / r / DEG };
    if (Math.hypot(this.velocity.lon, this.velocity.lat) * r * DEG < 0.12) this.velocity = { lon: 0, lat: 0 };
    this.inertiaLast = performance.now();
    this.requestRender();
  }

  /* ------------------------------ frame scheduling ------------------------------ */

  isAnimating() {
    return this.raf !== 0;
  }

  requestRender() {
    if (this.disposed || this.raf) return;
    this.raf = requestAnimationFrame(this.tick);
  }

  /** Advance animations; returns true if another frame is needed. */
  private advance(now: number): boolean {
    let more = false;
    const f = this.flight;
    if (f) {
      const t = clamp((now - f.start) / f.duration, 0, 1);
      const e = easeInOutCubic(t);
      const zoomMid = Math.max(this.minZoom, Math.min(f.from.zoom, f.to.zoom) - f.dip);
      // Quadratic dip towards zoomMid at t = 0.5 while easing endpoints.
      const bump = 4 * e * (1 - e);
      this.view = this.clampView({
        lon: f.from.lon + (f.to.lon - f.from.lon) * e,
        lat: f.from.lat + (f.to.lat - f.from.lat) * e,
        zoom: f.from.zoom + (f.to.zoom - f.from.zoom) * e - bump * Math.max(0, (f.from.zoom + f.to.zoom) / 2 - zoomMid),
      });
      if (t >= 1) {
        this.view = this.clampView(f.to);
        this.flight = null;
      } else more = true;
    }
    if (this.velocity.lon !== 0 || this.velocity.lat !== 0) {
      const dt = Math.min(48, now - this.inertiaLast);
      this.inertiaLast = now;
      const decay = Math.exp(-dt / 320);
      this.view = this.clampView({
        ...this.view,
        lon: this.view.lon + this.velocity.lon * dt,
        lat: this.view.lat + this.velocity.lat * dt,
      });
      this.velocity = { lon: this.velocity.lon * decay, lat: this.velocity.lat * decay };
      const r = zoomToRadiusPx(this.view.zoom);
      if (Math.hypot(this.velocity.lon, this.velocity.lat) * r * DEG < 0.01) this.velocity = { lon: 0, lat: 0 };
      else more = true;
    }
    if (this.routeLine) {
      const len = this.routeCache.get(this.activeRoute ?? "")?.length ?? 0;
      if (this.reduced) {
        this.routeMat.uniforms.uProgress!.value = len + 1;
      } else if (this.init.routeMode === "loop") {
        this.routeMat.uniforms.uProgress!.value = len + 1;
        this.routeMat.uniforms.uOffset!.value = ((now / 1000) * 30) / zoomToRadiusPx(this.view.zoom);
        more = true;
      } else if (!this.routeOnceDone) {
        const t = clamp((now - this.routeStart) / TUNING.routeDrawMs, 0, 1);
        this.routeMat.uniforms.uProgress!.value = easeInOutCubic(t) * len;
        // dashes march while drawing
        this.routeMat.uniforms.uOffset!.value = ((now - this.routeStart) / 1000 * 30) / zoomToRadiusPx(this.view.zoom);
        if (t >= 1) {
          this.routeOnceDone = true;
          this.routeMat.uniforms.uProgress!.value = len + 1;
          this.routeMat.uniforms.uOffset!.value = 0;
        } else more = true;
      }
    }
    return more;
  }

  private tick = (now: number) => {
    this.raf = 0;
    if (this.disposed) return;
    this.lastTickT = now;
    const more = this.advance(performance.now());
    this.renderNow();
    if (more) this.requestRender();
  };

  /** Synchronous render; used by the tick and by the benchmark driver. */
  renderNow() {
    if (this.disposed) return;
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    const t0 = performance.now();
    this.syncCamera();
    this.renderer.render(this.scene, this.camera);
    this.stats.frames++;
    this.stats.lastRenderMs = performance.now() - t0;
    this.init.onViewChange();
  }

  /** Blocking GPU sync (benchmark): forces the driver to finish all queued work. */
  gpuSync() {
    const gl = this.renderer.getContext();
    const px = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  }

  private syncCamera() {
    const ch = this.bufH * this.pixel;
    const b = viewBasis(this.view, ch);
    const cam = this.camera;
    cam.fov = FOV_DEG;
    cam.aspect = this.bufW / this.bufH;
    cam.near = Math.max(0.02, b.d - 1.05);
    cam.far = b.d + 1.05;
    cam.position.set(b.c[0] * b.d, b.c[1] * b.d, b.c[2] * b.d);
    cam.up.set(b.north[0], b.north[1], b.north[2]);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    const z = this.view.zoom;
    this.routeMat.uniforms.uPeriod!.value = (ROUTE_DASH_PX * this.pixel) / zoomToRadiusPx(z);
    // Borders: off, then a dotted 50% dither, then solid. Stepped (not a smooth ramp) because a low-coverage
    // dither on 1px lines reads as noise instead of a fade.
    const bz = TUNING.borderZoom;
    this.borders.uniforms.uCoverage!.value = z < bz.start ? 0 : z < bz.end ? 0.5 : 1;
    const u = this.silhouette.uniforms;
    u.uC!.value = b.c;
    u.uE!.value = b.east;
    u.uN!.value = b.north;
    u.uInvD!.value = 1 / b.d;
  }

  /* ------------------------------ teardown ------------------------------ */

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.ro.disconnect();
    this.cleanups.forEach((c) => c());
    this.cleanups = [];
    this.routeLine?.geometry.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
