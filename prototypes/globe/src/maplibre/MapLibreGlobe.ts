/**
 * MapLibre GL JS globe: no tiles, no glyphs, no sprites. All data is GeoJSON built from @catalyst/geodata
 * and the published fixture. Text is HTML (shared label layer), exactly as in the Three.js renderer.
 *
 * Look is approximated with style layers only:
 *  - pixelation: `pixelRatio: 1 / pixelSize` + `image-rendering: pixelated` on the canvas;
 *  - graticule: dotted line layers (`line-dasharray`), fine grid fades in with zoom;
 *  - borders: `line-opacity` interpolated on zoom (alpha blend, not dither);
 *  - markers: `circle` layers (round, not square);
 *  - route: `line` layer, draw-on done by re-sending a truncated GeoJSON (see `tickRoute`).
 */
import {
  Map as MLMap,
  setWorkerUrl,
  type CustomLayerInterface,
  type GeoJSONSource,
  type LngLatLike,
  type StyleSpecification,
} from "maplibre-gl";
// MapLibre v6 ships the worker as an ES module with a shared chunk. Vite must bundle it as a worker entry.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type { Polylines } from "@catalyst/geodata";
import { polylinesToMultiLineString } from "@catalyst/geodata";
import {
  DEG,
  FOV_DEG,
  clamp,
  dot,
  easeInOutCubic,
  fitZoom,
  focalPx,
  lonLatToVec3,
  normalizeLon,
  sampleRoute,
  vec3ToLonLat,
  type ScreenPoint,
  type ViewState,
} from "../core/geo";
import { TUNING, type FrameStats, type GlobeInit, type GlobeRenderer } from "../core/types";

type LonLat = [number, number];

/** log2(cos(lat)): offset between MapLibre's centre-latitude zoom and constant-radius "globe zoom". */
const BORDER_LAT_OFFSET = Math.log2(Math.cos(40 * DEG));
const cosLog = (lat: number) => Math.log2(Math.max(0.05, Math.cos(lat * DEG)));

function graticuleLines(stepDeg: number, sampleDeg: number): LonLat[][] {
  const lines: LonLat[][] = [];
  for (let lon = -180; lon <= 180; lon += stepDeg) {
    const l: LonLat[] = [];
    for (let lat = -84; lat <= 84; lat += sampleDeg) l.push([lon, lat]);
    lines.push(l);
  }
  for (let lat = -90 + stepDeg; lat < 90; lat += stepDeg) {
    if (Math.abs(lat) > 84) continue;
    const l: LonLat[] = [];
    for (let lon = -180; lon <= 180; lon += sampleDeg) l.push([lon, lat]);
    lines.push(l);
  }
  return lines;
}

const lineFC = (lines: LonLat[][]) =>
  ({
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: lines } }],
  }) as const;

/**
 * Custom WebGL layer: the globe horizon as a 1 buffer-pixel circle. MapLibre has no style layer for the
 * globe outline, so this is drawn with our own shader in screen space (no MapLibre projection needed).
 */
class SilhouetteLayer implements CustomLayerInterface {
  id = "silhouette";
  type = "custom" as const;
  renderingMode = "2d" as const;
  private program: WebGLProgram | null = null;
  private buffer: WebGLBuffer | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private uColor: WebGLUniformLocation | null = null;
  private count = 0;
  private readonly rgb: [number, number, number];

