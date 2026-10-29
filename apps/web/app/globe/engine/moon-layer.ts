/**
 * The moon as an object in the globe's scene (docs/landing.md, "The moon"; the maths is engine/moon.ts): a sphere a sixth of the earth's radius on a far orbit, drawn into the
 * globe's own canvas, so it is on the same art grid as the planet and the planet hides it by the depth buffer, exactly, at the planet's own stepped limb.
 *
 * Its pixels are whole pixels, as everything on the globe is (owner, 2026-10-26: "the moon is still heavily anti-aliased"; it had been drawn with coverage, soft edge and
 * smooth light, to glide on the art grid): a pixel is in or out of the silhouette (a sphere's silhouette is where the view ray is at asin(r / D) from the line to its centre: one
 * angle, exact at every place on the screen), the light is three flat steps, the ground three hard tones with the Earth's cuts, the rim a solid band. The orbit's slowness is what
 * keeps the motion even, as it does for the planet's turn.
 *
 * What is lit and what is not: a sun fixed in the inertial frame (`MOON.sun*`) lights the side toward it; the other side is the page's colour (the body is SOLID, so it hides the
 * stars and the band behind it; on the page's own colour it is invisible), with the faintest ring on its rim so that it can still be found.
 *
 * The layer knows nothing of input or the DOM: it is placed from the camera each frame (`sync`) and says where it is on the screen and how much of it shows (`MoonSample`), which
 * is what the link over it (engine/moon-overlay.ts) needs.
 */
import { AddEquation, ClampToEdgeWrapping, Color, CustomBlending, FrontSide, LinearFilter, Mesh, NoColorSpace, OneFactor, OneMinusSrcAlphaFactor, RepeatWrapping, type Scene, ShaderMaterial, SphereGeometry, SrcAlphaFactor, type Texture, TextureLoader, Vector3, type PerspectiveCamera } from "three";
import type { GlobeTheme } from "./colors";
import { MOON, inertialPosition, moonAmount, orbitBasis, toEarthFrame, unhidden, type OrbitBasis, type Vec3 } from "./moon";
import { SURFACE, surfaceTones } from "./surface";

/** What a frame says of the moon. Buffer pixels (the art grid, y up, as `gl_FragCoord` has them) and earth radii. */
export interface MoonSample {
  /** The centre in the earth-fixed frame, earth radii; the distance from the camera. */
  position: Vec3;
  distance: number;
  /** The disc's centre and radius on the drawing buffer, art pixels, y up. */
  cx: number;
  cy: number;
  r: number;
  /** In the picture at all: in front of the camera, inside the far plane, and the disc touches the buffer. Otherwise nothing is drawn. */
  onScreen: boolean;
  /** 0..1: how much of the disc the planet leaves visible (the link over it is not a target when this is low), and how much the zoom lets through. */
  unhidden: number;
  amount: number;
  /** The planet's silhouette on the buffer where it can hide the moon (beyond the plane of its horizon), art pixels, y up; else null. */
  planet: { x: number; y: number; r: number } | null;
}

export interface MoonFrame {
  camera: PerspectiveCamera;
  bufW: number;
  bufH: number;
  eraDeg: number;
  /** The orbit's angle, radians, and the roll and inclination of its plane (`rollFor`, `inclinationFor`), degrees. */
  angle: number;
  rollDeg: number;
  inclinationDeg: number;
  /** The sun in the earth-fixed frame (unit). */
  sun: Vec3;
  /** The camera's distance from the earth's centre, and the zoom with its fit (`moonAmount`). */
  d: number;
  zoom: number;
  fit: number;
}

