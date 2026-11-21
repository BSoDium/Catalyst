import type * as T from "three";

/**
 * The light that glass casts on the ground. Light theme: the sun through the glass, traced on the graphics card: the same optics as `lib/glass-caustics.ts` (which is the readable version, and the one the tests and the
 * comparison with a path tracer are run on), written as a vertex shader. Dark theme: baked templates (below). A ray is a point: the shader follows it through the glass of its block (Snell's law, Fresnel, total internal reflection, rounded edges), works out where it lands on the ground,
 * and puts the point THERE, with the light it carries as its colour; the points are added up in a float target (additive blending), which is then smoothed a little. Millions of rays take a few milliseconds, where
 * the processor took seconds, and it is a one-time draw per theme; it is also what would let the lights change (a blinking light would only redraw the points).
 */

/** A block of glass and the light that goes through it, in world units. */
export interface GlassLight {
  c: [number, number, number];
  h: [number, number, number];
  r: number;
  /** A small tilt of the glass's normals (no two blocks are alike). */
  bias: [number, number, number];
  /** The colour of the light the block gives out (dark), or of its glass (light theme). */
  col: [number, number, number];
  /** How much one ray carries. */
  power: number;
  /** Where the light is at full strength and where it has faded out, from the block's centre. */
  near: number;
  far: number;
  /** Half width of the rod inside (dark), and a seed of the block's own (decorrelates the evenly spread rays of one block from another's). */
  rod: number;
  seed: [number, number, number, number, number];
  /** (dark theme) the soft pool of haze under the block, see `StampedBlock`. */
  pool?: { col: [number, number, number]; r: number };
}

export interface Grid {
  /** The size of the target, in pixels, and the number of pixels per world unit. */
  w: number;
  h: number;
  scale: number;
  /** The world position of the target's corner (x, z). */
  x0: number;
  z0: number;
}

const COMMON = /* glsl */ `
const float IOR = 1.5;
const float R0 = 0.04;
float reflectance(float c) { c = clamp(c, 0., 1.); return R0 + (1. - R0) * pow(1. - c, 5.); }
float sdf(vec3 p, vec3 h, float r) {
  vec3 q = abs(p) - (h - r);
  return length(max(q, 0.)) + min(max(q.x, max(q.y, q.z)), 0.) - r;
}
// where a ray enters and leaves the sharp box (x, y), y < x for a miss
vec2 slab(vec3 o, vec3 d, vec3 h) {
  float t0 = -1e9; float t1 = 1e9;
  for (int i = 0; i < 3; i++) {
    float di = d[i]; float oi = o[i]; float hi = h[i];
    if (abs(di) < 1e-9) { if (abs(oi) > hi) return vec2(1., -1.); continue; }
    float a = (-hi - oi) / di; float b = (hi - oi) / di;
    t0 = max(t0, min(a, b)); t1 = min(t1, max(a, b));
  }
  return vec2(t0, t1);
}
vec3 roundedNormal(vec3 p, vec3 h, float r, vec3 bias) {
  vec3 q = abs(p) - (h - r);
  vec3 s = vec3(p.x >= 0. ? 1. : -1., p.y >= 0. ? 1. : -1., p.z >= 0. ? 1. : -1.);
  float m = max(q.x, max(q.y, q.z));
  vec3 n;
  if (m <= 0.) {
    n = q.x >= q.y && q.x >= q.z ? vec3(s.x, 0., 0.) : q.y >= q.z ? vec3(0., s.y, 0.) : vec3(0., 0., s.z);
  } else {
    n = normalize(max(q, 0.) * s);
  }
  return normalize(n + bias);
}
// from inside the glass, at p going along d: bounce until it gets out; where it lands on the ground (world y = 0), the share of its power that got out, the length it went through glass
bool leaveGlass(vec3 p, vec3 dir, vec3 c, vec3 h, float r, vec3 bias, out vec3 land, out float share, out float path) {
  vec3 o = p; vec3 d = dir; share = 1.; path = 0.; land = vec3(0.);
  for (int b = 0; b < 12; b++) {
    vec2 s = slab(o, d, h);
    if (s.y < s.x) return false;
    float lo = 0.; float hi = s.y + 0.01;
    for (int k = 0; k < 14; k++) { float mid = .5 * (lo + hi); if (sdf(o + d * mid, h, r) < 0.) lo = mid; else hi = mid; }
    float t = .5 * (lo + hi);
    path += t;
    vec3 q = o + d * t;
    vec3 n = roundedNormal(q, h, r, bias);
    vec3 outd = refract(d, -n, IOR);
    if (dot(outd, outd) > 1e-8) {
      share *= 1. - reflectance(dot(outd, n));
      if (outd.y >= -1e-3) return false;
      float g = -(q.y + c.y) / outd.y;
      land = vec3(q.x + c.x + outd.x * g, 0., q.z + c.z + outd.z * g);
      return true;
    }
    d = reflect(d, n);
    o = q + d * 1e-4;
  }
  return false;
}
float reachFade(float dist, float near, float far) {
  if (dist <= near) return 1.;
  if (dist >= far) return 0.;
  float u = 1. - (dist - near) / (far - near);
  return u * u * (3. - 2. * u);
}
`;