  /** `ring` returns the circle as x,y pairs in CSS px relative to the canvas, plus the canvas CSS size. */
  constructor(
    ink: string,
    private ring: () => { points: Float32Array; width: number; height: number },
  ) {
    const n = parseInt(ink.slice(1), 16);
    this.rgb = [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  onAdd(_map: MLMap, gl: WebGL2RenderingContext) {
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, `#version 300 es
      in vec2 a; uniform vec2 uRes;
      void main() { gl_Position = vec4(a.x / uRes.x * 2.0 - 1.0, 1.0 - a.y / uRes.y * 2.0, 0.0, 1.0); }`));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, `#version 300 es
      precision mediump float; uniform vec3 uColor; out vec4 o;
      void main() { o = vec4(uColor, 1.0); }`));
    gl.linkProgram(prog);
    this.program = prog;
    this.uColor = gl.getUniformLocation(prog, "uColor");
    this.buffer = gl.createBuffer();
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const loc = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  render(gl: WebGL2RenderingContext) {
    if (!this.program) return;
    const { points, width, height } = this.ring();
    gl.useProgram(this.program);
    gl.uniform2f(gl.getUniformLocation(this.program, "uRes"), width, height);
    gl.uniform3f(this.uColor, ...this.rgb);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, points, gl.DYNAMIC_DRAW);
    this.count = points.length / 2;
    gl.disable(gl.DEPTH_TEST);
    gl.drawArrays(gl.LINE_LOOP, 0, this.count);
    gl.bindVertexArray(null);
  }

  onRemove(_map: MLMap, gl: WebGL2RenderingContext) {
    if (this.program) gl.deleteProgram(this.program);
    if (this.buffer) gl.deleteBuffer(this.buffer);
    if (this.vao) gl.deleteVertexArray(this.vao);
  }
}

export async function createMapLibreGlobe(init: GlobeInit): Promise<GlobeRenderer> {
  setWorkerUrl(workerUrl);
  const g = new MapLibreGlobe(init);
  await g.ready;
  return g;
}

class MapLibreGlobe implements GlobeRenderer {
  readonly kind = "maplibre" as const;
  readonly stats: FrameStats = { frames: 0, lastRenderMs: 0 };
  readonly ready: Promise<void>;
  private map: MLMap;
  private reduced: boolean;
  private disposed = false;
  private selected: string | null = null;
  private activeRoute: string | null = null;
  private routeRaf = 0;
  private routeStart = 0;
  private routeCoords: LonLat[] = [];
  private routeDist: number[] = [];
  private routeLen = 0;
  private proj: { key: string; c: [number, number, number]; east: [number, number, number]; north: [number, number, number]; d: number; r: number } | null = null;
  private ro: ResizeObserver;
  /** "Globe zoom": constant apparent globe radius (the Three.js semantics). MapLibre's own zoom is Mercator-equivalent at the centre latitude. */
  private zGlobe: number;
  private lastZml: number;
  private compensating = false;

