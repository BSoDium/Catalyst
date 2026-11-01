import {
  BufferAttribute,
  DataTexture,
  InstancedBufferAttribute,
  DynamicDrawUsage,
  InstancedBufferGeometry,
  LineSegments,
  Matrix4,
  NearestFilter,
  RedFormat,
  UnsignedByteType,
  type Camera,
  type Scene,
  type ShaderMaterial,
} from "three";
import type { GlobeRoute } from "../types";
import type { GlobeTheme } from "./colors";
import { clamp, easeInOutCubic, radiusPxToZoom } from "./geo";
import { pathMaterial } from "./materials";
import { coastLevel } from "./palette";
import { TUNING } from "./tuning";
import { dotCell, farOf, TICK_FROM, levelFor, metresPerCell } from "../paths/lod";
import { buildBuffers, buildNetwork, legsAt, type PathBuffers, type PathNetwork } from "../paths/network";
import { crowdLegs, fadeStraight, legKey, mercatorPx, thinLegs, thinZoomFor, windowFor, type ThinLeg, type WindowAnchor } from "../paths/thin";

/** Marching speed of the dashes of a leg while it draws on, in px per second. */
const MARCH_PX_PER_S = 30;
/** Texels per row of the per-leg state texture. */
const STATE_ROW = 1024;
/** The state texel of a leg: none, starts at the selected place (the draw-on runs forwards), ends there (backwards). */
const STATE_NONE = 0;
const STATE_FWD = 128;
const STATE_REV = 255;
/**
 * The state of a leg that is not selected is a small number of bits, all below the lit states (the vertex shader reads them): `quiet` (0..3, a straight line
 * quietened up close, `paths/thin.ts` `fadeStraight`) + 4 x `crowd` (0..3, how crowded its place is: drawn as a quiet solid line, `crowdLegs`). A leg is never
 * clipped by its state: the globe does not thin legs away (the first versions did, by length and by shared corridor, and legs came and went as the zoom
 * stepped: #459). `thinLegs` still says which legs stay for the pictures of the modes, and the street map thins with it.
 */
