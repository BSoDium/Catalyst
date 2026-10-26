/**
 * The moon as an object in the scene (docs/landing.md, "The moon"; the maths is engine/moon.ts): a sphere a sixth of the earth's radius on an orbit about it, in the
 * earth-fixed frame the scene is in, with the depth test on and the depth written, so the planet hides it when it is behind and it hides the planet's lines, the sky and the stars
 * when it is in front, as any body would. Drawn with the Earth's own picture treatment (`surfaceMaterial`, engine/materials.ts), the same shader in all but its source: the
 * Moon's map (`public/media/moon-grey.png`) read by direction, three flat tones by brightness with the same cuts and the same tone steps (`SURFACE`), kept in `SURFACE.cover` of the pixels by
 * the globe's own ordered dither on the buffer's pixel, in the page's colour (the Earth's sea) where it is not, outlined by a pixel in the coastlines' colour. No light for now (the
 * Earth has none at rest); the body turns one face to the planet, as the real one does.
 *
 * The layer knows nothing of input or the DOM: it is placed from the camera each frame (`sync`) and says where it is on the screen and how much of it shows
 * (`MoonSample`), which is what the link over it (engine/moon-overlay.ts) and the ring's knock-out need.
 */
import { ClampToEdgeWrapping, Color, FrontSide, LinearFilter, Mesh, NoColorSpace, RepeatWrapping, type Scene, ShaderMaterial, SphereGeometry, type Texture, TextureLoader, Vector3, type PerspectiveCamera } from "three";
import type { GlobeTheme } from "./colors";
import { DITHER_GLSL } from "./materials";
import { MOON, inertialPosition, moonAmount, orbitBasis, toEarthFrame, unhidden, type OrbitBasis, type Vec3 } from "./moon";
import { SURFACE, surfaceTones } from "./surface";

/** What a frame says of the moon. Container-free: buffer pixels (the art grid, y up, as `gl_FragCoord` has them) and earth radii. */
export interface MoonSample {
  /** The centre in the earth-fixed frame, earth radii; the distance from the camera. */
  position: Vec3;
  distance: number;
  /** The disc's centre and radius on the drawing buffer, art pixels, y up. */
  cx: number;
  cy: number;
  r: number;
  /** In front of the plane of the planet's centre (for the ring, which has no depth: a flat circle in that plane). */
  inFront: boolean;
  /** 0..1: how much of the disc the planet leaves visible (the link over it is not a target when this is low), and how much the zoom lets through. */
  unhidden: number;
  amount: number;
}

export interface MoonFrame {
  camera: PerspectiveCamera;
  bufW: number;
  bufH: number;
  eraDeg: number;
  /** The orbit's angle, radians, and the roll of its plane (`rollFor`), degrees. */
  angle: number;
  rollDeg: number;
  /** The camera's distance from the earth's centre, and the zoom with its fit (`moonAmount`). */
  d: number;
  zoom: number;
  fit: number;
}

