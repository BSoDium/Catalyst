/**
 * Two ways to get the map's pixels into the pixel pass.
 *
 *  - CopyCompositor   a separate WebGL2 context on an overlay canvas. On every map `render` event (same task, so the
 *                     drawing buffer is still valid and `preserveDrawingBuffer` is NOT needed) the map canvas is uploaded
 *                     with texImage2D, pooled, and presented. Engine-agnostic: anything that draws to a canvas works.
 *                     The overlay can be art-resolution (cheap, pixelated by CSS) or device-resolution (sharp reveal).
 *  - InlineCompositor a MapLibre custom layer added last. It copies the framebuffer MapLibre has just drawn
 *                     (copyTexSubImage2D, on the GPU, no CPU involvement) and draws the result back into the same
 *                     framebuffer. One context, no canvas copy, but MapLibre-specific and device-resolution only.
 */
import type { CustomLayerInterface, Map as MLMap } from "maplibre-gl";
import { PixelPass, type PassParams } from "./pixelPass";

export interface PassConfig {
  /** returns the live params (palette, cell size, dither, reveal) for an output of the given device size */
  params(outW: number, outH: number, dpr: number): PassParams;
}

export interface CompositorStats {
  passes: number;
  lastPassMs: number;
  lastUploadMs: number;
}

export interface Compositor {
  readonly kind: "copy" | "inline";
  readonly stats: CompositorStats;
  /** Re-run the final pass from the cached source (dissolve animation). Returns false if it needs a new map frame. */
  redraw(): boolean;
  /** true while a frame at the new params needs a fresh map render (inline only) */
  needsMapFrame: boolean;
  /** Block until the GPU has finished this context's queued work (benchmark only). */
  sync(): void;
  dispose(): void;
}

const SYNC_BUF = new Uint8Array(4);

export type CopyMode = "art" | "device";

export class CopyCompositor implements Compositor {
  readonly kind = "copy" as const;
  readonly stats: CompositorStats = { passes: 0, lastPassMs: 0, lastUploadMs: 0 };
  readonly needsMapFrame = false;
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private pass: PixelPass;
  private ready = false;
  private onRender = () => this.frame();
  private lastOut = { w: 0, h: 0 };

  constructor(
    private map: MLMap,
    container: HTMLElement,
    private config: PassConfig,
    private mode: CopyMode,
    private syncAfterPass = false,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.dataset.role = "pixel-pass";
    Object.assign(this.canvas.style, {
      position: "absolute",
      left: "0",
      top: "0",
      pointerEvents: "none",
      imageRendering: "pixelated",
    });
    container.appendChild(this.canvas);
    const gl = this.canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: "high-performance" });
    if (!gl) throw new Error("WebGL2 unavailable");
    this.gl = gl;
    this.pass = new PixelPass(gl);
    // the map canvas stays in the DOM and keeps rendering, but is not shown
    map.getCanvas().style.visibility = "hidden";
    map.on("render", this.onRender);
    this.ready = true;
  }

  /** Output size: device px of the container, regardless of the (possibly lower) map render scale. */
  private outSize(): { w: number; h: number; dpr: number } {
    const mc = this.map.getCanvas();
    const rect = mc.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return { w: Math.max(1, Math.round(rect.width * dpr)), h: Math.max(1, Math.round(rect.height * dpr)), dpr };
  }

  private frame(): void {
    if (!this.ready) return;
    const t0 = performance.now();
    this.pass.uploadCanvas(this.map.getCanvas());
    this.stats.lastUploadMs = performance.now() - t0;
    this.draw(true);
  }

  private draw(pool: boolean): void {
    const t0 = performance.now();
    const gl = this.gl;
    const { w, h, dpr } = this.outSize();
    const p = this.config.params(w, h, dpr);
    const cols = Math.ceil(w / p.cellOut);
    const rows = Math.ceil(h / p.cellOut);
    const rect = this.map.getCanvas().getBoundingClientRect();
    if (this.mode === "art") {
      if (this.canvas.width !== cols || this.canvas.height !== rows) {
        this.canvas.width = cols;
        this.canvas.height = rows;
      }
      this.canvas.style.width = `${(cols * p.cellOut) / dpr}px`;
      this.canvas.style.height = `${(rows * p.cellOut) / dpr}px`;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.pass.poolPass(p, w, h, false);
    } else {
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
      this.canvas.style.width = `${rect.width}px`;
      this.canvas.style.height = `${rect.height}px`;
      if (pool) {
        this.pass.poolPass(p, w, h, true);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.pass.presentPass(p, w, h);
    }
    this.lastOut = { w, h };
    if (this.syncAfterPass) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    this.stats.passes++;
    this.stats.lastPassMs = performance.now() - t0;
  }

  redraw(): boolean {
    if (!this.ready || this.pass.srcW === 0) return false;
    if (this.mode === "art") return false; // art-only output has no sharp reveal, nothing to animate
    this.draw(false);
    return true;
  }

  sync(): void {
    this.gl.readPixels(0, 0, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, SYNC_BUF);
  }

  /** Average ms of n canvas uploads (texImage2D from the map canvas), GPU-synced once at the end. Benchmark only. */
  benchUpload(n: number): number {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) this.pass.uploadCanvas(this.map.getCanvas());
    this.sync();
    return (performance.now() - t0) / n;
  }

  /** Average ms of n pool+present passes from the cached source, GPU-synced at the end. Benchmark only. */
  benchPass(n: number): number {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) this.draw(true);
    this.sync();
    return (performance.now() - t0) / n;
  }

  /** Re-pool and present from the cached source (palette or threshold change). */
  repool(): void {
    if (this.ready && this.pass.srcW > 0) this.draw(true);
  }

  dispose(): void {
    this.ready = false;
    this.map.off("render", this.onRender);
    this.map.getCanvas().style.visibility = "";
    this.pass.dispose();
    this.canvas.remove();
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
  get size() {
    return this.lastOut;
  }
}

