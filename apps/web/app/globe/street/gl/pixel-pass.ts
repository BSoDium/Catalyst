/**
 * The pixel pass: three small fragment programs for a WebGL2 context fed with the map's plain-colour render
 * (docs/pixel-line-rules.md, variant F; docs/street-zoom-spike.md for the channel contract).
 *
 *   pass A "pool"     one fragment per art cell. Samples the source at the EXACT CENTRE of the cell (native
 *                     rasterisation: a cell is ink iff its centre is inside the line; no max-pool, no coverage) and
 *                     writes the cell's palette LEVEL (R) and line class none / thin / solid (G). The level is read
 *                     from the style's channel encoding (core/palette.ts) and is never smoothed: a cell has exactly
 *                     one of the palette's levels.
 *   pass T "stairs"   two sub-passes of staircase removal on THIN line cells only (whatever their level), so every
 *                     one-pixel line is 8-connected with one cell per step. Wide lines are never touched.
 *   pass E "ease"     one fragment per art cell: the PRESENTED level moves towards the target level by at most `step` levels
 *                     per tick (step 255 = instantly), motion compensated: the previous presented image is looked up where
 *                     the camera had it (a warp mesh, core/warp.ts) and only changes that the camera does not explain ease
 *                     (core/ease.ts has the rule and its CPU twin). Runs on every map frame, moving or not, so a tile that
 *                     arrives at any time fades in, and content that merely moves never ghosts.
 *   pass L "levels"   (seed) the level of every cell of ANOTHER renderer's canvas (the Three.js globe): the presented image
 *                     starts from it at the globe-to-street cut, or it is the target of the street-to-globe one.
 *   pass B "present"  one fragment per output pixel. Looks the level up in the palette with nearest sampling (pixel
 *                     art); inside the focus circle (and, with `sharp`, everywhere) a cell shows the sharp source
 *                     render instead once the mask exceeds its Bayer threshold; with `blend` < 1 the remaining cells
 *                     are transparent, which dissolves the street map into whatever is underneath (the Three.js
 *                     globe) on the same art-pixel grid.
 *
 * Source orientation: row 0 is the top (an uploaded canvas). The art texture always has row 0 at the top.
 */