const FRAGMENT = /* glsl */ `
  uniform vec3 uBg; uniform vec3 uTone0; uniform vec3 uTone1; uniform vec3 uTone2; uniform vec3 uOutline;
  uniform float uCover; uniform float uAmt; uniform vec3 uAxis; uniform float uGamma0; uniform float uEdgeAng;
  uniform sampler2D uMap;
  varying vec3 vDir; varying vec3 vWorld;
  ${DITHER_GLSL}
  void main() {
    // the dissolve of the zoom's fade: the lines' own ordered dither, the page's way of a fade
    ditherDiscard(uAmt);
    vec3 n = normalize(vDir);
    vec2 uv = vec2(atan(n.x, n.z) * 0.15915494 + 0.5, asin(clamp(n.y, -1.0, 1.0)) * 0.31830989 + 0.5);
    float v = texture2D(uMap, uv).r;
    // the body is the page's colour (the Earth's sea); the ground is one of three flat tones by brightness, in half of the pixels, by the globe's dither on the buffer's pixel
    vec3 col = uBg;
    if (dither4(floor(gl_FragCoord.xy)) < uCover) col = v < ${SURFACE.cuts[0].toFixed(2)} ? uTone0 : (v < ${SURFACE.cuts[1].toFixed(2)} ? uTone1 : uTone2);
    // the rim: one art pixel, in the coastlines' colour. A sphere's silhouette is where the view ray is at asin(r / D) from the line to its centre (uGamma0): the same
    // at every place on the screen, where a circle of pixels is only right on the axis (off it the silhouette is an ellipse); a pixel is uEdgeAng wide
    float gamma = acos(clamp(dot(normalize(vWorld - cameraPosition), uAxis), -1.0, 1.0));
    if (gamma > uGamma0 - uEdgeAng) col = uOutline;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const VERTEX = /* glsl */ `
  varying vec3 vDir; varying vec3 vWorld;
  void main() { vDir = position; vWorld = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

function moonMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uBg: { value: new Color() },
      uTone0: { value: new Color() },
      uTone1: { value: new Color() },
      uTone2: { value: new Color() },
      uOutline: { value: new Color() },
      uCover: { value: SURFACE.cover },
      uAmt: { value: 1 },
      uAxis: { value: new Vector3(0, 0, 1) },
      uGamma0: { value: 0.1 },
      uEdgeAng: { value: 0.002 },
      uMap: { value: null },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: FrontSide,
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
  private v = new Vector3();
  /** The last frame's sample (null while the moon is not shown). */
  sample: MoonSample | null = null;

  constructor(scene: Scene) {
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    // after the planet's disc (0), which writes the depth that hides it; before the sky (0.5) and the lines (1 and up), which its depth then hides in turn
    this.mesh.renderOrder = 0.4;
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

  /** The Earth's tones, in this theme (the recipe of `GlobeScene.applyTheme`: a step from the page's colour towards its ink), the outline the coastlines'. */
  applyTheme(t: GlobeTheme): void {
    const bg = t.background;
    const mixTo = (k: number) => [0, 1, 2].map((i) => bg[i]! + (t.ink[i]! - bg[i]!) * Math.min(1, k)) as [number, number, number];
    const steps = surfaceTones(t.scheme);
    const u = this.material.uniforms;
    u.uBg!.value.setRGB(...bg);
    u.uTone0!.value.setRGB(...mixTo(steps[0]! * MOON.toneBoost));
    u.uTone1!.value.setRGB(...mixTo(steps[1]! * MOON.toneBoost));
    u.uTone2!.value.setRGB(...mixTo(steps[2]! * MOON.toneBoost));
    u.uOutline!.value.setRGB(...t.coast);
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
    if (!this.basis || this.roll !== f.rollDeg) {
      this.roll = f.rollDeg;
      this.basis = orbitBasis(f.rollDeg);
    }
    const p = toEarthFrame(inertialPosition(f.angle, this.basis), f.eraDeg);
    this.mesh.position.set(p[0], p[1], p[2]);
    this.mesh.scale.setScalar(MOON.radius);
    this.mesh.lookAt(0, 0, 0); // one face to the planet: local +Z (longitude 0, latitude 0) toward it, +Y (north) up
    this.mesh.updateMatrixWorld();
    this.mesh.visible = true;

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
    const along = (p[0] * cp.x + p[1] * cp.y + p[2] * cp.z) / f.d; // the moon's coordinate along the camera's axis
    const behind = along < 1 / f.d;
    const sample: MoonSample = {
      position: p,
      distance: D,
      cx,
      cy,
      r,
      inFront: along > 0,
      unhidden: unhidden(behind, Math.hypot(cx - px, cy - py), s, r),
      amount,
    };
    const u = this.material.uniforms;
    (u.uAxis!.value as Vector3).set(dx / D, dy / D, dz / D);
    u.uGamma0!.value = Math.asin(Math.min(1, MOON.radius / D));
    u.uEdgeAng!.value = MOON.edgePx / focal;
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
