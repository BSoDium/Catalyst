/**
 * The pixel pass: three small fragment programs for a WebGL2 context fed with the map's plain-colour render
 * (docs/pixel-line-rules.md, variant F; docs/street-zoom-spike.md for the channel contract).
 *
 *   pass A "pool"     one fragment per art cell. Samples the source at the EXACT CENTRE of the cell (native
 *                     rasterisation: a cell is ink iff its centre is inside the line; no max-pool, no coverage) and
 *                     writes a class code: none / thin ink / solid ink / foreground tone / muted. Fills use a screen
 *                     anchored Bayer lattice (tone quantised to sixteenths).
 *   pass T "stairs"   two sub-passes of staircase removal on THIN ink cells only, so every one-pixel line is
 *                     8-connected with one cell per step. Wide ink is never touched.
 *   pass B "present"  one fragment per output pixel. Decodes the class code to the token palette with nearest
 *                     sampling (pixel art); inside the focus circle (and, with `sharp`, everywhere) a cell shows the
 *                     sharp source render instead once the mask exceeds its Bayer threshold; with `blend` < 1 the
 *                     remaining cells are transparent, which dissolves the street map into whatever is underneath
 *                     (the Three.js globe) on the same art-pixel grid.
 *
 * Source orientation: row 0 is the top (an uploaded canvas). The art texture always has row 0 at the top.
 */
import type { Rgb } from "../core/pixel-types";
import { MAX_LEVELS } from "../core/palette";

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const BAYER = `
int bayer8(ivec2 p) {
  // the standard 8x8 Bayer matrix: bits (x^y)0 y0 (x^y)1 y1 (x^y)2 y2, most significant first
  int hi = p.y & 7;
  int lo = (p.x ^ p.y) & 7;
  int v = 0;
  for (int i = 0; i < 3; i++) {
    v = (v << 2) | (((hi >> (2 - i)) & 1) << 1) | ((lo >> (2 - i)) & 1);
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
uniform float uInk;          // ink threshold (0.49 * the weakest ink)
uniform float uSolid;        // R above this is solid ink (never thinned); between uInk and uSolid it is thin ink
uniform ivec2 uAnchor;
uniform int uToneSteps;      // fill tone quantisation (core/palette.ts TONE_STEPS)
uniform int uNativeArt;      // 1: the source IS the art grid (one texel per cell, nearest): alpha between 0 and 1 is the disc edge
out vec4 o;
${BAYER}
vec2 uvOfOut(vec2 outPx) { return outPx * uScale / vec2(uSrcSize); }
vec4 centre(ivec2 cell) { return texture(uSrc, uvOfOut((vec2(cell) + 0.5) * float(uCellOut))); }
float code(int c) { return float(c) / 255.0; }

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  vec4 mx = centre(cell);
  // alpha at the four corners of the cell and its centre: outside the globe disc alpha is 0
  float c = float(uCellOut);
  vec2 base = vec2(cell) * c;
  float a0 = texture(uSrc, uvOfOut(base + 0.5)).a;
  float a1 = texture(uSrc, uvOfOut(base + vec2(c - 0.5, 0.5))).a;
  float a2 = texture(uSrc, uvOfOut(base + vec2(0.5, c - 0.5))).a;
  float a3 = texture(uSrc, uvOfOut(base + c - 0.5)).a;
  float aMin = min(min(min(a0, a1), min(a2, a3)), mx.a);
  float aMax = max(max(max(a0, a1), max(a2, a3)), mx.a);
  int outCode = 0;
  if (aMax >= 0.5) {
    ivec2 tc = cell + uAnchor;
    if (mx.r > uInk) outCode = mx.r > uSolid ? 2 : 1;
    if (outCode == 0) {
      if (aMin < 0.5 || (uNativeArt == 1 && mx.a < 0.98)) outCode = 4; // straddles the disc edge: 1 art px limb
      else if (mx.b > 0.49) outCode = 4;                             // muted lines (rail, graticule): hard threshold
      else if (bayer8(tc) < int(floor(mx.g * float(uToneSteps) + 0.5)) * (64 / uToneSteps)) outCode = 3;   // fills: screen-anchored lattice
    }
  }
  o = vec4(code(outCode), 0.0, 0.0, 1.0);
}`;

