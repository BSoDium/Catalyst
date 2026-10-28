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
import { AddEquation, BufferAttribute, BufferGeometry, Color, Mesh, NormalBlending, OneFactor, OneMinusSrcAlphaFactor, CustomBlending, type Scene, ShaderMaterial, Vector2 } from "three";
import type { GlobeTheme } from "./colors";
import { BAYER4 } from "./sky";
import { SUN } from "./moon";
import { FlareLayer, WARM_GLSL, rayStart, haloClear, sunCrescent, type FlareFrame } from "./sun-flare";

const VERTEX = /* glsl */ `
  uniform vec2 uCentre; uniform float uExt; uniform vec2 uBuf;
  void main() {
    vec2 px = uCentre + position.xy * uExt;
    gl_Position = vec4(px / uBuf * 2.0 - 1.0, 1.0, 1.0);
  }
`;

const f = (n: number) => n.toFixed(3);
const vec = (c: readonly number[]) => `vec3(${c.map(f).join(", ")})`;

const FRAGMENT = /* glsl */ `
  uniform vec2 uCentre; uniform float uR; uniform vec3 uBg; uniform vec3 uInk; uniform float uAmt; uniform float uLight; uniform float uHalo; uniform float uRing;
  ${WARM_GLSL}
  const float BAYER[16] = float[16](${BAYER4.map((n) => `${n}.0`).join(", ")});
  void main() {
    vec2 q = (gl_FragCoord.xy - uCentre) / uR;
    float r = length(q);
    // how strongly this pixel is inked, 0 (nothing: the sky shows) to 1 (the ramp's top)
    float ink = 0.0;
    // the halo: a falloff from the disc's edge in a few flat steps of tone, the steps ordered-dithered into each other (a pixel is one of the steps' tones, never between)
    // (it goes with the planet's cover, in the same dither: uHalo, 1 to 0, takes the steps out of the falloff one at a time, outermost first)
    float t0 = pow(clamp(1.0 - (max(r, 1.0) - 1.0) / ${f(SUN.halo)}, 0.0, 1.0), ${f(SUN.haloFall)});
    // (the planet's cover takes the OUTER steps out, the halo's size shrinking: the inner ones, round the sun's disc, stay: they were a duller ring round the sun's bright core, a dark halo, when all of them went down together)
    float t = t0 * mix(uHalo, 1.0, smoothstep(0.55, 1.0, t0));
    ivec2 c = ivec2(mod(floor(gl_FragCoord.xy), 4.0));
    float th = (BAYER[c.y * 4 + c.x] + 0.5) / 16.0;
    ink = floor(t * ${f(SUN.haloSteps)} + th) / ${f(SUN.haloSteps)} * ${f(SUN.glow)};
    if (r >= 1.0) {
      // the ring of light on the halo (it goes as the planet covers the sun, as the halo does: uHalo): a sharp inside edge and a smooth outside, a little brighter than the halo under it
      float d = r - ${f(SUN.ring.at)};
      float rt = 0.0;
      if (d <= 0.0) { if (d > -${f(SUN.ring.inner)}) rt = 1.0; }
      else { float x = 1.0 - d / ${f(SUN.ring.outer)}; if (x > 0.0) rt = floor(x * x * ${f(SUN.ring.steps)} + th) / ${f(SUN.ring.steps)}; }
      // (and with how much of the sun is in view, uRing: the ring is a lens's, light straight into the lens; with the sun hidden it means nothing, and only the soft halo is left, as the sun's coming)
      ink = max(ink, rt * uHalo * uRing * ${f(SUN.ring.strength)});
    }
    if (ink <= 0.0) discard;
    // the warm ramp on the dark page; on the light page the halo is a faint grey (the sun is white, and the paper has no room for light) with only a little of the ramp's colour in it
    float k = clamp(ink * ${f(SUN.gain)}, 0.0, 1.0);
    vec3 lightHalo = mix(vec3(${f(SUN.light.halo.grey)}), warm(ink) * ${f(SUN.light.ink)}, ${f(SUN.light.halo.warm)});
    vec3 col = uLight > 0.5 ? mix(uBg, lightHalo, k * ${f(SUN.light.halo.strength)}) : mix(uBg, warm(ink), k);
    // (the fade is the dither's, not a blend: this layer is OPAQUE, so that it is drawn with the opaque things, in renderOrder, BEFORE the planet's lines and the routes, which are over it, not under)
    if (uAmt < 0.999 && th >= uAmt) discard;
    gl_FragColor = vec4(col, 1.0);
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
      uHalo: { value: 1 },
      uRing: { value: 1 },
      uSet: { value: 0 },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: false,
    blending: NormalBlending,
    depthTest: true,
    depthWrite: false,
  });

/**
 * The blur (`SUN.core`, engine/moon.ts): its own quad over the planet, centred where the sun's visible part has its centre of mass, `uU` pixels to a disc radius of the BLOB (the sun's own, until the planet has covered half of
 * it, then the crescent's width), `uI` as bright as the share of the sun that is in view. Smooth, not dithered; a gaussian fading to nothing at its edge; in the warm light's colours, ADDED to what is behind it.
 */
const BLOB_VERTEX = /* glsl */ `
  uniform vec2 uCentre; uniform float uExt; uniform vec2 uBuf;
  void main() {
    vec2 px = uCentre + position.xy * uExt;
    gl_Position = vec4(px / uBuf * 2.0 - 1.0, 0.0, 1.0);
  }
