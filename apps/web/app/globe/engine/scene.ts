import type { Polylines } from "@catalyst/geodata";
import {
  BufferAttribute,
  BufferGeometry,
  LineLoop,
  LineSegments,
  Mesh,
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
import { graticuleSegments, polylinesToSegments } from "./geometry";
import { OCCLUDER_RADIUS, lineMaterial, occluderMaterial, silhouetteMaterial } from "./materials";
import { RouteLayer } from "./route-layer";
import { routeLift } from "./view";
import { TUNING } from "./tuning";

/** Route dash period in art pixels. */
const ROUTE_DASH_PX = 7;

function segmentGeometry(positions: Float32Array): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(positions, 3));
  return g;
}

/**
 * Everything drawn: disc, graticule, borders, coastlines, routes, markers, horizon outline.
 * Owns its GL-side resources (`dispose` frees them all). Knows nothing about input, DOM or scheduling.
 */
export class GlobeScene {
  readonly scene = new Scene();
  readonly routes: RouteLayer;

  private geometries: BufferGeometry[] = [];
  private materials: ShaderMaterial[] = [];
  private occluder = occluderMaterial();
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
    this.materials.push(this.occluder, this.graticule, this.borders, this.coast, this.silhouette);

    const disc = new SphereGeometry(OCCLUDER_RADIUS, 96, 48);
    this.geometries.push(disc);
    this.add(new Mesh(disc, this.occluder), 0);

    // Each layer is drawn in a fixed order (renderOrder) over the disc: grid, borders, coast, routes, horizon outline,
    // markers (last, so nothing can draw over a marker).
    this.add(new LineSegments(this.track(segmentGeometry(graticuleSegments(15, 3))), this.graticule), 1);
    this.bordersLines = new LineSegments(this.track(segmentGeometry(polylinesToSegments(data.borders, 1))), this.borders);
    this.add(this.bordersLines, 2);
    this.add(new LineSegments(this.track(segmentGeometry(polylinesToSegments(data.coastlines, 1))), this.coast), 3);

    this.routes = new RouteLayer(this.scene, data.routes);

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
    this.graticule.uniforms.uColor!.value.setRGB(...t.grid);
    this.ramp = t.ramp;
    this.borderLevelNow = -1;
    this.coast.uniforms.uColor!.value.setRGB(...t.coast);
    this.silhouette.uniforms.uColor!.value.setRGB(...t.outline);
    this.routes.applyTheme(t);
  }

  /** Whether the borders' fade has not reached its end: the frame loop must keep going. */
  get animating(): boolean {
    return this.borderFade.moving;
  }

  /** The borders' fade now (0..1) and whether they are wanted (checks). */
  borderState() {
    return { value: this.borderFade.value(0), on: this.bordersOn };
  }

  /** Run the borders' fade to its end (checks). */
  settleBorders() {
    this.borderFade.settle();
  }

  /** Per-frame uniforms that depend on the camera. `now` is the clock (ms) the border fade runs on; `instant`: reduced motion. */
  syncCamera(basis: ViewBasis, zoom: number, pixel: number, now: number, instant: boolean) {
    this.routes.setLift(routeLift(zoom));
    this.routes.setPeriod((ROUTE_DASH_PX * pixel) / zoomToRadiusPx(zoom));
    // Borders: on from the zoom `TUNING.borderZoom` (a hysteresis), off below. The fade is a timed TONE (a line is always solid): the faintest
    // grey level stepping up through the palette to the peak level (the coastline's) over `FADE_MS`, whatever the camera does, so the globe
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
    this.routes.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries = [];
    this.materials = [];
    this.scene.clear();
  }
}
