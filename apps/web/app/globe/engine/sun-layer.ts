/**
 * The sun (docs/landing.md, "The sun"): a sprite in the sky, in the globe's own canvas, on the side of the picture the light comes from. The light that makes the planet's day and night and the
 * moon's phase (`sunDirection`, engine/moon.ts) comes from behind the camera, so there is no real place for it in the picture: it is drawn where its direction falls on the screen (the
 * camera's right and up of it, lifted a little so that it clears the page's own content), a little off the planet's disc, and it moves with the globe's turn as the light does.
 *
 * One quad, one cheap fragment shader, in whole art pixels like everything on the globe: a disc of three flat tones (the fire's grain and its dark spots from two octaves of value noise), and a
 * crown round it, a halo and long and short rays, as a 4x4 Bayer dither of a falloff (a pixel is on or off, no blend). It is drawn after the planet's disc with the depth test, in the sky's way (at the
 * far plane, no depth write), so the planet hides it where they meet.
 *
 * Two looks, as the whole globe has two (`washOf`, engine/surface.ts): on the dark page it is the brightest thing there is, the ink's own tone. On the light page it is so bright that it burns the
 * colour away: the disc and the crown are the page's colour, and it shows only through its dark spots, a ghost of a rim and the rays' faint darkness.
 */
import { BufferAttribute, BufferGeometry, Color, Mesh, NormalBlending, type Scene, ShaderMaterial, Vector2 } from "three";
import type { GlobeTheme } from "./colors";
import { BAYER4 } from "./sky";
import { SUN, type Vec3 } from "./moon";

const VERTEX = /* glsl */ `
  uniform vec2 uCentre; uniform float uExt; uniform vec2 uBuf;
  void main() {
    vec2 px = uCentre + position.xy * uExt;
    gl_Position = vec4(px / uBuf * 2.0 - 1.0, 1.0, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec2 uCentre; uniform float uR; uniform vec3 uBg; uniform vec3 uInk; uniform float uAmt; uniform float uLight;
  const float BAYER[16] = float[16](${BAYER4.map((n) => `${n}.0`).join(", ")});
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  void main() {
    vec2 q = (gl_FragCoord.xy - uCentre) / uR;
    float r = length(q);
    float a = atan(q.y, q.x);
    // how strongly this pixel is inked, 0 (nothing: the sky shows) to 1 (the ink's own tone)
    float ink = 0.0;
    if (r < 1.0) {
      // the fire: grain and dark spots from two octaves of noise; limb darkening in a rim
      float g = vnoise(q * ${SUN.grain.toFixed(1)} + 3.7) * 0.65 + vnoise(q * ${(SUN.grain * 2.3).toFixed(1)} + 9.1) * 0.35;
      float level = 3.0;
      if (g > ${SUN.spot.toFixed(2)}) level = 1.0; else if (g > ${SUN.penumbra.toFixed(2)}) level = 2.0;
      if (r > ${SUN.limb.toFixed(2)}) level = min(level, 2.0);
      // dark page: the ink's tone, its three steps; light page: only what is darker than the sun's glare (the spots, a ghost of the rim)
      ink = uLight > 0.5 ? (level < 1.5 ? ${SUN.light.spot.toFixed(2)} : (level < 2.5 ? (r > ${SUN.limb.toFixed(2)} ? ${SUN.light.rim.toFixed(2)} : 0.0) : 0.0))
                         : (level < 1.5 ? ${SUN.dark.spot.toFixed(2)} : (level < 2.5 ? ${SUN.dark.mid.toFixed(2)} : 1.0));
    } else {
      // the crown: a halo and rays, as a dither of a falloff
      float k = r - 1.0;
      float m1 = pow(max(0.0, cos(a * ${SUN.rays.toFixed(1)} + 0.6)), 4.0);
      float m2 = pow(max(0.0, cos(a * ${(SUN.rays * 2.0).toFixed(1)} + 1.9)), 5.0) * 0.8;
      float ray = max(m1 * pow(clamp(1.0 - k / ${SUN.longRay.toFixed(2)}, 0.0, 1.0), 0.8), m2 * pow(clamp(1.0 - k / ${SUN.shortRay.toFixed(2)}, 0.0, 1.0), 0.8));
      float halo = pow(clamp(1.0 - k / ${SUN.halo.toFixed(2)}, 0.0, 1.0), 2.0);
      float t = max(ray, halo * 0.85);
      ivec2 c = ivec2(mod(floor(gl_FragCoord.xy), 4.0));
      float th = (BAYER[c.y * 4 + c.x] + 0.5) / 16.0;
      if (t > 0.04 && t > th) ink = ray >= halo * 0.85 ? (uLight > 0.5 ? ${SUN.light.ray.toFixed(2)} : ${SUN.dark.ray.toFixed(2)}) : (uLight > 0.5 ? ${SUN.light.halo.toFixed(2)} : ${SUN.dark.halo.toFixed(2)});
    }
    if (ink <= 0.0) discard;
    gl_FragColor = vec4(mix(uBg, uInk, ink), uAmt);
  }
`;

