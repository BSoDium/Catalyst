/**
 * The pixel pass: small fragment programs, usable in any WebGL2 context (the map's own, via a custom layer,
 * or a separate one fed by a canvas copy).
 *
 *   pass A "pool"    one fragment per art cell. Reads the plain-colour source (R ink, G/B tones, alpha) and writes a
 *                    CLASS CODE per cell (none / thin ink / solid ink / foreground tone / muted). The line rule is
 *                    selectable, see `LineRule` and docs/pixel-line-rules.md:
 *                      "centre"  (default) sample the source at the exact centre of the cell. With lines drawn at
 *                                >= 1 art pixel wide this IS native rasterisation: a cell is ink iff its centre is
 *                                inside the line. No dropouts, no doubling, no dependence on the supersampling factor.
 *                      "ridge"   centre sampling plus non-maximum suppression across the line, for tent-profile
 *                                hairlines: exactly one cell per step along the major axis at every angle (a
 *                                Bresenham equivalent).
 *                      "any"     max over the whole footprint (conservative, thickens lines)
 *                      "legacy"  the original spike rule (max over the footprint, hard threshold)
 *   pass T "thin"    optional Zhang-Suen thinning of cells coded "thin ink" (ping-pong, 2 sub-passes per iteration).
 *   pass B "present" one fragment per output pixel. Decodes the class code to the token palette, nearest-samples the
 *                    art texture (pixel art), and where the focus mask (plus the global dissolve) says so, shows the
 *                    sharp source render instead. A cell flips to sharp when mask coverage > its Bayer threshold.
 *
 * Source orientation: `topFirst` = row 0 is the top (an uploaded canvas); otherwise row 0 is the bottom (a
 * framebuffer copy). The art texture always has row 0 at the top.
 */
import type { Rgb } from "../core/pixel";

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

/** Class codes stored in the art texture (R channel, code / 255). Twins of `CODE` in core/artLine.ts. */
export const CODE = { none: 0, thin: 1, solid: 2, tone: 3, muted: 4 } as const;

export type LineRule = "legacy" | "any" | "centre" | "ridge";
const RULE_ID: Record<LineRule, number> = { legacy: 0, any: 1, centre: 2, ridge: 3 };

