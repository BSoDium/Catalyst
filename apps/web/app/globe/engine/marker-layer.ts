import { BufferAttribute, BufferGeometry, Points } from "three";
import type { GlobePlace } from "../types";
import type { GlobeTheme } from "./colors";
import { lonLatToVec3 } from "./geo";
import { MARKER_STATE, markerMaterial } from "./materials";

/** GL points at the places' TRUE coordinates; the depth occluder hides the far side. */
export class MarkerLayer {
  readonly points: Points;
  private material = markerMaterial();
  private geometry = new BufferGeometry();
  private state: Float32Array;
  private index = new Map<string, number>();

  constructor(places: readonly GlobePlace[]) {
    const pos = new Float32Array(places.length * 3);
    this.state = new Float32Array(places.length);
    places.forEach((p, i) => {
      pos.set(lonLatToVec3(p.lon, p.lat), i * 3);
      this.index.set(p.slug, i);
    });
    this.geometry.setAttribute("position", new BufferAttribute(pos, 3));
    this.geometry.setAttribute("aState", new BufferAttribute(this.state, 1));
    this.points = new Points(this.geometry, this.material);
    this.points.renderOrder = 5;
    this.points.frustumCulled = false;
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

  applyTheme(t: GlobeTheme) {
    this.material.uniforms.uColor!.value.setRGB(...t.ink);
    this.material.uniforms.uFill!.value.setRGB(...t.background);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
