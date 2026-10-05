/**
 * The pixel pass: two small fragment programs, usable in any WebGL2 context (the map's own, via a custom layer,
 * or a separate one fed by a canvas copy).
 *
 *   pass A "pool"    one fragment per art cell. Max-pools the cell footprint of the source (R ink, G/B tones,
 *                    alpha min/max), classifies it to background / foreground / muted with a hard threshold
 *                    for ink and an 8x8 Bayer ordered dither for tones. Output: palette colour per art cell.
 *   pass B "present" one fragment per output pixel. Nearest-samples the art texture (pixel art), and where the
 *                    focus mask (plus the global dissolve) says so, shows the sharp source render instead.
 *                    A cell flips to sharp when mask coverage > its Bayer threshold: a dither dissolve.
 *
 * Source orientation: `topFirst` = row 0 is the top (an uploaded canvas); otherwise row 0 is the bottom (a
 * framebuffer copy).
 */
import type { Rgb } from "../core/pixel";

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const BAYER = `
int bayer8(ivec2 p) {
  int a = p.x & 7;
  int b = (p.x ^ p.y) & 7;
  int v = 0;
  for (int i = 0; i < 3; i++) {
    v = (v << 2) | (((b >> (2 - i)) & 1) << 1) | ((a >> (2 - i)) & 1);
  }
  return ((v & 1) << 5) | ((v & 2) << 3) | ((v & 4) << 1) | ((v & 8) >> 1) | ((v & 16) >> 3) | ((v & 32) >> 5);
}
float thr(ivec2 c) { return (float(bayer8(c)) + 0.5) / 64.0; }
`;

const FRAG_POOL = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uSrc;
uniform ivec2 uSrcSize;
uniform float uScale;        // source px per output px
uniform int uCellOut;        // art cell in output px
uniform int uSrcTopFirst;
uniform int uOutTopFirst;
uniform int uArtH;
uniform vec3 uBg, uFg, uMuted;
uniform float uInk;
uniform int uDither;
uniform ivec2 uAnchor;
out vec4 o;
${BAYER}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  int cyTop = uOutTopFirst == 1 ? c.y : uArtH - 1 - c.y;
  ivec2 cell = ivec2(c.x, cyTop);
  ivec2 lo = ivec2(floor(vec2(cell * uCellOut) * uScale));
  ivec2 hi = ivec2(ceil(vec2((cell + 1) * uCellOut) * uScale));
  hi = max(hi, lo + 1);
  vec4 mx = vec4(0.0);
  float aMin = 1.0;
  for (int y = lo.y; y < hi.y; y++) {
    for (int x = lo.x; x < hi.x; x++) {
      if (x >= uSrcSize.x || y >= uSrcSize.y) continue;
      int sy = uSrcTopFirst == 1 ? y : uSrcSize.y - 1 - y;
      vec4 t = texelFetch(uSrc, ivec2(x, sy), 0);
      mx = max(mx, t);
      aMin = min(aMin, t.a);
    }
  }
  vec3 col = uBg;
  if (mx.a >= 0.5) {
    float t = uDither == 1 ? thr(cell + uAnchor) : 0.5;
    if (mx.r > uInk) col = uFg;
    else if (aMin < 0.5) col = uMuted;
    else if (mx.b > t) col = uMuted;
    else if (mx.g > t) col = uFg;
  }
  o = vec4(col, 1.0);
}`;

const FRAG_PRESENT = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uArt;
uniform sampler2D uSrc;
uniform ivec2 uOutSize;
uniform int uCellOut;
uniform int uSrcTopFirst;
uniform int uMode;            // 0 art-only output (no sharp), 1 device output with sharp reveal
uniform float uSharp;         // global dissolve 0..1
uniform vec4 uFocus;          // x, y (output px, top-origin), radius, feather
uniform vec3 uBg, uFg, uMuted;
uniform ivec2 uAnchor;
out vec4 o;
${BAYER}
float coverage(vec2 p) {
  if (uFocus.z <= 0.0) return 0.0;
  float d = distance(p, uFocus.xy);
  float t = clamp((d - uFocus.z) / max(uFocus.w, 1e-3), 0.0, 1.0);
  return 1.0 - t * t * (3.0 - 2.0 * t);
}
void main() {
  ivec2 p = ivec2(int(gl_FragCoord.x), uOutSize.y - 1 - int(gl_FragCoord.y));
  ivec2 cell = p / uCellOut;
  vec3 col = texelFetch(uArt, cell, 0).rgb;
  float m = max(uSharp, coverage(vec2(p) + 0.5));
  if (m > 0.0 && m > thr(cell + uAnchor)) {
    vec2 uv = (vec2(p) + 0.5) / vec2(uOutSize);
    uv.y = uSrcTopFirst == 1 ? uv.y : 1.0 - uv.y;
    vec4 s = texture(uSrc, uv);
    vec3 c = mix(uBg, uFg, clamp(s.g, 0.0, 1.0));
    c = mix(c, uMuted, clamp(s.b, 0.0, 1.0));
    c = mix(c, uFg, clamp(s.r, 0.0, 1.0));
    c = mix(c, uMuted, 1.0 - abs(2.0 * s.a - 1.0));
    col = c;
  }
  o = vec4(col, 1.0);
}`;

export interface FocusParams {
  /** output px, origin top-left */
  x: number;
  y: number;
  radius: number;
  feather: number;
}

export interface PassParams {
  bg: Rgb;
  fg: Rgb;
  muted: Rgb;
  /** art cell in output (device) px */
  cellOut: number;
  inkThreshold: number;
  dither: boolean;
  sharp: number;
  focus: FocusParams;
  /** dither phase, whole art cells */
  anchor: [number, number];
}

