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

export interface CompositorStats {
  passes: number;
  lastPassMs: number;
  lastUploadMs: number;
  contextLosses: number;
  contextRestores: number;
}

export interface OutputSize {
  /** Drawing buffer of the overlay canvas, px. Device mode: the container times the device pixel ratio. Native mode: the art grid (cols x rows). */
  w: number;
  h: number;
  /** Size the canvas is displayed at, CSS px (native mode: the grid box, upscaled with nearest-neighbour). */
  cssW: number;
  cssH: number;
}

export interface CompositorHooks {
  /** Output size now (the engine knows the grid). */
  size(): OutputSize;
  /** Live pass parameters for an output of the given buffer size. */
  params(outW: number, outH: number): PassParams;
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
  readonly stats: CompositorStats = { passes: 0, lastPassMs: 0, lastUploadMs: 0, contextLosses: 0, contextRestores: 0 };
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

  /** Keep the last presented frame (true) or resume following the map (false; repaints once). */
  hold(on: boolean): void {
    this.held = on;
    if (!on) this.map.triggerRepaint();
  }

  /**
   * Stop following the map (true): the map may keep rendering (tiles load) but nothing is copied or drawn. Resuming
   * repaints once. The handover keeps the street map out of the frame while the globe is the visible renderer.
   */
  suspend(on: boolean): void {
    if (on === this.suspended) return;
    this.suspended = on;
    if (!on) this.map.triggerRepaint();
  }

  private frame(): void {
    if (!this.ready || this.isLost || this.held || this.suspended || !this.pass) return;
    const t0 = performance.now();
    this.pass.uploadCanvas(this.map.getCanvas());
    this.stats.lastUploadMs = performance.now() - t0;
    perfEnd("compositor.upload", t0);
    const t1 = perfStart();
    this.draw(true);
    perfEnd("compositor.pass", t1);
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
  readCodes(): { cols: number; rows: number; codes: Uint8Array } | null {
    return this.ready && !this.isLost && this.pass && this.pass.artW > 0 ? this.pass.readCodes() : null;
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
