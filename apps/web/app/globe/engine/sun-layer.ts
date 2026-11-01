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
import { AddEquation, BufferAttribute, BufferGeometry, Color, DstColorFactor, Mesh, OneFactor, OneMinusSrcAlphaFactor, CustomBlending, type Scene, ShaderMaterial, Vector2 } from "three";
import type { GlobeTheme } from "./colors";
import { BAYER4 } from "./sky";
import { SUN } from "./moon";
import { FX } from "./fx";
import { PULSE, type SunPulse } from "./sun-pulse";
import { smoothstep } from "./geo";
import { FlareLayer, WARM_GLSL, easeTouch, rayStart, haloClear, sunCrescent, type FlareFrame } from "./sun-flare";

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
  uniform vec2 uCentre; uniform float uR; uniform vec3 uBg; uniform vec3 uInk; uniform float uAmt; uniform float uLight; uniform float uHalo; uniform float uRing; uniform float uSoft; uniform float uK; uniform float uDip;
  ${WARM_GLSL}
  const float BAYER[16] = float[16](${BAYER4.map((n) => `${n}.0`).join(", ")});
  void main() {
    vec2 q = (gl_FragCoord.xy - uCentre) / uR;
    float r = length(q);
    // how strongly this pixel is inked, 0 (nothing: the sky shows) to 1 (the ramp's top)
    float ink = 0.0;
    // the halo: a falloff from the disc's edge in a few flat steps of tone, the steps ordered-dithered into each other (a pixel is one of the steps' tones, never between)
    // (it goes with the planet's cover, in the same dither: uHalo, 1 to 0, takes the steps out of the falloff one at a time, outermost first)
    float t0 = pow(clamp(1.0 - (max(r, 1.0) - 1.0) / (${f(SUN.halo)} * uK), 0.0, 1.0), ${f(SUN.haloFall)});
    // (the planet's cover takes the OUTER steps out, the halo's size shrinking: the inner ones, round the sun's disc, stay: they were a duller ring round the sun's bright core, a dark halo, when all of them went down together)
    float t = t0 * mix(uHalo, 1.0, smoothstep(0.55, 1.0, t0));
    ivec2 c = ivec2(mod(floor(gl_FragCoord.xy), 4.0));
    float th = (BAYER[c.y * 4 + c.x] + 0.5) / 16.0;
    // (uSoft: with the sun hidden the soft halo is far softer, the sun's coming and no more: SUN.cover.hidden of it is left; whole while the sun is in view)
    // (the music's breath: the halo's tone is taken DOWN by up to uDip before it is cut into steps, so that the pixels of the flat zone round the disc, which a change of the whole tone would send across a step of the ramp all at once, change one at a time through the dither, as the rest of the halo's do)
    t = max(t - uDip, 0.0);
    ink = floor(t * ${f(SUN.haloSteps)} + th) / ${f(SUN.haloSteps)} * ${f(SUN.glow)} * uSoft;
    if (r >= 1.0) {
      // the ring of light on the halo (it goes as the planet covers the sun, as the halo does: uHalo): a sharp inside edge and a smooth outside, a little brighter than the halo under it
      float d = r - ${f(SUN.ring.at)} * uK;
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
    // (the fade is the dither's, not a blend: a pixel is on or off)
    if (uAmt < 0.999 && th >= uAmt) discard;
    // the halo is a lens's, over the planet like the blob (premultiplied, as the blob's): dark page, its light is laid over it, translucent; light page, it DARKENS what is behind it
    // (translucent, unlike the sun's disc. Light page: what is behind is multiplied by the grey's own strength (\`applyTheme\` sets the blend: the source is multiplied by the destination), which over the paper is exactly the old mix over the sky, and over the planet darkens the land and the lines under it instead of laying a flat grey that is the same tone as they are. Dark page: the light is whole, so over the sky it is as bright as ever, but only SUN.haloOpacity of it hides what is behind)
    if (uLight > 0.5) { float a = k * ${f(SUN.light.halo.strength)}; gl_FragColor = vec4(lightHalo * a, a); }
    else gl_FragColor = vec4(warm(ink) * k, k * ${f(SUN.haloOpacity)});
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
      uSoft: { value: 1 },
      uDip: { value: 0 },
      uK: { value: 1 },
      uSet: { value: 0 },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    depthTest: false,
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
  uniform vec2 uCentre; uniform float uU; uniform float uI; uniform float uAmt; uniform float uLight; uniform float uTouch;
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
    // (uTouch: that, eased in time on the CPU)
    float touch = uTouch;
    float disc = step(rr, ${f(SUN.cover.disc)}) * touch * uAmt;
    // (the lines' own ordered dither, on the art's pixels)
    float ordered = fract(floor(gl_FragCoord.x) * 0.5 + floor(gl_FragCoord.y) * floor(gl_FragCoord.y) * 0.75);
    float kq = floor(k * 6.0 + ordered) / 6.0;
    k = mix(k, kq, touch);
    if (uLight > 0.5) {
      // (the core is the paper's white through and through, as the rays are: the 0.9 and the warm tint it had let a tenth of the grey round it show in the middle of the sun, which read darker than the rays, 2026-11-01)
      float a = max(k, disc);
      gl_FragColor = vec4(vec3(1.0) * a, a);
    } else {
      vec3 emit = warm(ink) * k * dim;
      gl_FragColor = vec4(disc > 0.5 ? ${vec(SUN.cover.discColour)} : emit, disc);
    }
  }
`;

const blobMaterial = () =>
  new ShaderMaterial({
    uniforms: { uCentre: { value: new Vector2() }, uBuf: { value: new Vector2(1, 1) }, uExt: { value: 1 }, uU: { value: 1 }, uI: { value: 1 }, uTouch: { value: 0 }, uAmt: { value: 1 }, uSet: { value: 0 }, uLight: { value: 0 } },
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
  /** Whether what covers the sun has an atmosphere, as the planet has: the sunset's reddening is its, and the moon (which has none) leaves the sun's colour as it is. Absent: it has (the planet). */
  atmosphere?: boolean;
  /** The music's beat in the halo and the rays (`sunPulse`, engine/sun-pulse.ts). Absent: none. */
  pulse?: SunPulse;
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

/**
 * The sun's frame recorder (#469): with `?sun-log` in the address, every frame the sun is placed records what decides its look (the night's amount, the planet's cover, the eased disc, the camera's focal length) in
 * `window.__sunLog` (the last 1200 frames that differ from the one before: a screen at rest records nothing), to be read from the console after a fast zoom out: `copy(JSON.stringify(window.__sunLog))`. Off otherwise: nothing is recorded or kept.
 */
const SUN_LOG = typeof location !== "undefined" && new URLSearchParams(location.search).has("sun-log");
interface SunRecord {
  t: number;
  amount: number;
  rise: number;
  area: number;
  halo: number;
  touch: number;
  visible: boolean;
  ahead: boolean;
  focal: number;
}
function recordSun(r: SunRecord): void {
  const w = window as unknown as { __sunLog?: SunRecord[] };
  const log = (w.__sunLog ??= []);
  const rec = { ...r, amount: +r.amount.toFixed(3), rise: Number.isFinite(r.rise) ? +r.rise.toFixed(2) : Infinity, area: +r.area.toFixed(3), halo: +r.halo.toFixed(3), touch: +r.touch.toFixed(3) };
  // a frame is kept only if something changed since the last one kept: a screen at rest (120 frames a second) would otherwise push the fast zoom out out of the window in ten seconds
  const last = log[log.length - 1];
  if (last && last.amount === rec.amount && last.rise === rec.rise && last.area === rec.area && last.halo === rec.halo && last.touch === rec.touch && last.visible === rec.visible && last.ahead === rec.ahead && last.focal === rec.focal) return;
  log.push(rec);
  if (log.length > 1200) log.splice(0, log.length - 1200);
}

export class SunLayer {
  readonly mesh: Mesh;
  private mat = material();
  private geometry = new BufferGeometry();
  private flare: FlareLayer;
  private dark = true;
  /** How much of the sun's light is in the picture now, 0..1 (the eye's iris closes with it: `SUN.light.iris`). */
  glare = 0;
  /** The blur: over the planet, not under it. */
  readonly blob: Mesh;
  private blobMat = blobMaterial();
  /** The disc's eased state (`easeTouch`) and when it was last eased. */
  private touch = 0;
  private touchAt = 0;

  constructor(scene: Scene) {
    this.flare = new FlareLayer(scene);
    this.geometry.setAttribute("position", new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    this.mesh = new Mesh(this.geometry, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    // over the planet's own layers (the ground glow is 5.1), under the blur (5.2): the halo and the ring are a lens's, not hidden by the limb
    this.mesh.renderOrder = 5.15;
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
    // the halo's blend: the light page multiplies what is behind (the halo darkens the planet under it, `FRAGMENT`), the dark page lays its light over it
    this.mat.blendSrc = this.dark ? OneFactor : DstColorFactor;
    // (the blur adds its light on the dark page and lays white over the paper on the light one: its shader's output is premultiplied in both, one blend)
    this.blobMat.uniforms.uLight!.value = this.dark ? 0 : 1;
    this.flare.applyTheme(t);
  }

  /** Place the sun for this frame: true when it is in the picture (the frame loop has a sun to draw). */
  sync(f: SunFrame): boolean {
    const p = f.amount > 0.01 ? sunPlace(f) : null;
    this.mesh.visible = p !== null && FX.on.sunHalo;
    // how far the sun is outside the planet's limb, in disc radii (Infinity: nothing in the way): what is left of it (`sunCrescent`), and how much of the halo the planet leaves
    const sr = sunRadius(f);
    const rise = ((f.rise ?? Infinity) * f.focal) / sr;
    const cres = sunCrescent(rise);
    const halo = haloClear(rise);
    // the disc the planet makes of the sun once it touches it, eased in time (a fast zoom took the limb across in a few frames)
    const nowMs = performance.now();
    this.touch = easeTouch(this.touch, 1 - smoothstep(Math.min(1, Math.max(0, (cres.area - 0.9) / 0.07))), (nowMs - this.touchAt) / 1000);
    this.touchAt = nowMs;
    if (SUN_LOG) recordSun({ t: Math.round(nowMs), amount: f.amount, rise, area: cres.area, halo, touch: this.touch, visible: this.mesh.visible, ahead: f.ahead, focal: f.focal });
    // (the reddening is the atmosphere's: what has none, the moon, leaves the colour as it is)
    const air = f.atmosphere === false ? 0 : 1;
    this.glare = p !== null ? f.amount * Math.sqrt(cres.area) : 0;
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
      b.uTouch!.value = this.touch;
      b.uAmt!.value = f.amount;
      b.uSet!.value = (1 - halo) * SUN.cover.redden * air;
    }
    // the lens flare comes out of the same centre, as bright as the share of the sun that is left (on the light page whole, until the sun is gone: it does not dim, only the sun's size follows the crescent)
    const rayStartPx = rayStart(sr, cres.area, cres.width, SUN.cover.disc);
    let flaring = false;
    if (FX.on.flare) flaring = this.flare.sync({ bufW: f.bufW, bufH: f.bufH, x: f.ahead ? bx : f.x, y: f.ahead ? by : f.y, ahead: f.ahead, amount: f.amount, visible: this.dark ? cres.area : Math.sqrt(cres.area), rayDim: this.dark ? undefined : 1, r: rayStartPx, size: Math.sqrt(cres.area), pulse: f.pulse, set: (1 - halo) * SUN.cover.redden * air } satisfies FlareFrame);
    else this.flare.hide();
    if (!p) return flaring || blob;
    const u = this.mat.uniforms;
    // the halo and the ring are round what is left of the sun, not the whole one: centred where the visible part's centre of mass is, their inner edge the crescent's width (as the blur is)
    (u.uCentre!.value as Vector2).set(bx, by);
    (u.uBuf!.value as Vector2).set(f.bufW, f.bufH);
    u.uR!.value = unit;
    u.uExt!.value = p.r * (1 + SUN.halo) * (1 + PULSE.halo) + 1;
    u.uAmt!.value = f.amount;
    u.uHalo!.value = 1 - SUN.cover.halo * (1 - halo);
    // the lens's ring goes with the sun's visible share: whole above `SUN.ring.fade[1]` of it, gone when it is hidden
    const [r0, r1] = SUN.ring.fade;
    const rt = Math.min(1, Math.max(0, (cres.area - r0) / (r1 - r0)));
    const seen = rt * rt * (3 - 2 * rt);
    u.uRing!.value = seen;
    // the halo is in proportion to the sun that is left: its reach goes with the sun's visible radius (the root of its area), its light with the same share, so that it is gone when the sun is
    const k = Math.sqrt(cres.area);
    // (in units of `unit`: the reach is still SUN.halo disc radii times k)
    u.uK!.value = Math.max(k * (sr / unit), 1e-3) * (1 + PULSE.halo * (f.pulse?.gain ?? 1) * (f.pulse?.breath ?? 0));
    u.uSoft!.value = SUN.cover.hidden + (1 - SUN.cover.hidden) * k;
    // (as audible as the music is, less how far the breath has come up: it is 0 with no music, and a whole breath, up, is 0 too)
    u.uDip!.value = (PULSE.dip / SUN.haloSteps) * (f.pulse?.gain ?? 1) * Math.max(0, (f.pulse?.amount ?? 0) - (f.pulse?.breath ?? 0));
    u.uSet!.value = (1 - halo) * SUN.cover.halo * air;
    return true;
  }

  dispose(): void {
    this.flare.dispose();
    this.geometry.dispose();
    this.mat.dispose();
    this.blobMat.dispose();
  }
}