import type { Rgb } from "../core/pixel-types";
import { LEVEL_SCALE, MAX_LEVELS, codeOf } from "../core/palette";
import { MESH_STEP, type WarpMesh } from "../core/warp";

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
uniform float uSolid;        // R above this is a wide line (never thinned); between uInk and uSolid it is a thin line
uniform float uLevelScale;   // level encoding unit (core/palette.ts LEVEL_SCALE)
uniform int uMaxLevel;       // highest level (the ink)
uniform int uLimbLevel;      // level of the 1 art px limb where the disc edge straddles a cell
uniform int uNativeArt;      // 1: the source IS the art grid (one texel per cell, nearest): alpha between 0 and 1 is the disc edge
out vec4 o;
// Screen-anchored fill patterns (core/palette.ts PATTERN): a function of the art cell only, so a fill never moves under pan
// or zoom and never depends on world coordinates, time or tone.
bool patternLit(int pattern, ivec2 c) {
  if (pattern == 1) {
    // green: a dot every 4 cells, the odd rows of dots shifted by 2 (a regular quincunx lattice, 1 cell in 8)
    int x = c.x & 3, y = c.y & 3;
    return (x == 0 && y == 0) || (x == 2 && y == 2);
  }
  if (pattern == 2) {
    // water: dashes of 3 cells with 3 off, in rows 4 cells apart, alternate rows shifted by half a period (1 cell in 8)
    int shift = ((c.y >> 2) & 1) * 3;
    return (c.y & 3) == 0 && ((c.x + shift) % 6) < 3;
  }
  return true;
}
vec2 uvOfOut(vec2 outPx) { return outPx * uScale / vec2(uSrcSize); }
vec4 centre(ivec2 cell) { return texture(uSrc, uvOfOut((vec2(cell) + 0.5) * float(uCellOut))); }
// The fill of a cell: B = pattern x 16 + level (core/palette.ts). Anti-aliased strokes scale B where they cover a texel: an
// erasing stroke (route halo, hollow road interior) scales it towards 0, a line scales it by its opacity. Either garbles the
// code (pattern 2 level 4 = 36 becomes 27 = pattern 1 level 11) in the texels at the edge of the stroke, so the code is read
// from the cleanest texel of the cell: the highest B among the texels that carry no line. A centre texel that is fully erased
// (B = 0, no red) is an erased cell whatever its neighbours hold, which keeps the centre rule for the erasing strokes.
float fillCode(ivec2 cell, vec4 mx) {
  if (mx.r <= 0.004 && mx.b < 0.5 / 255.0) return 0.0;
  int n = max(1, int(floor(float(uCellOut) * uScale + 0.5)));   // source texels per cell and axis
  vec2 base = vec2(cell) * float(uCellOut) * uScale;
  float best = 0.0;
  for (int j = 0; j < n; j++) {
    for (int i = 0; i < n; i++) {
      vec4 t = texture(uSrc, (base + vec2(float(i), float(j)) + 0.5) / vec2(uSrcSize));
      if (t.r < 0.03) best = max(best, t.b);
    }
  }
  return floor(best * 255.0 + 0.5);
}

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
  int level = 0;
  int cls = 0;   // 0 none, 1 thin line, 2 wide line
  if (aMax >= 0.5) {
    if (mx.r > uInk) {
      cls = mx.r > uSolid ? 2 : 1;
      if (cls == 1) {
        // The edge texel of a WIDE line is antialiased (R = ink x coverage) and reads like a thin line. A thin line is painted at
        // THIN_INK (0.75) and never exceeds it, so a texel of the cell's block with R above uSolid proves a wide line: its edge cells
        // are solid too and the staircase remover never eats them (a 2 px road keeps its two cells on a diagonal).
        int n = max(1, int(floor(float(uCellOut) * uScale + 0.5)));
        vec2 b = vec2(cell) * float(uCellOut) * uScale;
        for (int j = 0; j < n; j++) for (int i = 0; i < n; i++) {
          if (texture(uSrc, (b + vec2(float(i), float(j)) + 0.5) / vec2(uSrcSize)).r > uSolid) cls = 2;
        }
      }
      // G / R is the level whatever the coverage of an antialiased edge texel (both are scaled by it)
      level = clamp(int(floor(mx.g / mx.r * uLevelScale + 0.5)), 1, uMaxLevel);
    } else {
      // fills: opaque, not antialiased; B = pattern x 16 + level (the level of the lit cells of the pattern)
      int code = int(fillCode(cell, mx));
      level = clamp(code & 15, 0, uMaxLevel);
      if (level > 0 && !patternLit(code >> 4, cell)) level = 0;
    }
    if (level == 0 && (aMin < 0.5 || (uNativeArt == 1 && mx.a < 0.98))) level = uLimbLevel;
  }
  o = vec4(float(level) / 255.0, float(cls) / 255.0, 0.0, 1.0);
}`;

const FRAG_STAIRS = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uArt;
uniform ivec2 uArtSize;
uniform int uSub;            // 0 or 1: the two sub-passes (left corners, then right corners)
out vec4 o;
ivec2 cellAt(ivec2 p) {
  if (p.x < 0 || p.y < 0 || p.x >= uArtSize.x || p.y >= uArtSize.y) return ivec2(0);
  vec4 t = texelFetch(uArt, p, 0);
  return ivec2(int(t.r * 255.0 + 0.5), int(t.g * 255.0 + 0.5));   // (level, line class)
}
int ink(ivec2 p) { return cellAt(p).y > 0 ? 1 : 0; }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 here = cellAt(p);
  ivec2 outCell = here;
  if (here.y == 1) {
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
    if (rm) outCell = ivec2(0);
  }
  o = vec4(float(outCell.x) / 255.0, float(outCell.y) / 255.0, 0.0, 1.0);
}`;

