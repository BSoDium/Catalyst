import {
  BufferAttribute,
  DataTexture,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LineSegments,
  NearestFilter,
  RedFormat,
  UnsignedByteType,
  type Scene,
  type ShaderMaterial,
} from "three";
import type { GlobeRoute } from "../types";
import type { GlobeTheme } from "./colors";
import { clamp, easeInOutCubic, radiusPxToZoom } from "./geo";
import { pathMaterial } from "./materials";
import { coastLevel } from "./palette";
import { TUNING } from "./tuning";
import { FADE_FROM_CELLS, FADE_FULL_CELLS, farOf, TICK_FROM, levelFor, metresPerCell } from "../paths/lod";
import { buildBuffers, buildNetwork, legsAt, type PathBuffers, type PathNetwork } from "../paths/network";
import { fadeStraight, legKey, thinLegs, thinZoomOf, type ThinLeg } from "../paths/thin";

/** Marching speed of the dashes of a leg while it draws on, in px per second. */
const MARCH_PX_PER_S = 30;
/** Texels per row of the per-leg state texture. */
const STATE_ROW = 1024;
/** The state texel of a leg: none, starts at the selected place (the draw-on runs forwards), ends there (backwards). */
const STATE_NONE = 0;
const STATE_FWD = 128;
const STATE_REV = 255;
/** A leg thinned away at this zoom (`paths/thin.ts`): the vertex shader clips it (a value between `none` and the lit states). */
const STATE_HIDDEN = 26;
/** A straight leg quietened by its step 1..3 (`paths/thin.ts` `fadeStraight`): 52 + 4 per step, between hidden and lit (the vertex shader reads it). */
const STATE_QUIET = 52;

export interface PathStats {
  legs: number;
  /** Vertices (the finest level, shared by every level). */
  vertices: number;
  /** Segments per level, finest first. */
  levelSegments: number[];
  /** Bytes held by the GPU buffers (vertex attributes + indices) and the state texture. */
  bytes: number;
  /** The level drawn now, and the segments it draws. */
  level: number;
  drawnSegments: number;
  /** Draw calls this layer issues per frame (0 when it is off or empty). */
  drawCalls: number;
  /** Legs lit by the selected place. */
  lit: number;
  /** The overlay presence the layer is drawn at (0: nothing is drawn, the home screen's caption and ring are up). */
  presence: number;
}

/**
 * ALL the routes' legs, drawn faintly at all times, and the legs next to the selected place in full ink with a draw-on. One
 * instanced `LineSegments` for every mode (one draw call), built once: the selection is a texel per leg and a uniform, the zoom
 * picks a simplification level by `setDrawRange`. Idle cost is zero (nothing animates but the draw-on; `advance` reports whether
 * another frame is needed). The legs themselves come from `paths/network.ts`: a decoded polyline per leg, or the geodesic arc.
 */
export class RouteLayer {
  readonly network: PathNetwork;
  private buffers: PathBuffers | null = null;
  private line: LineSegments | null = null;
  private geometry: InstancedBufferGeometry | null = null;
  private material: ShaderMaterial | null = null;
  private state: DataTexture | null = null;
  private stateData = new Uint8Array(0);
  private level: number | null = null;
  private lit = new Set<number>();
  /** Legs thinned away at this zoom, the keys that stay (null: all) and what they were worked out for. */
  private hidden = new Set<number>();
  private kept: ReadonlySet<string> | null = null;
  /** Straight legs quietened at this view: leg index -> step, and by key (for the pictures of the modes). */
  private quiet = new Map<number, number>();
  private quietKeys: ReadonlyMap<string, number> | null = null;
  private thinList: ThinLeg[] | null = null;
  private thinSig = "";
  private litRoutes = new Set<string>();
  /** performance.now() at which the draw-on began, or null when the legs are complete. */
  private drawStart: number | null = null;
  private enabled = true;
  /** How present the overlay is (0..1, `LodTree.overlayAlpha`): the paths come and go with the boxes and labels. 0 draws nothing at all. */
  private presence = 1;
  private mPerCell = 0;
  private cssPerCell = 1;
  private finalLevel = 8;
  private ramp: GlobeTheme["ramp"] | null = null;
  private lengthByRoute = new Map<string, number[]>();