const ATTRIBUTES = /* glsl */ `
attribute float ray;
attribute vec3 iC; attribute vec3 iH; attribute vec3 iBias; attribute vec3 iCol;
attribute vec4 iA;   // r, power, near, far
attribute vec4 iB;   // rod, seed0, seed1, seed2
attribute vec2 iD;   // seed3, seed4
uniform vec4 uGrid;  // pixels per unit, x0, z0, (unused)
uniform vec2 uSize;  // target size in pixels
varying vec3 vColor;
vec4 toClip(vec3 land) {
  float gx = (land.x - uGrid.y) * uGrid.x;
  float gz = (land.z - uGrid.z) * uGrid.x;
  return vec4(gx / uSize.x * 2. - 1., 1. - gz / uSize.y * 2., 0., 1.);
}
void discardPoint() { gl_Position = vec4(2., 2., 2., 1.); gl_PointSize = 0.; vColor = vec3(0.); }
`;

const SUN_VERT = /* glsl */ `
${COMMON}
${ATTRIBUTES}
uniform vec3 uDir;       // the way the light travels
uniform float uN;        // rays per side
uniform float uFree;     // 0: where the glass lands the ray (adds), 1: where it would have landed (takes away)
uniform float uAbsorb;
uniform float uStraight;
uniform float uPerArea;  // pixel area / cos
float hash(float n) { return fract(sin(n * 12.9898 + 78.233) * 43758.5453); }
void main() {
  float i = ray;
  float r = iA.x; float power = iA.y; float near = iA.z; float far = iA.w;
  vec3 h = iH;
  float R = length(h);
  float gi = mod(i, uN); float gj = floor(i / uN);
  float cell = 2. * R / uN;
  float a = -R + (gi + hash(i + iB.y)) * cell;
  float b = -R + (gj + hash(i * 1.37 + iB.z)) * cell;
  vec3 d = uDir;
  vec3 u = normalize(cross(d, vec3(0., 1., 0.)));
  vec3 v = cross(d, u);
  vec3 o = u * a + v * b - d * 2. * R;
  vec2 s = slab(o, d, h);
  if (s.y < s.x) { discardPoint(); return; }
  float area = cell * cell * uPerArea;
  if (uFree > .5) {
    float fy = -(o.y + iC.y) / d.y;
    vec3 free = vec3(o.x + iC.x + d.x * fy, 0., o.z + iC.z + d.z * fy);
    vec3 tint = vec3(1.) - uStraight * exp(-uAbsorb * (vec3(1.) - iCol));
    vColor = -area * tint;
    gl_Position = toClip(free);
    gl_PointSize = 1.;
    return;
  }
  // sphere tracing from where it enters the sharp box, to the rounded one
  float te = max(0., s.x - 1e-3);
  bool hit = false;
  for (int k = 0; k < 48; k++) {
    float sd = sdf(o + d * te, h, r);
    if (sd < 1e-4) { hit = true; break; }
    te += sd;
    if (te > s.y + 1e-3) break;
  }
  if (!hit) { discardPoint(); return; }
  vec3 q = o + d * te;
  vec3 nrm = roundedNormal(q, h, r, iBias);
  vec3 inside = refract(d, nrm, 1. / IOR);
  if (dot(inside, inside) < 1e-8) { discardPoint(); return; }
  float entered = 1. - reflectance(-dot(d, nrm));
  vec3 land; float share; float path;
  if (!leaveGlass(q + inside * 1e-4, inside, iC, h, r, iBias, land, share, path)) { discardPoint(); return; }
  float fade = reachFade(length(land.xz - iC.xz), near, far);
  if (fade <= 0.) { discardPoint(); return; }
  vColor = area * entered * share * fade * exp(-uAbsorb * (vec3(1.) - iCol) * path);
  gl_Position = toClip(land);
  gl_PointSize = 1.;
}
`;