const FRAG_EASE = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uTarget;       // T: the classified art image (level in R, line class in G)
uniform sampler2D uPrevTarget;   // Tp: the classified image of the previous frame
uniform sampler2D uPrev;         // P: what was presented last (level in R, 1 in G for a line)
uniform sampler2D uMesh;         // RG32F: where a node's cell was in the previous frame (core/warp.ts)
uniform ivec2 uArt;
uniform ivec2 uMeshSize;
uniform int uMeshStep;
uniform int uWarp;               // 0: identity, 1: mesh
uniform int uRadius;             // match radius of lines in cells (0..2)
uniform int uStep;               // levels per tick; 255 = take the target at once
layout(location = 0) out vec4 o;    // the presented image
layout(location = 1) out vec4 oT;   // the classified image, kept as the "previous target" of the next frame (no separate copy pass)
const int FILL_R = 4;            // core/ease.ts FILL_RADIUS
// (level, 1 if a line else 0) of a cell, (0, 0) outside the image
ivec2 cellAt(sampler2D s, ivec2 c) {
  if (c.x < 0 || c.y < 0 || c.x >= uArt.x || c.y >= uArt.y) return ivec2(0);
  vec4 t = texelFetch(s, c, 0);
  return ivec2(int(t.r * 255.0 + 0.5), t.g > 0.002 ? 1 : 0);
}
// Previous-frame position (cells, continuous) of a point of this frame: bilinear in the mesh, as core/warp.ts warpPoint
vec2 oldPos(vec2 p) {
  if (uWarp == 0) return p;
  vec2 g = min(p / float(uMeshStep), vec2(uMeshSize - 1) - 1e-5);
  ivec2 i = ivec2(floor(g));
  vec2 f = g - vec2(i);
  vec2 a = texelFetch(uMesh, i, 0).rg, b = texelFetch(uMesh, i + ivec2(1, 0), 0).rg;
  vec2 c = texelFetch(uMesh, i + ivec2(0, 1), 0).rg, d = texelFetch(uMesh, i + ivec2(1, 1), 0).rg;
  if (min(min(a.x, b.x), min(c.x, d.x)) < -5.0e5) return vec2(-1.0e6);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// The previous-frame cell of a cell centre; false when it was off the old image or off the globe
bool oldCellOf(vec2 centre, out ivec2 oc) {
  vec2 q = oldPos(centre);
  oc = ivec2(floor(q));
  return q.x > -5.0e5 && oc.x >= 0 && oc.y >= 0 && oc.x < uArt.x && oc.y < uArt.y;
}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  ivec2 T = cellAt(uTarget, c);
  int t = T.x;
  bool tLine = T.y == 1;
  int fillOut = 0;
  int lineOut = 0;

  // ---- fill part: anchored to the screen, identity lookups, the lattice-sized radius
  ivec2 ph = cellAt(uPrev, c);
  bool pFill = ph.x > 0 && ph.y == 0;
  if (t > 0 && !tLine) {
    int base = pFill ? ph.x : 0;
    int best = 1000;
    // the same fill right here (the common case: nothing moved) is the nearest match: no search
    ivec2 tp0 = cellAt(uPrevTarget, c);
    bool here = tp0.x == t && tp0.y == 0 && pFill;
    if (here) { base = ph.x; best = 0; }
    for (int dy = -FILL_R; dy <= FILL_R; dy++) for (int dx = -FILL_R; dx <= FILL_R; dx++) {
      if (here) break;
      ivec2 q = c + ivec2(dx, dy);
      ivec2 tp = cellAt(uPrevTarget, q);
      if (tp.x != t || tp.y != 0) continue;
      int d2 = dx * dx + dy * dy;
      ivec2 pp = cellAt(uPrev, q);
      if (d2 < best && pp.y == 0) { best = d2; base = pp.x; }
    }
    fillOut = base + clamp(t - base, -uStep, uStep);
  } else if (t == 0 && pFill) {
    bool moved = false;
    for (int dy = -FILL_R; dy <= FILL_R; dy++) {
      for (int dx = -FILL_R; dx <= FILL_R; dx++) {
        ivec2 tt = cellAt(uTarget, c + ivec2(dx, dy));
        if (tt.x > 0 && tt.y == 0 && tt.x + 1 >= ph.x) { moved = true; break; }
      }
      if (moved) break;
    }
    fillOut = moved ? 0 : ph.x - min(ph.x, uStep);
  }

  // ---- line part: warped lookups
  ivec2 oc;
  if (!oldCellOf(vec2(c) + 0.5, oc)) {
    lineOut = (t > 0 && tLine) ? t : 0;      // nothing before: the target at once
  } else {
    ivec2 pe = cellAt(uPrev, oc);
    int e = pe.y == 1 ? pe.x : 0;
    if (t > 0 && tLine) {
      int base = e > 0 ? e : (pFill ? ph.x : 0);   // a road over a lake takes over from the fill tone: no dip
      int best = 1000;
      // the same line right here, at the warped cell (the common case: a pan by whole cells, a tile that stays): the nearest match, no search
      bool here = false;
      if (pe.y == 1) {
        ivec2 tp0 = cellAt(uPrevTarget, oc);
        if (tp0.x == t && tp0.y == 1) { base = pe.x; best = 0; here = true; }
      }
      for (int dy = -2; dy <= 2; dy++) for (int dx = -2; dx <= 2; dx++) {
        if (here || abs(dx) > uRadius || abs(dy) > uRadius) continue;
        ivec2 on;
        if (!oldCellOf(vec2(c + ivec2(dx, dy)) + 0.5, on)) continue;
        ivec2 tp = cellAt(uPrevTarget, on);
        if (tp.x == t && tp.y == 1) {        // the same line as last frame: its presented tone is the base
          int d2 = dx * dx + dy * dy;
          ivec2 pp = cellAt(uPrev, on);
          if (d2 < best && pp.y == 1) { best = d2; base = pp.x; }
        }
      }
      lineOut = base + clamp(t - base, -uStep, uStep);
    } else if (e > 0) {
      bool moved = false;                    // a lit line cell of the target near with a level of at least e - 1: the line moved
      for (int dy = -2; dy <= 2; dy++) {
        for (int dx = -2; dx <= 2; dx++) {
          if (abs(dx) > uRadius || abs(dy) > uRadius) continue;
          ivec2 tt = cellAt(uTarget, c + ivec2(dx, dy));
          if (tt.x > 0 && tt.y == 1 && tt.x + 1 >= e) { moved = true; break; }
        }
        if (moved) break;
      }
      lineOut = moved ? 0 : e - min(e, uStep);
    }
  }
  bool useLine = lineOut >= fillOut;          // the louder part wins; equal: the line
  int r = useLine ? lineOut : fillOut;
  o = vec4(float(r) / 255.0, (useLine && r > 0) ? 1.0 / 255.0 : 0.0, 0.0, 1.0);
  oT = texelFetch(uTarget, c, 0);
}`;

const FRAG_LEVELS = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uCanvas;       // another renderer's canvas (premultiplied), the palette's colours
uniform ivec2 uCanvasSize;
uniform vec2 uOffset;            // canvas pixel of this grid's cell (0, 0)'s origin, in cells
uniform int uLevels;
uniform vec3 uPal[${MAX_LEVELS}];
out vec4 o;
void main() {
  ivec2 p = ivec2(floor(gl_FragCoord.xy + uOffset));   // the cell's centre is gl_FragCoord (index + 0.5): the canvas pixel under it
  int lv = 0;
  if (p.x >= 0 && p.y >= 0 && p.x < uCanvasSize.x && p.y < uCanvasSize.y) {
    vec4 px = texelFetch(uCanvas, p, 0);
    if (px.a > 0.5) {
      vec3 col = px.rgb / px.a;
      float best = 1.0e9;
      for (int k = 0; k < ${MAX_LEVELS}; k++) {
        if (k >= uLevels) break;
        vec3 d = col - uPal[k];
        float dd = dot(d, d);
        if (dd < best) { best = dd; lv = k; }
      }
    }
  }
  o = vec4(float(lv) / 255.0, lv > 0 ? 1.0 / 255.0 : 0.0, 0.0, 1.0);   // the globe's marks are lines: they follow the camera
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
uniform float uLevelScale;
uniform vec3 uPal[${MAX_LEVELS}];      // the palette (engine/palette.ts): one colour per level
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
  int level = int(texelFetch(uArt, cell, 0).r * 255.0 + 0.5);
  vec3 col = uPal[clamp(level, 0, ${MAX_LEVELS - 1})];
  float m = max(uSharp, coverage(vec2(p) + 0.5));
  if (m > 0.0 && m > th) {
    // the sharp device-resolution render (reveal / sharp dissolve only): the same encoding, blended by coverage
    vec2 uv = (vec2(p) + 0.5) / vec2(uOutSize);
    vec4 s = texture(uSrc, uv);
    vec3 c = uPal[0];
    int fill = int(floor(s.b * 255.0 + 0.5)) & 15;   // B = pattern x 16 + level (the sharp render shows patterns as flat tones)
    if (fill > 0) c = uPal[clamp(fill, 0, ${MAX_LEVELS - 1})];
    if (s.r > 0.02) {
      int lv = clamp(int(floor(s.g / s.r * uLevelScale + 0.5)), 1, ${MAX_LEVELS - 1});
      c = mix(c, uPal[lv], clamp(s.r / 0.75, 0.0, 1.0));   // one-pixel lines are painted at 0.75 (THIN_INK)
    }
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
  /** The palette (engine/palette.ts): one colour per level, 0 = page colour, last = ink. */
  levels: readonly Rgb[];
  /** Level of the 1 art px limb at the edge of a globe projection's disc. */
  limbLevel: number;
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
  private easeProg: ReturnType<typeof compile>;
  private levelsProg: ReturnType<typeof compile>;
  private srcTex: WebGLTexture;
  /** The classified image of the previous frame (the ease looks content up in it), the warp mesh and another renderer's canvas. */
  private prevTarget: [WebGLTexture, WebGLTexture];
  private meshTex: WebGLTexture;
  private meshW = 0;
  private meshH = 0;
  private canvasTex: WebGLTexture;
  private canvasW = 0;
  private canvasH = 0;
  private art: [WebGLTexture, WebGLTexture];
  private fbo: [WebGLFramebuffer, WebGLFramebuffer];
  /** index of the art texture holding the finished art image (the target) */
  private cur = 0;
  /** The presented levels (what `ease` produced), two textures ping-ponged. */
  private eased: [WebGLTexture, WebGLTexture];
  private easedFbo: [WebGLFramebuffer, WebGLFramebuffer];
  private easedCur = 0;
  /** false until `ease` has run on the current size: the next one takes the target at once. */
  private easedValid = false;
  private nearestSrc = false;
  private vao: WebGLVertexArrayObject;
  /** GPU time per pass (EXT_disjoint_timer_query_webgl2), measurement only: `profile(true)` then `timings()`. */
  private timerExt: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null = null;
  private profiling = false;
  private pending: { name: string; q: WebGLQuery }[] = [];
  private acc = new Map<string, { sum: number; n: number }>();
  srcW = 0;
  srcH = 0;
  artW = 0;
  artH = 0;

  constructor(private gl: WebGL2RenderingContext) {
    this.pool = compile(gl, VERT, FRAG_POOL);
    this.stairs = compile(gl, VERT, FRAG_STAIRS);
    this.present = compile(gl, VERT, FRAG_PRESENT);
    this.easeProg = compile(gl, VERT, FRAG_EASE);
    this.levelsProg = compile(gl, VERT, FRAG_LEVELS);
    this.srcTex = gl.createTexture()!;
    this.prevTarget = [gl.createTexture()!, gl.createTexture()!];
    this.meshTex = gl.createTexture()!;
    this.canvasTex = gl.createTexture()!;
    this.art = [gl.createTexture()!, gl.createTexture()!];
    this.fbo = [gl.createFramebuffer()!, gl.createFramebuffer()!];
    this.eased = [gl.createTexture()!, gl.createTexture()!];
    this.easedFbo = [gl.createFramebuffer()!, gl.createFramebuffer()!];
    this.vao = gl.createVertexArray()!;
    for (const t of [this.srcTex, ...this.art, ...this.eased, ...this.prevTarget, this.meshTex, this.canvasTex]) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, t === this.srcTex ? gl.LINEAR : gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, t === this.srcTex ? gl.LINEAR : gl.NEAREST);
    }
    // a complete (2 x 2) mesh texture from the start, so the sampler is never bound to an incomplete texture while the warp is the identity
    gl.bindTexture(gl.TEXTURE_2D, this.meshTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, 2, 2, 0, gl.RG, gl.FLOAT, new Float32Array(8));
    this.meshW = 2;
    this.meshH = 2;
  }

  /** Switch the per-pass GPU timers on (measurement; needs EXT_disjoint_timer_query_webgl2). Returns whether they exist. */
  profile(on: boolean): boolean {
    if (on && !this.timerExt) this.timerExt = (this.gl.getExtension("EXT_disjoint_timer_query_webgl2") as PixelPass["timerExt"]) ?? null;
    this.profiling = on && !!this.timerExt;
    return this.profiling;
  }

  /** Mean GPU ms per pass name since `profile(true)` (queries are polled here and on every pass). */
  timings(): Record<string, { ms: number; n: number }> {
    this.pollTimers();
    const out: Record<string, { ms: number; n: number }> = {};
    for (const [k, v] of this.acc) out[k] = { ms: v.sum / Math.max(1, v.n), n: v.n };
    return out;
  }

  private timed(name: string, fn: () => void): void {
    if (!this.profiling || !this.timerExt) return fn();
    const gl = this.gl;
    const q = gl.createQuery()!;
    gl.beginQuery(this.timerExt.TIME_ELAPSED_EXT, q);
    fn();
    gl.endQuery(this.timerExt.TIME_ELAPSED_EXT);
    this.pending.push({ name, q });
    if (this.pending.length > 64) this.pollTimers();
  }

  private pollTimers(): void {
    if (!this.timerExt) return;
    const gl = this.gl;
    const disjoint = gl.getParameter(this.timerExt.GPU_DISJOINT_EXT) as boolean;
    const keep: { name: string; q: WebGLQuery }[] = [];
    for (const p of this.pending) {
      if (!gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) { keep.push(p); continue; }
      if (!disjoint) {
        const ns = gl.getQueryParameter(p.q, gl.QUERY_RESULT) as number;
        const a = this.acc.get(p.name) ?? { sum: 0, n: 0 };
        a.sum += ns / 1e6;
        a.n++;
        this.acc.set(p.name, a);
      }
      gl.deleteQuery(p.q);
    }
    this.pending = keep;
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
      gl.bindTexture(gl.TEXTURE_2D, this.eased[i]!);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.easedFbo[i]!);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.eased[i]!, 0);
      // the ease pass also writes the classified image it eased towards (the "previous target" of the next frame): attachment 1
      gl.bindTexture(gl.TEXTURE_2D, this.prevTarget[i]!);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.prevTarget[i]!, 0);
    }
    this.easedValid = false;
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
    gl.uniform1f(u.uLevelScale!, LEVEL_SCALE);
    gl.uniform1i(u.uMaxLevel!, p.levels.length - 1);
    gl.uniform1i(u.uLimbLevel!, p.limbLevel);
    gl.uniform1i(u.uNativeArt!, this.nearestSrc ? 1 : 0);
    this.timed("pool", () => gl.drawArrays(gl.TRIANGLES, 0, 3));
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
      this.timed("stairs", () => gl.drawArrays(gl.TRIANGLES, 0, 3));
      this.cur = to;
    }
    return { cols, rows };
  }

  /**
   * Pass E: move the presented levels towards the classified art image (see FRAG_EASE and core/ease.ts). `step` is the number of levels
   * to move this frame (0 keeps the tone but still follows the camera), `mesh` where the cells of this frame were in the previous one
   * (null = identity) and `radius` the match tolerance. The first call after a size change, a context restore or `invalidate` takes the
   * target at once whatever `step` is. Afterwards the classified image becomes the "previous target" of the next call.
   */
  ease(step: number, mesh: WarpMesh | null = null, radius = 0): void {
    const gl = this.gl;
    if (this.artW === 0) return;
    this.baseState();
    const from = this.easedCur;
    const to = 1 - from;
    gl.viewport(0, 0, this.artW, this.artH);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.easedFbo[to]!);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.useProgram(this.easeProg.prog);
    const u = this.easeProg.u;
    const warp = !!mesh && mesh.kind !== "identity";
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.art[this.cur]!);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.eased[from]!);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.prevTarget[from]!);
    gl.activeTexture(gl.TEXTURE3);
    if (warp) this.uploadMesh(mesh!);
    else gl.bindTexture(gl.TEXTURE_2D, this.meshTex);
    gl.uniform1i(u.uTarget!, 0);
    gl.uniform1i(u.uPrev!, 1);
    gl.uniform1i(u.uPrevTarget!, 2);
    gl.uniform1i(u.uMesh!, 3);
    gl.uniform2i(u.uArt!, this.artW, this.artH);
    gl.uniform2i(u.uMeshSize!, this.meshW, this.meshH);
    gl.uniform1i(u.uMeshStep!, MESH_STEP);
    const instant = !this.easedValid;
    gl.uniform1i(u.uWarp!, warp && !instant ? 1 : 0);
    gl.uniform1i(u.uRadius!, instant ? 0 : Math.max(0, Math.min(2, Math.round(radius))));
    gl.uniform1i(u.uStep!, instant ? 255 : Math.max(0, Math.min(255, Math.round(step))));
    this.timed("ease", () => gl.drawArrays(gl.TRIANGLES, 0, 3));
    this.easedCur = to;
    this.easedValid = true;
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);
    gl.activeTexture(gl.TEXTURE0);
  }

  private uploadMesh(mesh: WarpMesh): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.meshTex);
    if (mesh.mw === this.meshW && mesh.mh === this.meshH) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, mesh.mw, mesh.mh, gl.RG, gl.FLOAT, mesh.data);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, mesh.mw, mesh.mh, 0, gl.RG, gl.FLOAT, mesh.data);
    this.meshW = mesh.mw;
    this.meshH = mesh.mh;
  }

  /** The next `ease` takes the target at once (a resume after a pause, a style swap that cannot be warped). */
  invalidate(): void {
    this.easedValid = false;
  }

  get valid(): boolean {
    return this.easedValid;
  }

  /** Upload another renderer's canvas (the Three.js globe's drawing buffer): same-task only, a WebGL canvas is cleared after it is composited. */
  uploadCanvasSource(canvas: HTMLCanvasElement): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.canvasTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    if (canvas.width === this.canvasW && canvas.height === this.canvasH) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this.canvasW = canvas.width;
    this.canvasH = canvas.height;
  }

  /**
   * Pass L: the palette level of every art cell of the uploaded canvas. `offset` is the canvas pixel of the grid's (0, 0) corner, in
   * cells (the canvas is laid out like the grid, possibly shifted). `into` "target": the classified image of this frame (the street
   * ease then runs towards the OTHER renderer's image: the street-to-globe cut); "presented": the presented image, valid at once, and
   * the next ease starts from it (the globe-to-street cut), its tone steps are the cut's cross-fade.
   */
  levelsFromCanvas(into: "target" | "presented", levels: readonly Rgb[], cols: number, rows: number, offset: [number, number]): void {
    const gl = this.gl;
    this.ensureArt(cols, rows);
    this.baseState();
    gl.viewport(0, 0, cols, rows);
    const dest = into === "target" ? this.fbo[0]! : this.easedFbo[this.easedCur]!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dest);
    if (into === "presented") gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);
    gl.useProgram(this.levelsProg.prog);
    const u = this.levelsProg.u;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.canvasTex);
    gl.uniform1i(u.uCanvas!, 0);
    gl.uniform2i(u.uCanvasSize!, this.canvasW, this.canvasH);
    gl.uniform2f(u.uOffset!, offset[0], offset[1]);
    gl.uniform1i(u.uLevels!, levels.length);
    const pal = new Float32Array(MAX_LEVELS * 3);
    levels.forEach((c, i) => pal.set(c, i * 3));
    gl.uniform3fv(u["uPal[0]"]!, pal);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (into === "target") {
      this.cur = 0;
    } else {
      this.easedValid = true;
      // the previous target of the seeded frame is empty: nothing matches, every change eases from the seeded picture
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);
    }
  }

  /** Pass B into the default framebuffer (device-sized output). */
  presentPass(p: PassParams, outW: number, outH: number): void {
    const gl = this.gl;
    this.baseState();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, outW, outH);
    gl.useProgram(this.present.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, (this.easedValid ? this.eased[this.easedCur]! : this.art[this.cur]!));
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    const u = this.present.u;
    gl.uniform1i(u.uArt!, 0);
    gl.uniform1i(u.uSrc!, 1);
    gl.uniform2i(u.uOutSize!, outW, outH);
    gl.uniform1f(u.uSharp!, p.sharp);
    gl.uniform1f(u.uBlend!, p.blend);
    gl.uniform4f(u.uFocus!, p.focus.x, p.focus.y, p.focus.radius, p.focus.feather);
    gl.uniform1f(u.uLevelScale!, LEVEL_SCALE);
    gl.uniform2i(u.uAnchor!, p.anchor[0], p.anchor[1]);
    gl.uniform1i(u.uCellOut!, p.cellOut);
    const pal = new Float32Array(MAX_LEVELS * 3);
    p.levels.forEach((c, i) => pal.set(c, i * 3));
    gl.uniform3fv(u["uPal[0]"]!, pal);
    this.timed("present", () => gl.drawArrays(gl.TRIANGLES, 0, 3));
    gl.activeTexture(gl.TEXTURE0);
  }

  /**
   * Read the finished art image back, row 0 = top: `codes` are class codes (`CODE`: thin / solid lines, any other lit cell
   * is a fill) and `levels` the palette level of each cell. Tests and measurement only (a GPU stall).
   */
  readCodes(): { cols: number; rows: number; codes: Uint8Array; levels: Uint8Array } {
    const gl = this.gl;
    const px = new Uint8Array(this.artW * this.artH * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[this.cur]!);
    gl.readPixels(0, 0, this.artW, this.artH, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const codes = new Uint8Array(this.artW * this.artH);
    const levels = new Uint8Array(this.artW * this.artH);
    for (let i = 0; i < codes.length; i++) {
      levels[i] = px[i * 4]!;
      codes[i] = codeOf(px[i * 4]!, px[i * 4 + 1]!);
    }
    return { cols: this.artW, rows: this.artH, codes, levels };
  }

  /**
   * Tests only (scripts/street/ease-twin.mjs): put a classified image, the previous classified image and the previous presented image
   * (level in R, 1 in G for a line) straight into the textures, so `ease` can be compared with the CPU twin in core/ease.ts.
   */
  debugLoad(cols: number, rows: number, target: { lvl: Uint8Array; line: Uint8Array }, prevTarget: { lvl: Uint8Array; line: Uint8Array }, prev: { lvl: Uint8Array; line: Uint8Array }): void {
    const gl = this.gl;
    this.ensureArt(cols, rows);
    const pack = (i: { lvl: Uint8Array; line: Uint8Array }) => {
      const px = new Uint8Array(cols * rows * 4);
      for (let k = 0; k < cols * rows; k++) { px[k * 4] = i.lvl[k]!; px[k * 4 + 1] = i.line[k]!; px[k * 4 + 3] = 255; }
      return px;
    };
    const put = (tex: WebGLTexture, i: { lvl: Uint8Array; line: Uint8Array }) => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, pack(i));
    };
    put(this.art[0]!, target);
    this.cur = 0;
    put(this.prevTarget[this.easedCur]!, prevTarget);
    put(this.eased[this.easedCur]!, prev);
    this.easedValid = true;
  }

  /** The presented image with its kinds (level, 1 = line), row 0 = top. Tests only. */
  readPresentedFull(): { lvl: Uint8Array; line: Uint8Array } {
    const gl = this.gl;
    const px = new Uint8Array(this.artW * this.artH * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.easedFbo[this.easedCur]!);
    gl.readPixels(0, 0, this.artW, this.artH, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const lvl = new Uint8Array(this.artW * this.artH);
    const line = new Uint8Array(this.artW * this.artH);
    for (let i = 0; i < lvl.length; i++) { lvl[i] = px[i * 4]!; line[i] = px[i * 4 + 1]! > 0 ? 1 : 0; }
    return { lvl, line };
  }

  /** The PRESENTED level of every cell (after easing), row 0 = top. Tests and measurement only. */
  readPresentedLevels(): Uint8Array {
    const gl = this.gl;
    const px = new Uint8Array(this.artW * this.artH * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.easedValid ? this.easedFbo[this.easedCur]! : this.fbo[this.cur]!);
    gl.readPixels(0, 0, this.artW, this.artH, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const out = new Uint8Array(this.artW * this.artH);
    for (let i = 0; i < out.length; i++) out[i] = px[i * 4]!;
    return out;
  }

  /** Free every GL object. Safe on a lost context (the deletes are no-ops). */
  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.pool.prog);
    gl.deleteProgram(this.stairs.prog);
    gl.deleteProgram(this.present.prog);
    gl.deleteProgram(this.easeProg.prog);
    gl.deleteProgram(this.levelsProg.prog);
    gl.deleteTexture(this.srcTex);
    for (const t of [...this.art, ...this.eased, ...this.prevTarget, this.meshTex, this.canvasTex]) gl.deleteTexture(t);
    for (const f of [...this.fbo, ...this.easedFbo]) gl.deleteFramebuffer(f);
    gl.deleteVertexArray(this.vao);
  }
}