const FRAG_POOL = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uSrc;
uniform ivec2 uSrcSize;
uniform float uScale;        // source px per output px
uniform int uCellOut;        // art cell in output px
uniform int uSrcTopFirst;
uniform float uInk;          // ink threshold for centre / legacy / ridge
uniform float uAny;          // ink threshold for the "any" rule
uniform float uSolid;        // R above this is solid ink (never thinned); between uInk and uSolid it is thin ink
uniform int uRule;           // 0 legacy, 1 any, 2 centre, 3 ridge
uniform int uDither;
uniform int uPattern;        // 0 bayer8 thresholds, 1 clean (tone quantised to sixteenths)
uniform ivec2 uAnchor;
out vec4 o;
${BAYER}
bool toneLit(float tone, ivec2 c) {
  if (uDither == 0) return tone > 0.5;
  if (uPattern == 1) return bayer8(c) < int(floor(tone * 16.0 + 0.5)) * 4;
  return tone > thr(c);
}
vec2 uvOfOut(vec2 outPx) {
  vec2 uv = outPx * uScale / vec2(uSrcSize);
  if (uSrcTopFirst == 0) uv.y = 1.0 - uv.y;
  return uv;
}
vec4 centre(ivec2 cell) { return texture(uSrc, uvOfOut((vec2(cell) + 0.5) * float(uCellOut))); }
float code(int c) { return float(c) / 255.0; }

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  // alpha over the footprint (4 corners + centre): outside the globe disc alpha is 0
  float aMax, aMin;
  vec4 mx = vec4(0.0);
  if (uRule <= 1) {
    ivec2 lo = ivec2(floor(vec2(cell * uCellOut) * uScale));
    ivec2 hi = ivec2(ceil(vec2((cell + 1) * uCellOut) * uScale));
    hi = max(hi, lo + 1);
    aMin = 1.0;
    aMax = 0.0;
    for (int y = lo.y; y < hi.y; y++) {
      for (int x = lo.x; x < hi.x; x++) {
        if (x >= uSrcSize.x || y >= uSrcSize.y) continue;
        int sy = uSrcTopFirst == 1 ? y : uSrcSize.y - 1 - y;
        vec4 t = texelFetch(uSrc, ivec2(x, sy), 0);
        mx = max(mx, t);
        aMin = min(aMin, t.a);
        aMax = max(aMax, t.a);
      }
    }
  } else {
    mx = centre(cell);
    float c = float(uCellOut);
    vec2 base = vec2(cell) * c;
    float a0 = texture(uSrc, uvOfOut(base + 0.5)).a;
    float a1 = texture(uSrc, uvOfOut(base + vec2(c - 0.5, 0.5))).a;
    float a2 = texture(uSrc, uvOfOut(base + vec2(0.5, c - 0.5))).a;
    float a3 = texture(uSrc, uvOfOut(base + c - 0.5)).a;
    aMin = min(min(a0, a1), min(a2, a3));
    aMax = max(max(a0, a1), max(a2, a3));
    aMin = min(aMin, mx.a);
    aMax = max(aMax, mx.a);
  }
  int outCode = 0;
  if (aMax >= 0.5) {
    ivec2 tc = cell + uAnchor;
    if (uRule == 0) {
      if (mx.r > uInk) outCode = 2;
    } else if (uRule == 1) {
      if (mx.r > uAny) outCode = 1;
    } else if (uRule == 2) {
      if (mx.r > uInk) outCode = mx.r > uSolid ? 2 : 1;
    } else {
      float v = mx.r;
      if (v > uSolid) outCode = 2;
      else if (v > uInk) {
        float l = centre(cell + ivec2(-1, 0)).r;
        float r = centre(cell + ivec2(1, 0)).r;
        float u = centre(cell + ivec2(0, -1)).r;
        float d = centre(cell + ivec2(0, 1)).r;
        float sx = abs(l - v) + abs(r - v);
        float sy = abs(u - v) + abs(d - v);
        bool ridge = sy >= sx ? (v > u && v >= d) : (v > l && v >= r);
        if (ridge) outCode = 1;
      }
    }
    if (outCode == 0) {
      if (aMin < 0.5) outCode = 4;                 // straddles the disc edge: 1 art px limb
      else if (uRule == 0 ? toneLit(mx.b, tc) : mx.b > 0.49) outCode = 4;   // muted lines (rail, graticule): hard threshold
      else if (toneLit(mx.g, tc)) outCode = 3;
    }
  }
  o = vec4(code(outCode), 0.0, 0.0, 1.0);
}`;

const FRAG_THIN = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uArt;
uniform ivec2 uArtSize;
uniform int uSub;            // 0 or 1: the two sub-iterations
uniform int uMode;           // 0 Zhang-Suen, 1 staircase removal
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
  if (c == 1 && uMode == 1) {
    // Staircase removal. A one-pixel line sampled at cell centres is 4-connected (two cells per step) at some
    // angles, worst at 45 degrees. A cell is redundant when it is the corner of such a stair: it has exactly one
    // horizontal and one vertical 4-neighbour (diagonal to each other, so removing it keeps the line 8-connected),
    // no neighbour on the other two sides (nor the diagonal that only it would connect), and the stair continues diagonally. Two sub-passes (left cells, then
    // right cells) so a stair of two-cell steps is thinned to ONE cell per step, never to none.
    int N = ink(p + ivec2(0, -1)), S = ink(p + ivec2(0, 1)), E = ink(p + ivec2(1, 0)), W = ink(p + ivec2(-1, 0));
    int NE = ink(p + ivec2(1, -1)), NW = ink(p + ivec2(-1, -1)), SE = ink(p + ivec2(1, 1)), SW = ink(p + ivec2(-1, 1));
    bool rm;
    // each rule also forbids the one diagonal neighbour that would be orphaned by the removal
    if (uSub == 0) rm = (E == 1 && W == 0) && ((N == 1 && S == 0 && SW == 0 && (NW == 1 || SE == 1)) || (S == 1 && N == 0 && NW == 0 && (SW == 1 || NE == 1)));
    else rm = (W == 1 && E == 0) && ((N == 1 && S == 0 && SE == 0 && (NE == 1 || SW == 1)) || (S == 1 && N == 0 && NE == 0 && (SE == 1 || NW == 1)));
    if (rm) outC = 0;
  } else if (c == 1) {
    // P2..P9 clockwise from north
    int n0 = ink(p + ivec2(0, -1)), n1 = ink(p + ivec2(1, -1)), n2 = ink(p + ivec2(1, 0)), n3 = ink(p + ivec2(1, 1));
    int n4 = ink(p + ivec2(0, 1)), n5 = ink(p + ivec2(-1, 1)), n6 = ink(p + ivec2(-1, 0)), n7 = ink(p + ivec2(-1, -1));
    int B = n0 + n1 + n2 + n3 + n4 + n5 + n6 + n7;
    int A = (n0 == 0 && n1 == 1 ? 1 : 0) + (n1 == 0 && n2 == 1 ? 1 : 0) + (n2 == 0 && n3 == 1 ? 1 : 0) + (n3 == 0 && n4 == 1 ? 1 : 0)
          + (n4 == 0 && n5 == 1 ? 1 : 0) + (n5 == 0 && n6 == 1 ? 1 : 0) + (n6 == 0 && n7 == 1 ? 1 : 0) + (n7 == 0 && n0 == 1 ? 1 : 0);
    bool ok = B >= 2 && B <= 6 && A == 1;
    if (ok) {
      if (uSub == 0) ok = (n0 * n2 * n4 == 0) && (n2 * n4 * n6 == 0);
      else ok = (n0 * n2 * n6 == 0) && (n0 * n4 * n6 == 0);
    }
    if (ok) outC = 0;
  }
  o = vec4(float(outC) / 255.0, 0.0, 0.0, 1.0);
}`;