const VERTEX = /* glsl */ `
  varying vec3 vDir; varying vec3 vWorld; varying vec3 vNormal;
  void main() {
    vDir = position;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal = normalize(mat3(modelMatrix) * position);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uBg; uniform vec3 uTone0; uniform vec3 uTone1; uniform vec3 uTone2; uniform vec3 uOutline; uniform vec3 uGhost;
  uniform vec3 uSun; uniform vec3 uAxis; uniform float uGamma0; uniform float uEdgeAng; uniform float uAmt; uniform float uFlip;
  uniform sampler2D uMap;
  varying vec3 vDir; varying vec3 vWorld; varying vec3 vNormal;
  void main() {
    // the silhouette: a sphere's is where the view ray is at asin(r / D) from the line to its centre: one angle, exact at every place on the screen
    float gamma = acos(clamp(dot(normalize(vWorld - cameraPosition), uAxis), -1.0, 1.0));
    // whole pixels, as the planet's are: a pixel is in or out (the owner, 2026-10-26: the soft edge read as anti-aliasing; the speed alone keeps the motion even)
    if (gamma > uGamma0) discard;
    // the light, in flat steps of the same grey ramp (no blended pixel)
    float lit = floor(smoothstep(${MOON.litFrom.toFixed(3)}, ${MOON.litTo.toFixed(3)}, dot(normalize(vNormal), uSun)) * 3.0 + 0.5) / 3.0;
    // the ground: the picture read by direction, three tones by brightness with the Earth's cuts, hard
    vec3 n = normalize(vDir);
    vec2 uv = vec2(atan(n.x, n.z) * 0.15915494 + 0.5, asin(clamp(n.y, -1.0, 1.0)) * 0.31830989 + 0.5);
    float v = texture2D(uMap, uv).r;
    vec3 ground = mix(mix(uTone0, uTone1, step(${SURFACE.cuts[0].toFixed(3)}, v)), uTone2, step(${SURFACE.cuts[1].toFixed(3)}, v));
    // the dark side is the page's colour: the body is solid, so it hides what is behind it. On the light page it is the other way (uFlip): the lit side is overexposed, burnt towards
    // the page's colour (not all the way: MOON.burn, so that its details are still there), and the dark side has the ground's full tones
    vec3 col = mix(uBg, ground, lit);
    vec3 burnt = mix(ground, uBg, ${MOON.burn.toFixed(2)});
    col = mix(col, mix(ground, burnt, lit), uFlip);
    // the rim: a band a pixel and a bit wide inside the silhouette, bright where lit and a ghost of a ring where not
    float rim = step(0.5, clamp((gamma - (uGamma0 - uEdgeAng * ${MOON.edgePx.toFixed(3)})) / uEdgeAng, 0.0, 1.0));
    vec3 rimCol = mix(mix(uGhost, uOutline, lit), mix(uOutline, mix(uOutline, uBg, ${MOON.burn.toFixed(2)}), lit), uFlip);
    col = mix(col, rimCol, rim);
    gl_FragColor = vec4(col, uAmt);
  }
`;

function moonMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uBg: { value: new Color() },
      uTone0: { value: new Color() },
      uTone1: { value: new Color() },
      uTone2: { value: new Color() },
      uOutline: { value: new Color() },
      uGhost: { value: new Color() },
      uSun: { value: new Vector3(0, 0, 1) },
      uAxis: { value: new Vector3(0, 0, 1) },
      uGamma0: { value: 0.1 },
      uEdgeAng: { value: 0.002 },
      uAmt: { value: 1 },
      uFlip: { value: 0 },
      uMap: { value: null },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: FrontSide,
    // Blended like a normal transparent material (the amount `uAmt` fades it), but NOT in three's transparent list: that is drawn after every opaque object whatever its `renderOrder`, and the route lines (4,
    // depth test off, so opaque) were drawn BEFORE the moon, which then covered them (owner, 2026-10-29: "the moon occludes the plane paths, though it is behind them"). Custom blending needs no `transparent`.
    transparent: false,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: SrcAlphaFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
    depthTest: true,
    depthWrite: true,
  });
}

export class MoonLayer {
  readonly mesh: Mesh;
  private material = moonMaterial();
  private geometry = new SphereGeometry(1, 64, 32);
  private texture: Texture | null = null;
  private loading = false;
  private disposed = false;
  private basis: OrbitBasis | null = null;
  private roll = NaN;
  private incl = NaN;
  private v = new Vector3();
  /** The last frame's sample (null while the moon is not shown). */
  sample: MoonSample | null = null;

  constructor(scene: Scene) {
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    // after the planet's disc (0), which writes the depth that hides it, and after the sky (0.5 and 0.6), which its soft edge is blended over; before the lines (1 and up), which its depth hides in turn
    this.mesh.renderOrder = 0.7;
    scene.add(this.mesh);
  }

  /** Whether the moon's picture is in (the moon is not drawn before: a sphere of nothing would be a hole). */
  get ready(): boolean {
    return this.texture !== null;
  }

  /** Load the Moon's picture, once; `done` is called when it is in (a frame is drawn again). A failure leaves no moon. */
  load(url: string, done: () => void): void {
    if (this.texture || this.loading || this.disposed) return;
    this.loading = true;
    new TextureLoader().load(
      url,
      (tex) => {
        if (this.disposed) {
          tex.dispose();
          return;
        }
        tex.magFilter = LinearFilter;
        tex.minFilter = LinearFilter;
        tex.wrapS = RepeatWrapping;
        tex.wrapT = ClampToEdgeWrapping;
        tex.generateMipmaps = false;
        tex.colorSpace = NoColorSpace;
        this.material.uniforms.uMap!.value = tex;
        this.texture = tex;
        done();
      },
      undefined,
      () => {
        this.loading = false;
      },
    );
  }