  constructor(private init: GlobeInit) {
    this.reduced = init.reducedMotion;
    this.zGlobe = init.initialView.zoom;
    this.lastZml = init.initialView.zoom + cosLog(init.initialView.lat);
    const P = init.pixelSize;
    const { theme } = init;
    const ink = theme.ink;
    const emptyLine = lineFC([]);

    const coast = lineFC(polylinesToMultiLineString(init.coastlines));
    const borders = lineFC(polylinesToMultiLineString(init.borders));
    const places = {
      type: "FeatureCollection",
      features: init.places.map((p) => ({
        type: "Feature",
        properties: { slug: p.slug },
        geometry: { type: "Point", coordinates: [p.coordinates.lon, p.coordinates.lat] },
      })),
    } as const;

    const style: StyleSpecification = {
      version: 8,
      projection: { type: "globe" },
      sources: {
        grid: { type: "geojson", data: lineFC(graticuleLines(15, 3)) as never },
        borders: { type: "geojson", data: borders as never },
        coast: { type: "geojson", data: coast as never },
        route: { type: "geojson", data: emptyLine as never },
        places: { type: "geojson", data: places as never },
      },
      layers: [
        { id: "ocean", type: "background", paint: { "background-color": theme.bg } },
        {
          id: "grid",
          type: "line",
          source: "grid",
          paint: { "line-color": ink, "line-width": P, "line-opacity": 0.55, "line-dasharray": [1, 3] },
        },
        {
          id: "borders",
          type: "line",
          source: "borders",
          paint: {
            "line-color": ink,
            "line-width": P,
            // MapLibre zoom is centre-latitude Mercator zoom, so convert the globe-zoom thresholds with cosLog at the
            // latitude where borders matter (mid latitudes). Alpha step, not a dither.
            "line-opacity": ["step", ["zoom"], 0, TUNING.borderZoom.start + BORDER_LAT_OFFSET, 0.5, TUNING.borderZoom.end + BORDER_LAT_OFFSET, 1],
          },
        },
        { id: "coast", type: "line", source: "coast", paint: { "line-color": ink, "line-width": P } },
        {
          id: "route",
          type: "line",
          source: "route",
          layout: { "line-cap": "butt" },
          paint: { "line-color": ink, "line-width": P * 2, "line-dasharray": [2.2, 1.3] },
        },
        {
          id: "markers",
          type: "circle",
          source: "places",
          paint: { "circle-radius": P * 2, "circle-color": ink, "circle-pitch-alignment": "viewport" },
        },
        {
          id: "routeStops",
          type: "circle",
          source: "places",
          filter: ["in", ["get", "slug"], ["literal", []]],
          paint: { "circle-radius": P * 2.5, "circle-color": ink },
        },
        {
          id: "selected",
          type: "circle",
          source: "places",
          filter: ["==", ["get", "slug"], ""],
          paint: {
            "circle-radius": P * 4.5,
            "circle-color": "rgba(0,0,0,0)",
            "circle-stroke-color": ink,
            "circle-stroke-width": P,
          },
        },
      ],
    };

    const c = init.container;
    c.style.background = theme.bg;
    this.map = new MLMap({
      container: c,
      style,
      center: [init.initialView.lon, init.initialView.lat],
      zoom: init.initialView.zoom + cosLog(init.initialView.lat),
      minZoom: -4,
      maxZoom: 22,
      pixelRatio: 1 / P,
      attributionControl: false,
      maplibreLogo: false,
      scrollZoom: { around: "center" },
      dragRotate: false,
      pitchWithRotate: false,
      maxPitch: 0,
      renderWorldCopies: true,
      canvasContextAttributes: { antialias: false, powerPreference: "high-performance", preserveDrawingBuffer: false },
      fadeDuration: 0,
    });
    const canvas = this.map.getCanvas();
    canvas.style.imageRendering = "pixelated";
    canvas.setAttribute("aria-label", "Interactive globe. Arrow keys rotate, plus and minus zoom.");
    this.map.touchZoomRotate.disableRotation();
    this.map.keyboard.disableRotation();
    this.map.on("error", (e) => console.error("[maplibre]", e.error?.message ?? e));
    this.map.on("click", (e) => init.onSelect(this.pick(e.point.x, e.point.y, 14)));
    this.map.on("mousemove", (e) => {
      canvas.style.cursor = this.pick(e.point.x, e.point.y, 12) ? "pointer" : "grab";
    });
    this.map.on("move", () => this.compensate());
    this.map.on("render", () => {
      this.stats.frames++;
      init.onViewChange();
    });
    this.ro = new ResizeObserver(() => this.applyMinZoom());
    this.ro.observe(c);
    this.ready = new Promise<void>((res) => this.map.once("load", () => res()));
    void this.ready.then(() => {
      this.map.addLayer(new SilhouetteLayer(ink, () => this.ring()), "markers");
      this.applyLimits();
    });
  }

  get canvas(): HTMLCanvasElement {
    return this.map.getCanvas();
  }

  /** Underlying map, exposed for benchmark hooks and diagnostics only. */
  get raw(): MLMap {
    return this.map;
  }

  private applyMinZoom() {
    this.applyLimits();
  }

  /** MapLibre bounds are in its own zoom; convert the globe-zoom bounds at the current latitude. */
  private applyLimits() {
    if (this.disposed) return;
    const { width, height } = this.getSize();
    const off = cosLog(this.map.getCenter().lat);
    this.map.setMinZoom(fitZoom(width, height, 0.12) + off);
    this.map.setMaxZoom(TUNING.maxZoom + off);
  }

