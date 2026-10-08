/**
 * The sky as Three.js objects: a full-buffer triangle that draws the Milky Way and a `Points` list that draws the stars, both in the
 * globe's own drawing buffer (the art grid), both behind the earth. The maths is engine/sky.ts; docs/web-architecture.md, "Skybox".
 *
 * - The band: per pixel, the view ray (the camera's inverse projection) is turned into galactic coordinates by one matrix and looked up
 *   in the baked band map, multiplied by the fade towards the earth's silhouette and by the layer's timed on/off value, then quantised to
 *   the sky's two palette tones with a 4x4 Bayer dither anchored to the art cell (`toneAt`, the same function in GLSL). A pixel whose tone
 *   is the page colour is discarded: the buffer is already cleared to it.
 * - The stars: one GL point of one buffer pixel each, projected as a direction at infinity (the unit vector, depth 1.0), kept while the
 *   fade exceeds the star's fixed rank (a random thinning towards the earth rather than a dimming).
 * - Both are drawn AFTER the earth's disc with the depth test on and no depth write, at the far plane: the disc's pixels fail the test
 *   before the shader runs, so a zoomed-in globe pays for the sky only where it shows. When the layer is off (`value` 0 at rest) neither
 *   object is visible: no draw call.
 */
import { BufferAttribute, BufferGeometry, ClampToEdgeWrapping, DataTexture, DoubleSide, LinearFilter, Matrix3, type Matrix4, Mesh, Points, RedFormat, RepeatWrapping, type Scene, ShaderMaterial, UnsignedByteType, Vector2, Vector3 } from "three";
import type { GlobeTheme } from "./colors";
import { FadeArray, clockStep } from "./fade";
import { BAYER4, type Mat3, bakeBand, makeStars, skyGeometry, skyTones, skyWanted } from "./sky";
import { SKY } from "./tuning";

const f = (n: number) => n.toFixed(6);

/** The shared GLSL: the fade (a smoothstep, `skyFade`) and the Bayer threshold (`bayerThreshold`). */
const COMMON = /* glsl */ `
  uniform vec2 uCentre; uniform float uRadius; uniform float uFade;
  uniform vec3 uTone1; uniform vec3 uTone2;
  float skyFade(vec2 px) { return smoothstep(${f(SKY.fade.from)}, ${f(SKY.fade.to)}, length(px - uCentre) / uRadius) * uFade; }
`;

const BAYER_GLSL = `const float BAYER[16] = float[16](${BAYER4.map((n) => `${n}.0`).join(", ")});`;

const bandMaterial = () =>
  new ShaderMaterial({
    uniforms: {
      uBand: { value: null },
      uViewToGal: { value: new Matrix3() },
      uProjInv: { value: null },
      uCentre: { value: new Vector2() },
      uRadius: { value: 1 },
      uFade: { value: 1 },
      uTone1: { value: new Vector3() },
      uTone2: { value: new Vector3() },
    },
    depthWrite: false,
    side: DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vNdc;
      void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 1.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uBand; uniform mat3 uViewToGal; uniform mat4 uProjInv;
      ${COMMON}
      ${BAYER_GLSL}
      varying vec2 vNdc;
      const float TAU = 6.283185307;
      void main() {
        float fade = skyFade(gl_FragCoord.xy);
        if (fade <= 0.0) discard;
        vec4 p = uProjInv * vec4(vNdc, 1.0, 1.0);
        vec3 g = uViewToGal * normalize(p.xyz / p.w);
        vec2 uv = vec2(atan(g.y, g.x) / TAU + 0.5, asin(clamp(g.z, -1.0, 1.0)) / ${f((SKY.map.bMaxDeg * Math.PI) / 180)} * 0.5 + 0.5);
        float u = texture2D(uBand, uv).r * fade * 2.0;
        float k = floor(u);
        ivec2 c = ivec2(floor(gl_FragCoord.xy)) & 3;
        k += (u - k > (BAYER[c.y * 4 + c.x] + 0.5) / 16.0) ? 1.0 : 0.0;
        if (k < 0.5) discard;
        gl_FragColor = vec4(k < 1.5 ? uTone1 : uTone2, 1.0);
      }
    `,
  });

const starMaterial = () =>
  new ShaderMaterial({
    uniforms: {
      uViewToGal: { value: new Matrix3() },
      uBuf: { value: new Vector2() },
      uCentre: { value: new Vector2() },
      uRadius: { value: 1 },
      uFade: { value: 1 },
      uTone1: { value: new Vector3() },
      uTone2: { value: new Vector3() },
    },
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute float aTier; attribute float aKeep;
      uniform mat3 uViewToGal; uniform vec2 uBuf;
      ${COMMON}
      varying vec3 vColor;
      void main() {
        vec4 clip = projectionMatrix * vec4(position * uViewToGal, 1.0); // position * M = transpose(M) * position: galactic to view
        vec2 px = (clip.xy / clip.w * 0.5 + 0.5) * uBuf;
        if (clip.w <= 0.0 || aKeep >= skyFade(px)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        gl_Position = vec4(clip.xy, clip.w, clip.w);
        gl_PointSize = 1.0;
        vColor = aTier > 0.5 ? uTone2 : uTone1;
      }
    `,
    fragmentShader: "varying vec3 vColor; void main() { gl_FragColor = vec4(vColor, 1.0); }",
  });