const POINT_FRAG = /* glsl */ `varying vec3 vColor; void main() { gl_FragColor = vec4(vColor, 1.); }`;

const FULL_VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;

/**
 * The light one block casts on the ground, baked: a path tracer (Mitsuba, see `scripts/caustic-templates`) rendered a glass block with a rod of light in it, from above, for a few heights of block and a few heights above
 * the ground, and averaged it over the eight symmetries of the square (enough samples that it is clean). What is stored is one quarter of each (x, z >= 0), as the log of the light, in an 8-bit picture. The page draws
 * each block's light by laying the right template under it (interpolated between the classes): the structure the tracer found, a fan out of every face and a faint wide glow, as sharp as the ground it is drawn on.
 */
export interface CausticTemplates {
  texture: T.Texture;
  /** The heights of block and of its foot above the ground the templates were rendered for. */
  heights: number[];
  feet: number[];
  /** How far from the block's centre a template reaches, in world units. */
  extent: number;
}

export const TEMPLATE_HEIGHTS = [0.5, 1.3, 2.4];
export const TEMPLATE_FEET = [0, 0.9, 1.8, 2.7];
export const TEMPLATE_EXTENT = 8;
/** The exponent of the curve applied to the baked light when it is laid down (above 1: the wide faint glow is lowered more than the bright streaks). */
export const STAMP_CONTRAST = 2.4;
/** How much of the light at the very foot of a block is kept (0 to 1; it rises to all of it by 3 units out). */
export const STAMP_FOOT = 0.04;
/** The quarter of a template, in pixels, and how the log is stored: value = (exp(byte / 255 * LOG_RANGE) - 1) * LOG_FLOOR. */
export const TEMPLATE_SIZE = 128;
export const LOG_FLOOR = 1e-4;
export const LOG_RANGE = 10;

/** Fetch and decode the templates picture into a half-float texture (the light itself, not its log). */
export async function loadCausticTemplates(THREE: typeof T, url: string): Promise<CausticTemplates> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, img.width, img.height).data;
  const half = new Uint16Array(img.width * img.height * 4);
  const one = THREE.DataUtils.toHalfFloat(1);
  for (let i = 0; i < img.width * img.height; i++) {
    const v = (Math.exp((px[i * 4]! / 255) * LOG_RANGE) - 1) * LOG_FLOOR;
    half[i * 4] = half[i * 4 + 1] = half[i * 4 + 2] = THREE.DataUtils.toHalfFloat(v);
    half[i * 4 + 3] = one;
  }
  const texture = new THREE.DataTexture(half, img.width, img.height, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return { texture, heights: TEMPLATE_HEIGHTS, feet: TEMPLATE_FEET, extent: TEMPLATE_EXTENT };
}

/** A block whose baked light is to be laid on the ground: where it is, its height and the height of its foot, and the colour of its light with its strength. */
export interface StampedBlock {
  x: number;
  z: number;
  height: number;
  foot: number;
  col: [number, number, number];
  /** The soft pool of haze under the block (it is there when the rod is on): its colour already times its strength, and its radius. */
  poolCol: [number, number, number];
  poolRadius: number;
}

