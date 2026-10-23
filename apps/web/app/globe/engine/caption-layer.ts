/**
 * The caption as objects in the globe's space (docs/web-architecture.md, "Orbiting type"; the maths is engine/caption.ts).
 *
 * Each line is a strip of the shell `CAPTION.radius` on a REAL parallel of the globe, with a texture of its words (a few faces and weights on one
 * baseline: the reading serif, its italic, the site's mono, a handwriting), STACKED `CAPTION.slices` times from the front face back towards the
 * planet: the front face shows the letters in the face colour with a thin outline, the slices behind it are the side of the letters (a short,
 * retro extrusion that costs one small geometry and no layout). Nothing is laid out or rasterised per frame: the words are drawn once into one
 * small canvas per line (a size class), the colours are uniforms (a theme change is no rebuild), and a frame is a rotation per line about the
 * earth's axis (the view's longitude and the entrance's turn).
 *
 * Drawn crisp: by a second `WebGLRenderer` onto a canvas of its own at the device's resolution, over the globe's (same camera, same rectangle, same
 * edge mask), with the planet in it as a depth-only sphere so the planet still hides what is behind it. Depth-tested and drawn from both sides: a letter
 * past the shell's horizon is seen from behind (mirrored, as a ring of type round a planet is), curls back and goes behind the planet's body.
 *
 * Nothing runs while the lines are hidden, and at rest the frame loop is asked for nothing: only an entrance or a departure animates.
 */
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  AddEquation,
  CustomBlending,
  DoubleSide,
  FrontSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  MaxEquation,
  OneFactor,
  OneMinusSrcAlphaFactor,
  Mesh,
  MeshBasicMaterial,
  type PerspectiveCamera,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  WebGLRenderer,
} from "three";
import type { GlobeTheme } from "./colors";
import {
  CAPTION_FACE,
  CAPTION_FACES,
  CAPTION_FALLBACK_STYLE,
  CAPTION_STYLES,
  CaptionMotion,
  DRIFT,
  captionColors,
  hex,
  captionFont,
  dimPresence,
  entranceStart,
  lineHidden,
  lineOf,
  shellXY,
  shellY,
  fitScale,
  minScaleFor,
  parallelPoint,
  placeEgg,
  placeRows,
  planPieces,
  runsText,
  spanOf,
  cycleMs,
  unitBand,
  BAND_COLUMNS,
  type CaptionContent,
  type CaptionExit,
  type CaptionLine,
  type CaptionPiece,
  type CaptionRun,
  type CaptionStyleKey,
  type Placement,
  eggMs,
} from "./caption";
import { CINEMATIC, cinematicForced, notePlayed, planForPage } from "./cinematic";
import { buildWordGeometry } from "./cinematic-word";
import { prepareSound, SOUND, startSound, type SoundHandle } from "./cinematic-sound";
import { OCCLUDER_RADIUS } from "./materials";
import { CAPTION, ENERGY } from "./tuning";

const DEG_ = Math.PI / 180;

/** The slice counts a strip is drawn with. */
const SLICE_STEPS = [2, 3, 4, 6, 8, 12, 16, 20, 28] as const;
/** The interlude's word is far thicker than the rows: its strips go on from there (made only when an interlude is planned). */

/**
 * One unit strip serves every line (`unitBand`: `position` is `(u, v, layer)`), and the line's parallel is a handful of uniforms: where the strip
 * is on the globe is computed here, so a change of the camera's tilt, which moves every line to another parallel, is a few uniforms and no new
 * geometry. The formula is `bandPoint` (engine/caption.ts, tested).
 */
const VERT = /* glsl */ `
  uniform float uBaseLat;
  uniform float uBelow;
  uniform float uAbove;
  uniform float uHalfSpan;
  uniform float uR;
  uniform float uDepth;
  varying vec2 vUv;
  varying float vLayer;
  void main() {
    vUv = position.xy;
    vLayer = position.z;
    float lat = uBaseLat - uBelow + position.y * (uBelow + uAbove);
    float a = (position.x * 2.0 - 1.0) * uHalfSpan;
    float rs = uR - uDepth * (1.0 - position.z);
    float cl = cos(lat);
    vec3 p = rs * vec3(cl * sin(a), sin(lat), cl * cos(a));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

/**
 * The texture holds the glyph's inside in its green channel and its outline in the red one; coverage is its alpha (the edge's). Output is
 * premultiplied and blended over (the material): the inside's alpha is exactly 1. The front face is the face colour inside and the outline colour on the outline; every slice behind it is
 * the side colour (the letters' thickness).
 */
const FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uMap;
  uniform vec3 uFace;
  uniform vec3 uOutline;
  uniform vec3 uSide;
  uniform vec3 uAccent;
  uniform vec3 uAccentOutline;
  uniform vec3 uAccentSide;
  uniform float uEdgeLayer;
  varying vec2 vUv;
  varying float vLayer;
  void main() {
    vec4 t = texture2D(uMap, vUv, ${CAPTION.lodBias.toFixed(2)});
    if (t.a < 0.02) discard;
    bool front = vLayer > 0.999;
    // red is the outline, green the inside of a word in the text tone; blue marks a word picked out (its inside is blue alone, its outline red AND
    // blue): the whole letter, face, contour and thickness, takes the accent's colours, each derived from it as the neutral ones are from the neutral face
    bool acc = t.b > 0.5;
    bool isOutline = acc ? t.r > 0.5 : t.r > t.g;
    vec3 face = acc ? uAccent : uFace;
    vec3 outl = acc ? uAccentOutline : uOutline;
    vec3 side = acc ? uAccentSide : uSide;
    // a row seen from behind (past the horizon, curling back towards the planet) is the thickness' tone whole: the back of the type is quieter than its face
    vec3 col = !gl_FrontFacing ? side : (front ? (isOutline ? outl : face) : (vLayer < uEdgeLayer ? face : side));
    // Premultiplied output, blended "over" (see the material): the glyph's inside is exactly 1, so an interior pixel is exactly opaque whatever
    // stacks behind it; only an edge is partly transparent (and then properly premultiplied: no bright fringe).
    float a = smoothstep(0.1, 0.9, t.a);
    gl_FragColor = vec4(col * a, a);
  }
`;

/**
 * The interlude's word (engine/cinematic-word.ts): solid letters, one mesh. A vertex is the strip's `(u, v, z)`; the normal is in `(east, north,
 * radial)`, turned here into the world's at the vertex's own longitude and latitude and then into the camera's (`normalMatrix`), where the light is.
 */
const EGG_VERT = /* glsl */ `
  uniform float uBaseLat;
  uniform float uBelow;
  uniform float uAbove;
  uniform float uHalfSpan;
  uniform float uR;
  uniform float uDepth;
  attribute float kind;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vKind;
  void main() {
    float lat = uBaseLat - uBelow + position.y * (uBelow + uAbove);
    float a = (position.x * 2.0 - 1.0) * uHalfSpan;
    float rs = uR - uDepth * (1.0 - position.z);
    float cl = cos(lat);
    float sl = sin(lat);
    float ca = cos(a);
    float sa = sin(a);
    vec3 p = rs * vec3(cl * sa, sl, cl * ca);
    vec3 east = vec3(ca, 0.0, -sa);
    vec3 north = vec3(-sl * sa, cl, -sl * ca);
    vec3 radial = vec3(cl * sa, sl, cl * ca);
    vNormal = normalMatrix * (normal.x * east + normal.y * north + normal.z * radial);
    vKind = kind;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vView = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

/**
 * Lit like polished metal: a key light and a weak fill fixed in the camera's frame (`CINEMATIC.light`), and a REFLECTION of a studio, a procedural
 * environment of the reflected direction in the camera's frame: a bright sky over a darker band just under the horizon and a dimmer floor, with two
 * soft boxes. The reflected direction changes across a face with the view (the vector to the fragment, not one for the whole word), so a flat face
 * is a sweep of light and shade, not one tone; `metal` is how much of the surface is the reflection (the albedo tints it: white metal, blue
 * metal, grey metal).
 */
const EGG_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uFace;
  uniform vec3 uOutline;
  uniform vec3 uSide;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vKind;
  vec3 studio(vec3 r) {
    float h = r.y;
    vec3 sky = mix(vec3(0.78, 0.84, 0.94), vec3(1.0), smoothstep(0.0, 0.9, h));
    vec3 floorTone = vec3(0.38, 0.4, 0.45);
    vec3 c = mix(floorTone, sky, smoothstep(-0.3, 0.12, h));
    float band = (h + 0.1) / 0.13;
    c *= 1.0 - 0.38 * exp(-band * band);
    c += 1.1 * pow(max(dot(r, normalize(vec3(-0.55, 0.62, 0.56))), 0.0), 18.0);
    c += 0.6 * pow(max(dot(r, normalize(vec3(0.62, 0.28, 0.73))), 0.0), 30.0);
    return c;
  }
  void main() {
    vec3 n = normalize(vNormal);
    vec3 albedo = vKind < 0.5 ? uFace : (vKind < 1.5 ? uOutline : uSide);
    vec3 key = normalize(vec3(${CINEMATIC.light.key.map((x) => x.toFixed(3)).join(", ")}));
    vec3 fill = normalize(vec3(${CINEMATIC.light.fill.map((x) => x.toFixed(3)).join(", ")}));
    float diff = max(dot(n, key), 0.0);
    float fil = max(dot(n, fill), 0.0);
    vec3 h = normalize(key + vec3(0.0, 0.0, 1.0));
    float spec = pow(max(dot(n, h), 0.0), ${CINEMATIC.light.shininess.toFixed(1)}) * ${CINEMATIC.light.specular.toFixed(3)} * (vKind < 1.5 ? 1.0 : 0.6);
    vec3 lit = albedo * (${CINEMATIC.light.ambient.toFixed(3)} + ${CINEMATIC.light.diffuse.toFixed(3)} * diff + ${CINEMATIC.light.filler.toFixed(3)} * fil);
    vec3 refl = albedo * studio(reflect(normalize(vView), n)) * ${CINEMATIC.light.reflect.toFixed(3)};
    vec3 col = mix(lit, refl, ${CINEMATIC.light.metal.toFixed(3)}) + vec3(spec);
    gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
  }
`;

