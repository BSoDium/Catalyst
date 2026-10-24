import type { Polylines } from "@catalyst/geodata";
import {
  BufferAttribute,
  BufferGeometry,
  LineLoop,
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  LineSegments,
  Mesh,
  Points,
  RedFormat,
  RepeatWrapping,
  UnsignedByteType,
  type PerspectiveCamera,
  Scene,
  SphereGeometry,
  type ShaderMaterial,
} from "three";
import type { GlobePlace, GlobeRoute } from "../types";
import type { GlobeTheme, Rgb } from "./colors";
import { FadeArray, clockStep } from "./fade";
import { borderLevel, bordersWanted } from "./palette";
import type { ViewBasis } from "./geo";
import { zoomToRadiusPx } from "./geo";
import { LAND_H, LAND_W, landMask } from "./land";
import { GRATICULE_STEP_DEG, graticuleSegments, polylinesToSegments } from "./geometry";
import { OCCLUDER_RADIUS, atmosphereMaterial, cityMaterial, lineMaterial, occluderMaterial, silhouetteMaterial } from "./materials";
import { RouteLayer } from "./route-layer";
import { SKY_STATE, viewToGalactic } from "./sky";
import { SkyLayer } from "./sky-layer";
import { routeLift } from "./view";
import { TUNING } from "./tuning";


/** How much of the ink the filled land has (the rest is the page's colour): near the ink, as the letters' metal is. */
const LAND_SHARE = 0.86;
/** The most lights (places) the planet shows at the chord. */
const CITY_LIGHTS = 16;

function segmentGeometry(positions: Float32Array): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(positions, 3));
  return g;
}

/**
 * Everything drawn: sky, disc, graticule, borders, coastlines, routes, markers, horizon outline.
 * Owns its GL-side resources (`dispose` frees them all). Knows nothing about input, DOM or scheduling.
 */
export class GlobeScene {
  readonly scene = new Scene();
  readonly routes: RouteLayer;
  /** The Milky Way and the stars behind the earth (engine/sky-layer.ts), or null when the page switched them off (`applySkyFlags`). */
  readonly sky: SkyLayer | null;

  private geometries: BufferGeometry[] = [];
  private materials: ShaderMaterial[] = [];
  private occluder = occluderMaterial();
  private city = cityMaterial();
  private atmosphere = atmosphereMaterial();
  private atmosphereMesh: Mesh | null = null;
  private atmosphereNow = 0;
  private cityNow = 0;
  private coastData: Polylines | null = null;
  private landTex: DataTexture | null = null;
  private landNow = 0;
  private landFill: Rgb = [0, 0, 0];
  private graticule = lineMaterial(1, 3);
  private borders = lineMaterial(1);
  private bordersLines: LineSegments | null = null;
  private ramp: readonly Rgb[] = [];
  private borderLevelNow = -1;
  /** The borders are ON or OFF (decided from the zoom with a hysteresis), and their tone runs to it by time: a timed fade, never a resting grey. */
  private borderFade = new FadeArray(1);
  private bordersOn = false;
  private bordersSeen = false;
  private lastClock = 0;
  private coast = lineMaterial(1);
  private silhouette = silhouetteMaterial();

  constructor(data: {
    places: readonly GlobePlace[];
    routes: readonly GlobeRoute[];
    coastlines: Polylines;
    borders: Polylines;
  }) {
    this.materials.push(this.occluder, this.city, this.atmosphere, this.graticule, this.borders, this.coast, this.silhouette);
    this.coastData = data.coastlines;

    const disc = new SphereGeometry(OCCLUDER_RADIUS, 96, 48);
    this.geometries.push(disc);
    this.add(new Mesh(disc, this.occluder), 0);

    // Each layer is drawn in a fixed order (renderOrder) over the disc: grid, borders, coast, routes, horizon outline,
    // markers (last, so nothing can draw over a marker).
    // the atmosphere shell (the cinematic interlude's: hidden, and not drawn at all, outside it)
    const shell = new SphereGeometry(1.04, 96, 48);
    this.geometries.push(shell);
    this.atmosphereMesh = new Mesh(shell, this.atmosphere);
    this.atmosphereMesh.visible = false;
    this.atmosphereMesh.frustumCulled = false;
    this.add(this.atmosphereMesh, 0.5);

    this.add(new LineSegments(this.track(segmentGeometry(graticuleSegments(GRATICULE_STEP_DEG, 3))), this.graticule), 1);
    this.bordersLines = new LineSegments(this.track(segmentGeometry(polylinesToSegments(data.borders, 1))), this.borders);
    this.add(this.bordersLines, 2);
    this.add(new LineSegments(this.track(segmentGeometry(polylinesToSegments(data.coastlines, 1))), this.coast), 3);

    // the places' lights: a dot for each of the owner's places, one for those within two degrees of another (a city and its districts are one light), a few
    const lights: number[] = [];
    const taken = new Set<string>();
    for (const pl of data.places) {
      const key = `${Math.round(pl.lon / 2)},${Math.round(pl.lat / 2)}`;
      if (taken.has(key) || lights.length >= CITY_LIGHTS * 3) continue;
      taken.add(key);
      const cl = Math.cos((pl.lat * Math.PI) / 180);
      const lam = (pl.lon * Math.PI) / 180;
      lights.push(1.003 * cl * Math.sin(lam), 1.003 * Math.sin((pl.lat * Math.PI) / 180), 1.003 * cl * Math.cos(lam));
    }
    if (lights.length) {
      const cityPoints = new Points(this.track(segmentGeometry(new Float32Array(lights))), this.city);
      cityPoints.frustumCulled = false;
      this.add(cityPoints as unknown as Mesh, 7);
    }
    this.routes = new RouteLayer(this.scene, data.routes);
    this.sky = SKY_STATE.enabled ? new SkyLayer(this.scene) : null;

    const N = 360;
    const angle = new Float32Array(N);
    for (let i = 0; i < N; i++) angle[i] = (i / N) * Math.PI * 2;
    const ring = this.track(new BufferGeometry());
    ring.setAttribute("position", new BufferAttribute(new Float32Array(N * 3), 3));
    ring.setAttribute("aAngle", new BufferAttribute(angle, 1));
    const outline = new LineLoop(ring, this.silhouette);
    outline.frustumCulled = false;
    this.add(outline, 6);
  }

