/**
 * The sun (docs/landing.md, "The sun"): a point on the skybox. It is the direction the light comes from (`sunDirection`, engine/moon.ts: a direction in the sky's inertial frame, in the earth's frame
 * `toEarthFrame`), at infinity, drawn where the stars are drawn, at the far plane, with the depth test and no depth write: so the planet hides it where they meet, it is in the picture only where the camera
 * looks towards it, and it turns with the sky as the globe is turned (the camera's own turn, no motion of its own). The light comes from behind the opening camera, so it is not in the picture at the
 * opening view: one turns the globe to its far side and the sun comes round the planet's limb, its crown first.
 *
 * One quad and one cheap fragment shader, in whole art pixels like everything on the globe: a disc of two flat tones with a few dark spots (two octaves of value noise), and a crown round it, a halo
 * scalloped by soft lobes with a short faint ray at each, as a 4x4 Bayer dither of a falloff (a pixel is on or off). Static: it asks for no frames of its own.
 *
 * Two looks, as the whole globe has two (`washOf`, engine/surface.ts): on the dark page it is the brightest thing there is, the ink's own tone. On the light page it is so bright that it burns the
 * colour away: the disc and the crown are the page's colour, and it shows only through its dark spots, a ghost of a rim and the crown's faint darkness.
 */
import { BufferAttribute, BufferGeometry, Color, Mesh, NormalBlending, type Scene, ShaderMaterial, Vector2 } from "three";
import type { GlobeTheme } from "./colors";
import { BAYER4 } from "./sky";
import { SUN } from "./moon";

const VERTEX = /* glsl */ `
  uniform vec2 uCentre; uniform float uExt; uniform vec2 uBuf;
  void main() {
    vec2 px = uCentre + position.xy * uExt;
    gl_Position = vec4(px / uBuf * 2.0 - 1.0, 1.0, 1.0);
  }
`;

const f = (n: number) => n.toFixed(3);

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
    // how strongly this pixel is inked, 0 (nothing: the sky shows) to 1 (the ink's own tone)
    float ink = 0.0;
    if (r < 1.0) {
      float g = vnoise(q * ${f(SUN.grain)} + 3.7) * 0.65 + vnoise(q * ${f(SUN.grain * 2.3)} + 9.1) * 0.35;
      bool spot = g > ${f(SUN.spot)};
      bool rim = r > ${f(SUN.limb)};
      // dark page: the ink's tone, a step down on the limb and in the spots; light page: only what is darker than the glare (the spots, a ghost of the rim)
      ink = uLight > 0.5 ? (spot ? ${f(SUN.light.spot)} : (rim ? ${f(SUN.light.rim)} : 0.0))
                         : (spot ? ${f(SUN.dark.spot)} : (rim ? ${f(SUN.dark.limb)} : ${f(SUN.dark.core)}));
    } else {
      // the crown: a halo scalloped by soft lobes, a short faint ray at each, as a dither of a falloff
      float k = r - 1.0;
      float lobe = 0.5 + 0.5 * cos(atan(q.y, q.x) * ${f(SUN.lobes)} + 0.6);
      float ext = ${f(SUN.halo)} * (0.7 + 0.3 * lobe) + ${f(SUN.ray)} * pow(lobe, 14.0);
      float t = pow(clamp(1.0 - k / ext, 0.0, 1.0), 1.5);
      ivec2 c = ivec2(mod(floor(gl_FragCoord.xy), 4.0));
      float th = (BAYER[c.y * 4 + c.x] + 0.5) / 16.0;
      if (t > 0.05 && t > th) ink = uLight > 0.5 ? ${f(SUN.light.crown)} : ${f(SUN.dark.crown)};
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
  /** The globe's drawing buffer (the art grid), art pixels, y up. */
  bufW: number;
  bufH: number;
  /** Where the sun's direction projects on the buffer (the camera's projection of a direction at infinity), and whether it is in front of the camera at all. */
  x: number;
  y: number;
  ahead: boolean;
  /** The camera's vertical focal length in buffer pixels, and how much of the sun the zoom lets through, 0..1. */
  focal: number;
  amount: number;
}

/** The sun's disc on the buffer: its centre on a whole pixel's centre (the disc is symmetric and its edge falls on the grid) and its radius, or null when it is behind the camera or its crown is wholly off the picture. Pure. */
export function sunPlace(f: SunFrame): { x: number; y: number; r: number } | null {
  if (!f.ahead) return null;
  const r = Math.max(SUN.minR, f.focal * Math.tan((SUN.angularDeg * Math.PI) / 180));
  const reach = r * (1 + SUN.halo + SUN.ray);
  if (f.x + reach < 0 || f.x - reach > f.bufW || f.y + reach < 0 || f.y - reach > f.bufH) return null;
  return { x: Math.floor(f.x) + 0.5, y: Math.floor(f.y) + 0.5, r };
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
    // after the planet's disc (0, the depth that hides it) and the sky (0.5, 0.6), before the moon (0.7) and the lines
    this.mesh.renderOrder = 0.65;
    scene.add(this.mesh);
  }

  applyTheme(t: GlobeTheme): void {
    const u = this.mat.uniforms;
    u.uBg!.value.setRGB(...t.background);
    u.uInk!.value.setRGB(...t.ink);
    u.uLight!.value = t.scheme === "dark" ? 0 : 1;
  }

  /** Place the sun for this frame: true when it is in the picture (the frame loop has a sun to draw). */
  sync(f: SunFrame): boolean {
    const p = f.amount > 0.01 ? sunPlace(f) : null;
    this.mesh.visible = p !== null;
    if (!p) return false;
    const u = this.mat.uniforms;
    (u.uCentre!.value as Vector2).set(p.x, p.y);
    (u.uBuf!.value as Vector2).set(f.bufW, f.bufH);
    u.uR!.value = p.r;
    u.uExt!.value = p.r * (1 + SUN.halo + SUN.ray) + 1;
    u.uAmt!.value = f.amount;
    return true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.mat.dispose();
  }
}
