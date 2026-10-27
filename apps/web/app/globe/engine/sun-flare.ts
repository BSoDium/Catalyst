/**
 * The sun's lens flare (docs/landing.md, "The sun"): what a lens does with a bright thing in the picture. A row of ghosts on the line from the sun through the middle of the picture
 * (the optical axis), each at a fixed share of the way along it, so that as the camera turns the ghosts slide across the picture the other way round the middle and come together
 * as the sun nears it, and a thin streak across the sun itself. It is drawn over everything (it is in the lens, not in the sky), one full-buffer quad and one cheap fragment shader,
 * in whole art pixels like the rest of the globe: rings and discs whose edges fall on the grid, flat tones, and a 4x4 Bayer dither for the soft ones (a pixel is on or off).
 *
 * The planet hides the sun, and so it hides the flare: `flarePlace` takes how much of the sun the planet leaves (`visible`) and fades the whole flare with it. The flare also fades
 * towards the picture's edge (the sun leaving it) and as the sun comes to the middle (the ghosts would pile up on it). Like the sun, it is static: it asks for no frames of its own.
 * On the light page the sun is burnt out, so the flare is too: the same shapes, as faint ghosts of the ink.
 */
import { BufferAttribute, BufferGeometry, Color, Mesh, NormalBlending, type Scene, ShaderMaterial, Vector2 } from "three";
import type { GlobeTheme } from "./colors";
import { FLARE } from "./moon";
import { BAYER4 } from "./sky";

const f = (n: number) => n.toFixed(3);
const list = (xs: readonly number[]) => xs.map(f).join(", ");

const VERTEX = /* glsl */ `
  void main() { gl_Position = vec4(position.xy, 1.0, 1.0); }
`;

const N = FLARE.ghosts.length;

const FRAGMENT = /* glsl */ `
  uniform vec2 uSun; uniform vec2 uMid; uniform float uUnit; uniform float uStr; uniform vec3 uBg; uniform vec3 uInk; uniform float uLight; uniform float uBufW; uniform float uBufH; uniform float uSunR;
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
    for (int i = 0; i < ${N}; i++) {
      // the ghost's centre on a whole pixel's centre, so that its edge falls on the grid
      vec2 g = floor(uSun + (uMid - uSun) * AT[i]) + 0.5;
      float R = max(2.0, floor(SIZE[i] * uUnit) + 0.5);
      float r = length(p - g);
      float t = TONE[i];
      if (KIND[i] == 0) { if (abs(r - R) < ${f(FLARE.ringWidth / 2)}) ink = max(ink, t); }
      else if (KIND[i] == 1) { if (r < R && t > bayer()) ink = max(ink, t); }
      else { if (r < R) ink = max(ink, t); }
    }
    // the streaks: a one-pixel row and column through the sun, in its own tone, from the disc's edge out; a dither that thins out along them
    vec2 d = abs(p - uSun);
    if (abs(p.y - (floor(uSun.y) + 0.5)) < 0.5 && d.x > uSunR) {
      float along = 1.0 - d.x / (${f(FLARE.streak)} * uBufW);
      if (along > 0.0 && pow(along, 2.2) > bayer()) ink = max(ink, ${f(FLARE.streakTone)});
    }
    if (abs(p.x - (floor(uSun.x) + 0.5)) < 0.5 && d.y > uSunR) {
      float along = 1.0 - d.y / (${f(FLARE.streakUp)} * uBufH);
      if (along > 0.0 && pow(along, 2.2) > bayer()) ink = max(ink, ${f(FLARE.streakTone)});
    }
    if (ink <= 0.0) discard;
    gl_FragColor = vec4(mix(uBg, uInk, ink * (uLight > 0.5 ? ${f(FLARE.lightShare)} : 1.0)), uStr);
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
    return true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.mat.dispose();
  }
}