const FRAG_PRESENT = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uArt;
uniform sampler2D uSrc;
uniform ivec2 uOutSize;
uniform int uCellOut;
uniform int uSrcTopFirst;
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
  int code = int(texelFetch(uArt, cell, 0).r * 255.0 + 0.5);
  vec3 col = code == 0 ? uBg : (code == 4 ? uMuted : uFg);
  float m = max(uSharp, coverage(vec2(p) + 0.5));
  if (m > 0.0 && m > thr(cell + uAnchor)) {
    vec2 uv = (vec2(p) + 0.5) / vec2(uOutSize);
    uv.y = uSrcTopFirst == 1 ? uv.y : 1.0 - uv.y;
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
  /** art cell in output (device) px */
  cellOut: number;
  /** hard ink threshold on the sampled R (centre/ridge/legacy rules) */
  inkThreshold: number;
  /** R above this is solid ink, between inkThreshold and this it is thin ink (thinning / ridge candidates) */
  solidThreshold: number;
  /** threshold of the "any" rule */
  anyThreshold: number;
  rule: LineRule;
  /** Zhang-Suen iterations on thin ink cells (0 = off) */
  thinIters: number;
  /** thinning algorithm for thin ink: "stairs" (4-connected stair removal) or "zs" (Zhang-Suen) */
  thinMode: "stairs" | "zs";
  dither: boolean;
  /** tone fills: "bayer8" raw thresholds, "clean" tone quantised to sixteenths (regular dot lattices) */
  pattern: "bayer8" | "clean";
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
  private thin: ReturnType<typeof compile>;
  private present: ReturnType<typeof compile>;
  private srcTex: WebGLTexture;
  private art: [WebGLTexture, WebGLTexture];
  private fbo: [WebGLFramebuffer, WebGLFramebuffer];
  /** index of the art texture holding the finished art image */
  private cur = 0;
  private vao: WebGLVertexArrayObject;
  srcW = 0;
  srcH = 0;
  srcTopFirst = true;
  artW = 0;
  artH = 0;

  constructor(private gl: WebGL2RenderingContext) {
    this.pool = compile(gl, VERT, FRAG_POOL);
    this.thin = compile(gl, VERT, FRAG_THIN);
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

  private uniformsCommon(u: Uniforms, p: PassParams): void {
    const gl = this.gl;
    gl.uniform3f(u.uBg!, ...p.bg);
    gl.uniform3f(u.uFg!, ...p.fg);
    gl.uniform3f(u.uMuted!, ...p.muted);
    gl.uniform2i(u.uAnchor!, p.anchor[0], p.anchor[1]);
    gl.uniform1i(u.uCellOut!, p.cellOut);
  }

  /**
   * Passes A (+T): classify every art cell of a virtual output of `outW x outH` device px into the internal art
   * texture. Returns the art grid size.
   */
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
    gl.uniform1i(u.uSrcTopFirst!, this.srcTopFirst ? 1 : 0);
    gl.uniform1f(u.uInk!, p.inkThreshold);
    gl.uniform1f(u.uAny!, p.anyThreshold);
    gl.uniform1f(u.uSolid!, p.solidThreshold);
    gl.uniform1i(u.uRule!, RULE_ID[p.rule]);
    gl.uniform1i(u.uDither!, p.dither ? 1 : 0);
    gl.uniform1i(u.uPattern!, p.pattern === "clean" ? 1 : 0);
    gl.uniform2i(u.uAnchor!, p.anchor[0], p.anchor[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.cur = 0;

    if (p.thinIters > 0) {
      gl.useProgram(this.thin.prog);
      const t = this.thin.u;
      gl.uniform1i(t.uArt!, 0);
      gl.uniform2i(t.uArtSize!, cols, rows);
      gl.uniform1i(t.uMode!, p.thinMode === "stairs" ? 1 : 0);
      for (let i = 0; i < p.thinIters * 2; i++) {
        const from = this.cur;
        const to = 1 - from;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[to]!);
        gl.bindTexture(gl.TEXTURE_2D, this.art[from]!);
        gl.uniform1i(t.uSub!, i & 1);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        this.cur = to;
      }
    }
    return { cols, rows };
  }

  /** Pass B into the currently bound framebuffer (device-sized output). */
  presentPass(p: PassParams, outW: number, outH: number): void {
    const gl = this.gl;
    this.baseState();
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
    gl.uniform1i(u.uSrcTopFirst!, this.srcTopFirst ? 1 : 0);
    gl.uniform1f(u.uSharp!, p.sharp);
    gl.uniform4f(u.uFocus!, p.focus.x, p.focus.y, p.focus.radius, p.focus.feather);
    this.uniformsCommon(u, p);
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

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.pool.prog);
    gl.deleteProgram(this.thin.prog);
    gl.deleteProgram(this.present.prog);
    gl.deleteTexture(this.srcTex);
    for (const t of this.art) gl.deleteTexture(t);
    for (const f of this.fbo) gl.deleteFramebuffer(f);
    gl.deleteVertexArray(this.vao);
  }
}