  constructor(
    private scene: Scene,
    routes: readonly GlobeRoute[],
  ) {
    this.network = buildNetwork(routes);
    if (this.network.legs.length === 0) return;
    const b = buildBuffers(this.network);
    this.buffers = b;
    const g = new InstancedBufferGeometry();
    g.setAttribute("position", new BufferAttribute(b.position, 3));
    g.setAttribute("aDist", new BufferAttribute(b.dist, 1));
    g.setAttribute("aInfo", new BufferAttribute(b.info, 4));
    g.setAttribute("aTan", new BufferAttribute(b.tangent, 3));
    // copies 1 and 2 are the rail's cross-ticks and the cross of every head's spark: always three
    g.setAttribute("aCopy", new InstancedBufferAttribute(Float32Array.from([0, 1, 2]), 1));
    g.instanceCount = 3;
    g.setIndex(new BufferAttribute(b.index, 1));
    this.geometry = g;

    const rows = Math.ceil(b.legCount / STATE_ROW);
    const width = Math.min(STATE_ROW, b.legCount);
    this.stateData = new Uint8Array(width * rows);
    const tex = new DataTexture(this.stateData, width, rows, RedFormat, UnsignedByteType);
    tex.minFilter = NearestFilter;
    tex.magFilter = NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    this.state = tex;

    const material = pathMaterial();
    material.uniforms.uState!.value = tex;
    material.uniforms.uTexSize!.value = [width, rows];
    material.uniforms.uFadeFrom!.value = FADE_FROM_CELLS;
    material.uniforms.uFadeFull!.value = FADE_FULL_CELLS;
    this.material = material;

    const line = new LineSegments(g, material);
    line.renderOrder = 4;
    line.frustumCulled = false;
    this.line = line;
    this.applyLevel(0);
    scene.add(line);
    for (const leg of this.network.legs) {
      const arr = this.lengthByRoute.get(leg.routeId) ?? [];
      arr.push(leg.index);
      this.lengthByRoute.set(leg.routeId, arr);
    }
  }

  /** Whether any leg exists (a projection without routes has no layer at all). */
  get empty(): boolean {
    return this.line === null;
  }

  private applyLevel(level: number) {
    if (!this.buffers || !this.geometry) return;
    this.level = level;
    const r = this.buffers.levels[level]!;
    this.geometry.setDrawRange(r.start, r.count);
  }

  /**
   * Light the legs next to the place (`placeKey`) and none other; none when `key` is null. With `animate` they draw on from the
   * place outwards (from `now`), else they are complete.
   */
  select(key: string | null, animate: boolean, now: number) {
    if (!this.state) return;
    this.stateData.fill(STATE_NONE);
    this.lit.clear();
    this.litRoutes.clear();
    if (key !== null) {
      for (const { leg, dir } of legsAt(this.network, key)) {
        this.stateData[leg] = dir === "fwd" ? STATE_FWD : STATE_REV;
        this.lit.add(leg);
        this.litRoutes.add(this.network.legs[leg]!.routeId);
      }
    }
    this.applyHidden();
    this.thinSig = ""; // the selected place's legs are never thinned: the next frame works it out again
    this.state.needsUpdate = true;
    const animating = animate && this.lit.size > 0;
    this.drawStart = animating ? now : null;
    this.setFront(animating ? 0 : 2, 0);
    this.updateVisible();
  }

  /** The legs thinned away, as the state of their texel (the lit ones are never hidden). */
  private applyHidden() {
    for (const [leg, step] of this.quiet) if (!this.lit.has(leg)) this.stateData[leg] = STATE_QUIET + 4 * (step - 1);
    for (const leg of this.hidden) if (!this.lit.has(leg)) this.stateData[leg] = STATE_HIDDEN;
  }