const STAMP_VERT = /* glsl */ `
attribute vec2 iPos; attribute vec3 iCol; attribute vec4 iIdx; attribute vec3 iPoolCol; attribute float iPoolR;
uniform vec4 uGrid; uniform vec2 uSize; uniform float uExtent;
varying vec3 vCol; varying vec2 vLocal; varying vec4 vIdx; varying vec3 vPoolCol; varying float vPoolR;
void main() {
  vPoolCol = iPoolCol; vPoolR = iPoolR;
  vLocal = position.xy * 2. * uExtent;
  vCol = iCol; vIdx = iIdx;
  vec2 world = iPos + vLocal;
  float gx = (world.x - uGrid.y) * uGrid.x;
  float gz = (world.y - uGrid.z) * uGrid.x;
  gl_Position = vec4(gx / uSize.x * 2. - 1., 1. - gz / uSize.y * 2., 0., 1.);
}
`;

const STAMP_FRAG = /* glsl */ `
uniform sampler2D atlas; uniform float uContrast; uniform float uFoot; uniform float uExtent; uniform vec2 uCells; uniform float uQuarter;
varying vec3 vCol; varying vec2 vLocal; varying vec4 vIdx; varying vec3 vPoolCol; varying float vPoolR;
float tap(float h, float f, vec2 u) {
  // the template of height class h, foot class f: the cell of the atlas, sampled inside it (never across its edge)
  vec2 inside = (clamp(u, 0., 1.) * (uQuarter - 1.) + .5) / uQuarter;
  return texture2D(atlas, (vec2(f, h) + inside) / uCells).r;
}
void main() {
  // the soft pool: a round spot of haze under the block, a third of its peak at 0.45 of its radius and out to nothing at the radius
  float pu = length(vLocal) / vPoolR;
  float pool = pu >= 1. ? 0. : (pu < .45 ? 1. - (pu / .45) * .65 : .35 * (1. - (pu - .45) / .55));
  vec2 u = abs(vLocal) / uExtent;
  float edge = length(u);
  if (edge >= 1.) discard;
  float h0 = vIdx.x; float fH = vIdx.y; float f0 = vIdx.z; float fF = vIdx.w;
  float h1 = min(h0 + 1., uCells.y - 1.); float f1 = min(f0 + 1., uCells.x - 1.);
  float v = mix(mix(tap(h0, f0, u), tap(h0, f1, u), fF), mix(tap(h1, f0, u), tap(h1, f1, u), fF), fH);
  // (a curve that keeps the bright structure and lowers the faint wide glow under it, so that the streaks are not drowned: where the template is a tenth of its peak, it is far less than a tenth)
  v = pow(max(v, 0.), uContrast);
  // (the template ends at its edge: let it fade out just before, not stop)
  v *= 1. - smoothstep(.5, 1., edge);
  // (the bright foot of a block is for a block on open ground: in the picture its neighbours stand in the way, and the ground between blocks is not lit like that; it is lowered near the block, and the light that goes further out is kept)
  v *= mix(uFoot, 1., smoothstep(1., 3., length(vLocal)));
  gl_FragColor = vec4(vCol * v + vPoolCol * pool * 0.04, 1.);
}
`;