const STATE_CROWD = 4;

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
  /** The keys of the legs that stay at this zoom (null: all), for the pictures of the modes. */
  private kept: ReadonlySet<string> | null = null;
  /** Straight legs quietened at this view: leg index -> step, and by key (for the pictures of the modes). */
  private quiet = new Map<number, number>();
  /** Legs in a crowd at this view: leg index -> step (1..3). */
  private crowd = new Map<number, number>();
  private quietKeys: ReadonlyMap<string, number> | null = null;
  private thinList: ThinLeg[] | null = null;
  private thinSig = "";
  /** The thinning zoom in force (`thinZoomFor` keeps it through a hysteresis) and the grid point of the window it was worked out for (`windowFor`). */
  private thinZoom: number | null = null;
  private thinAnchor: WindowAnchor | null = null;
  private litRoutes = new Set<string>();
  /** The flights' vertex runs (first vertex, count) and the screen length along them (`syncScreen`): the dots of an arc are laid out on the screen, not on the ground (#483). */
  private flightRuns: { from: number; count: number }[] = [];
  private screenLen: BufferAttribute | null = null;
  private screenMat = new Matrix4();
  private screenKey = new Float64Array(19);
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
    let first = 0;
    for (const leg of this.network.legs) {
      const n = leg.lonlat.length / 2;
      if (leg.mode === "flight") this.flightRuns.push({ from: first, count: n });
      first += n;
    }
    this.screenLen = new BufferAttribute(new Float32Array(b.vertexCount), 1).setUsage(DynamicDrawUsage);
    g.setAttribute("aScr", this.screenLen);
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
    this.applyTones();
    this.thinSig = ""; // the selected place's legs are never thinned: the next frame works it out again
    this.state.needsUpdate = true;
    const animating = animate && this.lit.size > 0;
    this.drawStart = animating ? now : null;
    this.setFront(animating ? 0 : 2, 0);
    this.updateVisible();
  }

  /** The quietened and crowded legs, as the state of their texel (the lit ones keep theirs). */
  private applyTones() {
    const bits = new Map<number, number>();
    for (const [leg, step] of this.quiet) bits.set(leg, step);
    for (const [leg, step] of this.crowd) bits.set(leg, (bits.get(leg) ?? 0) + STATE_CROWD * step);
    for (const [leg, v] of bits) if (!this.lit.has(leg)) this.stateData[leg] = v;
  }

  /**
   * Thin the paths for the view (`paths/thin.ts`): `zoom` is the Web Mercator zoom that gives the centre's scale (the unified zoom less log2 of the
   * latitude's secant) and `cssPerCell` the art pixel. Cheap when the zoom has not moved by a quarter step (with a hysteresis, so a zoom that rests at a
   * boundary does not thin again and again), the view has not moved by half a screen, or the selection has not changed. `centre`: where the view is, for
   * the window the thinning is worked out in (the cells of the legs are only counted where the screen can be: without it the cost doubled with every
   * zoom level). Returns the keys of the legs that stay (null: all of them), for the pictures of the modes.
   */
  setThinning(zoom: number, cssPerCell: number, view = 0, centre?: { lon: number; lat: number }): ReadonlySet<string> | null {
    if (!this.state || this.network.legs.length === 0) return null;
    const z = thinZoomFor(zoom, this.thinZoom);
    let win: ReturnType<typeof windowFor> = null;
    if (centre) {
      const [cx, cy] = mercatorPx(centre.lon, centre.lat, z);
      win = windowFor(cx, cy, view, z, this.thinZoom === z ? this.thinAnchor : null);
    }
    const sig = `${z}|${cssPerCell}|${Math.round(view)}|${win ? `${win.anchor.ix},${win.anchor.iy}` : "-"}`;
    if (sig === this.thinSig) return this.kept;
    this.thinSig = sig;
    this.thinZoom = z;
    this.thinAnchor = win?.anchor ?? null;
    if (!this.thinList) {
      this.thinList = this.network.legs.map((leg) => {
        // a coarse level is plenty to tell which legs share a corridor
        const lvl = leg.levels[Math.min(2, leg.levels.length - 1)] ?? leg.levels[0]!;
        const pts: Array<readonly [number, number]> = [];
        for (const i of lvl) pts.push([leg.lonlat[i * 2]!, leg.lonlat[i * 2 + 1]!]);
        return { key: legKey(leg.routeId, leg.legIndex), parts: [pts], ends: [leg.fromKey, leg.toKey] as const, straight: leg.arc || leg.mode === "flight" };
      });
    }
    const list = this.thinList.map((l, i) => (this.lit.has(i) ? { ...l, lit: true } : l));
    const kept = thinLegs(list, z, cssPerCell, win?.window ?? null);
    this.kept = kept;
    for (const leg of this.quiet.keys()) if (!this.lit.has(leg)) this.stateData[leg] = STATE_NONE;
    for (const leg of this.crowd.keys()) if (!this.lit.has(leg)) this.stateData[leg] = STATE_NONE;
    this.quiet.clear();
    this.crowd.clear();
    this.quietKeys = fadeStraight(list, z, view);
    if (this.quietKeys) this.thinList.forEach((l, i) => { const step = this.quietKeys!.get(l.key); if (step) this.quiet.set(i, step); });
    const crowded = crowdLegs(list, z, cssPerCell, win?.window ?? null);
    if (crowded) this.thinList.forEach((l, i) => { const step = crowded.get(l.key); if (step) this.crowd.set(i, step); });
    this.applyTones();
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
    this.material.uniforms.uDot!.value = dotCell(cssPerCell / radiusPx);
    this.material.uniforms.uFar!.value = farOf(radiusPxToZoom(radiusPx));
    const ticks = radiusPxToZoom(radiusPx) >= TICK_FROM;
    this.material.uniforms.uTickOn!.value = ticks ? 1 : 0;
    // copies 1 and 2 (the rail's cross-ticks) are discarded by the fragment shader until the ticks are on: do not send them through the vertex stage
    // and the rasteriser (a third of the work, at every view from the world to the continent, where the paths are drawn most)
    if (this.geometry) this.geometry.instanceCount = ticks ? 3 : 1;
    const level = levelFor(this.mPerCell, this.level);
    if (level !== this.level) this.applyLevel(level);
  }

  /**
   * The length along each flight's arc ON THE SCREEN, in buffer pixels from its start, at the vertex (the shader lays the dots out by it). Called with the camera's
   * matrices current; does nothing until the camera, the lift or the buffer has moved (a still globe costs nothing). Only the flights' vertices are projected here.
   */
  syncScreen(camera: Camera, bufW: number, bufH: number) {
    const attr = this.screenLen;
    if (!attr || !this.line || !this.material || this.flightRuns.length === 0) return;
    this.line.updateWorldMatrix(true, false);
    const m = this.screenMat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(this.line.matrixWorld);
    const lift = this.material.uniforms.uLift!.value as number;
    const key = this.screenKey;
    let same = key[16] === lift && key[17] === bufW && key[18] === bufH;
    for (let i = 0; same && i < 16; i++) if (key[i] !== m.elements[i]) same = false;
    if (same) return;
    for (let i = 0; i < 16; i++) key[i] = m.elements[i]!;
    key[16] = lift;
    key[17] = bufW;
    key[18] = bufH;
    const e = m.elements;
    const pos = this.buffers!.position;
    const out = attr.array as Float32Array;
    const hx = bufW / 2, hy = bufH / 2;
    for (const { from, count } of this.flightRuns) {
      let acc = 0;
      let px = 0, py = 0, have = false;
      for (let k = 0; k < count; k++) {
        const o = (from + k) * 3;
        const x = pos[o]!, y = pos[o + 1]!, z = pos[o + 2]!;
        const len = Math.hypot(x, y, z) || 1;
        const s = (1 + (len - 1) * lift) / len;
        const X = x * s, Y = y * s, Z = z * s;
        const w = e[3]! * X + e[7]! * Y + e[11]! * Z + e[15]!;
        if (w > 1e-6) {
          const sx = ((e[0]! * X + e[4]! * Y + e[8]! * Z + e[12]!) / w) * hx;
          const sy = ((e[1]! * X + e[5]! * Y + e[9]! * Z + e[13]!) / w) * hy;
          if (have) acc += Math.hypot(sx - px, sy - py);
          px = sx;
          py = sy;
          have = true;
        }
        out[from + k] = acc;
      }
    }
    attr.needsUpdate = true;
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