  /**
   * Thin the paths for the view (`paths/thin.ts`): `zoom` is the Web Mercator zoom that gives the centre's scale (the unified zoom less log2 of the
   * latitude's secant) and `cssPerCell` the art pixel. Cheap when the zoom has not moved by a quarter step or the selection has not changed.
   * Returns the keys of the legs that stay (null: all of them), for the pictures of the modes.
   */
  setThinning(zoom: number, cssPerCell: number, view = 0): ReadonlySet<string> | null {
    if (!this.state || this.network.legs.length === 0) return null;
    const z = thinZoomOf(zoom);
    const sig = `${z}|${cssPerCell}|${Math.round(view)}`;
    if (sig === this.thinSig) return this.kept;
    this.thinSig = sig;
    if (!this.thinList) {
      this.thinList = this.network.legs.map((leg) => {
        // a coarse level is plenty to tell which legs share a corridor
        const lvl = leg.levels[Math.min(2, leg.levels.length - 1)] ?? leg.levels[0]!;
        const pts: Array<readonly [number, number]> = [];
        for (const i of lvl) pts.push([leg.lonlat[i * 2]!, leg.lonlat[i * 2 + 1]!]);
        return { key: legKey(leg.routeId, leg.legIndex), parts: [pts], straight: leg.arc || leg.mode === "flight" };
      });
    }
    const list = this.thinList.map((l, i) => (this.lit.has(i) ? { ...l, lit: true } : l));
    const kept = thinLegs(list, z, cssPerCell);
    this.kept = kept;
    for (const leg of this.hidden) if (!this.lit.has(leg)) this.stateData[leg] = STATE_NONE;
    for (const leg of this.quiet.keys()) if (!this.lit.has(leg)) this.stateData[leg] = STATE_NONE;
    this.hidden.clear();
    this.quiet.clear();
    this.quietKeys = fadeStraight(list, z, view);
    if (this.quietKeys) this.thinList.forEach((l, i) => { const step = this.quietKeys!.get(l.key); if (step) this.quiet.set(i, step); });
    if (kept) this.thinList.forEach((l, i) => { if (!kept.has(l.key) && !this.lit.has(i)) this.hidden.add(i); });
    this.applyHidden();
    this.state.needsUpdate = true;
    return kept;
  }

  /** The "Paths" switch: off hides every path, on shows them (the selection is kept either way). */
  setEnabled(on: boolean) {
    this.enabled = on;
    this.updateVisible();
  }

  /**
   * The overlay's presence as a whole, taken from the same timed value that fades the boxes and labels (`LodTree.overlayAlpha`), on the same
   * clock: at 0 (the home screen's caption and ring) the layer does not draw at all, in between the colours mix toward the page colour in
   * the shader (solid, quantised to the fade's levels, never an alpha).
   */
  setPresence(a: number) {
    const v = clamp(a, 0, 1);
    if (v === this.presence) return;
    this.presence = v;
    if (this.material) this.material.uniforms.uPresence!.value = v;
    this.updateVisible();
  }

  get overlayPresence(): number {
    return this.presence;
  }

  private updateVisible() {
    if (this.line) this.line.visible = this.enabled && this.presence > 0;
  }

  /** Whether the layer is drawn now (on, and the overlay is present). */
  get visible(): boolean {
    return this.enabled && this.presence > 0;
  }

  /** The straight legs quietened at this view, by key with their step (null: none). */
  get quietLegs(): ReadonlyMap<string, number> | null {
    return this.quietKeys;
  }

  /** The keys (`paths/thin.ts` `legKey`) of the legs lit now. */
  litKeys(): string[] {
    return [...this.lit].map((i) => legKey(this.network.legs[i]!.routeId, this.network.legs[i]!.legIndex));
  }

  /** Ids of the routes with a leg lit now (measurement and tests). */
  shown(): string[] {
    return this.enabled && this.presence > 0 ? [...this.litRoutes] : [];
  }

  /** Leg ids lit now (checks). */
  litLegs(): number[] {
    return [...this.lit];
  }

  /** Reduced motion: the lit legs are complete and static. */
  finishAll() {
    this.drawStart = null;
    this.setFront(2, 0);
  }

  /** Advance any draw-on; returns true while another frame is needed. */
  advance(now: number): boolean {
    if (this.drawStart === null) return false;
    const elapsed = now - this.drawStart;
    const t = clamp(elapsed / TUNING.routeDrawMs, 0, 1);
    if (t >= 1) {
      this.drawStart = null;
      this.setFront(2, 0);
      return false;
    }
    this.setFront(easeInOutCubic(t), ((elapsed / 1000) * MARCH_PX_PER_S) / this.cssPerCell);
    return true;
  }