const FRAG_STAIRS = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uArt;
uniform ivec2 uArtSize;
uniform int uSub;            // 0 or 1: the two sub-passes (left corners, then right corners)
out vec4 o;
int codeAt(ivec2 p) {
  if (p.x < 0 || p.y < 0 || p.x >= uArtSize.x || p.y >= uArtSize.y) return 0;
  return int(texelFetch(uArt, p, 0).r * 255.0 + 0.5);
}
int ink(ivec2 p) { int c = codeAt(p); return (c == 1 || c == 2) ? 1 : 0; }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int c = codeAt(p);
  int outC = c;
  if (c == 1) {
    // Staircase removal. A one-pixel line sampled at cell centres is 4-connected (two cells per step) at some
    // angles, worst at 45 degrees. A cell is redundant when it is the corner of such a stair: exactly one
    // horizontal and one vertical 4-neighbour (diagonal to each other, so removing it keeps the line 8-connected),
    // no neighbour on the other two sides, and the stair continues diagonally. Two sub-passes (left cells, then
    // right cells) so a stair of two-cell steps is thinned to ONE cell per step, never to none.
    int N = ink(p + ivec2(0, -1)), S = ink(p + ivec2(0, 1)), E = ink(p + ivec2(1, 0)), W = ink(p + ivec2(-1, 0));
    int NE = ink(p + ivec2(1, -1)), NW = ink(p + ivec2(-1, -1)), SE = ink(p + ivec2(1, 1)), SW = ink(p + ivec2(-1, 1));
    bool rm;
    // each rule also forbids the one diagonal neighbour that would be orphaned by the removal
    if (uSub == 0) rm = (E == 1 && W == 0) && ((N == 1 && S == 0 && SW == 0 && (NW == 1 || SE == 1)) || (S == 1 && N == 0 && NW == 0 && (SW == 1 || NE == 1)));
    else rm = (W == 1 && E == 0) && ((N == 1 && S == 0 && SE == 0 && (NE == 1 || SW == 1)) || (S == 1 && N == 0 && NE == 0 && (SE == 1 || NW == 1)));
    if (rm) outC = 0;
  }
  o = vec4(float(outC) / 255.0, 0.0, 0.0, 1.0);
}`;

const FRAG_PRESENT = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uArt;
uniform sampler2D uSrc;
uniform ivec2 uOutSize;
uniform int uCellOut;
uniform float uSharp;         // global dissolve of pixel art into the sharp render, 0..1
uniform float uBlend;         // share of cells that show the street map at all (1 = all, 0 = none: transparent)
uniform vec4 uFocus;          // x, y (output px, top-origin), radius, feather
uniform vec3 uBg, uFg, uMuted;   // the sharp path's colours (the palette's bg / ink / muted levels)
uniform vec3 uPal[${MAX_LEVELS}];      // the palette table (core/palette.ts): one colour per level
uniform int uCodeLevel[8];       // class code -> palette level
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
  float th = thr(cell + uAnchor);
  if (uBlend < 1.0 && !(uBlend > th)) { o = vec4(0.0); return; }   // premultiplied transparent: the layer below shows
  int code = int(texelFetch(uArt, cell, 0).r * 255.0 + 0.5);
  vec3 col = uPal[uCodeLevel[code & 7]];
  float m = max(uSharp, coverage(vec2(p) + 0.5));
  if (m > 0.0 && m > th) {
    vec2 uv = (vec2(p) + 0.5) / vec2(uOutSize);
    vec4 s = texture(uSrc, uv);
    vec3 c = mix(uBg, uFg, clamp(s.g, 0.0, 1.0));
    c = mix(c, uMuted, clamp(s.b, 0.0, 1.0));
    c = mix(c, uFg, clamp(s.r / 0.75, 0.0, 1.0));   // one-pixel lines are painted at 0.75 (THIN_INK)
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
  /** The palette table (core/palette.ts): colours per level and the level of each class code. */
  levels: readonly Rgb[];
  codeLevel: readonly number[];
  toneSteps: number;
  /** art cell in output px (1 when the source and the output are the art grid itself) */
  cellOut: number;
  /** hard ink threshold on the sampled R */
  inkThreshold: number;
  /** R above this is solid ink, between inkThreshold and this it is thin ink */
  solidThreshold: number;
  /** sharp-render share of cells everywhere (the dither dissolve of pixel art into the vector render) */
  sharp: number;
  focus: FocusParams;
  /** share of cells that show the street map; the rest are transparent (dissolve into the layer below) */
  blend: number;
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
  private stairs: ReturnType<typeof compile>;
  private present: ReturnType<typeof compile>;
  private srcTex: WebGLTexture;
  private art: [WebGLTexture, WebGLTexture];
  private fbo: [WebGLFramebuffer, WebGLFramebuffer];
  /** index of the art texture holding the finished art image */
  private cur = 0;
  private nearestSrc = false;
  private vao: WebGLVertexArrayObject;
  srcW = 0;
  srcH = 0;
  artW = 0;
  artH = 0;

  constructor(private gl: WebGL2RenderingContext) {
    this.pool = compile(gl, VERT, FRAG_POOL);
    this.stairs = compile(gl, VERT, FRAG_STAIRS);
    this.present = compile(gl, VERT, FRAG_PRESENT);
    this.srcTex = gl.createTexture()!;
    this.art = [gl.createTexture()!, gl.createTexture()!];
    this.fbo = [gl.createFramebuffer()!, gl.createFramebuffer()!];
    this.vao = gl.createVertexArray()!;
    for (const t of [this.srcTex, ...this.art]) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, t === this.srcTex ? gl.LINEAR : gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, t === this.srcTex ? gl.LINEAR : gl.NEAREST);
    }
  }

  /** The source is the art grid itself (one texel per cell): sample it with NEAREST. Otherwise it is a device-resolution render (LINEAR). */
  setNativeSource(on: boolean): void {
    // LINEAR in both modes: at one texel per cell a centre sample IS the texel, at 2x2 it is the average of the four
    // texels around the centre (the value of the ramp at the exact cell centre).
    this.nearestSrc = on;
  }

  /** Upload a canvas (another context's drawing buffer). Row 0 is the top. */
  uploadCanvas(canvas: HTMLCanvasElement): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    // Same size as last time (every frame of a pan): overwrite the storage instead of re-specifying it.
    if (canvas.width === this.srcW && canvas.height === this.srcH) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this.srcW = canvas.width;
    this.srcH = canvas.height;
  }

  private ensureArt(cols: number, rows: number): void {
    const gl = this.gl;
    if (cols === this.artW && rows === this.artH) return;
    for (let i = 0; i < 2; i++) {
      gl.bindTexture(gl.TEXTURE_2D, this.art[i]!);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[i]!);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.art[i]!, 0);
    }
    this.artW = cols;
    this.artH = rows;
  }

  private baseState(): void {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    gl.colorMask(true, true, true, true);
    gl.bindVertexArray(this.vao);
  }

  /** Passes A + T: classify every art cell of a virtual output of `outW x outH` device px. Returns the art grid size. */
  poolPass(p: PassParams, outW: number, outH: number): { cols: number; rows: number } {
    const gl = this.gl;
    const cols = Math.ceil(outW / p.cellOut);
    const rows = Math.ceil(outH / p.cellOut);
    this.ensureArt(cols, rows);
    this.baseState();
    gl.viewport(0, 0, cols, rows);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[0]!);
    gl.useProgram(this.pool.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    const u = this.pool.u;
    gl.uniform1i(u.uSrc!, 0);
    gl.uniform2i(u.uSrcSize!, this.srcW, this.srcH);
    gl.uniform1f(u.uScale!, this.srcW / outW);
    gl.uniform1i(u.uCellOut!, p.cellOut);
    gl.uniform1f(u.uInk!, p.inkThreshold);
    gl.uniform1f(u.uSolid!, p.solidThreshold);
    gl.uniform2i(u.uAnchor!, p.anchor[0], p.anchor[1]);
    gl.uniform1i(u.uToneSteps!, p.toneSteps);
    gl.uniform1i(u.uNativeArt!, this.nearestSrc ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.cur = 0;

    gl.useProgram(this.stairs.prog);
    const t = this.stairs.u;
    gl.uniform1i(t.uArt!, 0);
    gl.uniform2i(t.uArtSize!, cols, rows);
    for (let i = 0; i < 2; i++) {
      const from = this.cur;
      const to = 1 - from;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[to]!);
      gl.bindTexture(gl.TEXTURE_2D, this.art[from]!);
      gl.uniform1i(t.uSub!, i);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.cur = to;
    }
    return { cols, rows };
  }

  /** Pass B into the default framebuffer (device-sized output). */
  presentPass(p: PassParams, outW: number, outH: number): void {
    const gl = this.gl;
    this.baseState();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, outW, outH);
    gl.useProgram(this.present.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.art[this.cur]!);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    const u = this.present.u;
    gl.uniform1i(u.uArt!, 0);
    gl.uniform1i(u.uSrc!, 1);
    gl.uniform2i(u.uOutSize!, outW, outH);
    gl.uniform1f(u.uSharp!, p.sharp);
    gl.uniform1f(u.uBlend!, p.blend);
    gl.uniform4f(u.uFocus!, p.focus.x, p.focus.y, p.focus.radius, p.focus.feather);
    gl.uniform3f(u.uBg!, ...p.bg);
    gl.uniform3f(u.uFg!, ...p.fg);
    gl.uniform3f(u.uMuted!, ...p.muted);
    gl.uniform2i(u.uAnchor!, p.anchor[0], p.anchor[1]);
    gl.uniform1i(u.uCellOut!, p.cellOut);
    const pal = new Float32Array(MAX_LEVELS * 3);
    p.levels.forEach((c, i) => pal.set(c, i * 3));
    gl.uniform3fv(u["uPal[0]"]!, pal);
    const codes = new Int32Array(8);
    p.codeLevel.forEach((l, i) => (codes[i] = l));
    gl.uniform1iv(u["uCodeLevel[0]"]!, codes);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Read the finished art image back as class codes, row 0 = top. Tests and measurement only (a GPU stall). */
  readCodes(): { cols: number; rows: number; codes: Uint8Array } {
    const gl = this.gl;
    const px = new Uint8Array(this.artW * this.artH * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[this.cur]!);
    gl.readPixels(0, 0, this.artW, this.artH, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const codes = new Uint8Array(this.artW * this.artH);
    for (let i = 0; i < codes.length; i++) codes[i] = px[i * 4]!;
    return { cols: this.artW, rows: this.artH, codes };
  }

  /** Free every GL object. Safe on a lost context (the deletes are no-ops). */
  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.pool.prog);
    gl.deleteProgram(this.stairs.prog);
    gl.deleteProgram(this.present.prog);
    gl.deleteTexture(this.srcTex);
    for (const t of this.art) gl.deleteTexture(t);
    for (const f of this.fbo) gl.deleteFramebuffer(f);
    gl.deleteVertexArray(this.vao);
  }
}