/** MapLibre custom layer running the same pass inside the map's own context. */
export class InlineCompositor implements Compositor, CustomLayerInterface {
  readonly kind = "inline" as const;
  readonly id = "pixel-pass";
  readonly type = "custom" as const;
  readonly renderingMode = "2d" as const;
  readonly stats: CompositorStats = { passes: 0, lastPassMs: 0, lastUploadMs: 0 };
  needsMapFrame = false;
  private pass: PixelPass | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private lastFb: WebGLFramebuffer | null = null;

  constructor(
    private map: MLMap,
    private config: PassConfig,
    private syncAfterPass = false,
  ) {
    map.addLayer(this);
  }

  onAdd(_map: MLMap, gl: WebGL2RenderingContext): void {
    this.gl = gl;
    this.pass = new PixelPass(gl);
  }

  render(gl: WebGL2RenderingContext): void {
    const pass = this.pass;
    if (!pass) return;
    const t0 = performance.now();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    // save the state we touch
    const fb = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const prog = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
    const vao = gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null;
    const vp = gl.getParameter(gl.VIEWPORT) as Int32Array;
    const active = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
    const tex0 = (gl.activeTexture(gl.TEXTURE0), gl.getParameter(gl.TEXTURE_BINDING_2D)) as WebGLTexture | null;
    const tex1 = (gl.activeTexture(gl.TEXTURE1), gl.getParameter(gl.TEXTURE_BINDING_2D)) as WebGLTexture | null;
    const wasBlend = gl.isEnabled(gl.BLEND);
    const wasDepth = gl.isEnabled(gl.DEPTH_TEST);
    const wasStencil = gl.isEnabled(gl.STENCIL_TEST);
    const wasScissor = gl.isEnabled(gl.SCISSOR_TEST);
    const wasCull = gl.isEnabled(gl.CULL_FACE);
    const cm = gl.getParameter(gl.COLOR_WRITEMASK) as boolean[];
    const rect = this.map.getCanvas().getBoundingClientRect();
    const dpr = rect.width > 0 ? w / rect.width : 1;

    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb);
    pass.copyFromFramebuffer(w, h);
    this.stats.lastUploadMs = performance.now() - t0;
    const p = this.config.params(w, h, dpr);
    pass.poolPass(p, w, h, true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    pass.presentPass(p, w, h);
    this.lastFb = fb;
    if (this.syncAfterPass) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));

    // restore
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(vp[0]!, vp[1]!, vp[2]!, vp[3]!);
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tex1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex0);
    gl.activeTexture(active);
    (wasBlend ? gl.enable : gl.disable).call(gl, gl.BLEND);
    (wasDepth ? gl.enable : gl.disable).call(gl, gl.DEPTH_TEST);
    (wasStencil ? gl.enable : gl.disable).call(gl, gl.STENCIL_TEST);
    (wasScissor ? gl.enable : gl.disable).call(gl, gl.SCISSOR_TEST);
    (wasCull ? gl.enable : gl.disable).call(gl, gl.CULL_FACE);
    gl.colorMask(cm[0]!, cm[1]!, cm[2]!, cm[3]!);
    this.stats.passes++;
    this.stats.lastPassMs = performance.now() - t0;
  }

  sync(): void {
    const gl = this.gl;
    gl?.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, SYNC_BUF);
  }

  redraw(): boolean {
    // the pass lives in the map's frame: ask for one
    this.needsMapFrame = true;
    this.map.triggerRepaint();
    return false;
  }

  onRemove(): void {
    this.pass?.dispose();
    this.pass = null;
  }

  dispose(): void {
    if (this.map.getLayer(this.id)) this.map.removeLayer(this.id);
  }
}