/** A drawing of the light of many blocks on the ground: build it, `draw` into it, read its `texture`, `dispose` it. */
export function createGroundLight(THREE: typeof T, renderer: T.WebGLRenderer, grid: Grid) {
  // (float targets add exactly; half floats are the fallback where float blending is not offered)
  const type = renderer.extensions.has("EXT_float_blend") && renderer.extensions.has("EXT_color_buffer_float") ? THREE.FloatType : THREE.HalfFloatType;
  const make = () => new THREE.WebGLRenderTarget(grid.w, grid.h, { type, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  let target = make();
  let spare = make();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const points = new THREE.Scene();
  const full = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  full.add(quad);
  const blurMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: null }, stepv: { value: new THREE.Vector2() } },
    vertexShader: FULL_VERT,
    fragmentShader: `uniform sampler2D map; uniform vec2 stepv; varying vec2 vUv;
void main() { gl_FragColor = (texture2D(map, vUv - 2. * stepv) + 4. * texture2D(map, vUv - stepv) + 6. * texture2D(map, vUv) + 4. * texture2D(map, vUv + stepv) + texture2D(map, vUv + 2. * stepv)) / 16.; }`,
    depthTest: false,
    depthWrite: false,
  });
  const disposables: { dispose(): void }[] = [blurMat, quad.geometry];

  /** One draw of rays: `blocks` each send `rays` rays (an emitter's: the light of a rod; the sun's: a grid of `rays` = n x n parallel rays), added into the target. */
  const draw = (blocks: GlassLight[], rays: number, vertex: string, uniforms: Record<string, { value: unknown }>, keep: boolean) => {
    const geo = new THREE.InstancedBufferGeometry();
    geo.instanceCount = blocks.length;
    const ray = new Float32Array(rays);
    for (let i = 0; i < rays; i++) ray[i] = i;
    geo.setAttribute("ray", new THREE.BufferAttribute(ray, 1));
    // (a position attribute the shader does not use, so that the draw has a count)
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(rays * 3), 3));
    const inst = (size: number, fill: (b: GlassLight) => number[]) => {
      const a = new Float32Array(blocks.length * size);
      blocks.forEach((b, i) => a.set(fill(b), i * size));
      return new THREE.InstancedBufferAttribute(a, size);
    };
    geo.setAttribute("iC", inst(3, (b) => b.c));
    geo.setAttribute("iH", inst(3, (b) => b.h));
    geo.setAttribute("iBias", inst(3, (b) => b.bias));
    geo.setAttribute("iCol", inst(3, (b) => b.col));
    geo.setAttribute("iA", inst(4, (b) => [b.r, b.power, b.near, b.far]));
    geo.setAttribute("iB", inst(4, (b) => [b.rod, b.seed[0], b.seed[1], b.seed[2]]));
    geo.setAttribute("iD", inst(2, (b) => [b.seed[3], b.seed[4]]));
    const mat = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: POINT_FRAG,
      uniforms: { uGrid: { value: new THREE.Vector4(grid.scale, grid.x0, grid.z0, 0) }, uSize: { value: new THREE.Vector2(grid.w, grid.h) }, ...uniforms },
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    const mesh = new THREE.Points(geo, mat);
    mesh.frustumCulled = false;
    points.add(mesh);
    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    renderer.setRenderTarget(target);
    renderer.autoClear = !keep;
    renderer.render(points, cam);
    renderer.autoClear = prevAuto;
    renderer.setRenderTarget(prevTarget);
    points.remove(mesh);
    geo.dispose();
    mat.dispose();
  };

  /** The sun through the blocks (light theme): the target holds the difference to what the ground would get without the glass. */
  const sun = (blocks: GlassLight[], n: number, dir: [number, number, number], absorb: number, straight: number, pixelPerArea: number) => {
    const common = { uDir: { value: new THREE.Vector3(...dir) }, uN: { value: n }, uAbsorb: { value: absorb }, uStraight: { value: straight }, uPerArea: { value: pixelPerArea } };
    draw(blocks, n * n, SUN_VERT, { ...common, uFree: { value: 0 } }, false);
    draw(blocks, n * n, SUN_VERT, { ...common, uFree: { value: 1 } }, true);
  };

  /**
   * The baked light of blocks (dark theme): a quad per block, textured with the template of its size, added into the target. Returns what changes it afterwards: `update(levels)` sets how much of its light each block
   * gives out (0 to 1, one per block, in the order they were given) and draws the ground's light again, which is one draw of a few hundred quads.
   */
  const stamps = (blocks: StampedBlock[], templates: CausticTemplates) => {
    const geo = new THREE.InstancedBufferGeometry();
    const plane = new THREE.PlaneGeometry(1, 1);
    geo.setAttribute("position", plane.getAttribute("position"));
    geo.setIndex(plane.getIndex());
    geo.instanceCount = blocks.length;
    const pos = new Float32Array(blocks.length * 2);
    const base = new Float32Array(blocks.length * 3);
    const idx = new Float32Array(blocks.length * 4);
    const poolBase = new Float32Array(blocks.length * 3);
    const poolR = new Float32Array(blocks.length);
    // (a value's place between two classes: the lower class and how far on to the next)
    const place = (v: number, classes: number[]): [number, number] => {
      if (v <= classes[0]!) return [0, 0];
      for (let i = 1; i < classes.length; i++) if (v <= classes[i]!) return [i - 1, (v - classes[i - 1]!) / (classes[i]! - classes[i - 1]!)];
      return [classes.length - 1, 0];
    };
    blocks.forEach((b, i) => {
      pos.set([b.x, b.z], i * 2);
      base.set(b.col, i * 3);
      const [h0, fh] = place(b.height, templates.heights);
      const [f0, ff] = place(b.foot, templates.feet);
      idx.set([h0, fh, f0, ff], i * 4);
      poolBase.set(b.poolCol, i * 3);
      poolR[i] = b.poolRadius;
    });
    const poolColours = new THREE.InstancedBufferAttribute(poolBase.slice(), 3);
    const colours = new THREE.InstancedBufferAttribute(base.slice(), 3);
    geo.setAttribute("iPos", new THREE.InstancedBufferAttribute(pos, 2));
    geo.setAttribute("iCol", colours);
    geo.setAttribute("iIdx", new THREE.InstancedBufferAttribute(idx, 4));
    geo.setAttribute("iPoolCol", poolColours);
    geo.setAttribute("iPoolR", new THREE.InstancedBufferAttribute(poolR, 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: STAMP_VERT,
      fragmentShader: STAMP_FRAG,
      uniforms: {
        uGrid: { value: new THREE.Vector4(grid.scale, grid.x0, grid.z0, 0) },
        uSize: { value: new THREE.Vector2(grid.w, grid.h) },
        uExtent: { value: templates.extent },
        atlas: { value: templates.texture },
        uContrast: { value: STAMP_CONTRAST },
        uFoot: { value: STAMP_FOOT },
        uCells: { value: new THREE.Vector2(templates.feet.length, templates.heights.length) },
        uQuarter: { value: TEMPLATE_SIZE },
      },
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(mesh);
    const draw = () => {
      const prevTarget = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.render(scene, cam);
      renderer.setRenderTarget(prevTarget);
    };
    disposables.push(geo, plane, mat);
    draw();
    return {
      update(levels: ArrayLike<number>) {
        const a = colours.array as Float32Array;
        for (let i = 0; i < blocks.length; i++) {
          const k = levels[i]!;
          a[i * 3] = base[i * 3]! * k;
          a[i * 3 + 1] = base[i * 3 + 1]! * k;
          a[i * 3 + 2] = base[i * 3 + 2]! * k;
          const p = poolColours.array as Float32Array;
          p[i * 3] = poolBase[i * 3]! * k;
          p[i * 3 + 1] = poolBase[i * 3 + 1]! * k;
          p[i * 3 + 2] = poolBase[i * 3 + 2]! * k;
        }
        colours.needsUpdate = true;
        poolColours.needsUpdate = true;
        draw();
      },
    };
  };

  /** A smoothing of a few pixels (the rays are a sample). */
  const smooth = (passes: number) => {
    const prevTarget = renderer.getRenderTarget();
    quad.material = blurMat;
    for (let i = 0; i < passes; i++) {
      for (const step of [new THREE.Vector2(1 / grid.w, 0), new THREE.Vector2(0, 1 / grid.h)]) {
        blurMat.uniforms.map!.value = target.texture;
        blurMat.uniforms.stepv!.value.copy(step);
        renderer.setRenderTarget(spare);
        renderer.render(full, cam);
        [target, spare] = [spare, target];
      }
    }
    renderer.setRenderTarget(prevTarget);
  };

  return {
    stamps,
    sun,
    smooth,
    get texture() {
      return target.texture;
    },
    dispose() {
      target.dispose();
      spare.dispose();
      disposables.forEach((d) => d.dispose());
    },
  };
}