/**
 * The dimming of the whole block: one quad in the screen's own tangent space (the camera on the planet's axis: a point's `(x, y) / -z`), sized to
 * the ellipse's box, drawn BEFORE the letters in the caption's canvas. Clipped to the planet's disc (so never over the ring, the labels or the
 * page), a smooth falloff to zero at the ellipse's edge, in the page's colour, premultiplied.
 */
const DIM_VERT = /* glsl */ `
  uniform vec2 uCentre;
  uniform vec2 uRadii;
  varying vec2 vT;
  void main() {
    vT = uCentre + position.xy * uRadii;
    // ndc = P00 t - P02 (the projection may carry a view offset)
    gl_Position = vec4(projectionMatrix[0][0] * vT.x - projectionMatrix[2][0], projectionMatrix[1][1] * vT.y - projectionMatrix[2][1], 0.0, 1.0);
  }
`;
const DIM_FRAG = /* glsl */ `
  precision highp float;
  uniform vec2 uCentre;
  uniform vec2 uRadii;
  uniform float uDisc;
  uniform float uAlpha;
  uniform vec3 uColor;
  varying vec2 vT;
  void main() {
    vec2 q = (vT - uCentre) / uRadii;
    float e = 1.0 - smoothstep(0.0, 1.0, length(q));
    float inside = 1.0 - smoothstep(uDisc * 0.985, uDisc, length(vT));
    float a = uAlpha * e * e * inside;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor * a, a);
  }
`;
/** The per-row band: on the row's parallel at the planet's surface, the strip widened, a falloff across and along it. */
const BAND_VERT = /* glsl */ `
  uniform float uBaseLat;
  uniform float uBelow;
  uniform float uAbove;
  uniform float uHalfSpan;
  uniform float uR;
  varying vec2 vUv;
  void main() {
    vUv = position.xy;
    float lat = uBaseLat - uBelow + position.y * (uBelow + uAbove);
    float a = (position.x * 2.0 - 1.0) * uHalfSpan;
    float cl = cos(lat);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(uR * vec3(cl * sin(a), sin(lat), cl * cos(a)), 1.0);
  }
`;
const BAND_FRAG = /* glsl */ `
  precision highp float;
  uniform float uAlpha;
  uniform vec3 uColor;
  uniform float uEndFrac;
  varying vec2 vUv;
  void main() {
    float across = 1.0 - smoothstep(0.0, 1.0, abs(vUv.y * 2.0 - 1.0));
    float along = smoothstep(0.0, uEndFrac, min(vUv.x, 1.0 - vUv.x));
    float a = uAlpha * across * across * along;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

/** The `set` of the big row of the cinematic interlude (engine/cinematic.ts): not a phrase set, not a fixed row. */
const EGG = -2;

/** One drawn strip: a row of a phrase set (`set` >= 0: it takes its turn) or a fixed row (`set` -1). Built once, all of them, ahead of time. */
interface Variant {
  row: number;
  set: number;
  piece: CaptionPiece;
  /** Where it is now (rewritten in place as the camera tilts). */
  line: CaptionLine;
  mesh: Mesh;
  material: ShaderMaterial;
  /** The slice count the strip is drawn with now. */
  n: number;
  /** The dimming band of the row (mode `bands`): turned with the row. */
  band: Mesh;
  bandMaterial: ShaderMaterial;
}

interface Built {
  /** The solver's piece of each row: the widest variant's box (so the row's chord is the worst case of the sets). */
  pieces: CaptionPiece[];
  /** The cap height each row is meant to have before the CSS-px floor (it follows the planet's size: `replan`). */
  nominal: number[];
  places: Placement[];
  variants: Variant[];
  /** How many rows take turns (the first ones); the rest are fixed. */
  slotRows: number;
  /** The static fit of the block (`fitScale`: 1 unless a row would not fit its chord inside the band). */
  scale: number;
  /** The big row of the cinematic interlude: its piece, its own placement (on its own, higher shell, centred on the equator, as large as it may be: `placeEgg`) and how far behind the planet it starts. Null: no interlude is planned. */
  egg: { piece: CaptionPiece; place: Placement; start: number } | null;
  key: string;
}

export interface CaptionState {
  built: boolean;
  phase: string;
  /** The caption canvas's opacity now (a fade runs it from 1 to 0). */
  opacity: number;
  wrapped: boolean;
  scale: number;
  viewLat: number;
  /** The latitude the rows' parallels are centred on: always the equator (0): they are fixed, whatever the camera does. */
  parallelsFor: number;
  capCells: number;
  seed: number | null;
  lines: { text: string; parent: number; theta: number; visible: boolean; halfSpanDeg: number; baseLat: number; capR: number; side: number; styles: string[] }[];
  /**
   * The phrase sets that take turns: how many, which one the first row shows, whether any row is on its way in or out of its set (a swap is on),
   * the first row's cycle count, the side each row came in from (`lastIn`) and goes out by (`lastOut`) in its current cycle.
   */
  cycle: { sets: number; current: number; swapping: boolean; waiting: boolean; paused: boolean; swaps: number; lastOut: number[]; lastIn: number[] };
  /** The cinematic interlude: planned, under way, how many levels of zoom the globe is pulled back by, the big row's turn (radians; null: not on the stage) and whether its strip is drawn. */
  egg: { planned: boolean; active: boolean; zoomOut: number; theta: number | null; drawn: boolean; slices: number; depth: number; dpr: number };
  /** The baselines' latitudes of the rows now in view, top to bottom (degrees). */
  baselines: number[];
  texture: { width: number; height: number }[];
  colors: { face: number[]; accent: number[]; accentOutline: number[]; accentSide: number[]; outline: number[]; side: number[] };
}

/**
 * Where the crisp canvas lays itself (CSS px, on the stage): a window of the globe's own canvas round the planet (the caption never leaves it:
 * a quarter of the pixels of the whole canvas, and multisampled), and the globe's edge mask, offset to follow.
 */
export interface CaptionRect {
  w: number;
  h: number;
  left: number;
  top: number;
  mask: string;
  /** The globe canvas's own size, and where the window is in it: the mask's frame. */
  full: { w: number; h: number };
  at: { x: number; y: number };
}

/** The second canvas: its own renderer and scene, with the planet in it as a depth-only sphere. Throws when no second context can be had. */
class CrispCanvas {
  readonly scene = new Scene();
  private renderer: WebGLRenderer;
  private lost = false;
  private shown = false;
  /** What was last written to the canvas and its style: a frame writes only what changed (a size change clears the buffer and re-runs layout). */
  private last = { w: -1, h: -1, dpr: -1, left: NaN, top: NaN, mask: "", pos: "", size: "" };

  constructor(host: HTMLElement, onRestore: () => void) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    this.renderer.setClearColor(0x000000, 0);
    const el = this.renderer.domElement;
    el.setAttribute("aria-hidden", "true");
    // (above the hero's text plate, which is a wash over the lower half of the planet for the hero's own text: under it the caption would
    // fade to nothing at the bottom; below the credits, the panel and the header. The canvas takes no pointer events.)
    Object.assign(el.style, { position: "absolute", pointerEvents: "none", display: "block", visibility: "hidden", zIndex: "15" } satisfies Partial<CSSStyleDeclaration>);
    host.append(el);
    el.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.lost = true;
      this.hide();
    });
    el.addEventListener("webglcontextrestored", () => {
      // Three re-creates its GL state and re-uploads textures, geometry and programs lazily on the next render; the clear colour is part of
      // what it drops, and the size is kept by the canvas itself. A frame is asked for: nothing else would draw the lines again.
      this.renderer.setClearColor(0x000000, 0);
      this.last.w = -1;
      this.lost = false;
      onRestore();
    });
    // The planet, in the depth buffer only: what is behind it is not drawn.
    const globe = new Mesh(new SphereGeometry(OCCLUDER_RADIUS, 96, 48), new MeshBasicMaterial({ colorWrite: false }));
    globe.renderOrder = -1;
    this.scene.add(globe);
  }

  render(camera: PerspectiveCamera, rect: CaptionRect, dpr: number): void {
    if (this.lost) return;
    const r = this.renderer;
    const el = r.domElement;
    const L = this.last;
    const w = Math.round(rect.w);
    const h = Math.round(rect.h);
    if (w !== L.w || h !== L.h || dpr !== L.dpr) {
      // (setPixelRatio re-runs setSize: only when something changed; the drawing buffer is floor(size * ratio) and nothing here compares otherwise)
      r.setPixelRatio(dpr);
      r.setSize(w, h, false);
      L.w = w;
      L.h = h;
      L.dpr = dpr;
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
    }
    if (rect.left !== L.left) {
      el.style.left = `${rect.left}px`;
      L.left = rect.left;
    }
    if (rect.top !== L.top) {
      el.style.top = `${rect.top}px`;
      L.top = rect.top;
    }
    const pos = `${-rect.at.x}px ${-rect.at.y}px`;
    const size = `${rect.full.w}px ${rect.full.h}px`;
    if (rect.mask !== L.mask || pos !== L.pos || size !== L.size) {
      for (const [k, v] of [["mask-image", rect.mask], ["mask-position", pos], ["mask-size", size], ["mask-repeat", "no-repeat"]] as const) {
        el.style.setProperty(k, v);
        el.style.setProperty(`-webkit-${k}`, v);
      }
      L.mask = rect.mask;
      L.pos = pos;
      L.size = size;
    }
    r.render(this.scene, camera);
    if (!this.shown) {
      el.style.visibility = "";
      this.shown = true;
    }
  }

  /** Waits for the GPU to finish this canvas's frame (a 1 x 1 read back): checks and measurements only. */
  finish(): void {
    const gl = this.renderer.getContext();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.probe);
  }
  private probe = new Uint8Array(4);

  /** Upload a texture now (its first use would do it in the middle of a frame: the first time a phrase set comes round). */
  warm(tex: CanvasTexture): void {
    this.renderer.initTexture(tex);
  }

  hide(): void {
    if (!this.shown) return;
    this.renderer.domElement.style.visibility = "hidden";
    this.shown = false;
  }

  /**
   * The canvas fades out: a CSS opacity transition, run by the compositor (no JS and no frame of its own: the canvas goes on being drawn with the
   * camera while it fades, so the words stay locked to the globe). `restore` puts it back at once for the next entrance.
   */
  fadeOut(ms: number): void {
    const el = this.renderer.domElement;
    el.style.transition = `opacity ${ms}ms linear`;
    el.style.opacity = "0";
  }

  restore(): void {
    const el = this.renderer.domElement;
    el.style.transition = "none";
    el.style.opacity = "1";
  }

  /** The canvas's opacity now (checks). */
  get opacity(): number {
    return Number(getComputedStyle(this.renderer.domElement).opacity);
  }

  get maxAnisotropy(): number {
    return this.renderer.capabilities.getMaxAnisotropy();
  }

  dispose(): void {
    this.scene.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as MeshBasicMaterial).dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}

/**
 * One load per style, shared by the builds (`document.fonts` keeps what is added: a retry must not add the same file again). The promise says
 * whether the face is usable within `FONT_WAIT_MS`; a style whose face is not falls back (`CAPTION_FALLBACK_STYLE`) so the texture is never drawn
 * in a stand-in that then changes. A NEGATIVE answer is never kept: the next build asks again (and the layer asks once more after a build that
 * used a fallback, `buildLines`), so a slow network costs the face a late arrival and not the page's life.
 */
const STYLE_LOADS = new Map<CaptionStyleKey, Promise<boolean>>();
const ADDED_FACES = new Map<CaptionStyleKey, FontFace>();
const FONT_WAIT_MS = 3000;

const SAMPLE = "AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz .,;:!?'·-";

async function tryLoadStyle(style: CaptionStyleKey): Promise<boolean> {
  const st = CAPTION_STYLES[style];
  const face = CAPTION_FACES[st.face];
  try {
    if (typeof document === "undefined" || !document.fonts) return false;
    const url = st.url ?? face.url;
    if (url) {
      let added = ADDED_FACES.get(style);
      if (!added) {
        added = new FontFace(face.family.replace(/"/g, ""), `url(${url})`, { weight: String(st.weight), style: st.italic ? "italic" : "normal", display: "block" });
        ADDED_FACES.set(style, added);
        document.fonts.add(added);
      }
      try {
        await added.load();
        return true;
      } catch {
        // (a face that failed is taken out, so the retry makes a new one)
        document.fonts.delete(added);
        ADDED_FACES.delete(style);
        return false;
      }
    }
    const font = captionFont(style, 64);
    await document.fonts.load(font, SAMPLE);
    return document.fonts.check(font, SAMPLE);
  } catch {
    return false;
  }
}

function loadStyle(style: CaptionStyleKey): Promise<boolean> {
  let p = STYLE_LOADS.get(style);
  if (!p) {
    let timer = 0;
    const timeout = new Promise<boolean>((resolve) => {
      timer = window.setTimeout(() => resolve(false), FONT_WAIT_MS);
    });
    p = Promise.race([tryLoadStyle(style), timeout]).then((ok) => {
      window.clearTimeout(timer);
      if (!ok) STYLE_LOADS.delete(style);
      return ok;
    });
    STYLE_LOADS.set(style, p);
  }
  return p;
}

export class CaptionLayer {
  private motion = new CaptionMotion();
  private built: Built | null = null;
  private textures: CanvasTexture[] = [];
  private texSizes: { width: number; height: number }[] = [];
  /** The three colours of the theme's caption, shared by every strip's material. */
  private face = { value: [1, 1, 1] as number[] };
  private outline = { value: [0, 0, 0] as number[] };
  private side = { value: [0, 0, 0] as number[] };
  private accent = { value: [0, 0, 1] as number[] };
  private accentOutline = { value: [0, 0, 1] as number[] };
  private accentSide = { value: [0, 0, 1] as number[] };
  /** The cinematic interlude's word has colours of its own (`CINEMATIC`): a white face, a BSoD blue outline, grey sides that darken with depth and are lit from the upper left. */
  private eggFace = { value: [1, 1, 1] as number[] };
  private eggOutline = { value: [0.7, 0.5, 0.1] as number[] };
  private eggSide = { value: [0.5, 0.5, 0.5] as number[] };
  /** The far slices (layer below this) that carry the text colour in mode `edge` (0: none). */
  private edgeLayer = { value: 0 };
  /** Slices of the thickness now (the quality governor lowers them; `CAPTION.slices` is the best) and the most the canvas is drawn at. */
  private slices: number = CAPTION.slices;
  private dprCap: number = ENERGY.captionDpr;
  private sideMode: "page" | "mix" | "edge" = CAPTION.colors.sideMode;
  private theme!: GlobeTheme;
  /** The dimming's colour (the page's), its strength for the scheme, and the mode (`CAPTION.dim.mode`; a check may change it). */
  private dimColor = { value: [1, 1, 1] as number[] };
  private dimAlpha = 0;
  private dimMode: "ellipse" | "bands" | "none" = CAPTION.dim.mode;
  /** The block's ellipse (one quad, mode `ellipse`) and its uniforms. */
  private ellipse: Mesh | null = null;
  private ellipseU = { uCentre: { value: [0, 0] as number[] }, uRadii: { value: [1, 1] as number[] }, uDisc: { value: 0.1 }, uAlpha: { value: 0 }, uColor: this.dimColor };
  /** Whether a build that used a fallback face has asked once more for the real one. */
  private retried = false;
  /** A build that threw (a canvas context refused, ...): the caption is not there and asks for no frames. */
  private failed = false;
  private disposed = false;
  private want = false;
  private reduced: boolean;
  private token = 0;
  private crisp: CrispCanvas;
  private tmp = new Matrix4();
  private lastThetas: number[] = [];
  private allHidden = false;
  private anyVisible = false;
  /** The art cell, the planet's radius at the lowest zoom (CSS px) and the camera's distance there: what decides the cap heights and where an entrance starts. */
  private sizing: { cell: number; r: number; d: number } | null = null;
  private viewLat = 28;
  /** The strip every line shares (`unitBand`). */
  private units = new Map<number, BufferGeometry>();
  /** Checks only: the shell's radius, in place of `CAPTION.radius` (1.001 puts the caption on the surface, over the graticule's own parallels). */
  private radius: number | null = null;
  /** The key of the build in flight (a frame that sees the layout out of date must not start the same build again). */
  private building: string | null = null;
  /** The phrase set each row shows now (of those that take turns): the cycle it is in, modulo the sets; refreshed every frame. */
  private rowSet: number[] = [];
  /** The phrase set the parked rows show (-1: not parked) and the shift the roll goes on with after a park (so the same set stays on). */
  private parkSet = -1;
  private setShift = 0;
  private rowCycle: number[] = [];
  private paused = false;

  /** Throws when the second WebGL canvas cannot be had: the page then has no caption (the hero's how-to line shows). */
  constructor(
    private opts: {
      /** What it says: phrase sets that take turns in the upper rows, and the rows that stay under them. */
      content: CaptionContent;
      /** The element the caption's canvas goes into (the globe's stage). */
      host: HTMLElement;
      theme: GlobeTheme;
      reduced: boolean;
      maxAnisotropy: number;
      /** The lines are built, or a swap is to begin: a frame is wanted. */
      onChange(): void;
    },
  ) {
    this.reduced = opts.reduced;
    this.motion.continuous = !opts.reduced;
    this.crisp = new CrispCanvas(opts.host, () => opts.onChange());
    // Each entrance draws the sides the lines come in from at random, from a seed of the session.
    this.motion.seed = (Math.random() * 0x7fffffff) | 0;
    // Rarely, and only for a visitor who has been here before, the words give way to one big one for a while (engine/cinematic.ts).
    this.motion.egg = opts.content.sets.length + opts.content.fixed.length > 0 ? planForPage(this.motion.seed, opts.reduced) : null;
    // (the sound is fetched now, long before it plays; it begins with the interlude, and lets go when it ends, or is cut short)
    if (this.motion.egg) prepareSound();
    this.motion.onCinematic = () => {
      notePlayed();
      const shape = this.motion.egg?.shape ?? CINEMATIC.shape;
      this.swell = startSound(eggMs(shape));
      // (it began inside the caption's own frame, and that loop is the roll's, which ends here: the interlude is the globe's own frames, so ask for one)
      this.opts.onChange();
    };
    // (the interlude is over, by itself or cut short by a gesture: the sound lets go over its own fade, whatever is left of the file)
    this.motion.onCinematicEnd = () => {
      this.swell?.fade(SOUND.fadeCutMs);
      this.swell = null;
    };
    // With `?cinematic` the owner can play it again at will: the key U (a key press is a gesture that lets the browser play the sound, and does not
    // leave the presentation, as a click on the globe does)
    if (this.motion.egg && cinematicForced() && typeof window !== "undefined") {
      this.onKey = (e: KeyboardEvent) => {
        if (e.key.toLowerCase() !== "u" || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
        const t = e.target as HTMLElement | null;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        this.playInterlude();
      };
      window.addEventListener("keydown", this.onKey);
      console.info("[interlude] ?cinematic: press U to play it now (a key press also lets the browser play its sound)");
    }
    this.motion.onResume = () => {
      // (the showing begins again from its first phrase set)
      this.parkSet = -1;
      this.setShift = 0;
      this.opts.onChange(); // (the entrance is the globe's own loop's: a frame is wanted)
    };
    this.setTheme(opts.theme);
  }

  /**
   * The interlude's word: a lit, opaque, culled mesh (engine/cinematic-word.ts), no blending and no slices. It takes the same placement uniforms as a
   * row's strip (`place` writes them for every variant) and the colours of its own (`setTheme`).
   */
  private makeEggMaterial(radius: number): ShaderMaterial {
    return new ShaderMaterial({
      vertexShader: EGG_VERT,
      fragmentShader: EGG_FRAG,
      uniforms: {
        uFace: this.eggFace,
        uOutline: this.eggOutline,
        uSide: this.eggSide,
        uBaseLat: { value: 0 },
        uBelow: { value: 0 },
        uAbove: { value: 0 },
        uHalfSpan: { value: 0 },
        uR: { value: radius },
        uDepth: { value: CAPTION.depth },
      },
      side: FrontSide,
      depthTest: true,
      depthWrite: true,
      transparent: false,
    });
  }

  /** The dimming band of a row (mode `bands`): the same strip, on the planet's surface, widened; max-blended so overlapping bands never add. */
  private makeBandMaterial(): ShaderMaterial {
  return new ShaderMaterial({
      vertexShader: BAND_VERT,
      fragmentShader: BAND_FRAG,
      uniforms: {
        uBaseLat: { value: 0 },
        uBelow: { value: 0 },
        uAbove: { value: 0 },
        uHalfSpan: { value: 0 },
        uR: { value: OCCLUDER_RADIUS + 0.004 },
        uAlpha: { value: 0 },
        uColor: this.dimColor,
        uEndFrac: { value: 0.35 },
      },
      side: FrontSide,
      depthTest: true,
      depthWrite: false,
      transparent: false,
      blending: CustomBlending,
      blendEquation: MaxEquation,
      blendSrc: OneFactor,
      blendDst: OneFactor,
    });
  }

  private makeMaterial(map: CanvasTexture, radius: number): ShaderMaterial {
    return new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uMap: { value: map },
        uFace: this.face,
        uOutline: this.outline,
        uSide: this.side,
        uAccent: this.accent,
        uAccentOutline: this.accentOutline,
        uAccentSide: this.accentSide,
        uEdgeLayer: this.edgeLayer,
        uBaseLat: { value: 0 },
        uBelow: { value: 0 },
        uAbove: { value: 0 },
        uHalfSpan: { value: 0 },
        uR: { value: radius },
        uDepth: { value: CAPTION.depth },
      },
      // Both sides: past the shell's horizon a row is seen from behind (its glyphs mirrored, as a ring of type round a planet is), curls back
      // towards the planet and goes behind its body (the occluder in the depth buffer); it never vanishes in the open.
      side: DoubleSide,
      depthTest: true,
      depthWrite: true,
      // NOT alpha-to-coverage: it wrote each sample's own partial alpha (the frontmost slice's edge texel), which left the thickness translucent
      // (the owner saw the globe's linework through it). The slices are drawn back to front and blended over one another, premultiplied: where
      // anything opaque is behind, the result is opaque, and only the silhouette's edge is partial.
      transparent: false,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
    });
  }

  /**
   * Where the caption will be seen: the art cell, the planet's radius at the lowest zoom (CSS px) and the camera's distance there (the renderer
   * tells at start and when the viewport changes). The lines are built when it is known and again only when what they depend on changes.
   */
  setSizing(cell: number, r: number, d: number): void {
    if (this.disposed || !(cell > 0) || !(r > 0) || !(d > 1)) return;
    const prev = this.sizing;
    this.sizing = { cell, r, d };
    if (!this.built) {
      void this.build();
      return;
    }
    // (the texture does not depend on the size: only the parallels and the floor of the letters' size do)
    if (!prev || prev.r !== r || prev.d !== d || prev.cell !== cell) this.replan();
  }

  /** The planet's size or the camera's distance changed: the letters' floor and the parallels are worked out again; no texture is made again. */
  private replan(): void {
    const b = this.built;
    const sizing = this.sizing;
    if (!b || !sizing) return;
    const floorCap = CAPTION.minCapPx / sizing.r;
    b.pieces.forEach((p, i) => {
      p.cap = Math.max(b.nominal[i]!, floorCap);
    });
    for (const v of b.variants) v.piece.cap = v.set === EGG ? v.piece.cap : b.pieces[v.row]!.cap;
    this.place();
    this.motion.setStarts(
      b.pieces.map((_, r) => this.rowStart(r)),
      b.pieces.map((_, r) => r),
    );
    this.opts.onChange();
  }

  /** Checks only: lay the lines on a shell of this radius (null: the tuned one); the lines are built again. */
  setRadius(r: number | null): void {
    this.radius = r;
    if (this.built) this.replan();
    else void this.build();
  }

  /** Checks and captures: the seed of the sides the lines come in from (null: all from the east), drawn again at once. */
  setSeed(seed: number | null): void {
    this.motion.reseed(seed);
  }

  setTheme(theme: GlobeTheme): void {
    this.theme = theme;
    const c = captionColors(theme, this.sideMode);
    this.face.value = [...c.face];
    this.outline.value = [...c.outline];
    this.side.value = [...c.side];
    this.accent.value = [...c.accent];
    this.accentOutline.value = [...c.accentOutline];
    this.accentSide.value = [...c.accentSide];
    this.edgeLayer.value = this.sideMode === "edge" ? (CAPTION.colors.edgeSlices - 0.5) / (this.slices - 1) : 0;
    this.dimColor.value = [...theme.background];
    const dark = 0.2126 * theme.background[0] + 0.7152 * theme.background[1] + 0.0722 * theme.background[2] < 0.5;
    this.eggFace.value = [...hex(CINEMATIC.face)];
    this.eggOutline.value = [...hex(dark ? CINEMATIC.outline.dark : CINEMATIC.outline.light)];
    this.eggSide.value = [...hex(dark ? CINEMATIC.sideColor.dark : CINEMATIC.sideColor.light)];
    this.dimAlpha = dark ? CAPTION.dim.alpha.dark : CAPTION.dim.alpha.light;
  }

  /**
   * The quality governor's rung: the canvas's pixel ratio cap and the most slices the thickness is drawn with. The strips are drawn with only as
   * many slices as their SIDE needs (`slicesFor`: a step of under a pixel between two of them), so the cap matters only at the sides of the orbit.
   */
  setQuality(dpr: number, slices: number): void {
    this.dprCap = dpr;
    this.slices = Math.max(2, Math.min(CAPTION.slices, slices));
    this.opts.onChange();
  }

  /** The strip with `n` slices (made once, shared by every row). */
  private unitFor(n: number): BufferGeometry {
    let g = this.units.get(n);
    if (!g) {
      const unit = unitBand(BAND_COLUMNS, n);
      g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(unit.attributes, 3));
      g.setIndex(new BufferAttribute(unit.indices, 1));
      this.units.set(n, g);
    }
    return g;
  }

  /**
   * How many slices a row needs: the thickness (`CAPTION.depth` planet radii) projected sideways at the row's far end is `depth * sin(psi)` planet
   * radii, `psi` the central angle from the view's axis; one slice per `CAPTION.sliceStepPx` of it, at least the front and the back, at most the
   * governor's cap. A row at rest, within a few degrees of the middle, sees its side edge-on and a small fraction of a pixel wide: a handful of
   * slices instead of 28 (every slice is a full pass over the glyphs: the GPU cost of the caption at rest was that overdraw).
   */
  private slicesFor(theta: number, halfSpan: number, baseLat: number, lat: number): number {
    const vl = lat * DEG_;
    const L = baseLat * DEG_;
    const cos = Math.sin(vl) * Math.sin(L) + Math.cos(vl) * Math.cos(L) * Math.cos(Math.min(Math.PI, Math.abs(theta) + halfSpan));
    const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
    const n = Math.ceil((CAPTION.depth * (this.sizing?.r ?? 300) * sin) / CAPTION.sliceStepPx) + 1;
    // (quantised to a few strips, all made when the strips are built: a row going round the orbit changes its count by a step, and no strip is
    // first made, or first used, in the middle of an exit)
    for (const step of SLICE_STEPS) if (step >= n && step <= this.slices) return step;
    return Math.max(2, Math.min(this.slices, SLICE_STEPS.filter((x) => x <= this.slices).at(-1) ?? this.slices));
  }

  /** How far the globe has pulled back for the cinematic interlude, 0 to 1 (see `zoomOutLevels`), and when it was last read. */
  private zoomK = 0;
  private zoomAt = -1;
  private onKey: ((e: KeyboardEvent) => void) | null = null;

  /** The cinematic interlude is under way (the rows are leaving, the word is on, or the globe is coming back). */
  get interluding(): boolean {
    return this.motion.eggActive;
  }

  /**
   * The globe is pulled back or leaning, or the interlude is under way: the picture is not at the place the page's own camera says it is. What is
   * placed from that camera (the boxes, the labels) waits until this is over, or it appears where the planet will be and not where it is.
   */
  get pulledBack(): boolean {
    return this.motion.eggActive || this.zoomK > 0;
  }

  /**
   * How present the flat ring of type is now, 1 to 0: it is gone while the globe is pulled back (it would run through the word's orbit), out over the
   * first fifth of the pull and back over the last fifth of the way home, whether the interlude ran its course or was cut short.
   */
  ringShare(): number {
    const x = Math.min(1, this.zoomK * 5);
    return 1 - x * x * (3 - 2 * x);
  }

  /** Play the interlude now (the key U with `?cinematic`): false when it cannot (the rows are not rolling, or one is under way, or there is none planned). */
  playInterlude(retries = 6): boolean {
    const b = this.built;
    if (this.disposed || this.failed || !b || !b.egg || this.motion.eggActive) return false;
    // (one that has played is spent: a new plan, the same as the first)
    this.motion.egg ??= { n: 0, shape: { ...CINEMATIC.shape }, side: CINEMATIC.side };
    const ok = this.motion.replayEgg(performance.now());
    if (ok) this.opts.onChange();
    // (the key press is an input: it wakes a caption the idle hold had stopped, and the rows are rolling again a moment later: ask again)
    else if (retries > 0) {
      window.clearTimeout(this.replayTimer);
      this.replayTimer = window.setTimeout(() => this.playInterlude(retries - 1), 500);
    }
    return ok;
  }
  private replayTimer = 0;

  /** The sound of the interlude under way (engine/cinematic-sound.ts), if one is playing. */
  private swell: SoundHandle | null = null;

  /**
   * How many levels of zoom the globe is pulled back by now (0 when there is no interlude under way): the renderer subtracts it from the zoom it
   * draws with, so the planet, the ring and the caption shrink together, smoothly. During the interlude it is the timeline's own value
   * (`CaptionMotion.eggZoom`); once the interlude is over or was cut short (a gesture) it gives the size back at a fixed pace.
   */
  zoomOutLevels(): number {
    const shape = this.motion.egg?.shape ?? CINEMATIC.shape;
    if (this.motion.eggActive) {
      this.zoomK = this.motion.eggZoom();
      this.zoomAt = -1;
    } else if (this.zoomK > 0) {
      const now = performance.now();
      const dt = this.zoomAt < 0 ? 0 : Math.min(now - this.zoomAt, 64);
      this.zoomAt = now;
      this.zoomK = Math.max(0, this.zoomK - dt / shape.zoomCutMs);
    }
    return this.zoomK * shape.zoomLevels;
  }

  /**
   * How far the picture leans now, radians (0 outside the interlude): the pull-back's own eased value times the tilt, so the planet leans in as it
   * pulls back and comes upright as it comes back (and as it gives the size back when a gesture cuts the interlude short). Read after `zoomOutLevels`.
   */
  rollRad(): number {
    return this.zoomK > 0 ? this.zoomK * ((CINEMATIC.tiltDeg * Math.PI) / 180) : 0;
  }

  /** The radius of the shell a strip is on: the rows' own, or the cinematic word's higher one. */
  private radiusOf(v: Pick<Variant, "set">): number {
    return v.set === EGG ? CINEMATIC.radius : (this.radius ?? CAPTION.radius);
  }

  /** The largest shell the caption draws on (the renderer sizes the second canvas to the shell's silhouette). */
  get maxRadius(): number {
    return Math.max(this.radius ?? CAPTION.radius, this.built?.egg ? CINEMATIC.radius : 0);
  }

  /** The quality now (checks). */
  get quality(): { dpr: number; slices: number } {
    return { dpr: this.dprCap, slices: this.slices };
  }

  /**
   * The idle settle: every row eases to the middle, fully visible, all of them showing one phrase set (the one a row that is in view shows), and
   * stays there. Returns whether a park began (the caption is rolling); `parkDone` says when it has arrived.
   */
  park(now: number): boolean {
    const b = this.built;
    if (!b || !this.drifting || this.motion.eggActive) return false;
    let chosen = this.rowSet[0] ?? 0;
    for (let r = 0; r < b.slotRows; r++) {
      if (Math.abs(this.lastThetas[r] ?? 9) <= DRIFT.amp * 1.5) {
        chosen = this.rowSet[r] ?? 0;
        break;
      }
    }
    this.parkSet = chosen;
    this.motion.beginPark(now);
    return true;
  }

  get parkDone(): boolean {
    return this.motion.parkDone;
  }

  /** Leave the park: the rows blend from the middle into the roll, which goes on with the set they were showing. */
  unpark(now: number): void {
    if (this.parkSet < 0) return;
    this.motion.unpark(now);
    this.setShift = this.parkSet;
    this.parkSet = -1;
    this.opts.onChange();
  }

  /** The roll stands still (the energy pass's hold): the clock stops, the loops end, the composition stays. */
  setFrozen(on: boolean): void {
    this.motion.frozen = on;
  }

  /**
   * The vertical extent of everything the caption draws, in the camera's tangent space (planet radii at the focal length) for a camera at
   * latitude `lat`: the rows' top and bottom edges over their whole parallels (the orbit takes a row all the way round, so every longitude
   * counts) and the dimming's ellipse. The second canvas is sized to it (`ENERGY.captionWindow` `band`). Null before the strips exist.
   */
  extentTan(lat: number): { top: number; bottom: number } | null {
    const b = this.built;
    const sizing = this.sizing;
    if (!b || !sizing || b.pieces.length === 0) return null;
    let top = -Infinity;
    let bottom = Infinity;
    const rows = b.pieces.map((pc, i) => ({ pc, pl: b.places[i]!, r: this.radius ?? CAPTION.radius }));
    const all = b.egg ? [...rows, { pc: b.egg.piece, pl: b.egg.place, r: CINEMATIC.radius }] : rows;
    for (const { pc, pl, r } of all) {
      const up = Math.min(89.5, pl.baseLat + (pl.capR * pc.box.aboveCaps) / r / DEG_);
      const dn = Math.max(-89.5, pl.baseLat - (pl.capR * pc.box.belowCaps) / r / DEG_);
      for (let a = -Math.PI; a <= Math.PI + 1e-9; a += Math.PI / 12) {
        top = Math.max(top, shellY(a, up, lat, sizing.d, r));
        bottom = Math.min(bottom, shellY(a, dn, lat, sizing.d, r));
      }
    }
    if (this.dimMode === "ellipse" && this.dimAlpha > 0) {
      const c = this.ellipseU.uCentre.value[1]!;
      const ry = this.ellipseU.uRadii.value[1]!;
      top = Math.max(top, c + ry);
      bottom = Math.min(bottom, c - ry);
    }
    return { top, bottom };
  }

  /** Checks and captures: the dimming's mode (null: the tuned one). The strips are made for every mode, so it is a switch and no rebuild. */
  setDimMode(mode: "ellipse" | "bands" | "none" | null): void {
    this.dimMode = mode ?? CAPTION.dim.mode;
    this.opts.onChange();
  }

  /** Checks and captures: the thickness's look (`page`, `mix`, `edge`; null: the tuned one). */
  setSideMode(mode: "page" | "mix" | "edge" | null): void {
    this.sideMode = mode ?? CAPTION.colors.sideMode;
    this.setTheme(this.theme);
    this.opts.onChange();
  }

  setReduced(on: boolean): void {
    this.reduced = on;
    // (still, at the centre, the first phrase set: no roll, no turns)
    this.motion.continuous = !on;
    if (on) this.motion.egg = null; // (reduced motion never plays it)
    if (on) this.motion.settle(this.want);
    this.opts.onChange();
  }

  /**
   * The page cannot be looked at (the tab is hidden, the globe is not drawn, the context is lost): the roll and the phrase sets stand still (the
   * clock advances only when a frame is drawn, by at most `drift.maxStepMs`) and they go on from where they were when it can be.
   */
  setPaused(on: boolean): void {
    this.paused = on;
  }

  get isParking(): boolean {
    return this.motion.isParking;
  }

  /** The showcase begins (`now`: the clock reading) or, before the first frame exists, `null`: the entrance then starts with the first frame. */
  show(now: number | null): void {
    this.want = true;
    this.parkSet = -1;
    this.setShift = 0;
    this.crisp.restore();
    // every showing begins with the first phrase set, whole (the entrance restarts the clock)
    if (this.reduced) this.motion.settle(true);
    else this.motion.enter(now);
  }

  /**
   * The showcase ends. By default the caption FADES (an interaction's exit: only the canvas's opacity changes, the lines keep following the
   * camera); `"orbit"` sends the lines on round behind the planet instead (kept for a caption that cycles its words). Reduced motion: gone at once.
   * Once the fade is over nothing of the caption runs: no placement (the parallels are solved again by the first frame of the next showing, when
   * the camera's tilt has changed meanwhile), no render call, no depth pass. The roll is frozen where it is for the fade (the clock stands still
   * in a fade), so the words fade where they were.
   */
  hide(now: number, exit: CaptionExit = "fade"): void {
    this.want = false;
    if (this.reduced) {
      this.motion.settle(false);
      this.crisp.hide();
      return;
    }
    this.motion.leave(now, exit);
    if (exit === "fade" && this.motion.phase === "fade") this.crisp.fadeOut(CAPTION.fadeMs);
  }

  /**
   * The globe is not drawn for a while (the street map owns the view): every timed thing runs to its end now, so nothing of the caption asks for a
   * frame (`animating` and `drifting` are false while it lasts): an entrance is in place (or the caption is gone, when the showcase is off). The
   * roll's clock goes on from where it was when the globe is drawn again.
   */
  settle(): void {
    this.zoomK = 0; // (the pull-back is a timed thing too: nothing is drawn for it to run in)
    this.motion.settle(this.want);
  }

  /** Checks and captures: hold the entrance at `ms` after its start; null lets it run (or rest) again. */
  pin(ms: number | null): void {
    this.motion.pinned = ms;
  }

  /** Checks and captures: hold every line at `deg` degrees east of its place (null releases it). */
  pinAngle(deg: number | null): void {
    this.motion.pinnedAngle = deg === null ? null : (deg * Math.PI) / 180;
  }

  /** The entrance or the orbit exit is under way: full frames (the globe's own loop) are wanted. */
  get animating(): boolean {
    return this.built !== null && !this.failed && (this.motion.animating || this.zoomK > 0);
  }

  /** The rows are in and rolling (or turning over to the next phrase set): the caption's own capped loop draws it, nothing else. */
  get drifting(): boolean {
    return this.built !== null && !this.failed && !this.disposed && this.motion.drifting && this.visible;
  }

  get isBuilt(): boolean {
    return this.built !== null;
  }

  /**
   * Checks and captures: carry on at the start of the first row's exit now (the rows then leave, one `staggerMs` after another, and the next
   * phrase set comes in). Returns whether there is a next set to come in.
   */
  swapNow(now: number): boolean {
    const b = this.built;
    if (!b || b.slotRows < 1 || this.opts.content.sets.length < 2 || this.reduced || !this.want) return false;
    const { n } = this.motion.cycle(now, 0);
    this.motion.seek(Math.max(0, n) * cycleMs() + CAPTION.enter.ms + CAPTION.cycle.dwellMs);
    this.opts.onChange();
    return true;
  }

  /* ------------------------------ per frame ------------------------------ */

  /**
   * Per frame, after the camera is current: turn every line to where the clock has it. `lon` and `lat` are the view's longitude and latitude
   * (degrees: the lines are centred on the view's meridian; their parallels are FIXED, on the equator's side, and never move for the camera's
   * tilt: `lat` is only the camera's, for what is hidden and for where the dimming sits), `d` the camera's distance, `now` the clock the
   * entrance runs on (the same one `show` and `hide` were given).
   */
  sync(d: number, lon: number, lat: number, now: number): void {
    this.viewLat = lat;
    const b = this.built;
    if (!b || this.failed) return;
    if (this.motion.waiting) this.motion.begin(now, CAPTION.enter.loadDelayMs);
    // A fade changes the canvas's opacity only (a CSS transition, run by the compositor): the lines go on following the camera exactly as at rest
    // (zoom, drag, tilt: the same uniforms and one render a frame the globe draws anyway), and when it is over the caption is hidden.
    this.motion.tick(now);
    const hiddenNow = this.motion.phase === "hidden" && this.motion.pinned === null && this.motion.pinnedAngle === null;
    // Hidden (the showcase is off and the lines have gone): every mesh is hidden once, and then there is nothing to do, whatever the camera does.
    if (hiddenNow) {
      if (!this.allHidden) {
        for (const v of b.variants) v.mesh.visible = v.band.visible = false;
        if (this.ellipse) this.ellipse.visible = false;
        this.allHidden = true;
        this.anyVisible = false;
        this.lastThetas.length = b.pieces.length;
        for (let r = 0; r < b.pieces.length; r++) this.lastThetas[r] = this.rowStart(r) * this.motion.side(r);
      }
      return;
    }
    this.allHidden = false;
    const rows = b.pieces.length;
    const rowTheta = this.lastThetas;
    rowTheta.length = rows;
    this.rowSet.length = rows;
    this.rowCycle.length = rows;
    const nSets = Math.max(1, this.opts.content.sets.length);
    for (let r = 0; r < rows; r++) {
      rowTheta[r] = this.motion.angle(now, r, this.rowStart(r));
      // the phrase set a row shows is the cycle it is in (modulo the sets): the row leaves, and the next set comes in on the same parallel
      const n = this.motion.continuous && r < b.slotRows ? this.motion.cycle(now, r).n : 0;
      this.rowCycle[r] = Math.max(0, n);
      this.rowSet[r] = r < b.slotRows && this.parkSet >= 0 ? this.parkSet : (Math.max(0, n) + this.setShift) % nSets;
    }
    let any = false;
    const bands = this.dimMode === "bands" && this.dimAlpha > 0;
    let presence = 0;
    let eggPresence = 0;
    let eggTheta: number | null = null;
    if (b.egg) {
      // (for any camera distance: the globe is pulled back while it lasts)
      b.egg.start = entranceStart({ baseLat: b.egg.place.baseLat, halfSpan: b.egg.place.halfSpan }, this.viewLat, undefined, CINEMATIC.radius);
      this.motion.setEggStart(b.egg.start);
      eggTheta = this.motion.eggTheta();
    }
    for (const v of b.variants) {
      let theta = 0;
      let on = false;
      let start = 0;
      if (v.set === EGG) {
        if (eggTheta !== null) {
          theta = eggTheta;
          start = b.egg!.start;
          on = true;
        }
      } else if (v.set < 0) {
        theta = rowTheta[v.row]!;
        start = this.rowStart(v.row);
        on = true;
      } else if (v.set === this.rowSet[v.row]) {
        theta = rowTheta[v.row]!;
        start = this.rowStart(v.row);
        on = true;
      }
      const hidden = !on || lineHidden(theta, v.line, d, lat, this.radiusOf(v));
      v.mesh.visible = !hidden;
      v.band.visible = false;
      if (hidden) continue;
      any = true;
      const p = dimPresence(theta, start);
      if (v.set === EGG) eggPresence = p;
      else presence += p;
      // The earth's axis is y: a line's own meridian is the view's (`lon`), turned by the entrance's `theta` (east positive, west negative).
      this.tmp.makeRotationY((lon * Math.PI) / 180 + theta);
      v.mesh.matrix.copy(this.tmp);
      v.mesh.matrixWorldNeedsUpdate = true;
      // only as many slices as the side of the letters needs from here (the interlude's word is a solid mesh: no slices)
      const ns = v.set === EGG ? v.n : this.slicesFor(theta, v.line.halfSpan, v.line.baseLat, lat);
      if (ns !== v.n) {
        v.n = ns;
        v.mesh.geometry = this.unitFor(ns);
      }
      if (bands && p > 0.01) {
        v.band.visible = true;
        v.band.matrix.copy(this.tmp);
        v.band.matrixWorldNeedsUpdate = true;
        v.bandMaterial.uniforms.uAlpha!.value = this.dimAlpha * p;
      }
    }
    // The block's ellipse: its strength is the mean presence of the rows (a row that is on its way in or out is half of one).
    if (this.ellipse) {
      const rowsE = presence / Math.max(1, b.pieces.length);
      const egg = eggPresence > rowsE;
      const e = this.dimMode === "ellipse" && this.dimAlpha > 0 ? Math.max(rowsE, eggPresence) : 0;
      this.ellipse.visible = e > 0.01;
      if (this.ellipse.visible) this.updateEllipse(lat, egg);
      this.ellipseU.uAlpha.value = this.dimAlpha * Math.min(1, e);
      this.ellipseU.uDisc.value = 1 / Math.sqrt(Math.max(1.0001, d * d - 1));
    }
    this.anyVisible = any;
  }

  /** How far behind the planet row `r` (its widest variant) starts, for its parallel now. */
  private rowStart(r: number): number {
    const b = this.built!;
    const pl = b.places[r]!;
    return entranceStart({ baseLat: pl.baseLat, halfSpan: pl.halfSpan }, this.viewLat, this.sizing?.d ?? 16);
  }

  /**
   * Put the rows on their fixed parallels (`placeRows`, at the static fit `fitScale`) and hand every strip its uniforms. Runs when the strips are
   * built and when the planet's size or the camera's distance changes: never for the camera's tilt.
   */
  private place(): void {
    const b = this.built;
    const sizing = this.sizing;
    if (!b || !sizing) return;
    b.scale = fitScale(b.pieces, sizing.d, minScaleFor(b.pieces, sizing.r));
    placeRows(b.pieces, sizing.d, b.scale, b.places);
    if (b.egg) {
      // the big row alone, on its own higher shell: as large as its chord allows (never under twice the others' cap, never over `maxCapScale`)
      const floorCap = CAPTION.minCapPx / sizing.r;
      b.egg.place = placeEgg(b.egg.piece.box, sizing.d, CINEMATIC.radius, {
        fill: Math.min(CINEMATIC.fill, (CINEMATIC.maxHalfScreen * (this.opts.host.clientWidth || Infinity)) / sizing.r),
        minCap: Math.max(CINEMATIC.capScale * CAPTION.capR, floorCap),
        maxCap: CINEMATIC.maxCapScale * CAPTION.capR,
        ampRad: ((this.motion.egg?.shape ?? CINEMATIC.shape).ampDeg * Math.PI) / 180,
      });
    }
    // (the word's thickness is a share of its own cap height, and changes with its size)
    for (const v of b.variants) if (v.set === EGG) v.material.uniforms.uDepth!.value = b.egg!.place.capR * CINEMATIC.depthCaps;
    for (const v of b.variants) {
      const pl = v.set === EGG ? b.egg!.place : b.places[v.row]!;
      // the row's parallel and size, the strip's own width: a set's row is as wide as its words
      const rv = this.radiusOf(v);
      lineOf(v.piece, { ...pl, halfSpan: spanOf(v.piece.box.widthEm, pl.capR, pl.baseLat, rv) / 2 }, v.line, rv);
      const u = v.material.uniforms;
      u.uBaseLat!.value = (v.line.baseLat * Math.PI) / 180;
      u.uBelow!.value = v.line.below;
      u.uAbove!.value = v.line.above;
      u.uHalfSpan!.value = v.line.halfSpan;
      u.uR!.value = rv;
      // the band: the row's strip, widened (the falloff reaches `bandReach` half heights across, a little beyond the words along)
      const bu = v.bandMaterial.uniforms;
      const mid = (v.line.above - v.line.below) / 2;
      const half = ((v.line.above + v.line.below) / 2) * CAPTION.dim.bandReach;
      bu.uBaseLat!.value = u.uBaseLat!.value + mid;
      bu.uBelow!.value = half;
      bu.uAbove!.value = half;
      bu.uHalfSpan!.value = v.line.halfSpan * 1.12 + half;
    }
    this.updateEllipse(this.viewLat);
  }

  /**
   * The ellipse's centre and radii (tangent space of a camera on the axis: what `shellXY` and `shellY` return) from the block's ink: the widest
   * row's ends and the top and bottom edges over the middle, for the camera at latitude `lat` (the fixed parallels move on the screen with the
   * camera's tilt; the ellipse follows them: four rows of trigonometry a frame, only while it is drawn).
   */
  private updateEllipse(lat: number, egg = false): void {
    const b = this.built;
    const sizing = this.sizing;
    if (!b || !sizing || b.pieces.length === 0) return;
    const r = this.radius ?? CAPTION.radius;
    // the rows' block, or the cinematic interlude's one big row
    const rr = egg && b.egg ? CINEMATIC.radius : r;
    const pieces = egg && b.egg ? [b.egg.piece] : b.pieces;
    const places = egg && b.egg ? [b.egg.place] : b.places;
    const n = pieces.length;
    let halfW = 0;
    const xy: [number, number] = [0, 0];
    for (let i = 0; i < n; i++) {
      const pl = places[i]!;
      halfW = Math.max(halfW, Math.abs(shellXY(Math.min(pl.halfSpan, Math.PI / 2), pl.baseLat, lat, sizing.d, rr, xy)[0]));
    }
    const f = pieces[0]!;
    const l = pieces[n - 1]!;
    const topLat = places[0]!.baseLat + (places[0]!.capR * f.box.aboveCaps) / rr / DEG_;
    const botLat = places[n - 1]!.baseLat - (places[n - 1]!.capR * l.box.belowCaps) / rr / DEG_;
    const top = shellY(0, Math.min(89.5, topLat), lat, sizing.d, rr);
    const bottom = shellY(0, Math.max(-89.5, botLat), lat, sizing.d, rr);
    const hh = Math.max(1e-4, (top - bottom) / 2);
    const hw = Math.max(1e-4, halfW);
    const k = Math.SQRT2 * (1 + CAPTION.dim.reach);
    this.ellipseU.uCentre.value = [0, (top + bottom) / 2];
    this.ellipseU.uRadii.value = [hw * k, hh * k];
  }

  /** Whether any line is in view now (as of the last `sync`): the renderer draws the second canvas only then (one flag, no work at rest or hidden). */
  get visible(): boolean {
    return this.anyVisible && this.built !== null && !this.failed;
  }

  /** Draw the caption over the globe's frame. */
  /** The pixel ratio the caption's canvas was last drawn at (the word's slices are counted in device pixels). */
  private dprNow = 2;

  renderCrisp(camera: PerspectiveCamera, rect: CaptionRect, dpr: number): void {
    this.dprNow = dpr;
    if (!this.anyVisible || !this.built || this.failed) {
      this.crisp.hide();
      return;
    }
    this.crisp.render(camera, rect, Math.min(dpr, ENERGY.captionDpr, this.dprCap));
  }

  /**
   * The two ends of the line the widest on the screen, in the globe's frame where the line is now (positions at its baseline, turned as the mesh
   * is): for the checks that measure the caption's size on the screen. Null when no line is in view.
   */
  widestEnds(): { left: [number, number, number]; right: [number, number, number] } | null {
    const b = this.built;
    if (!b) return null;
    let best: Variant | null = null;
    for (const v of b.variants) if (v.mesh.visible && (!best || v.line.halfSpan > best.line.halfSpan)) best = v;
    if (!best) return null;
    const line = best.line;
    const m = best.mesh.matrix.elements;
    const at = (a: number): [number, number, number] => {
      const p = parallelPoint(a, line.baseLat, this.radiusOf(best!));
      return [m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2], m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2], m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2]];
    };
    return { left: at(-line.halfSpan), right: at(line.halfSpan) };
  }

  /**
   * The edges of every strip in view, in the globe's frame as drawn (the top edge and the bottom edge of the ink box, `samples` + 1 points each):
   * for the checks that measure the caption's real layout on the screen (clearances between rows, where the block sits).
   */
  edges(samples = 16): { row: number; top: [number, number, number][]; bottom: [number, number, number][]; base: [number, number, number][] }[] {
    const b = this.built;
    if (!b) return [];
    const out: { row: number; top: [number, number, number][]; bottom: [number, number, number][]; base: [number, number, number][] }[] = [];
    for (const v of b.variants) {
      if (!v.mesh.visible) continue;
      const m = v.mesh.matrix.elements;
      const r = this.radiusOf(v);
      const turn = (p: [number, number, number]): [number, number, number] => [m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2], m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2], m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2]];
      const top: [number, number, number][] = [];
      const bottom: [number, number, number][] = [];
      const base: [number, number, number][] = [];
      for (let k = 0; k <= samples; k++) {
        const a = (-1 + (2 * k) / samples) * v.line.halfSpan;
        top.push(turn(parallelPoint(a, v.line.baseLat + (v.line.above * 180) / Math.PI, r)));
        bottom.push(turn(parallelPoint(a, v.line.baseLat - (v.line.below * 180) / Math.PI, r)));
        base.push(turn(parallelPoint(a, v.line.baseLat, r)));
      }
      out.push({ row: v.row, top, bottom, base });
    }
    return out;
  }

  /** Checks and measurements: wait for the second canvas's GPU work (a read back). */
  finishGpu(): void {
    this.crisp.finish();
  }

  /** The globe is not drawn (the street map owns the view): the second canvas must not show a stale frame. */
  hideCrisp(): void {
    this.crisp.hide();
  }

  state(): CaptionState {
    const b = this.built;
    const shown = (b?.variants ?? []).filter((v) => (v.set === EGG ? v.mesh.visible : v.set < 0 || v.set === (this.rowSet[v.row] ?? 0)));
    const slot = b?.slotRows ?? 0;
    const inSides: number[] = [];
    const outSides: number[] = [];
    for (let r = 0; r < slot; r++) {
      const side = this.motion.sideAt(this.rowCycle[r] ?? 0, r);
      inSides.push(side);
      outSides.push(-side);
    }
    const phases = [...Array(slot).keys()].map((r) => this.motion.cycle(0, r).local);
    const swapping = this.motion.continuous && phases.some((l, r) => (this.rowCycle[r] ?? 0) > 0 && l < CAPTION.enter.ms + 1e-9) || phases.some((l) => l > CAPTION.enter.ms + CAPTION.cycle.dwellMs);
    return {
      built: b !== null,
      phase: this.motion.phase,
      opacity: this.crisp.opacity,
      wrapped: false,
      scale: b?.scale ?? 1,
      viewLat: this.viewLat,
      parallelsFor: 0,
      capCells: this.sizing ? (CAPTION.capR * this.sizing.r) / this.sizing.cell : 0,
      seed: this.motion.seed,
      egg: { planned: this.motion.egg !== null, active: this.motion.eggActive, zoomOut: this.zoomK * (this.motion.egg?.shape ?? CINEMATIC.shape).zoomLevels, theta: this.motion.eggTheta(), drawn: (b?.variants ?? []).some((v) => v.set === EGG && v.mesh.visible), slices: (b?.variants ?? []).find((v) => v.set === EGG)?.n ?? 0, depth: (b?.variants ?? []).find((v) => v.set === EGG)?.material.uniforms.uDepth!.value ?? 0, dpr: this.dprNow },
      lines: shown.map((v) => ({
        text: v.line.text,
        parent: v.row,
        theta: this.lastThetas[v.row] ?? 0,
        visible: v.mesh.visible,
        halfSpanDeg: (v.line.halfSpan * 180) / Math.PI,
        baseLat: v.line.baseLat,
        capR: v.line.capR,
        side: this.motion.side(v.row),
        styles: [...new Set(v.line.runs.map((r) => r.style ?? "plain"))],
      })),
      cycle: { sets: this.opts.content.sets.length, current: this.rowSet[0] ?? 0, swapping, waiting: false, paused: this.paused, swaps: this.rowCycle[0] ?? 0, lastOut: outSides, lastIn: inSides },
      baselines: shown.map((v) => v.line.baseLat),
      texture: this.texSizes,
      colors: { face: this.face.value, accent: this.accent.value, accentOutline: this.accentOutline.value, accentSide: this.accentSide.value, outline: this.outline.value, side: this.side.value },
    };
  }

  dispose(): void {
    if (this.disposed) return;
    if (this.onKey) window.removeEventListener("keydown", this.onKey);
    window.clearTimeout(this.replayTimer);
    this.swell?.fade(150); // (the globe goes away mid-interlude: so does its sound)
    this.swell = null;
    this.disposed = true;
    this.token++;
    this.release();
    for (const g of this.units.values()) g.dispose();
    this.units.clear();
    this.ellipse?.geometry.dispose();
    (this.ellipse?.material as ShaderMaterial | undefined)?.dispose();
    this.ellipse = null;
    this.crisp.dispose();
    this.built = null;
  }

  /** Take the strips out of the scene and free what they hold (texture, per-strip material). */
  private release(): void {
    for (const v of this.built?.variants ?? []) {
      this.crisp.scene.remove(v.mesh);
      this.crisp.scene.remove(v.band);
      v.material.dispose();
      v.bandMaterial.dispose();
      if (v.set === EGG) v.mesh.geometry.dispose(); // (the word's own mesh: the rows' strips are shared, `units`)
    }
    for (const t of this.textures) t.dispose();
    this.textures = [];
    this.texSizes = [];
    this.allHidden = false;
    this.anyVisible = false;
  }

  /* ------------------------------ building ------------------------------ */

  private keyFor(): string {
    // The texture depends on the words and the faces only (a size class of its own, `texCap`): never on the planet's size, the cell, the camera's
    // distance or the shell's radius (a window resize used to rebuild every texture at each whole pixel of the radius).
    return "texture";
  }

  private async build(): Promise<void> {
    const key = this.keyFor();
    if (this.building === key || this.built?.key === key) return;
    this.building = key;
    const token = ++this.token;
    try {
      await this.buildLines(token);
    } catch {
      // Anything the browser refuses (a 2D context, a texture): the caption is not there, quietly, and it asks for no frames.
      if (token === this.token && !this.disposed) {
        this.release();
        this.built = null;
        this.failed = true;
      }
    } finally {
      if (this.building === key) this.building = null;
    }
  }

  private async buildLines(token: number): Promise<void> {
    if (!this.sizing) return;
    const key = this.keyFor();
    if (this.built?.key === key) return;
    const content = this.opts.content;
    // The faces first: the texture is drawn once and must not be drawn in a stand-in. A style whose face failed is drawn in its fallback style.
    const used = new Set<CaptionStyleKey>();
    for (const set of content.sets) for (const row of set) for (const r of row) used.add(r.style ?? "plain");
    for (const row of content.fixed) for (const r of row) used.add(r.style ?? "plain");
    const planned = this.motion.egg !== null;
    const ok = new Map<CaptionStyleKey, CaptionStyleKey>();
    await Promise.all(
      [...used].map(async (style) => {
        const loaded = await loadStyle(style);
        ok.set(style, loaded ? style : (CAPTION_FALLBACK_STYLE[style] ?? "plain"));
      }),
    );
    if (this.disposed || token !== this.token) return;
    // (capitals are the caption's drawing: the words the app gave, and the page's text, are as they were)
    // (the calligraphic script is exempt: its capitals read badly all together, "Poetry" stays as the page spells it; so does its fallback's case)
    const clean = (row: readonly CaptionRun[]): CaptionRun[] =>
      row
        .filter((r) => r.text.length > 0)
        .map((r) => {
          const asked = r.style ?? "plain";
          const style = ok.get(asked) ?? "plain";
          return { text: CAPTION.upper && CAPTION_STYLES[asked].face !== "script" ? r.text.toLocaleUpperCase("en") : r.text, style, ...(r.accent ? { accent: r.accent } : {}) } as CaptionRun;
        });
    const sets = content.sets.map((set) => set.map(clean).filter((row) => row.some((r) => r.text.trim().length > 0)));
    const fixed = content.fixed.map(clean).filter((row) => row.some((r) => r.text.trim().length > 0));
    const slotRows = sets.reduce((a, s) => Math.max(a, s.length), 0);
    if (slotRows + fixed.length === 0) return;
    // the big row of the cinematic interlude (only when one is planned: no texture is made for nothing)
    const eggRuns = planned ? clean([{ text: CINEMATIC.word }]) : null;
    // (the word is a solid mesh made from baked outlines: no face to load, no texture to draw; its box comes with the mesh)
    const eggWord = planned ? buildWordGeometry({ bevelCaps: CINEMATIC.bevelCaps, depthCaps: CINEMATIC.depthCaps }) : null;
    this.failed = false;
    const emPx = CAPTION.texCap / CAPTION_FACE.capEm;
    const probe = document.createElement("canvas").getContext("2d");
    if (!probe) throw new Error("no 2D context");
    const hasSpacing = "letterSpacing" in probe;
    const outlinePx = CAPTION.outline * CAPTION.texCap;
    const faceOf = (run: CaptionRun) => CAPTION_FACES[CAPTION_STYLES[run.style ?? "plain"].face];
    const emboldenPx = (run: CaptionRun) => (run.embolden ?? faceOf(run).embolden) * CAPTION.texCap;
    /** Set `c`'s font and spacing for a run; the advance of the run (tracking included) is what `measureText` says then. */
    const setRun = (c: CanvasRenderingContext2D, run: CaptionRun) => {
      const f = faceOf(run);
      c.font = captionFont(run.style ?? "plain", emPx);
      if (hasSpacing) (c as unknown as { letterSpacing: string }).letterSpacing = `${f.tracking * emPx * f.scale}px`;
    };
    const advance = (run: CaptionRun, m: TextMetrics) => m.width + (hasSpacing ? 0 : faceOf(run).tracking * emPx * faceOf(run).scale * run.text.length);
    /**
     * The ink of a piece, measured from the faces: where the words start and end on the baseline (a script overhangs its advance, an italic its
     * first glyph's), how high and how low they go, and the room of the outline: the texture and the strip are made to that, not to the advance.
     */
    const boxPx = (runs: readonly CaptionRun[]) => {
      let x = 0;
      let minL = 0;
      let maxR = 0;
      let asc = 0;
      let desc = 0;
      let margin = 0;
      const at: number[] = [];
      for (const run of runs) {
        setRun(probe, run);
        const m = probe.measureText(run.text);
        const f = faceOf(run);
        at.push(x);
        minL = Math.min(minL, x - m.actualBoundingBoxLeft);
        maxR = Math.max(maxR, x + Math.max(advance(run, m), m.actualBoundingBoxRight));
        asc = Math.max(asc, m.actualBoundingBoxAscent - f.dy * emPx);
        desc = Math.max(desc, m.actualBoundingBoxDescent + f.dy * emPx);
        margin = Math.max(margin, outlinePx + emboldenPx(run) / 2 + 3);
        x += advance(run, m);
      }
      return { at, x0: margin - minL, width: maxR - minL + 2 * margin, above: Math.max(asc + margin, CAPTION.texCap * 1.05), below: desc + margin };
    };
    const boxOf = (runs: readonly CaptionRun[]) => {
      const b = boxPx(runs);
      return { widthEm: b.width / emPx, aboveCaps: b.above / CAPTION.texCap, belowCaps: b.below / CAPTION.texCap };
    };
    const measure = (r: CaptionRun) => {
      setRun(probe, r);
      return advance(r, probe.measureText(r.text)) / emPx;
    };
    // every strip there is: the rows of every phrase set and the fixed rows, each with its own texture; the solver sees each row as its widest
    const rowsOf: { row: number; set: number; runs: CaptionRun[] }[] = [];
    for (let s = 0; s < sets.length; s++) for (let r = 0; r < sets[s]!.length; r++) rowsOf.push({ row: r, set: s, runs: sets[s]![r]! });
    fixed.forEach((runs, i) => rowsOf.push({ row: slotRows + i, set: -1, runs }));
    const totalRows = slotRows + fixed.length;
    // (the big row is the last strip, row `totalRows`: the solver and the rows' placements never see it)
    if (eggRuns) rowsOf.push({ row: totalRows, set: EGG, runs: eggRuns });
    const reps: CaptionRun[][] = [];
    for (let r = 0; r < totalRows; r++) {
      const cands = rowsOf.filter((x) => x.row === r);
      reps.push(cands.reduce((best, c) => (boxOf(c.runs).widthEm > boxOf(best.runs).widthEm ? c : best)).runs);
    }
    const nominal = reps.map(() => CAPTION.capR);
    const plan = planPieces({ rows: reps, caps: nominal, measure, box: boxOf, rPx: this.sizing.r });
    // the representative boxes take the largest extent over the variants of the row (the solver's clearance must hold for any of them)
    plan.pieces.forEach((p, r) => {
      for (const c of rowsOf.filter((x) => x.row === r)) {
        const b = boxOf(c.runs);
        p.box = { widthEm: Math.max(p.box.widthEm, b.widthEm), aboveCaps: Math.max(p.box.aboveCaps, b.aboveCaps), belowCaps: Math.max(p.box.belowCaps, b.belowCaps) };
      }
    });
    // The sheets first (they can throw): a rebuild replaces the strips only once the new ones are made.
    const sheets = rowsOf.map((x) => {
      if (x.set === EGG) return { canvas: null, box: eggWord!.box };
      const b = boxPx(x.runs);
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(b.width);
      canvas.height = Math.ceil(b.above + b.below);
      const c = canvas.getContext("2d");
      if (!c) throw new Error("no 2D context");
      c.textBaseline = "alphabetic";
      c.textAlign = "left";
      c.lineJoin = "round";
      c.miterLimit = 2;
      // The words one after the other on one baseline. First the outline (red, drawn at twice its width: the half inside the letter is covered by
      // the fill that follows), then the inside (green): the outline is outside the glyph, so the face keeps its whole area.
      const baseline = b.above;
      for (const pass of ["stroke", "fill"] as const) {
        x.runs.forEach((run, k) => {
          setRun(c, run);
          const f = faceOf(run);
          const px = b.x0 + b.at[k]!;
          const py = baseline + f.dy * emPx;
          if (pass === "stroke") {
            c.lineWidth = outlinePx * 2 + emboldenPx(run);
            // (the outline of a word picked out is red AND blue: the shader reads the blue as "this letter is the accent's")
            c.strokeStyle = run.accent ? "rgb(255 0 255)" : "rgb(255 0 0)";
            c.strokeText(run.text, px, py);
          } else {
            // (the inside is green, or blue for the accent's word: the shader picks the colour by the stronger channel)
            const inside = run.accent ? "rgb(0 0 255)" : "rgb(0 255 0)";
            c.fillStyle = inside;
            c.fillText(run.text, px, py);
            if ((run.embolden ?? f.embolden) > 0) {
              c.lineWidth = emboldenPx(run);
              c.strokeStyle = inside;
              c.strokeText(run.text, px, py);
            }
          }
        });
      }
      return { canvas, box: boxOf(x.runs) };
    });
    this.release();
    this.built = null;
    const anisotropy = Math.min(this.opts.maxAnisotropy, this.crisp.maxAnisotropy);
    const radius = this.radius ?? CAPTION.radius;
    const variants: Variant[] = rowsOf.map((x, i) => {
      const { canvas, box } = sheets[i]!;
      if (x.set === EGG) {
        // the interlude's word: its own mesh and material, no texture
        const mesh = new Mesh(eggWord!.geometry, this.makeEggMaterial(CINEMATIC.radius));
        mesh.matrixAutoUpdate = false;
        mesh.frustumCulled = false;
        mesh.visible = false;
        mesh.renderOrder = 7;
        this.crisp.scene.add(mesh);
        const piece: CaptionPiece = { runs: x.runs, text: runsText(x.runs), parent: x.row, cap: Math.max(CINEMATIC.capScale * CAPTION.capR, CAPTION.minCapPx / this.sizing!.r), box };
        const bandMaterial = this.makeBandMaterial();
        const band = new Mesh(this.unitFor(2), bandMaterial);
        band.matrixAutoUpdate = false;
        band.frustumCulled = false;
        band.visible = false;
        band.renderOrder = -0.5;
        this.crisp.scene.add(band);
        return { row: x.row, set: x.set, piece, line: {} as CaptionLine, mesh, material: mesh.material as ShaderMaterial, n: 2, band, bandMaterial };
      }
      const tex = new CanvasTexture(canvas!);
      tex.generateMipmaps = true;
      tex.minFilter = LinearMipmapLinearFilter;
      tex.magFilter = LinearFilter;
      tex.anisotropy = anisotropy;
      this.textures.push(tex);
      // (uploaded now, with the mipmaps: the first frame of a set that has not been on screen yet would otherwise pay for it)
      this.crisp.warm(tex);
      this.texSizes.push({ width: canvas!.width, height: canvas!.height });
      const material = this.makeMaterial(tex, radius);
      const mesh = new Mesh(this.unitFor(2), material);
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = 7;
      this.crisp.scene.add(mesh);
      const piece: CaptionPiece = { runs: x.runs, text: runsText(x.runs), parent: x.row, cap: plan.pieces[x.row]!.cap, box };
      // the row's dimming band (mode `bands`): the same strip, on the planet's surface, widened; max-blended so overlapping bands never add
      const bandMaterial = this.makeBandMaterial();
      const band = new Mesh(this.unitFor(2), bandMaterial);
      band.matrixAutoUpdate = false;
      band.frustumCulled = false;
      band.visible = false;
      band.renderOrder = -0.5;
      this.crisp.scene.add(band);
      return { row: x.row, set: x.set, piece, line: {} as CaptionLine, mesh, material, n: 2, band, bandMaterial };
    });
    if (!this.ellipse) {
      const quad = new BufferGeometry();
      quad.setAttribute("position", new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
      const m = new ShaderMaterial({ vertexShader: DIM_VERT, fragmentShader: DIM_FRAG, uniforms: this.ellipseU, depthTest: false, depthWrite: false, transparent: false, side: DoubleSide });
      this.ellipse = new Mesh(quad, m);
      this.ellipse.frustumCulled = false;
      this.ellipse.renderOrder = -0.5;
      this.ellipse.visible = false;
      this.crisp.scene.add(this.ellipse);
    }
    for (const n of SLICE_STEPS) this.unitFor(n); // (the CPU side of every strip is made now)
    const eggVariant = variants.find((v) => v.set === EGG);
    this.built = { pieces: plan.pieces, nominal, places: [], variants, slotRows, scale: 1, egg: eggVariant ? { piece: eggVariant.piece, place: { baseLat: 0, capR: 0, halfSpan: 0, y: 0 }, start: Math.PI } : null, key };
    this.place();
    this.motion.setFixedFrom(slotRows);
    this.motion.setStarts(
      plan.pieces.map((_, r) => this.rowStart(r)),
      plan.pieces.map((_, r) => r),
    );
    if (this.want && this.reduced) this.motion.settle(true);
    this.opts.onChange();
    // A face that did not arrive in time is drawn in its fallback now; it is asked for once more, and the strips are made again when it comes.
    const missing = [...ok].filter(([style, used]) => style !== used).map(([style]) => style);
    if (missing.length && !this.retried) {
      this.retried = true;
      void Promise.all(missing.map(loadStyle)).then((all) => {
        if (all.every(Boolean) && !this.disposed && this.built) {
          this.built.key = "stale";
          void this.build();
        }
      });
    }
  }
}
