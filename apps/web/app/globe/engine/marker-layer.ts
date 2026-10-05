import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Points } from "three";
import type { GlobePlace } from "../types";
import type { GlobeTheme } from "./colors";
import { MARKER_STATE, markerMaterial } from "./materials";

/**
 * One GL point per place, drawn as a whole or not at all. The renderer projects each place on the CPU (the same
 * projection labels and picking use), snaps it to an art pixel and decides visibility from the marker centre
 * (`visibility.ts`); this layer just draws the result with no depth test, so the globe can never cut a marker.
 * The `position` attribute therefore carries (buffer-pixel centre x, y, shown) instead of a 3D position.
 */
export class MarkerLayer {
  readonly points: Points;
  private material = markerMaterial();
  private geometry = new BufferGeometry();
  private state: Float32Array;
  private index = new Map<string, number>();
  private probe = false;
  private theme: GlobeTheme | null = null;

  constructor(places: readonly GlobePlace[]) {
    const pos = new Float32Array(places.length * 3); // x, y, shown: filled by `setScreen` before each frame
    this.state = new Float32Array(places.length);
    places.forEach((p, i) => this.index.set(p.slug, i));
    this.geometry.setAttribute("position", new BufferAttribute(pos, 3).setUsage(DynamicDrawUsage));
    this.geometry.setAttribute("aState", new BufferAttribute(this.state, 1));
    this.points = new Points(this.geometry, this.material);
    // Last of all (after the horizon outline, scene.ts), so nothing can draw over a marker and cut it.
    this.points.renderOrder = 7;
    this.points.frustumCulled = false;
  }

  /** Drawing buffer size in pixels (the points are placed in buffer pixels). */
  setBufferSize(w: number, h: number) {
    this.material.uniforms.uBuf!.value.set(w, h);
  }

  /**
   * Place marker `i` at the centre of buffer pixel (`col`, `row`, row 0 at the top), or hide it. Call
   * `commitScreen` once after all of them.
   */
  setScreen(i: number, col: number, row: number, shown: boolean) {
    const a = this.geometry.getAttribute("position") as BufferAttribute;
    a.setXYZ(i, col + 0.5, row + 0.5, shown ? 1 : 0);
  }

  commitScreen() {
    this.geometry.getAttribute("position").needsUpdate = true;
  }

  /** Precedence: selected, then focused, then stops of the selected place's route, then normal. */
  setStates(selected: string | null, focused: string | null, routeStops: ReadonlySet<string>) {
    this.state.fill(MARKER_STATE.normal);
    for (const slug of routeStops) this.mark(slug, MARKER_STATE.routeStop);
    this.mark(focused, MARKER_STATE.focused);
    this.mark(selected, MARKER_STATE.selected);
    this.geometry.getAttribute("aState").needsUpdate = true;
  }

  private mark(slug: string | null, value: number) {
    const i = slug === null ? undefined : this.index.get(slug);
    if (i !== undefined) this.state[i] = value;
  }

  /**
   * Measurement only: draw marker ink in pure red and marker fill in pure blue, so a pixel readout can tell marker
   * pixels from the identical-looking linework under and around them.
   */
  setProbe(on: boolean) {
    this.probe = on;
    if (this.theme) this.applyTheme(this.theme);
  }

  applyTheme(t: GlobeTheme) {
    this.theme = t;
    this.material.uniforms.uColor!.value.setRGB(...(this.probe ? ([1, 0, 0] as const) : t.ink));
    this.material.uniforms.uFill!.value.setRGB(...(this.probe ? ([0, 0, 1] as const) : t.background));
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
