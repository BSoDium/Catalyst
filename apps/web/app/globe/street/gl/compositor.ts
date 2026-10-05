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

export interface CompositorStats {
  passes: number;
  lastPassMs: number;
  lastUploadMs: number;
  contextLosses: number;
  contextRestores: number;
}

export interface CompositorHooks {
  /** Live pass parameters for an output of the given device size. */
  params(outW: number, outH: number, dpr: number): PassParams;
  onContextChange?(lost: boolean): void;
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

  /** Output size in device px: the container box times the device pixel ratio. */
  private outSize(): { w: number; h: number; dpr: number } {
    const dpr = window.devicePixelRatio || 1;
    return { w: Math.max(1, Math.round(this.root.clientWidth * dpr)), h: Math.max(1, Math.round(this.root.clientHeight * dpr)), dpr };
  }

  private frame(): void {
    if (!this.ready || this.isLost || this.held || !this.pass) return;
    const t0 = performance.now();
    this.pass.uploadCanvas(this.map.getCanvas());
    this.stats.lastUploadMs = performance.now() - t0;
    this.draw(true);
  }

  private draw(pool: boolean): void {
    const pass = this.pass;
    if (!pass) return;
    const t0 = performance.now();
    const { w, h, dpr } = this.outSize();
    const p = this.hooks.params(w, h, dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.canvas.style.width = `${w / dpr}px`;
      this.canvas.style.height = `${h / dpr}px`;
      pool = true;
    }
    if (pool) pass.poolPass(p, w, h);
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
    if (!this.ready || this.isLost || this.held || !this.pass || this.pass.srcW === 0) return false;
    this.draw(false);
    return true;
  }

  /** Re-classify and present from the cached source (palette or threshold change). */
  repool(): boolean {
    if (!this.ready || this.isLost || this.held || !this.pass || this.pass.srcW === 0) return false;
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