  /** The Earth's tones in this theme (the recipe of `GlobeScene.applyTheme`: a step from the page's colour towards its ink, boosted), the rim the coastlines' colour softened toward the page's. */
  applyTheme(t: GlobeTheme): void {
    const bg = t.background;
    const mixTo = (to: readonly [number, number, number], k: number) => [0, 1, 2].map((i) => bg[i]! + (to[i]! - bg[i]!) * Math.min(1, k)) as [number, number, number];
    const steps = surfaceTones(t.scheme);
    const u = this.material.uniforms;
    u.uBg!.value.setRGB(...bg);
    u.uFlip!.value = t.scheme === "dark" ? 0 : 1;
    u.uTone0!.value.setRGB(...mixTo(t.ink, steps[0]! * MOON.toneBoost));
    u.uTone1!.value.setRGB(...mixTo(t.ink, steps[1]! * MOON.toneBoost));
    u.uTone2!.value.setRGB(...mixTo(t.ink, steps[2]! * MOON.toneBoost));
    u.uOutline!.value.setRGB(...mixTo(t.coast, MOON.outlineMix));
    u.uGhost!.value.setRGB(...mixTo(t.coast, MOON.ghostMix));
  }

  /**
   * Place the moon for this frame and say where it is. Null (and not drawn) while the picture is not in, or the zoom has taken it away. The camera's matrices are those
   * of the frame (`syncCamera` calls this after them), so the projection is the one that draws it.
   */
  sync(f: MoonFrame): MoonSample | null {
    const amount = this.texture ? moonAmount(f.zoom, f.fit) : 0;
    if (amount <= 0.01) {
      this.mesh.visible = false;
      this.sample = null;
      return null;
    }
    if (!this.basis || this.roll !== f.rollDeg || this.incl !== f.inclinationDeg) {
      this.roll = f.rollDeg;
      this.incl = f.inclinationDeg;
      this.basis = orbitBasis(f.rollDeg, f.inclinationDeg);
    }
    const p = toEarthFrame(inertialPosition(f.angle, this.basis), f.eraDeg);
    this.mesh.position.set(p[0], p[1], p[2]);
    this.mesh.scale.setScalar(MOON.radius);
    this.mesh.lookAt(0, 0, 0); // one face to the planet: local +Z (longitude 0, latitude 0) toward it, +Y (north) up
    this.mesh.updateMatrixWorld();

    const cam = f.camera;
    const cp = cam.position;
    const dx = p[0] - cp.x;
    const dy = p[1] - cp.y;
    const dz = p[2] - cp.z;
    const D = Math.hypot(dx, dy, dz);
    // the disc's centre on the buffer, and the radius of a sphere's silhouette in perspective: f r / sqrt(D^2 - r^2), f the vertical focal length in buffer pixels
    const ndc = this.v.set(p[0], p[1], p[2]).project(cam);
    const cx = (ndc.x * 0.5 + 0.5) * f.bufW;
    const cy = (ndc.y * 0.5 + 0.5) * f.bufH;
    const focal = (cam.projectionMatrix.elements[5]! * f.bufH) / 2;
    const r = (focal * MOON.radius) / Math.sqrt(Math.max(1e-6, D * D - MOON.radius * MOON.radius));
    // the planet's centre on the buffer and its silhouette, to see how much of the moon it hides: only a point beyond the plane of its horizon can be
    const c0 = this.v.set(0, 0, 0).project(cam);
    const px = (c0.x * 0.5 + 0.5) * f.bufW;
    const py = (c0.y * 0.5 + 0.5) * f.bufH;
    const s = focal / Math.sqrt(Math.max(1e-6, f.d * f.d - 1));
    const along = (p[0] * cp.x + p[1] * cp.y + p[2] * cp.z) / f.d;
    const behind = along < 1 / f.d;
    // in front of the camera (the near half of the orbit is behind it: a point behind a perspective camera projects to a mirrored place), and the disc touches the buffer
    const ce = cam.matrixWorld.elements;
    const ahead = -(dx * ce[8]! + dy * ce[9]! + dz * ce[10]!);
    const onScreen = ahead > 0.5 && cx + r > 0 && cx - r < f.bufW && cy + r > 0 && cy - r < f.bufH;
    this.mesh.visible = onScreen;
    const sample: MoonSample = { position: p, distance: D, cx, cy, r, onScreen, unhidden: unhidden(behind, Math.hypot(cx - px, cy - py), s, r), amount, planet: behind ? { x: px, y: py, r: s } : null };
    const u = this.material.uniforms;
    (u.uAxis!.value as Vector3).set(dx / D, dy / D, dz / D);
    (u.uSun!.value as Vector3).set(f.sun[0], f.sun[1], f.sun[2]);
    u.uGamma0!.value = Math.asin(Math.min(1, MOON.radius / D));
    u.uEdgeAng!.value = 1 / focal; // one buffer pixel
    u.uAmt!.value = amount;
    this.sample = sample;
    return sample;
  }

  dispose(): void {
    this.disposed = true;
    this.geometry.dispose();
    this.material.dispose();
    this.texture?.dispose();
    this.texture = null;
  }
}
