/**
 * The sun's lens flare (docs/landing.md, "The sun"): what a lens does with a bright thing in the picture. A row of ghosts on the line from the sun through the middle of the picture
 * (the optical axis), each at a fixed share of the way along it, so that as the camera turns the ghosts slide across the picture the other way round the middle and come together
 * as the sun nears it, and eight thin rays out of the sun itself (up, down, left, right and the four diagonals). It is drawn over everything (it is in the lens, not in the sky), one full-buffer quad and one cheap fragment shader,
 * in whole art pixels like the rest of the globe: hexagons (an aperture's shape), rings and filled ones, whose edges fall on the grid, flat tones, and a 4x4 Bayer dither for the soft ones (a pixel is on or off).
 *
 * The planet hides the sun, and so it hides the flare: `flarePlace` takes how much of the sun the planet leaves (`visible`) and fades the whole flare with it. The flare also fades
 * towards the picture's edge (the sun leaving it) and as the sun comes to the middle (the ghosts would pile up on it). Like the sun, it is static: it asks for no frames of its own.
 * On the light page the sun is burnt out, so the flare is too: the same shapes, as faint ghosts of the ink.
 */
import { BufferAttribute, BufferGeometry, Color, Mesh, NormalBlending, type Scene, ShaderMaterial, Vector2 } from "three";
import type { GlobeTheme } from "./colors";
import { FLARE, SUN } from "./moon";
import { BAYER4 } from "./sky";

const f = (n: number) => n.toFixed(3);
const list = (xs: readonly number[]) => xs.map(f).join(", ");

const VERTEX = /* glsl */ `
  void main() { gl_Position = vec4(position.xy, 1.0, 1.0); }
`;

const N = FLARE.ghosts.length;

/**
 * The warm ramp (`SUN.tint`) as a GLSL function: `warm(tone)` is the colour of a pixel of that tone, `uSet` (0..1, how far the planet has covered the sun) pulls the tone down, so the light reddens as it sets.
 * Shared by the sun's halo and the flare, so that the two are one light.
 */
export const WARM_GLSL = /* glsl */ `
  uniform float uSet;
  vec3 warm(float tone) {
    float t = tone * (1.0 - ${f(SUN.setShare)} * uSet);
    ${SUN.tint.map((s, i) => `${i === 0 ? "" : "else "}if (t >= ${f(s.at)}) return vec3(${list(s.rgb)});`).join("\n    ")}
    return vec3(${list(SUN.tint[SUN.tint.length - 1]!.rgb)});
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec2 uSun; uniform vec2 uMid; uniform float uUnit; uniform float uStr; uniform vec3 uBg; uniform vec3 uInk; uniform float uLight; uniform float uBufW; uniform float uBufH; uniform float uSunR;
  ${WARM_GLSL}
  const float BAYER[16] = float[16](${BAYER4.map((n) => `${n}.0`).join(", ")});
  const float AT[${N}] = float[${N}](${list(FLARE.ghosts.map((g) => g.at))});
  const float SIZE[${N}] = float[${N}](${list(FLARE.ghosts.map((g) => g.size))});
  const float TONE[${N}] = float[${N}](${list(FLARE.ghosts.map((g) => g.tone))});
  const int KIND[${N}] = int[${N}](${FLARE.ghosts.map((g) => ({ ring: 0, dither: 1, disc: 2 })[g.kind]).join(", ")});
  float bayer() {
    ivec2 c = ivec2(mod(floor(gl_FragCoord.xy), 4.0));
    return (BAYER[c.y * 4 + c.x] + 0.5) / 16.0;
  }
  void main() {
    vec2 p = gl_FragCoord.xy;
    float ink = 0.0;
    // the tone the strongest element asks the warm ramp for (the ghosts go from the sun's gold to violet across the picture, the rays from white-gold to orange)
    float hue = 0.0;
    for (int i = 0; i < ${N}; i++) {
      // the ghost's centre on a whole pixel's centre, so that its edge falls on the grid
      vec2 g = floor(uSun + (uMid - uSun) * AT[i]) + 0.5;
      float R = max(2.0, floor(SIZE[i] * uUnit) + 0.5);
      // the distance in the metric of a regular hexagon (flat top and bottom: an aperture's blades), so that a ring is a hexagon and a disc a filled one; R is its apothem
      vec2 q = abs(p - g);
      float r = max(dot(q, vec2(0.8660254, 0.5)), q.y);
      float t = TONE[i];
      float h = clamp(0.62 - 0.22 * AT[i], 0.06, 0.62);
      bool on = false;
      if (KIND[i] == 0) { on = abs(r - R) < ${f(FLARE.ringWidth / 2)}; }
      else if (KIND[i] == 1) { on = r < R && t > bayer(); }
      else { on = r < R; }
      if (on && t > ink) { ink = t; hue = h; }
    }
    // the rays: one pixel wide, from the sun's centre (the disc's edge, where they join it) out along the axes and the diagonals (a diagonal is the pixels where the two offsets are equal), a dither that thins out along them
    vec2 o = floor(p) - floor(uSun);
    vec2 a = abs(o);
    float dist = -1.0;
    float len = 1.0;
    if (o.y == 0.0) { dist = a.x; len = ${f(FLARE.streak)} * uBufW; }
    else if (o.x == 0.0) { dist = a.y; len = ${f(FLARE.streakUp)} * uBufH; }
    else if (a.x == a.y) { dist = a.x * 1.4142; len = ${f(FLARE.streakDiag)} * uBufW; }
    if (dist > uSunR) {
      float along = 1.0 - (dist - uSunR) / len;
      if (along > 0.0 && pow(along, ${f(FLARE.streakFall)}) > bayer()) { ink = ${f(FLARE.streakTone)}; hue = mix(0.5, 0.95, along); }
    }
    if (ink <= 0.0) discard;
    // the dark page's light is warm; the light page's is burnt out: the ink's own ghosts
    vec3 col = uLight > 0.5 ? mix(uBg, uInk, ink * ${f(FLARE.lightShare)}) : mix(uBg, warm(hue), clamp(ink * ${f(SUN.gain)}, 0.0, 1.0));
    gl_FragColor = vec4(col, uStr);
  }
`;