  private track(g: BufferGeometry): BufferGeometry {
    this.geometries.push(g);
    return g;
  }

  private add(object: Mesh | LineSegments | LineLoop, renderOrder: number) {
    object.renderOrder = renderOrder;
    this.scene.add(object);
  }

  applyTheme(t: GlobeTheme) {
    // The disc is the ocean: exactly the page colour, so the far side stays hidden without a visible body.
    this.occluder.uniforms.uColor!.value.setRGB(...t.background);
    // the land the interlude fills: the ink, taken a little towards the page (a fill of the full ink is the loudest thing on the page), and the borders over it the page's
    this.landFill = [0, 1, 2].map((i) => t.background[i]! + (t.ink[i]! - t.background[i]!) * LAND_SHARE) as unknown as Rgb;
    this.occluder.uniforms.uFill!.value.setRGB(...this.landFill);
    this.borders.uniforms.uAlt!.value.setRGB(...t.background);
    // the accent, as the page has it in this scheme (app.css `--palette-blue`; the lighter step on the dark page)
    if (t.scheme === "dark") this.city.uniforms.uColor!.value.setRGB(0.29, 0.64, 0.96);
    else this.city.uniforms.uColor!.value.setRGB(0, 0.47, 0.84);
    this.atmosphere.uniforms.uColor!.value.copy(this.city.uniforms.uColor!.value);
    // (the accent is loud on the light page: fewer dots there)
    this.atmosphere.uniforms.uCover!.value = t.scheme === "dark" ? 0.5 : 0.34;
    this.graticule.uniforms.uColor!.value.setRGB(...t.grid);
    this.ramp = t.ramp;
    this.borderLevelNow = -1;
    this.coast.uniforms.uColor!.value.setRGB(...t.coast);
    this.silhouette.uniforms.uColor!.value.setRGB(...t.outline);
    this.routes.applyTheme(t);
    this.sky?.applyTheme(t);
  }

  /**
   * Make the land mask now (engine/land.ts: a few milliseconds and 2 MB; the interlude is planned, so it is done before it begins and not in the frame
   * that starts it). Idempotent.
   */
  prepareLand() {
    if (this.landTex || !this.coastData) return;
    const tex = new DataTexture(landMask(this.coastData), LAND_W, LAND_H, RedFormat, UnsignedByteType);
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearFilter;
    tex.wrapS = RepeatWrapping;
    tex.wrapT = ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;
    this.landTex = tex;
    this.occluder.uniforms.uLandMap!.value = tex;
  }

  /** The sun's direction in the earth's frame (the planet's light; the letters have the same one in the camera's frame). */
  setSun(x: number, y: number, z: number) {
    this.atmosphere.uniforms.uSun!.value = [x, y, z];
    this.occluder.uniforms.uSun!.value = [x, y, z];
    this.city.uniforms.uSun!.value = [x, y, z];
  }

  /** The atmosphere, 0 (none: the shell is not drawn) to 1: a thin dithered glow round the limb, in the accent. */
  setAtmosphere(k: number, shell?: number) {
    const x = Math.min(1, Math.max(0, k));
    if (Math.abs(x - this.atmosphereNow) < 0.01 && !(x === 0 && this.atmosphereNow !== 0)) return;
    this.atmosphereNow = x;
    this.atmosphere.uniforms.uAmt!.value = x;
    if (shell !== undefined) this.atmosphere.uniforms.uShell!.value = shell;
    if (this.atmosphereMesh) this.atmosphereMesh.visible = x > 0;
  }