`;

const BLOB_FRAGMENT = /* glsl */ `
  uniform vec2 uCentre; uniform float uU; uniform float uI; uniform float uAmt; uniform float uLight;
  ${WARM_GLSL}
  void main() {
    float rr = length(gl_FragCoord.xy - uCentre) / uU;
    // a gaussian, half as bright at SUN.core.half and gone at SUN.core.radius; its light is ADDED to what is behind it (AdditiveBlending: colour times alpha), as bright as the share of the sun in view
    float ink = exp(-0.6931 * rr * rr / ${f(SUN.core.half * SUN.core.half)});
    ink = max(0.0, ink - ${f(Math.exp((-0.6931 * SUN.core.radius * SUN.core.radius) / (SUN.core.half * SUN.core.half)))}) / (1.0 - ${f(Math.exp((-0.6931 * SUN.core.radius * SUN.core.radius) / (SUN.core.half * SUN.core.half)))});
    if (ink <= 0.003) discard;
    float k = clamp(ink * ${f(SUN.gain)}, 0.0, 1.0) * uAmt;
    // dark page: the light is ADDED (colour times alpha). Light page: the sun is WHITE, laid over the paper and over the grey round it (the veil, the halo), and it does NOT dim as the planet covers it (only its size follows the crescent)
    // As the planet covers the sun it keeps its whole light for now (SUN.cover.dim, 0: the size is what changes, with the crescent, until it is gone; any dimming is in COLOUR, never opacity), and it is exactly as it was while it is clear (uI is 1).
    float dim = 1.0 - ${f(SUN.cover.dim)} * (1.0 - uI);
    // Once the planet touches the sun (uI under 1), what is dazzling of it is a DISC: a flat, OPAQUE disc of the sun's core colour (the planet does not show through it: nothing is behind it), with a hard edge on the art's pixels (this canvas
    // is the art's own resolution), and its glow round it is in art pixels too (a few levels, dithered, as the halo is). The blend is premultiplied (the output is the light ADDED, alpha how much of what is behind is hidden): with no disc it
    // is the additive blend of the dark page and the normal one of the light page, as before; and the sun clear is exactly as it was, smooth.
    float touch = 1.0 - smoothstep(0.90, 0.97, uI);
    float disc = step(rr, ${f(SUN.cover.disc)}) * touch * uAmt;
    // (the lines' own ordered dither, on the art's pixels)
    float ordered = fract(floor(gl_FragCoord.x) * 0.5 + floor(gl_FragCoord.y) * floor(gl_FragCoord.y) * 0.75);
    float kq = floor(k * 6.0 + ordered) / 6.0;
    k = mix(k, kq, touch);
    if (uLight > 0.5) {
      float a = max(k * 0.9, disc);
      gl_FragColor = vec4(vec3(1.0, 0.995, 0.975) * a, a);
    } else {
      vec3 emit = warm(ink) * k * dim;
      gl_FragColor = vec4(disc > 0.5 ? ${vec(SUN.cover.discColour)} : emit, disc);
    }
  }