export interface FlareFrame {
  bufW: number;
  bufH: number;
  /** Where the sun's direction projects on the buffer, and whether it is in front of the camera (as `SunFrame`). */
  x: number;
  y: number;
  ahead: boolean;
  /** How much of the sun the zoom lets through (the night's amount), 0..1, and how much of it the planet leaves, 0..1. */
  amount: number;
  visible: number;
  /** The sun's disc radius on the buffer, px: the streaks start at its edge. */
  r?: number;
  /** How far the planet has covered the sun's glow, 0 (none) to 1 (all): the light reddens with it (`warm`). Absent: none. */
  set?: number;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** How much of the planet's disc, seen from `d` earth radii, is clear of a direction at `cos` from its centre: 1 well outside its limb, 0 behind it, a smoothstep over a hair of its width. Pure. */
export function planetClear(cosFromCentre: number, d: number): number {
  if (cosFromCentre <= 0) return 1;
  const limb = 1 / Math.max(1.0001, d);
  const sin = Math.sqrt(Math.max(0, 1 - cosFromCentre * cosFromCentre));
  return smooth(limb * (1 - FLARE.limbSoft), limb * (1 + FLARE.limbSoft), sin);
}

/**
 * How much of the sun's HALO the planet leaves, 1 until the sun's blob first touches the limb and 0 once the sun's centre is `SUN.fade.from` disc radii behind it, a smoothstep over the distance between. `riseDisc` is the sun's
 * distance outside the limb in disc radii (`sunRise` in radians, times the focal length, over the disc's radius on the buffer); Infinity when nothing is in the way. Pure.
 */
export function haloClear(riseDisc: number): number {
  return smooth(-SUN.fade.from, SUN.fade.to, riseDisc);
}

/**
 * What is left of the sun's disc as the planet covers it, with the limb taken as a straight line across the disc (it is a hair of curve over a disc this small). `riseDisc` is the sun's centre's distance outside the limb, in disc
 * radii (negative once it is behind it; Infinity when nothing is in the way). `area` is the share of the disc's surface still in view, 0..1; `shift` the distance of the visible part's centre of mass from the disc's centre,
 * in disc radii, along the normal away from the planet; `width` the widest the visible part is, across that normal, in disc radii: the disc's own (1) until the limb has reached the centre, then the crescent's, down to 0. It is
 * 1, 0, 1 for a sun clear of the limb and 0, 1, 0 for one wholly behind it. Pure.
 */
export function sunCrescent(riseDisc: number): { area: number; shift: number; width: number } {
  const a = -riseDisc; // the limb's place along the outward normal, from the sun's centre; the visible part is where x >= a
  if (a <= -1) return { area: 1, shift: 0, width: 1 };
  if (a >= 1) return { area: 0, shift: 1, width: 0 };
  const s = Math.sqrt(1 - a * a);
  const area = Math.acos(a) - a * s; // (of the unit disc, which is pi)
  return { area: area / Math.PI, shift: area > 1e-9 ? ((2 / 3) * s * s * s) / area : 1, width: a <= 0 ? 1 : s };
}

/**
 * How far the sun's centre is outside the planet's limb, in radians: positive outside, negative behind it, +Infinity when the sun is on the far side of the view axis (nothing of the planet is in its way). The blur's core shrinks
 * to fit it (`SUN.core`). `cosFromCentre` and `d` are as in `planetClear`. Pure.
 */
export function sunRise(cosFromCentre: number, d: number): number {
  if (cosFromCentre <= 0) return Infinity;
  return Math.acos(Math.min(1, cosFromCentre)) - Math.asin(Math.min(1, 1 / Math.max(1.0001, d)));
}

/** The flare for this frame: the sun's place (a whole pixel's centre), the middle of the picture, the unit its sizes are shares of, and its strength; or null when there is none. Pure. */
export function flarePlace(fr: FlareFrame): { sx: number; sy: number; mx: number; my: number; unit: number; str: number; r: number } | null {
  if (!fr.ahead || fr.amount <= 0.01 || fr.visible <= 0.01) return null;
  const mx = fr.bufW / 2;
  const my = fr.bufH / 2;
  const half = Math.hypot(mx, my);
  const out = Math.hypot(fr.x - mx, fr.y - my) / half;
  // fades as the sun leaves the picture, and as it comes to the middle
  const str = fr.amount * fr.visible * (1 - smooth(FLARE.edgeFrom, FLARE.edgeTo, out)) * smooth(FLARE.midFrom, FLARE.midTo, out);
  if (str <= 0.01) return null;
  return { sx: Math.floor(fr.x) + 0.5, sy: Math.floor(fr.y) + 0.5, mx, my, unit: Math.min(fr.bufW, fr.bufH), str, r: fr.r ?? 0 };
}

export class FlareLayer {
  readonly mesh: Mesh;
  private mat = new ShaderMaterial({
    uniforms: {
      uSet: { value: 0 },
      uSun: { value: new Vector2() },
      uMid: { value: new Vector2() },
      uUnit: { value: 1 },
      uBufW: { value: 1 },
      uBufH: { value: 1 },
      uSunR: { value: 0 },
      uStr: { value: 1 },
      uBg: { value: new Color() },
      uInk: { value: new Color() },
      uLight: { value: 0 },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    blending: NormalBlending,
    depthTest: false,
    depthWrite: false,
  });
  private geometry = new BufferGeometry();

  constructor(scene: Scene) {
    this.geometry.setAttribute("position", new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    this.mesh = new Mesh(this.geometry, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    // over the sun, the moon and the lines: the flare is in the lens
    this.mesh.renderOrder = 0.9;
    scene.add(this.mesh);
  }

  applyTheme(t: GlobeTheme): void {
    const u = this.mat.uniforms;
    u.uBg!.value.setRGB(...t.background);
    u.uInk!.value.setRGB(...t.ink);
    u.uLight!.value = t.scheme === "dark" ? 0 : 1;
  }

  /** True when the flare is in the picture now. */
  sync(fr: FlareFrame): boolean {
    const p = flarePlace(fr);
    this.mesh.visible = p !== null;
    if (!p) return false;
    const u = this.mat.uniforms;
    (u.uSun!.value as Vector2).set(p.sx, p.sy);
    (u.uMid!.value as Vector2).set(p.mx, p.my);
    u.uUnit!.value = p.unit;
    u.uBufW!.value = fr.bufW;
    u.uBufH!.value = fr.bufH;
    u.uSunR!.value = p.r;
    u.uStr!.value = p.str;
    u.uSet!.value = fr.set ?? 0;
    return true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.mat.dispose();
  }
}