export interface SkyFrame {
  /** The view-space to galactic matrix for this frame (`viewToGalactic`). */
  viewToGal: Mat3;
  /** The camera's inverse projection (the view offset of the inset included). */
  projInv: Matrix4;
  /** Camera distance (globe radius 1), the drawing buffer, and the projection-centre shift in buffer pixels. */
  d: number;
  bufW: number;
  bufH: number;
  shiftBuf: number;
}

export class SkyLayer {
  private band = bandMaterial();
  private stars = starMaterial();
  private geometries: BufferGeometry[] = [];
  private texture: DataTexture;
  private quad: Mesh;
  private points: Points;
  /** The sky is ON or OFF (decided from how much of the picture is sky, with a hysteresis); its value runs to that by time. */
  private fade = new FadeArray(1);
  private on = false;
  private seen = false;
  private lastClock = 0;
  private rhoMax = 0;
  private geo = { cx: 0, cy: 0, radius: 1 };

  constructor(scene: Scene) {
    const { cols, rows } = SKY.map;
    this.texture = new DataTexture(bakeBand(), cols, rows, RedFormat, UnsignedByteType);
    this.texture.magFilter = this.texture.minFilter = LinearFilter;
    this.texture.wrapS = RepeatWrapping;
    this.texture.wrapT = ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.unpackAlignment = 1;
    this.texture.needsUpdate = true;
    this.band.uniforms.uBand!.value = this.texture;

    const tri = new BufferGeometry();
    tri.setAttribute("position", new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.quad = new Mesh(tri, this.band);
    this.quad.renderOrder = 0.5; // after the disc (0), before every line
    this.quad.frustumCulled = false;

    const s = makeStars();
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(s.position, 3));
    g.setAttribute("aTier", new BufferAttribute(s.tier, 1));
    g.setAttribute("aKeep", new BufferAttribute(s.keep, 1));
    this.points = new Points(g, this.stars);
    this.points.renderOrder = 0.6;
    this.points.frustumCulled = false;
    this.geometries.push(tri, g);

    this.quad.visible = this.points.visible = false;
    scene.add(this.quad, this.points);
  }

  applyTheme(t: GlobeTheme) {
    const [dim, bright] = skyTones(t.ramp);
    for (const m of [this.band, this.stars]) {
      (m.uniforms.uTone1!.value as Vector3).set(...dim);
      (m.uniforms.uTone2!.value as Vector3).set(...bright);
    }
  }

  /** Whether the on/off transition has not reached its end: the frame loop must keep going. */
  get animating(): boolean {
    return this.fade.moving;
  }

  /** The layer's timed value (0..1), whether it is wanted and drawn, the farthest corner in earth radii, and the silhouette in buffer px (centre, radius; y up) (checks). */
  state() {
    return { value: this.fade.value(0), on: this.on, rhoMax: this.rhoMax, drawn: this.quad.visible, cx: this.geo.cx, cy: this.geo.cy, radius: this.geo.radius, fadeFrom: SKY.fade.from };
  }

  /** Run the transition to its end (checks). */
  settle() {
    this.fade.settle();
    this.show();
  }

  /** Per frame: decide on/off, advance the timed value, set the uniforms. `now` is the clock (ms) the fade runs on; `instant`: reduced motion. */
  sync(frame: SkyFrame, now: number, instant: boolean) {
    const geo = skyGeometry(frame.d, frame.bufW, frame.bufH, frame.shiftBuf);
    this.rhoMax = geo.rhoMax;
    this.geo = geo;
    this.on = skyWanted(this.on, geo.rhoMax);
    if (!this.seen) {
      this.seen = true; // the first frame starts in its state
      this.fade.snap(0, this.on);
    } else this.fade.set(0, this.on);
    if (this.fade.moving) this.fade.step(clockStep(this.lastClock, now), instant);
    this.lastClock = now;
    this.show();
    if (!this.quad.visible) return;
    const v = this.fade.value(0);
    const m = frame.viewToGal;
    const mat = this.band.uniforms.uViewToGal!.value as Matrix3;
    mat.set(...m);
    (this.stars.uniforms.uViewToGal!.value as Matrix3).copy(mat);
    this.band.uniforms.uProjInv!.value = frame.projInv;
    for (const u of [this.band.uniforms, this.stars.uniforms]) {
      (u.uCentre!.value as Vector2).set(geo.cx, geo.cy);
      u.uRadius!.value = geo.radius;
      u.uFade!.value = v;
    }
    (this.stars.uniforms.uBuf!.value as Vector2).set(frame.bufW, frame.bufH);
  }

  private show() {
    this.quad.visible = this.points.visible = this.fade.value(0) > 0;
  }

  dispose() {
    for (const g of this.geometries) g.dispose();
    this.band.dispose();
    this.stars.dispose();
    this.texture.dispose();
    this.geometries = [];
  }
}
