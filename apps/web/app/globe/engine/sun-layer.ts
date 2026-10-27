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
import { FlareLayer, WARM_GLSL, type FlareFrame } from "./sun-flare";

const VERTEX = /* glsl */ `
  uniform vec2 uCentre; uniform float uExt; uniform vec2 uBuf;
  void main() {
    vec2 px = uCentre + position.xy * uExt;
    gl_Position = vec4(px / uBuf * 2.0 - 1.0, 1.0, 1.0);
  }
`;

const f = (n: number) => n.toFixed(3);

const FRAGMENT = /* glsl */ `
  uniform vec2 uCentre; uniform float uR; uniform vec3 uBg; uniform vec3 uInk; uniform float uAmt; uniform float uLight; uniform float uClear; uniform float uHalo; uniform float uCore;
  ${WARM_GLSL}
  const float BAYER[16] = float[16](${BAYER4.map((n) => `${n}.0`).join(", ")});
  void main() {
    vec2 q = (gl_FragCoord.xy - uCentre) / uR;
    float r = length(q);
    // how strongly this pixel is inked, 0 (nothing: the sky shows) to 1 (the ink's own tone)
    float ink = 0.0;
    // the tone the warm ramp is asked for (the dark page's light is warm), or none: the disc is the ink's own
    float tone = -1.0;
    if (r < 1.0 && uLight > 0.5) {
      // (the light page: only a ghost of a rim; the rest is the glare, the page's colour)
      ink = r > ${f(SUN.limb)} ? ${f(SUN.light.rim)} : 0.0;
    } else {
      // the halo: a falloff from the disc's edge in a few flat steps of tone, the steps ordered-dithered into each other (a pixel is one of the steps' tones, never between)
      // (it goes with the planet's cover, in the same dither: uHalo, 1 to 0, takes the steps out of the falloff one at a time, outermost first)
      float t = pow(clamp(1.0 - (max(r, 1.0) - 1.0) / ${f(SUN.halo)}, 0.0, 1.0), ${f(SUN.haloFall)}) * uHalo;
      ivec2 c = ivec2(mod(floor(gl_FragCoord.xy), 4.0));
      float th = (BAYER[c.y * 4 + c.x] + 0.5) / 16.0;
      ink = floor(t * ${f(SUN.haloSteps)} + th) / ${f(SUN.haloSteps)} * (uLight > 0.5 ? ${f(SUN.light.glow)} : ${f(SUN.dark.glow)});
      tone = ink;
      // the dark page's sun is a blur, not a disc: a core, smooth, from the sun's white at the middle to the halo's own tone at its edge, with no edge of its own. It is at full strength until the limb reaches it, then it shrinks (uCore, in disc radii), round
      if (uLight < 0.5 && r < uCore) {
        float edgeTone = ${f(SUN.dark.glow)} * pow(max(0.0, 1.0 - (max(uCore, 1.0) - 1.0) / ${f(SUN.halo)}), ${f(SUN.haloFall)}) * uHalo;
        float core = mix(edgeTone, 1.0, pow(1.0 - r / uCore, ${f(SUN.core.fall)}));
        if (core > ink) { ink = core; tone = core; }
      }
      if (r >= 1.0) {
        // the ring of light on the halo (it goes as the planet covers the sun, as the halo does: uHalo): a sharp inside edge and a smooth outside, a little brighter than the halo under it
        float d = r - ${f(SUN.ring.at)};
        float rt = 0.0;
        if (d <= 0.0) { if (d > -${f(SUN.ring.inner)}) rt = 1.0; }
        else { float x = 1.0 - d / ${f(SUN.ring.outer)}; if (x > 0.0) rt = floor(x * x * ${f(SUN.ring.steps)} + th) / ${f(SUN.ring.steps)}; }
        float ringInk = rt * uHalo * (uLight > 0.5 ? ${f(SUN.ring.light)} : ${f(SUN.ring.dark)});
        if (ringInk > ink) { ink = ringInk; tone = ink; }
      }
    }
    if (ink <= 0.0) discard;
    vec3 col = (tone < 0.0 || uLight > 0.5) ? mix(uBg, uInk, ink) : mix(uBg, warm(tone), clamp(ink * ${f(SUN.gain)}, 0.0, 1.0));
    gl_FragColor = vec4(col, uAmt);
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
      uClear: { value: 1 },
      uHalo: { value: 1 },
      uCore: { value: SUN.core.radius },
      uSet: { value: 0 },
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
  /** How much of the HALO the planet leaves (`haloClear`, engine/sun-flare.ts): the halo is wide, so its fade is long. Absent: all of it. */
  halo?: number;
  /** How far the sun's centre is outside the planet's limb, radians (`sunRise`, engine/sun-flare.ts): the blur's core shrinks to fit it. Absent: nothing in the way. */
  rise?: number;
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
    const flaring = this.flare.sync({ bufW: f.bufW, bufH: f.bufH, x: f.x, y: f.y, ahead: f.ahead, amount: f.amount, visible: f.visible ?? 1, r: sunRadius(f), set: 1 - (f.halo ?? 1) } satisfies FlareFrame);
    if (!p) return flaring;
    const u = this.mat.uniforms;
    (u.uCentre!.value as Vector2).set(p.x, p.y);
    (u.uBuf!.value as Vector2).set(f.bufW, f.bufH);
    u.uR!.value = p.r;
    u.uExt!.value = p.r * (1 + SUN.halo) + 1;
    u.uAmt!.value = f.amount;
    // the ring of light is a lens flare too: it goes with the sun as the planet covers it
    u.uClear!.value = f.visible ?? 1;
    u.uHalo!.value = f.halo ?? 1;
    // (the core's radius in disc radii: the sun's distance outside the limb, in the sun's own radius, and a little over; at most its full size)
    u.uCore!.value = Math.min(SUN.core.radius, Math.max(0, ((f.rise ?? Infinity) * f.focal) / p.r + SUN.core.lead));
    u.uSet!.value = 1 - (f.halo ?? 1);
    return true;
  }

  dispose(): void {
    this.flare.dispose();
    this.geometry.dispose();
    this.mat.dispose();
  }
}
