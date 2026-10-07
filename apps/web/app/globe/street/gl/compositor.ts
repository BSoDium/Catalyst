/**
 * The copy compositor: a SEPARATE WebGL2 context on an overlay canvas. On every map `render` event (same task, so the
 * map's drawing buffer is still valid and `preserveDrawingBuffer` is NOT needed) the map canvas is uploaded with
 * texImage2D, classified into the art grid and presented. Engine-agnostic (anything that draws to a canvas feeds it)
 * and the only way to a sharp reveal, because the device-resolution source stays available.
 *
 * Lifecycle discipline (the globe's, plus the spike's open gap):
 *  - a context that is lost (GPU reset, tab discarded, `WEBGL_lose_context`) is `preventDefault`ed, drawing stops,
 *    and on `webglcontextrestored` every GL object is rebuilt and the next map frame repaints the overlay;
 *  - `hold(true)` keeps the last presented frame on screen (a style swap would otherwise flash world-only linework);
 *  - `dispose()` deletes every GL object, forces the context loss and removes the canvas.
 */
import type { Map as MLMap } from "maplibre-gl";
import { PixelPass, type PassParams } from "./pixel-pass";
import { perfEnd, perfStart } from "../../engine/perf";
import { EASE, matchRadius, stepBudget } from "../core/ease";
import { buildWarpMesh, type WarpCamera, type WarpMesh } from "../core/warp";

export interface CompositorStats {
  passes: number;
  lastPassMs: number;
  lastUploadMs: number;
  contextLosses: number;
  contextRestores: number;
  /** ease passes run (map frames and settle ticks) */
  eases: number;
  /** the warp of the last map frame: kind, match radius, largest displacement in cells */
  lastWarp: { kind: string; radius: number; maxShift: number };
  /** CPU ms of the last warp mesh build */
  lastMeshMs: number;
}

export interface OutputSize {
  /** Drawing buffer of the overlay canvas, px. Device mode: the container times the device pixel ratio. Native mode: the art grid (cols x rows). */
  w: number;
  h: number;
  /** Size the canvas is displayed at, CSS px (native mode: the grid box, upscaled with nearest-neighbour). */
  cssW: number;
  cssH: number;
}

/**
 * Tile fade (temporal ease, core/ease.ts): content that appears or disappears for any reason other than the camera moving it (a tile
 * arriving after a slow request, a tile leaving, a tone step, the globe-to-street cut) goes through the grey levels at `msPerLevel`
 * per level, at rest AND while the camera pans or zooms (the previous presented image is looked up where the camera had it). The
 * ease keeps running by itself after the last map frame until the presented image has reached the classified one (`settle`), then
 * the loop stops: an idle map costs no frame.
 */
export const TILE_FADE = {
  /** Time per palette level of a fade (ms): the loudest map tone is reached in about a quarter of a second. */
  msPerLevel: EASE.msPerLevel,
  /** A gap since the last ease pass longer than this (ms) is idle time, not fade time: the fade restarts with one frame of progress. */
  idleGapMs: 250,
} as const;

export interface CompositorHooks {
  /** Output size now (the engine knows the grid). */
  size(): OutputSize;
  /** Live pass parameters for an output of the given buffer size. */
  params(outW: number, outH: number): PassParams;
  /**
   * The camera of the frame the map just rendered, for the motion compensation of the ease (core/warp.ts). Absent: the camera is
   * taken as fixed, so every change eases (correct at rest, ghosts while moving).
   */
  camera?(): WarpCamera | null;
  onContextChange?(lost: boolean): void;
}

export interface CompositorOptions {
  /**
   * Native art-resolution mode: the map renders ONE PIXEL PER ART CELL, so the source is the art grid itself and the
   * whole pass (classify, stair removal, present) runs on cols x rows pixels; the browser scales the canvas up with
   * `image-rendering: pixelated`. Off ("device" mode): the map renders at device resolution and the pass samples cell
   * centres from it (needed for the sharp reveal and the sharp dissolve, which show the device-resolution render).
   */
  native: boolean;
  /** Native mode: map pixels per art cell along each axis (1, 2 or 3). The pass samples the centre of the cell bilinearly. */
  scale?: number;
}

const SYNC_BUF = new Uint8Array(4);