  /**
   * Keep the globe radius constant while panning across latitudes. MapLibre keeps its own zoom fixed, which makes
   * the globe grow by 1/cos(lat) towards the poles. Runs on every `move`; pure zoom gestures update `zGlobe` instead.
   */
  private compensate() {
    if (this.compensating || this.disposed) return;
    const lat = this.map.getCenter().lat;
    const zml = this.map.getZoom();
    const off = cosLog(lat);
    if (Math.abs(zml - this.lastZml) < 1e-6) {
      this.compensating = true;
      try {
        this.applyLimits();
        this.map.setZoom(this.zGlobe + off);
      } finally {
        this.compensating = false;
      }
    } else {
      this.zGlobe = zml - off;
      this.applyLimits();
      // Touch pinch (and its inertia) can overshoot MapLibre's own bounds while the latitude is changing, because
      // the bounds above were computed for the previous latitude. Enforce the globe-zoom bounds explicitly.
      const clamped = clamp(this.zGlobe, this.getMinZoom(), TUNING.maxZoom);
      if (clamped !== this.zGlobe) {
        this.compensating = true;
        try {
          this.zGlobe = clamped;
          this.map.setZoom(clamped + off);
        } finally {
          this.compensating = false;
        }
      }
    }
    this.lastZml = this.map.getZoom();
  }

  /** Silhouette circle in canvas CSS px. */
  private ring() {
    const { width, height } = this.getSize();
    const cam = this.camera();
    const r = focalPx(height) / Math.sqrt(cam.d * cam.d - 1);
    const n = 360;
    const pts = new Float32Array(n * 2);
    const cw = this.map.getCanvas().clientWidth;
    const ch = this.map.getCanvas().clientHeight;
    for (let i = 0; i < n; i++) {
      pts[i * 2] = cw / 2 + Math.cos((i / n) * Math.PI * 2) * r;
      pts[i * 2 + 1] = ch / 2 + Math.sin((i / n) * Math.PI * 2) * r;
    }
    void width;
    return { points: pts, width: cw, height: ch };
  }

  getSize() {
    const c = this.init.container;
    return { width: c.clientWidth, height: c.clientHeight };
  }
  getMinZoom() {
    return fitZoom(this.getSize().width, this.getSize().height, 0.12);
  }
  getView(): ViewState {
    const c = this.map.getCenter();
    return { lon: normalizeLon(c.lng), lat: c.lat, zoom: this.map.getZoom() - cosLog(c.lat) };
  }

  private target(v: Partial<ViewState>) {
    const cur = this.getView();
    const lat = clamp(v.lat ?? cur.lat, -TUNING.maxLat, TUNING.maxLat);
    const zGlobe = clamp(v.zoom ?? cur.zoom, this.getMinZoom(), TUNING.maxZoom);
    return { center: [v.lon ?? cur.lon, lat] as LngLatLike, zoom: zGlobe + cosLog(lat) };
  }

  setView(v: Partial<ViewState>) {
    this.map.stop();
    this.map.jumpTo(this.target(v));
  }

  flyTo(v: Partial<ViewState>) {
    if (this.reduced) return this.setView(v);
    // `essential: false` additionally lets MapLibre honour the OS reduced-motion setting by itself.
    this.map.flyTo({ ...this.target(v), essential: false, curve: 1.2, speed: 1.1 });
  }

  setReducedMotion(on: boolean) {
    this.reduced = on;
    if (on) {
      this.map.stop();
      this.finishRoute();
    }
  }

  requestRender() {
    this.map.triggerRepaint();
  }

  isAnimating() {
    // MapLibre does not expose a pending-frame flag; `isMoving` + route loop is the closest public signal.
    return this.map.isMoving() || this.routeRaf !== 0;
  }

  /* ---------------- selection / routes ---------------- */

  select(slug: string | null) {
    this.selected = slug;
    this.map.setFilter("selected", ["==", ["get", "slug"], slug ?? ""]);
  }

  setRoute(id: string | null) {
    if (id === this.activeRoute) return;
    this.activeRoute = id;
    cancelAnimationFrame(this.routeRaf);
    this.routeRaf = 0;
    const src = this.map.getSource("route") as GeoJSONSource;
    const route = this.init.routes.find((r) => r.id === id);
    if (!route) {
      src.setData(lineFC([]) as never);
      this.map.setFilter("routeStops", ["in", ["get", "slug"], ["literal", []]]);
      return;
    }
    // ONLY the curated stop order is drawn.
    const coords = route.stops
      .map((s) => this.init.places.find((p) => p.slug === s))
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((p) => [p.coordinates.lon, p.coordinates.lat] as const);
    const sampled = sampleRoute(coords, { stepDeg: 0.4, heightPerRadian: 0 });
    this.routeCoords = [];
    for (let i = 0; i < sampled.positions.length; i += 3) {
      const ll = vec3ToLonLat([sampled.positions[i]!, sampled.positions[i + 1]!, sampled.positions[i + 2]!]);
      this.routeCoords.push([ll.lon, ll.lat]);
    }
    this.routeDist = Array.from(sampled.distance);
    this.routeLen = sampled.length;
    this.map.setFilter("routeStops", ["in", ["get", "slug"], ["literal", [...route.stops]]]);
    if (this.reduced) {
      src.setData(lineFC([this.routeCoords]) as never);
    } else {
      this.routeStart = performance.now();
      this.tickRoute();
    }
  }