const material = () =>
  new ShaderMaterial({
    uniforms: {
      uCentre: { value: new Vector2() },
      uBuf: { value: new Vector2(1, 1) },
      uExt: { value: 1 },
      uR: { value: 1 },
      uBg: { value: new Color() },
      uInk: { value: new Color() },
      uAmt: { value: 1 },
      uLight: { value: 0 },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    blending: NormalBlending,
    depthTest: true,
    depthWrite: false,
  });

export interface SunFrame {
  /** The globe's drawing buffer (the art grid), the planet's centre on it and its silhouette's radius, art pixels, y up. */
  bufW: number;
  bufH: number;
  cx: number;
  cy: number;
  radius: number;
  /** The sun's direction in the camera's frame (unit: x right, y up, z toward the viewer); how much of it the zoom lets through, 0..1. */
  dir: Vec3;
  amount: number;
}

/** Where the sun is on the buffer and how big: the light's side of the picture, `SUN.lift` up, `SUN.distance` planet radii out, kept inside the picture. Pure. */
export function sunPlace(f: SunFrame): { x: number; y: number; r: number } {
  const r = Math.max(SUN.minR, f.radius * SUN.size);
  let vx = f.dir[0];
  let vy = f.dir[1] + SUN.lift;
  const n = Math.hypot(vx, vy) || 1;
  vx /= n;
  vy /= n;
  const m = r * SUN.keep;
  const x = Math.min(f.bufW - m, Math.max(m, f.cx + vx * f.radius * SUN.distance));
  const y = Math.min(f.bufH - m, Math.max(m, f.cy + vy * f.radius * SUN.distance));
  // on a whole pixel's centre: the disc is symmetric and its edge falls on the grid
  return { x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5, r };
}

export class SunLayer {
  readonly mesh: Mesh;
  private mat = material();
  private geometry = new BufferGeometry();

  constructor(scene: Scene) {
    this.geometry.setAttribute("position", new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    this.mesh = new Mesh(this.geometry, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    // after the planet's disc (0, the depth that hides it), the sky (0.5, 0.6), before the moon (0.7) and the lines
    this.mesh.renderOrder = 0.65;
    scene.add(this.mesh);
  }

  applyTheme(t: GlobeTheme): void {
    const u = this.mat.uniforms;
    u.uBg!.value.setRGB(...t.background);
    u.uInk!.value.setRGB(...t.ink);
    u.uLight!.value = t.scheme === "dark" ? 0 : 1;
  }

  sync(f: SunFrame): void {
    if (f.amount <= 0.01) {
      this.mesh.visible = false;
      return;
    }
    const p = sunPlace(f);
    const u = this.mat.uniforms;
    (u.uCentre!.value as Vector2).set(p.x, p.y);
    (u.uBuf!.value as Vector2).set(f.bufW, f.bufH);
    u.uR!.value = p.r;
    u.uExt!.value = p.r * SUN.reach;
    u.uAmt!.value = f.amount;
    this.mesh.visible = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.mat.dispose();
  }
}