export class Compositor {
  readonly canvas: HTMLCanvasElement;
  readonly stats: CompositorStats = {
    passes: 0,
    lastPassMs: 0,
    lastUploadMs: 0,
    contextLosses: 0,
    contextRestores: 0,
    eases: 0,
    lastWarp: { kind: "identity", radius: 0, maxShift: 0 },
    lastMeshMs: 0,
  };
  /** Called synchronously at the end of every composited frame with a fresh map upload (measurement hooks read the art here). */
  onFrame: (() => void) | null = null;
  private gl: WebGL2RenderingContext;
  /** Kept from creation: `getExtension` returns null on a lost context, and the restore needs it. */
  private loseExt: WEBGL_lose_context | null;
  private pass: PixelPass | null;
  private ready = false;
  private lost = false;
  private held = false;
  private suspended = false;
  private disposed = false;
  private fadeOn = true;
  /** Settle loop: ease passes keep running (identity warp) until this time, so a fade that started on the last map frame finishes. */
  private settleUntil = 0;
  private easeRaf = 0;
  /** Time of the last ease pass and the fraction of a level not yet spent (the budget is time based, not frame based). */
  private easeLast = 0;
  private carry = 0;
  /** Camera of the presented image (null: none known, the next pair is taken as identity). */
  private prevCam: WarpCamera | null = null;
  /** A seed was just written: the next ease shows it as is (no progress), then crosses over to the classified image. */
  private seeded = false;
  /** Another renderer's image is the target (the street-to-globe cut): map frames are ignored. */
  private external = false;
  private size = { w: 0, h: 0 };
  private onRender = () => this.frame();
  private onLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
    this.stats.contextLosses++;
    this.hooks.onContextChange?.(true);
  };
  private onRestored = () => {
    if (this.disposed) return;
    try {
      this.pass = new PixelPass(this.gl);
      this.pass.setNativeSource(this.options.native);
      this.lost = false;
      this.size = { w: 0, h: 0 };
      this.stats.contextRestores++;
      this.hooks.onContextChange?.(false);
      this.map.triggerRepaint();
    } catch {
      // The restored context is unusable (lost again in the middle of the rebuild): wait for the next restore.
      this.lost = true;
    }
  };

  constructor(
    private map: MLMap,
    private root: HTMLElement,
    private hooks: CompositorHooks,
    readonly options: CompositorOptions = { native: false },
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.dataset.role = "pixel-pass";
    Object.assign(this.canvas.style, {
      position: "absolute",
      left: "0",
      top: "0",
      pointerEvents: "none",
      imageRendering: "pixelated",
    } satisfies Partial<CSSStyleDeclaration>);
    root.appendChild(this.canvas);
    const gl = this.canvas.getContext("webgl2", {
      antialias: false,
      alpha: true,
      premultipliedAlpha: true,
      depth: false,
      stencil: false,
      powerPreference: "high-performance",
    });
    if (!gl) {
      this.canvas.remove();
      throw new Error("WebGL2 is not available for the street overlay");
    }
    this.gl = gl;
    this.loseExt = gl.getExtension("WEBGL_lose_context");
    this.pass = new PixelPass(gl);
    this.pass.setNativeSource(options.native);
    this.canvas.addEventListener("webglcontextlost", this.onLost);
    this.canvas.addEventListener("webglcontextrestored", this.onRestored);
    // The map canvas keeps rendering (it feeds the copy) but is not shown.
    map.getCanvas().style.visibility = "hidden";
    map.on("render", this.onRender);
    this.ready = true;
  }

  get isLost(): boolean {
    return this.lost || this.gl.isContextLost();
  }

  /**
   * Keep the last presented frame (true) or resume following the map (false; repaints once). The presented image is kept (and the
   * camera it was drawn for), so what arrives while the overlay was held eases in instead of popping (a style swap: the first load).
   */
  hold(on: boolean): void {
    this.held = on;
    this.stopSettle();
    if (!on) this.map.triggerRepaint();
  }

  /** Tile fade on or off (off: reduced motion); turning it off finishes any fade in progress at once. */
  setFade(on: boolean): void {
    this.fadeOn = on;
    if (on) return;
    this.stopSettle();
    if (this.ready && !this.isLost && this.pass && this.pass.srcW > 0) {
      this.pass.ease(255);
      this.draw(false);
    }
  }

  private stopSettle(): void {
    this.settleUntil = 0;
    if (this.easeRaf) cancelAnimationFrame(this.easeRaf);
    this.easeRaf = 0;
  }

  /**
   * Settle loop (rAF): after the last map frame the ease keeps running with the camera fixed until every cell has reached its
   * target. One pass per whole level of progress (about every `msPerLevel`), none while the tab is hidden; it stops by itself.
   */
  private settleTick = () => {
    this.easeRaf = 0;
    if (this.disposed || !this.pass || this.isLost || this.held || this.suspended) return;
    const now = performance.now();
    const { step, carry } = stepBudget(this.carry, now - this.easeLast);
    if (step >= 1) {
      this.carry = carry;
      this.easeLast = now;
      this.pass.ease(step, null, 0);
      this.stats.eases++;
      this.draw(false);
    }
    if (now < this.settleUntil && !document.hidden) this.easeRaf = requestAnimationFrame(this.settleTick);
    else this.settleUntil = 0;
  };

  private startSettle(levels: number): void {
    this.settleUntil = performance.now() + levels * TILE_FADE.msPerLevel + 80;
    if (!this.easeRaf && !document.hidden) this.easeRaf = requestAnimationFrame(this.settleTick);
  }

  /**
   * Stop following the map (true): the map may keep rendering (tiles load) but nothing is copied or drawn. Resuming
   * repaints once. The handover keeps the street map out of the frame while the globe is the visible renderer. What was presented
   * is stale by then (the camera moved), so the next image is taken as it is unless the host seeds one (`seed`).
   */
  suspend(on: boolean): void {
    if (on === this.suspended) return;
    this.suspended = on;
    this.stopSettle();
    this.pass?.invalidate();
    this.prevCam = null;
    this.seeded = false;
    this.external = false;
    if (!on) this.map.triggerRepaint();
  }

  private frame(): void {
    if (!this.ready || this.isLost || this.held || this.suspended || this.external || !this.pass) return;
    const t0 = performance.now();
    this.pass.uploadCanvas(this.map.getCanvas());
    this.stats.lastUploadMs = performance.now() - t0;
    perfEnd("compositor.upload", t0);
    const t1 = perfStart();
    this.draw(true);
    perfEnd("compositor.pass", t1);
  }

  /**
   * The new classified image is in: present it through the temporal ease (core/ease.ts). The previous presented image is warped by
   * the camera delta since it was drawn, so a line that only moved keeps its tone and a tile that arrived (or left) fades in (out)
   * at `msPerLevel` per level, whether the camera rests or moves. Under reduced motion (and without the native grid) the classified
   * image is presented as it is.
   */
  private present(levels: number): void {
    const pass = this.pass!;
    const cam = this.hooks.camera?.() ?? null;
    if (!this.fadeOn || !this.options.native) {
      this.stopSettle();
      pass.ease(255);
      this.prevCam = cam;
      return;
    }
    const now = performance.now();
    let mesh: WarpMesh | null = null;
    let radius = 0;
    if (pass.valid && this.prevCam && cam) {
      if (Math.abs(this.prevCam.cell - cam.cell) > 1e-9) pass.invalidate(); // another grid: nothing to look up
      else {
        const t = performance.now();
        mesh = buildWarpMesh(this.prevCam, cam, pass.artW, pass.artH);
        this.stats.lastMeshMs = performance.now() - t;
        radius = matchRadius(mesh);
        this.stats.lastWarp = { kind: mesh.kind, radius, maxShift: mesh.maxShift };
        if (mesh.maxShift > EASE.jumpCells) {
          // a camera jump: the previous image is of another view, take this one as it is
          pass.invalidate();
          mesh = null;
          radius = 0;
        }
      }
    }
    // The time since the last pass is fade time while a fade is running; a longer gap was idle (or a pause), a frame of progress then.
    const gap = now - this.easeLast;
    const dt = this.seeded ? 0 : gap > TILE_FADE.idleGapMs ? 8 : gap;
    this.seeded = false;
    const { step, carry } = stepBudget(this.carry, dt);
    this.carry = carry;
    this.easeLast = now;
    pass.ease(step, mesh, radius);
    this.stats.eases++;
    this.prevCam = cam;
    this.startSettle(levels - 1);
  }

  /**
   * Start the presented image from ANOTHER renderer's canvas (the Three.js globe, which draws on the same art grid): the globe-to-street
   * cut. Call right after `suspend(false)` and in the task that drew the canvas (a WebGL canvas is cleared once composited), before
   * the camera is pushed: the first frame the map renders afterwards shows the seed exactly, then every cell crosses over to the
   * street image at the ease's pace. `grid` is where the canvas's art cells sit (`left` and `top` in CSS px from the container's
   * corner, `cell` its CSS px per cell). Returns false when it cannot (no native grid, a lost context): the cut is then instant.
   */
  seed(canvas: HTMLCanvasElement, grid: { cell: number; left: number; top: number }): boolean {
    if (!this.ready || this.isLost || !this.pass || !this.options.native || !this.fadeOn) return false;
    const { w, h } = this.hooks.size();
    const p = this.hooks.params(w, h);
    this.pass.uploadCanvasSource(canvas);
    this.pass.levelsFromCanvas("presented", p.levels, w, h, [-grid.left / grid.cell, -grid.top / grid.cell]);
    this.prevCam = null; // the seed was drawn for the camera the host is about to push
    this.seeded = true;
    this.carry = 0;
    return true;
  }

  /**
   * The street-to-globe cut: while the host keeps the camera in step, make the OTHER renderer's canvas the target. Each call
   * classifies the canvas (same task as its drawing) and eases the presented image towards it; the host hides this renderer once
   * `easing` is 0. Pass null to resume following the map.
   */
  crossfadeTo(canvas: HTMLCanvasElement | null, grid?: { cell: number; left: number; top: number }): void {
    if (!canvas || !grid) {
      this.external = false;
      return;
    }
    if (!this.ready || this.isLost || !this.pass || !this.options.native || !this.fadeOn || this.held || this.suspended) return;
    this.external = true;
    const { w, h } = this.hooks.size();
    const p = this.hooks.params(w, h);
    this.pass.uploadCanvasSource(canvas);
    this.pass.levelsFromCanvas("target", p.levels, w, h, [-grid.left / grid.cell, -grid.top / grid.cell]);
    this.present(p.levels.length);
    this.pass.presentPass(p, w, h);
    this.stats.passes++;
  }

  private draw(pool: boolean): void {
    const pass = this.pass;
    if (!pass) return;
    const t0 = performance.now();
    const { w, h, cssW, cssH } = this.hooks.size();
    const p = this.hooks.params(w, h);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      pool = true;
    }
    const cw = `${cssW}px`;
    const ch = `${cssH}px`;
    if (this.canvas.style.width !== cw) this.canvas.style.width = cw;
    if (this.canvas.style.height !== ch) this.canvas.style.height = ch;
    if (pool) {
      // Native: the source holds `scale x scale` map pixels per cell; classify from its centre sample.
      const s = this.options.native ? Math.max(1, this.options.scale ?? 1) : 1;
      if (s === 1) pass.poolPass(p, w, h);
      else pass.poolPass({ ...p, cellOut: s }, w * s, h * s);
      this.present(p.levels.length);
    }
    pass.presentPass(p, w, h);
    this.size = { w, h };
    this.stats.passes++;
    this.stats.lastPassMs = performance.now() - t0;
    if (pool) this.onFrame?.();
  }

  /**
   * Re-run the final pass from the cached source (reveal, dissolve and palette changes need no new map frame).
   * Returns false when there is no source yet or the context is gone: the caller asks the map for a frame instead.
   */
  redraw(): boolean {
    if (!this.ready || this.isLost || this.held || this.suspended || !this.pass || this.pass.srcW === 0) return false;
    this.draw(false);
    return true;
  }

  /** Re-classify and present from the cached source (palette or threshold change). */
  repool(): boolean {
    if (!this.ready || this.isLost || this.held || this.suspended || !this.pass || this.pass.srcW === 0) return false;
    this.draw(true);
    return true;
  }

  /** The finished art image as class codes (row 0 = top). A GPU stall: tests and measurement only. */
  readCodes(): { cols: number; rows: number; codes: Uint8Array; levels: Uint8Array } | null {
    return this.ready && !this.isLost && this.pass && this.pass.artW > 0 ? this.pass.readCodes() : null;
  }

  /** The presented palette level of every cell (after easing), row 0 = top. A GPU stall: tests and measurement only. */
  readPresentedLevels(): Uint8Array | null {
    return this.ready && !this.isLost && this.pass && this.pass.artW > 0 ? this.pass.readPresentedLevels() : null;
  }

  /** Settle ticks (about `msPerLevel` each) still to run: 0 = the presented image has reached the classified one and the loop has stopped. Measurement. */
  get easing(): number {
    return this.settleUntil > 0 ? Math.max(1, Math.ceil((this.settleUntil - performance.now()) / TILE_FADE.msPerLevel)) : 0;
  }

  /** Per-pass GPU timers on or off (measurement only), and their means in ms per pass name. */
  profile(on: boolean): boolean {
    return this.pass?.profile(on) ?? false;
  }
  timings(): Record<string, { ms: number; n: number }> {
    return this.pass?.timings() ?? {};
  }

  /** Block until the GPU has finished this context's queued work (benchmark only). */
  sync(): void {
    if (!this.isLost) this.gl.readPixels(0, 0, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, SYNC_BUF);
  }

  get outputSize() {
    return this.size;
  }

  /** Test hook: lose or restore the overlay context through WEBGL_lose_context. */
  loseContext(lose: boolean): void {
    if (lose) this.loseExt?.loseContext();
    else this.loseExt?.restoreContext();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopSettle();
    this.ready = false;
    this.map.off("render", this.onRender);
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onRestored);
    try {
      this.pass?.dispose();
    } catch {
      // a lost context: nothing to free
    }
    this.pass = null;
    this.loseExt?.loseContext();
    this.canvas.remove();
  }
}