  /** The places' lights, 0 (out) to 1: they come up through the dither. */
  setCity(k: number) {
    const x = Math.min(1, Math.max(0, k));
    if (Math.abs(x - this.cityNow) < 0.01 && !(x === 0 && this.cityNow !== 0)) return;
    this.cityNow = x;
    this.city.uniforms.uCity!.value = x;
  }

  /**
   * The continents are filled with the ink, 0 (not at all) to 1: the borders go to the page's colour over it so that they stay seen, the coastlines
   * (the ink's own tone) are the fill's edge. A change of a hundredth or more is written.
   */
  setLand(k: number) {
    const x = Math.min(1, Math.max(0, k));
    if (x > 0 && !this.landTex) this.prepareLand();
    if (Math.abs(x - this.landNow) < 0.01 && !(x === 0 && this.landNow !== 0)) return;
    this.landNow = x;
    this.occluder.uniforms.uLand!.value = x;
    this.borders.uniforms.uAltAmt!.value = x;
  }

  /** Whether the borders' fade has not reached its end: the frame loop must keep going. */
  get animating(): boolean {
    return this.borderFade.moving || (this.sky?.animating ?? false);
  }

  /** The borders' fade now (0..1) and whether they are wanted (checks). */
  borderState() {
    return { value: this.borderFade.value(0), on: this.bordersOn };
  }

  /** Run the borders' and the sky's fades to their end (checks). */
  settleBorders() {
    this.borderFade.settle();
    this.sky?.settle();
  }

  /**
   * Per-frame sky: the view-to-galactic matrix of this camera at the earth rotation angle `era`, and where the earth's silhouette is in
   * the buffer. Call after the camera's matrices are current. `bufW`, `bufH` and `shiftBuf` are the drawing buffer and the inset's shift (buffer px).
   */
  syncSky(camera: PerspectiveCamera, basis: ViewBasis, era: number, buf: { w: number; h: number; shift: number; lift?: number }, now: number, instant: boolean) {
    this.sky?.sync({ viewToGal: viewToGalactic(basis, era), projInv: camera.projectionMatrixInverse, d: basis.d, bufW: buf.w, bufH: buf.h, shiftBuf: buf.shift, liftBuf: buf.lift ?? 0 }, now, instant);
  }

  /** The keys of the legs that stay at this zoom (`RouteLayer.setThinning`), null: all. */
  kept: ReadonlySet<string> | null = null;

  /** Per-frame uniforms that depend on the camera. `now` is the clock (ms) the border fade runs on; `instant`: reduced motion. */
  syncCamera(basis: ViewBasis, zoom: number, pixel: number, now: number, instant: boolean, lat = 0, view = 0) {
    this.routes.setLift(routeLift(zoom));
    this.routes.setScale(pixel, zoomToRadiusPx(zoom));
    // the Web Mercator zoom with the scale the centre has on the globe (the unified zoom less log2 of the secant of the latitude)
    this.kept = this.routes.setThinning(zoom + Math.log2(Math.max(0.05, Math.cos((lat * Math.PI) / 180))), pixel, view);
    // Borders: on from the zoom `TUNING.borderZoom` (a hysteresis), off below. The fade is a timed TONE (a line is always solid): the faintest
    // grey level stepping up through the palette to the coast level (the coastline's, `borderLevel`) over `FADE_MS`, whatever the camera does, so the globe
    // at rest never shows a half-faded border. Never a dither: a low-coverage dither on 1px lines reads as noise instead of a fade.
    this.bordersOn = bordersWanted(this.bordersOn, zoom, TUNING.borderZoom);
    if (!this.bordersSeen) {
      this.bordersSeen = true; // the first frame starts in its state
      this.borderFade.snap(0, this.bordersOn);
    } else this.borderFade.set(0, this.bordersOn);
    if (this.borderFade.moving) this.borderFade.step(clockStep(this.lastClock, now), instant);
    this.lastClock = now;
    this.setBorderLevel(borderLevel(this.borderFade.value(0), this.ramp.length));
    const u = this.silhouette.uniforms;
    u.uC!.value = basis.c;
    u.uE!.value = basis.east;
    u.uN!.value = basis.north;
    u.uInvD!.value = 1 / basis.d;
  }

  private setBorderLevel(level: number) {
    if (level === this.borderLevelNow || !this.bordersLines) return;
    this.borderLevelNow = level;
    this.bordersLines.visible = level > 0;
    if (level > 0) this.borders.uniforms.uColor!.value.setRGB(...this.ramp[level]!);
  }

  dispose() {
    this.landTex?.dispose();
    this.routes.dispose();
    this.sky?.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries = [];
    this.materials = [];
    this.scene.clear();
  }
}