`;

const blobMaterial = () =>
  new ShaderMaterial({
    uniforms: { uCentre: { value: new Vector2() }, uBuf: { value: new Vector2(1, 1) }, uExt: { value: 1 }, uU: { value: 1 }, uI: { value: 1 }, uAmt: { value: 1 }, uSet: { value: 0 }, uLight: { value: 0 } },
    vertexShader: BLOB_VERTEX,
    fragmentShader: BLOB_FRAGMENT,
    transparent: true,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    depthTest: false,
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
  /** Where the planet's centre is on the buffer (the crescent's centre of mass is on the line from it through the sun). Absent: straight below the sun. */
  px?: number;
  py?: number;
  /** How far the sun's centre is outside the planet's limb, radians (`sunRise`, engine/sun-flare.ts): what is left of the sun and its halo are measured from it. Absent: nothing in the way. */
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
  private dark = true;
  /** The blur: over the planet, not under it. */
  readonly blob: Mesh;
  private blobMat = blobMaterial();

  constructor(scene: Scene) {
    this.flare = new FlareLayer(scene);
    this.geometry.setAttribute("position", new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    this.mesh = new Mesh(this.geometry, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    // after the planet's disc (0, the depth that hides it) and the sky (0.5, 0.6), before the moon (0.7) and the lines
    this.mesh.renderOrder = 0.65;
    scene.add(this.mesh);
    this.blob = new Mesh(this.geometry, this.blobMat);
    this.blob.frustumCulled = false;
    this.blob.visible = false;
    // over the planet's own layers (the ground glow is 5.1): the bloom of a lens is not hidden by the limb
    this.blob.renderOrder = 5.2;
    scene.add(this.blob);
  }

  applyTheme(t: GlobeTheme): void {
    const u = this.mat.uniforms;
    u.uBg!.value.setRGB(...t.background);
    u.uInk!.value.setRGB(...t.ink);
    u.uLight!.value = t.scheme === "dark" ? 0 : 1;
    this.dark = t.scheme === "dark";
    // (the blur adds its light on the dark page and lays white over the paper on the light one: its shader's output is premultiplied in both, one blend)
    this.blobMat.uniforms.uLight!.value = this.dark ? 0 : 1;
    this.flare.applyTheme(t);
  }

  /** Place the sun for this frame: true when it is in the picture (the frame loop has a sun to draw). */
  sync(f: SunFrame): boolean {
    const p = f.amount > 0.01 ? sunPlace(f) : null;
    this.mesh.visible = p !== null;
    // how far the sun is outside the planet's limb, in disc radii (Infinity: nothing in the way): what is left of it (`sunCrescent`), and how much of the halo the planet leaves
    const sr = sunRadius(f);
    const rise = ((f.rise ?? Infinity) * f.focal) / sr;
    const cres = sunCrescent(rise);
    const halo = haloClear(rise);
    // the crescent's centre of mass: on the line from the planet's centre through the sun, `shift` disc radii from the sun's centre, away from the planet
    let dx = 0;
    let dy = 1;
    if (f.px !== undefined && f.py !== undefined) {
      const l = Math.hypot(f.x - f.px, f.y - f.py);
      if (l > 1e-3) {
        dx = (f.x - f.px) / l;
        dy = (f.y - f.py) / l;
      }
    }
    const bx = Math.floor(f.x + dx * cres.shift * sr) + 0.5;
    const by = Math.floor(f.y + dy * cres.shift * sr) + 0.5;
    // the blur: over the planet, where the crescent's centre of mass is, as wide as the crescent, as bright as the share of the sun that is left
    const unit = Math.max(1, cres.width * sr);
    const ext = SUN.core.radius * unit + 1;
    const blob = f.ahead && f.amount > 0.01 && cres.area > 0.003 && bx + ext > 0 && bx - ext < f.bufW && by + ext > 0 && by - ext < f.bufH;
    this.blob.visible = blob;
    if (blob) {
      const b = this.blobMat.uniforms;
      (b.uCentre!.value as Vector2).set(bx, by);
      (b.uBuf!.value as Vector2).set(f.bufW, f.bufH);
      b.uExt!.value = ext;
      b.uU!.value = unit;
      b.uI!.value = cres.area;
      b.uAmt!.value = f.amount;
      b.uSet!.value = (1 - halo) * SUN.cover.redden;
    }
    // the lens flare comes out of the same centre, as bright as the share of the sun that is left (on the light page whole, until the sun is gone: it does not dim, only the sun's size follows the crescent)
    const rayStartPx = rayStart(sr, cres.area, cres.width, SUN.cover.disc);
    const flaring = this.flare.sync({ bufW: f.bufW, bufH: f.bufH, x: f.ahead ? bx : f.x, y: f.ahead ? by : f.y, ahead: f.ahead, amount: f.amount, visible: this.dark ? cres.area : cres.area > 0.01 ? 1 : 0, r: rayStartPx, set: (1 - halo) * SUN.cover.redden } satisfies FlareFrame);
    if (!p) return flaring || blob;
    const u = this.mat.uniforms;
    (u.uCentre!.value as Vector2).set(p.x, p.y);
    (u.uBuf!.value as Vector2).set(f.bufW, f.bufH);
    u.uR!.value = p.r;
    u.uExt!.value = p.r * (1 + SUN.halo) + 1;
    u.uAmt!.value = f.amount;
    u.uHalo!.value = 1 - SUN.cover.halo * (1 - halo);
    // the lens's ring goes with the sun's visible share: whole above `SUN.ring.fade[1]` of it, gone when it is hidden
    const [r0, r1] = SUN.ring.fade;
    const rt = Math.min(1, Math.max(0, (cres.area - r0) / (r1 - r0)));
    u.uRing!.value = rt * rt * (3 - 2 * rt);
    u.uSet!.value = (1 - halo) * SUN.cover.halo;
    return true;
  }

  dispose(): void {
    this.flare.dispose();
    this.geometry.dispose();
    this.mat.dispose();
    this.blobMat.dispose();
  }
}