  private finishRoute() {
    cancelAnimationFrame(this.routeRaf);
    this.routeRaf = 0;
    if (this.activeRoute && this.routeCoords.length) {
      (this.map.getSource("route") as GeoJSONSource).setData(lineFC([this.routeCoords]) as never);
    }
  }

  /**
   * Draw-on animation. Style layers cannot animate a path directly, so each frame we re-send a truncated
   * line to the (worker-backed) GeoJSON source. This works but costs a worker round trip and a re-tile per frame.
   */
  private tickRoute = () => {
    if (this.disposed) return;
    const t = clamp((performance.now() - this.routeStart) / TUNING.routeDrawMs, 0, 1);
    const progress = easeInOutCubic(t) * this.routeLen;
    const coords: LonLat[] = [];
    for (let i = 0; i < this.routeCoords.length; i++) {
      if (this.routeDist[i]! <= progress) coords.push(this.routeCoords[i]!);
      else {
        const prev = this.routeCoords[i - 1];
        if (prev) {
          const a = this.routeDist[i - 1]!;
          const f = (progress - a) / (this.routeDist[i]! - a);
          const next = this.routeCoords[i]!;
          coords.push([prev[0] + (next[0] - prev[0]) * f, prev[1] + (next[1] - prev[1]) * f]);
        }
        break;
      }
    }
    (this.map.getSource("route") as GeoJSONSource).setData(lineFC(coords.length > 1 ? [coords] : []) as never);
    this.routeRaf = t < 1 ? requestAnimationFrame(this.tickRoute) : 0;
  };

  /* ---------------- projection / picking ---------------- */

  /**
   * MapLibre exposes `project()` but no far-side test, so we derive the camera from public values: the apparent
   * globe radius is measured with `project()` (it varies with latitude in MapLibre's globe) and the camera
   * distance follows from the shared perspective model.
   */
  private camera() {
    const { width, height } = this.getSize();
    const v = this.getView();
    const key = `${v.lon.toFixed(5)},${v.lat.toFixed(5)},${v.zoom.toFixed(5)},${width},${height}`;
    if (this.proj?.key === key) return this.proj;
    const c = lonLatToVec3(v.lon, v.lat);
    const a = this.map.project([v.lon, v.lat]);
    const eps = 0.25 / Math.max(0.2, Math.cos(v.lat * DEG));
    const b = this.map.project([v.lon + eps, v.lat]);
    const r = Math.hypot(b.x - a.x, b.y - a.y) / (0.25 * DEG);
    const d = 1 + focalPx(height, FOV_DEG) / r;
    this.proj = { key, c, east: [0, 0, 0], north: [0, 0, 0], d, r };
    return this.proj;
  }

  project(lon: number, lat: number): ScreenPoint {
    const cam = this.camera();
    const p = lonLatToVec3(lon, lat);
    const pc = dot(p, cam.c);
    const horizon = 1 / cam.d;
    const visible = pc > horizon + 1e-4;
    const s = this.map.project([lon, lat]);
    return { x: s.x, y: s.y, visible, facing: visible ? clamp((pc - horizon) / (1 - horizon), 0, 1) : 0 };
  }

  pick(x: number, y: number, radius = 14): string | null {
    let best: string | null = null;
    let bestD = radius;
    for (const place of this.init.places) {
      const p = this.project(place.coordinates.lon, place.coordinates.lat);
      if (!p.visible) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) {
        bestD = d;
        best = place.slug;
      }
    }
    return best;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.routeRaf);
    this.ro.disconnect();
    this.map.remove();
    this.init.container.style.background = "";
  }
}
