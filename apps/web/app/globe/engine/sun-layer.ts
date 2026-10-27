/**
 * The sun (docs/landing.md, "The sun"): a point on the skybox. It is the direction the light comes from (`sunDirection`, engine/moon.ts: a direction in the sky's inertial frame, in the earth's frame
 * `toEarthFrame`), at infinity, drawn where the stars are drawn, at the far plane, with the depth test and no depth write: so the planet hides it where they meet, it is in the picture only where the camera
 * looks towards it, and it turns with the sky as the globe is turned (the camera's own turn, no motion of its own). The light comes from behind the opening camera, so it is not in the picture at the
 * opening view: one turns the globe to its far side and the sun comes round the planet's limb, its halo first.
 *
 * One quad and one cheap fragment shader, in whole art pixels like everything on the globe: a flat disc and a very subtle halo round it, as a 4x4 Bayer dither of a falloff (a pixel is on or off). Static: it asks for no frames of its own.
 *
 * Two looks, as the whole globe has two (`washOf`, engine/surface.ts): on the dark page it is the brightest thing there is, the ink's own tone. On the light page it is so bright that it burns the
 * colour away: the disc and the halo are the page's colour, and it shows only a ghost of a rim and the halo's faint darkness.
 */
import { BufferAttribute, BufferGeometry, Color, Mesh, NormalBlending, type Scene, ShaderMaterial, Vector2 } from "three";
import type { GlobeTheme } from "./colors";
import { BAYER4 } from "./sky";
import { SUN } from "./moon";
import { FlareLayer, type FlareFrame } from "./sun-flare";

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
  void main() {
    vec2 q = (gl_FragCoord.xy - uCentre) / uR;
    float r = length(q);
    // how strongly this pixel is inked, 0 (nothing: the sky shows) to 1 (the ink's own tone)
    float ink = 0.0;
    if (r < 1.0) {
      // a flat disc; on the dark page a step down on its limb, on the light page only a ghost of a rim (the rest is the glare: the page's colour)
      bool rim = r > ${f(SUN.limb)};
      ink = uLight > 0.5 ? (rim ? ${f(SUN.light.rim)} : 0.0) : (rim ? ${f(SUN.dark.limb)} : ${f(SUN.dark.disc)});
    } else {
      // the halo: a falloff from the disc's edge in a few flat steps of tone, the steps ordered-dithered into each other (a pixel is one of the steps' tones, never between)
      float t = pow(clamp(1.0 - (r - 1.0) / ${f(SUN.halo)}, 0.0, 1.0), ${f(SUN.haloFall)});
      ivec2 c = ivec2(mod(floor(gl_FragCoord.xy), 4.0));
      float th = (BAYER[c.y * 4 + c.x] + 0.5) / 16.0;
      ink = floor(t * ${f(SUN.haloSteps)} + th) / ${f(SUN.haloSteps)} * (uLight > 0.5 ? ${f(SUN.light.glow)} : ${f(SUN.dark.glow)});
      // the ring of light on the halo: a sharp inside edge and a smooth outside, a little brighter than the halo under it
      float d = r - ${f(SUN.ring.at)};
      float rt = 0.0;
      if (d <= 0.0) { if (d > -${f(SUN.ring.inner)}) rt = 1.0; }
      else { float x = 1.0 - d / ${f(SUN.ring.outer)}; if (x > 0.0) rt = floor(x * x * ${f(SUN.ring.steps)} + th) / ${f(SUN.ring.steps)}; }
      ink = max(ink, rt * (uLight > 0.5 ? ${f(SUN.ring.light)} : ${f(SUN.ring.dark)}));
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
  /** How much of the sun the planet leaves (`planetClear`, engine/sun-flare.ts), 0..1; the disc itself is hidden by the depth test, the lens flare by this. Absent: all of it. */
  visible?: number;
}

/** The sun's disc radius on the buffer, px: a fixed angle at the camera's focal length, with a floor. */
export const sunRadius = (f: Pick<SunFrame, "focal">): number => Math.max(SUN.minR, f.focal * Math.tan((SUN.angularDeg * Math.PI) / 180));

/** The sun's disc on the buffer: its centre on a whole pixel's centre (the disc is symmetric and its edge falls on the grid) and its radius, or null when it is behind the camera or its crown is wholly off the picture. Pure. */
export function sunPlace(f: SunFrame): { x: number; y: number; r: number } | null {
  if (!f.ahead) return null;
  const r = sunRadius(f);
  const reach = r * (1 + SUN.halo);
  if (f.x + reach < 0 || f.x - reach > f.bufW || f.y + reach < 0 || f.y - reach > f.bufH) return null;
  return { x: Math.floor(f.x) + 0.5, y: Math.floor(f.y) + 0.5, r };
}

export class SunLayer {
  readonly mesh: Mesh;
  private mat = material();
  private geometry = new BufferGeometry();
  private flare: FlareLayer;

  constructor(scene: Scene) {
    this.flare = new FlareLayer(scene);
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
    this.flare.applyTheme(t);
  }

  /** Place the sun for this frame: true when it is in the picture (the frame loop has a sun to draw). */
  sync(f: SunFrame): boolean {
    const p = f.amount > 0.01 ? sunPlace(f) : null;
    this.mesh.visible = p !== null;
    const flaring = this.flare.sync({ bufW: f.bufW, bufH: f.bufH, x: f.x, y: f.y, ahead: f.ahead, amount: f.amount, visible: f.visible ?? 1, r: sunRadius(f) } satisfies FlareFrame);
    if (!p) return flaring;
    const u = this.mat.uniforms;
    (u.uCentre!.value as Vector2).set(p.x, p.y);
    (u.uBuf!.value as Vector2).set(f.bufW, f.bufH);
    u.uR!.value = p.r;
    u.uExt!.value = p.r * (1 + SUN.halo) + 1;
    u.uAmt!.value = f.amount;
    return true;
  }

  dispose(): void {
    this.flare.dispose();
    this.geometry.dispose();
    this.mat.dispose();
  }
}
