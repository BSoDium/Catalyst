import { BufferAttribute, BufferGeometry, LineSegments, type Scene, type ShaderMaterial } from "three";
import type { GlobeRoute } from "../types";
import type { GlobeTheme } from "./colors";
import { clamp, easeInOutCubic } from "./geo";
import { routeBuffers } from "./geometry";
import { routeMaterial } from "./materials";
import { TUNING } from "./tuning";

interface Entry {
  route: GlobeRoute;
  line: LineSegments;
  material: ShaderMaterial;
  /** Arc length in radians. */
  length: number;
  /** performance.now() at which the draw-on began, or null when the route is fully drawn. */
  drawStart: number | null;
}

/** Marching speed of the dashes while a route draws on, in px per second. */
const MARCH_PX_PER_S = 30;

/**
 * Curated routes only: one line per entry of the `routes` prop, built from its ordered points. A route is NOT drawn
 * unless one of its stops is the selected place (`show`): none on the world view, none while nothing is selected. The
 * selected place's routes play their draw-on once when motion is allowed, else they are complete and static. Idle cost is
 * zero: hidden lines are not rendered, and `advance` reports `false` when nothing is animating.
 */
export class RouteLayer {
  private entries: Entry[] = [];

  constructor(
    private scene: Scene,
    routes: readonly GlobeRoute[],
  ) {
    for (const route of routes) {
      if (route.points.length < 2) continue;
      const b = routeBuffers(route);
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(b.position, 3));
      g.setAttribute("aDist", new BufferAttribute(b.distance, 1));
      g.setAttribute("aOff", new BufferAttribute(b.offset, 2));
      const material = routeMaterial();
      material.uniforms.uProgress!.value = b.length + 1;
      const line = new LineSegments(g, material);
      line.renderOrder = 4;
      line.frustumCulled = false;
      line.visible = false;
      scene.add(line);
      this.entries.push({ route, line, material, length: b.length, drawStart: null });
    }
  }

  /**
   * Show exactly the routes in `ids` (none when empty) and hide every other. With `animate` the shown routes draw on from
   * the start (`now`), else they are complete.
   */
  show(ids: ReadonlySet<string>, animate: boolean, now: number) {
    for (const e of this.entries) {
      const on = ids.has(e.route.id);
      e.line.visible = on;
      e.drawStart = on && animate ? now : null;
      this.set(e, on && animate ? 0 : e.length + 1, 0);
    }
  }

  /** Ids of the routes shown now (measurement and tests). */
  shown(): string[] {
    return this.entries.filter((e) => e.line.visible).map((e) => e.route.id);
  }

  /** Reduced motion: the shown routes are complete and static. */
  finishAll() {
    for (const e of this.entries) {
      e.drawStart = null;
      this.set(e, e.length + 1, 0);
    }
  }

  /** Advance any draw-on; returns true while another frame is needed. */
  advance(now: number, radiusPx: number): boolean {
    let more = false;
    for (const e of this.entries) {
      if (e.drawStart === null) continue;
      const elapsed = now - e.drawStart;
      const t = clamp(elapsed / TUNING.routeDrawMs, 0, 1);
      if (t >= 1) {
        e.drawStart = null;
        this.set(e, e.length + 1, 0);
      } else {
        this.set(e, easeInOutCubic(t) * e.length, ((elapsed / 1000) * MARCH_PX_PER_S) / radiusPx);
        more = true;
      }
    }
    return more;
  }

  private set(e: Entry, progress: number, offset: number) {
    e.material.uniforms.uProgress!.value = progress;
    e.material.uniforms.uOffset!.value = offset;
  }

  /** Per-frame: dash period in world units, so dashes keep a constant on-screen length. */
  setPeriod(period: number) {
    for (const e of this.entries) e.material.uniforms.uPeriod!.value = period;
  }

  /** 1 = lifted arcs, 0 = flat on the ground (handover: they flatten before the street map takes over). */
  setLift(lift: number) {
    for (const e of this.entries) e.material.uniforms.uLift!.value = lift;
  }

  /** One buffer pixel in clip space (y flipped), for the 2x2 stroke. */
  setPixelSize(bufW: number, bufH: number) {
    for (const e of this.entries) e.material.uniforms.uPixel!.value = [2 / bufW, -2 / bufH];
  }

  applyTheme(t: GlobeTheme) {
    for (const e of this.entries) e.material.uniforms.uColor!.value.setRGB(...t.ink);
  }

  dispose() {
    for (const e of this.entries) {
      this.scene.remove(e.line);
      e.line.geometry.dispose();
      e.material.dispose();
    }
    this.entries = [];
  }
}