type Uniforms = Record<string, WebGLUniformLocation | null>;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): { prog: WebGLProgram; u: Uniforms } {
  const mk = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
    return s;
  };
  const prog = gl.createProgram()!;
  const v = mk(gl.VERTEX_SHADER, vs);
  const f = mk(gl.FRAGMENT_SHADER, fs);
  gl.attachShader(prog, v);
  gl.attachShader(prog, f);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(prog)}`);
  gl.deleteShader(v);
  gl.deleteShader(f);
  const u: Uniforms = {};
  const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(prog, i)!;
    u[info.name] = gl.getUniformLocation(prog, info.name);
  }
  return { prog, u };
}

export class PixelPass {
  private pool: ReturnType<typeof compile>;
  private present: ReturnType<typeof compile>;
  private srcTex: WebGLTexture;
  private artTex: WebGLTexture;
  private artFbo: WebGLFramebuffer;
  private vao: WebGLVertexArrayObject;
  srcW = 0;
  srcH = 0;
  srcTopFirst = true;
  artW = 0;
  artH = 0;

  constructor(private gl: WebGL2RenderingContext) {
    this.pool = compile(gl, VERT, FRAG_POOL);
    this.present = compile(gl, VERT, FRAG_PRESENT);
    this.srcTex = gl.createTexture()!;
    this.artTex = gl.createTexture()!;
    this.artFbo = gl.createFramebuffer()!;
    this.vao = gl.createVertexArray()!;
    for (const t of [this.srcTex, this.artTex]) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, t === this.srcTex ? gl.LINEAR : gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, t === this.srcTex ? gl.LINEAR : gl.NEAREST);
    }
  }

  /** Upload a canvas (another context's drawing buffer). Row 0 is the top. */
  uploadCanvas(canvas: HTMLCanvasElement): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this.srcW = canvas.width;
    this.srcH = canvas.height;
    this.srcTopFirst = true;
  }

  /** Copy the currently bound READ framebuffer into the source texture (same context). Row 0 is the bottom. */
  copyFromFramebuffer(w: number, h: number): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    if (w !== this.srcW || h !== this.srcH || this.srcTopFirst) {
      gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, w, h, 0);
      this.srcW = w;
      this.srcH = h;
      this.srcTopFirst = false;
    } else {
      gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, w, h);
    }
  }

  private ensureArt(cols: number, rows: number): void {
    const gl = this.gl;
    if (cols === this.artW && rows === this.artH) return;
    gl.bindTexture(gl.TEXTURE_2D, this.artTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.artW = cols;
    this.artH = rows;
  }

  private uniformsCommon(u: Uniforms, p: PassParams): void {
    const gl = this.gl;
    gl.uniform3f(u.uBg!, ...p.bg);
    gl.uniform3f(u.uFg!, ...p.fg);
    gl.uniform3f(u.uMuted!, ...p.muted);
    gl.uniform2i(u.uAnchor!, p.anchor[0], p.anchor[1]);
    gl.uniform1i(u.uCellOut!, p.cellOut);
  }

  /**
   * Pass A. `outW/outH` is the virtual output size in device px (it defines the art grid). In "device" mode the result goes to the
   * internal art texture; in "art" mode straight to the currently bound framebuffer, which must be exactly cols x rows.
   */
  poolPass(p: PassParams, outW: number, outH: number, toArtTexture: boolean): { cols: number; rows: number } {
    const gl = this.gl;
    const cols = Math.ceil(outW / p.cellOut);
    const rows = Math.ceil(outH / p.cellOut);
    if (toArtTexture) {
      this.ensureArt(cols, rows);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.artFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.artTex, 0);
    }
    gl.viewport(0, 0, cols, rows);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    gl.colorMask(true, true, true, true);
    gl.useProgram(this.pool.prog);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    const u = this.pool.u;
    gl.uniform1i(u.uSrc!, 0);
    gl.uniform2i(u.uSrcSize!, this.srcW, this.srcH);
    gl.uniform1f(u.uScale!, this.srcW / outW);
    gl.uniform1i(u.uSrcTopFirst!, this.srcTopFirst ? 1 : 0);
    gl.uniform1i(u.uOutTopFirst!, toArtTexture ? 1 : 0);
    gl.uniform1i(u.uArtH!, rows);
    gl.uniform1f(u.uInk!, p.inkThreshold);
    gl.uniform1i(u.uDither!, p.dither ? 1 : 0);
    this.uniformsCommon(u, p);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return { cols, rows };
  }

  /** Pass B into the currently bound framebuffer (device-sized output). */
  presentPass(p: PassParams, outW: number, outH: number): void {
    const gl = this.gl;
    gl.viewport(0, 0, outW, outH);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    gl.colorMask(true, true, true, true);
    gl.useProgram(this.present.prog);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.artTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    const u = this.present.u;
    gl.uniform1i(u.uArt!, 0);
    gl.uniform1i(u.uSrc!, 1);
    gl.uniform2i(u.uOutSize!, outW, outH);
    gl.uniform1i(u.uSrcTopFirst!, this.srcTopFirst ? 1 : 0);
    gl.uniform1f(u.uSharp!, p.sharp);
    gl.uniform4f(u.uFocus!, p.focus.x, p.focus.y, p.focus.radius, p.focus.feather);
    this.uniformsCommon(u, p);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.pool.prog);
    gl.deleteProgram(this.present.prog);
    gl.deleteTexture(this.srcTex);
    gl.deleteTexture(this.artTex);
    gl.deleteFramebuffer(this.artFbo);
    gl.deleteVertexArray(this.vao);
  }
}