  private setFront(front: number, marchCells: number) {
    if (!this.material) return;
    this.material.uniforms.uFront!.value = front;
    this.material.uniforms.uMarch!.value = marchCells;
  }

  /**
   * Per-frame scale: `cssPerCell` is the art pixel in CSS px and `radiusPx` the globe's radius in CSS px. Sets the cell in world units
   * (the fade) and picks the simplification level (with hysteresis).
   */
  setScale(cssPerCell: number, radiusPx: number) {
    if (!this.material) return;
    this.cssPerCell = cssPerCell;
    this.mPerCell = metresPerCell(radiusPx, cssPerCell);
    this.material.uniforms.uCell!.value = cssPerCell / radiusPx;
    this.material.uniforms.uFar!.value = farOf(radiusPxToZoom(radiusPx));
    const ticks = radiusPxToZoom(radiusPx) >= TICK_FROM;
    this.material.uniforms.uTickOn!.value = ticks ? 1 : 0;
    // copies 1 and 2 (the rail's cross-ticks) are discarded by the fragment shader until the ticks are on: do not send them through the vertex stage
    // and the rasteriser (a third of the work, at every view from the world to the continent, where the paths are drawn most)
    if (this.geometry) this.geometry.instanceCount = ticks ? 3 : 1;
    const level = levelFor(this.mPerCell, this.level);
    if (level !== this.level) this.applyLevel(level);
  }

  /** 1 = lifted arcs, 0 = flat on the ground (handover: they flatten before the street map takes over). */
  setLift(lift: number) {
    if (this.material) this.material.uniforms.uLift!.value = lift;
  }

  /** One buffer pixel in clip space (y flipped). */
  setPixelSize(bufW: number, bufH: number) {
    if (this.material) this.material.uniforms.uPixel!.value = [2 / bufW, -2 / bufH];
  }

  applyTheme(t: GlobeTheme) {
    this.ramp = t.ramp;
    if (!this.material) return;
    this.material.uniforms.uPage!.value.setRGB(...t.background);
    // The paths' colours for this scheme (paths/trail.ts): a theme change is these uniforms only, the geometry is untouched.
    const trail = this.material.uniforms.uTrail!.value as { setRGB(r: number, g: number, b: number): void }[];
    for (let k = 0; k < trail.length; k++) {
      const c = t.trail[k]!;
      trail[k]!.setRGB(...c);
    }
    // A short leg fades in over this many solid mixes toward the page (the borders' staircase): the palette's `coast` level.
    this.finalLevel = coastLevel(t.ramp.length);
    this.material.uniforms.uFinal!.value = this.finalLevel;
  }

  /** The grey tone the old faint legs had and the ink (kept for the checks that compare with the map's own tones). */
  tones() {
    return this.ramp ? { faint: this.ramp[this.finalLevel]!, ink: this.ramp[this.ramp.length - 1]! } : null;
  }

  stats(): PathStats {
    const b = this.buffers;
    if (!b) return { legs: 0, vertices: 0, levelSegments: [], bytes: 0, level: 0, drawnSegments: 0, drawCalls: 0, lit: 0, presence: this.presence };
    const level = this.level ?? 0;
    return {
      legs: b.legCount,
      vertices: b.vertexCount,
      levelSegments: b.levels.map((l) => l.count / 2),
      bytes: b.position.byteLength + b.dist.byteLength + b.info.byteLength + b.tangent.byteLength + b.index.byteLength + this.stateData.byteLength,
      level,
      drawnSegments: b.levels[level]!.count / 2,
      drawCalls: this.enabled && this.presence > 0 ? 1 : 0,
      lit: this.lit.size,
      presence: this.presence,
    };
  }

  dispose() {
    if (this.line) this.scene.remove(this.line);
    this.geometry?.dispose();
    this.material?.dispose();
    this.state?.dispose();
    this.line = null;
    this.geometry = null;
    this.material = null;
    this.state = null;
    this.buffers = null;
  }
}
