import type { BufferGeometry, Color, Mesh } from "three";
import { createGroundLight, loadCausticTemplates, type CausticTemplates, type GlassLight } from "./ground-light";
import { clampTone, sameColor } from "./color";
import { layoutGraph, type Matrix } from "./layout";
import { createNeon } from "./neon";
import { renderSize } from "./size";
import { createHoverHum } from "./hover-hum";
import type { ContentBounds, GraphData, GraphOptions, LayerColors, Startup, Tones } from "./types";
import { CAMERA_DIR, glassShades, lightBehind, roomFor, shiftsFromLayers, slabFor } from "./view";

/** How much of the light behind a block of glass the glass takes (the whole of it covering), and the least that is let through however many there are in front. */
const GLASS_ABSORB = 0.45;
const GLASS_FLOOR = 0.3;

/** How many jittered frames are averaged before the picture is final (soft shadows, anti-aliasing): the scene never moves, so it is drawn once, a frame at a time, and then not at all. */
const SAMPLES = 96;

export const DEFAULT_COLORS: { top: LayerColors; bottom: LayerColors } = {
  // each source has its own hue and the level of the day is the brightness: a quiet day is a dim dark shade, a busy one the brightest
  top: { light: [0x0a8f2c, 0x00d63c], dark: [0x0f8a2c, 0x0fbf3e] },
  bottom: { light: [0x1658b8, 0x1a8cff], dark: [0x0f5aa8, 0x1f9bff] },
};

/**
 * How much the device is asked to do: a phone, or a machine with few cores or little memory, gets the light version (a third of the frames, a lower resolution, simpler blocks, a smaller shadow map, a single bloom).
 */
export function resolveLite(lite: "auto" | boolean | undefined): boolean {
  if (typeof lite === "boolean") return lite;
  const nav = navigator as Navigator & { deviceMemory?: number };
  return window.matchMedia("(pointer: coarse)").matches || (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) < 4;
}

/** The page's background as a CSS colour: the option's, or the nearest opaque background above the container, else white (light) or near black (dark). */
function resolveBackground(el: HTMLElement, option: GraphOptions["background"], theme: "light" | "dark"): string {
  const given = typeof option === "function" ? option(theme) : option;
  if (given) return given;
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    const c = getComputedStyle(n).backgroundColor;
    if (c && c !== "transparent" && !/rgba\(.*,\s*0\)$/.test(c)) return c;
  }
  return theme === "dark" ? "#0b0b0e" : "#ffffff";
}

export interface SceneHandle {
  /** Where the blocks are, in CSS pixels of the container (null before the first layout). */
  bounds(): ContentBounds | null;
  stop(): void;
  rethink(recolour?: boolean): void;
  ready: Promise<void>;
}

/**
 * The activity of the year as two matrices of blocks seen from an isometric camera that never moves (the bottom layer at the bottom of each day's column, the top layer on top): the height
 * and the colour of a block follow the intensity of the day. Because nothing moves the picture is progressive: each animation frame renders the scene with the sun a little elsewhere
 * (an area light's soft shadow) and the camera a sub-pixel away (anti-aliasing) and adds it to an accumulation buffer; after `SAMPLES` frames the loop stops and the canvas keeps the
 * result. Translucent rounded blocks (transmission, refraction) lit by a room environment, on a ground that only receives the shadows, so it sits on the page's own background.
 */
export function mountScene(el: HTMLElement, opts: GraphOptions & { data: GraphData }, st: { theme: "light" | "dark" | "auto" }): SceneHandle {
  const api = { stop: () => {}, rethink: (_recolour?: boolean) => {}, bounds: (): ContentBounds | null => null };
  let cancelled = false;
  const dbg = opts.debug ?? {};
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const isDark = () => (st.theme === "auto" ? mq.matches : st.theme === "dark");
  const colorOf = (layer: "top" | "bottom", dark: boolean): Tones => (opts.colors?.[layer]?.[dark ? "dark" : "light"] ?? DEFAULT_COLORS[layer][dark ? "dark" : "light"]);
  el.setAttribute("role", "group");
  el.setAttribute("aria-roledescription", "interactive chart");
  el.setAttribute("aria-label", opts.label ?? "Activity graph, one column a day. Use the arrow keys to move between days.");
  const ready = (async () => {
      const THREE = await import("three");
      const { RoundedBoxGeometry } = await import("three/examples/jsm/geometries/RoundedBoxGeometry.js");
      const { mergeGeometries } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");
      const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
      // The baked light of the dark theme (41 KB): fetched only when the dark theme is on, and a failure only means no baked light (the rods and the glass are drawn without it), never that there is no picture.
      let templates: CausticTemplates | null = null;
      let templatesFailed = false;
      const templatesSource = async () => opts.templatesUrl ?? (await import("./templates-data")).TEMPLATES_DATA_URI;
      const wantTemplates = () => (templatesFailed ? Promise.resolve() : templatesSource().then((url) => loadCausticTemplates(THREE, url)).then((t) => void (templates = t)).catch(() => void (templatesFailed = true)));
      if (isDark()) await wantTemplates();
      if (cancelled) return;

      // Other code on the page may switch three.js's colour management off (it is global: the hex colours and the textures here would then not be converted to linear and the picture would come out far too light).
      // So everything here runs with it on, and puts the switch back as it found it: the page never sees it change (JavaScript does not interleave: the setup runs in one go and the later entry points are wrapped, `cm`).
      const cm = <T,>(fn: () => T): T => {
        const prev = THREE.ColorManagement.enabled;
        THREE.ColorManagement.enabled = true;
        try {
          return fn();
        } finally {
          THREE.ColorManagement.enabled = prev;
        }
      };
      cm(() => {

      const { onReady, onLit, onHover } = opts;
      const strips = opts.strips ?? 1;
      const layout = layoutGraph(opts.data, opts.weeks ?? 53);
      const lite = resolveLite(opts.lite);
      const samples = lite ? 32 : SAMPLES;
      const t0 = performance.now();
      const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "high-performance" });
      renderer.setClearColor(0x000000, 0);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      el.appendChild(renderer.domElement);
      // (absolute, so that the canvas never decides the size of its box: with its own aspect it could make the box a pixel taller, the box's resize would redraw the picture, and so on, without end)
      if (getComputedStyle(el).position === "static") el.style.position = "relative";
      const CANVAS_FADE = "filter .4s ease,opacity .4s ease";
      renderer.domElement.style.cssText = `position:absolute;inset:0;display:block;width:100%;height:100%;transition:${CANVAS_FADE};opacity:0;filter:blur(7px)`;
      // (the canvas is born invisible and blurred, so that nothing of it can show before the picture is first drawn: it came in at full strength and was faded out by `soften` a moment later)
      // While the picture is redrawn (a resize, a change of scheme) the last one stays, blurred, and comes back into focus on the new one once it has a few frames in it
      let settling = false;
      const soften = (opacity = "0.85") => {
        settling = true;
        renderer.domElement.style.filter = "blur(7px)";
        renderer.domElement.style.opacity = opacity;
      };
      // (it comes in the same way the first time: invisible and blurred, then in focus; `onReady` tells the page to fade its place-holder out)
      let announced = false;
      // (the neon start-up begins when the picture first appears)
      let neonStart: (() => void) | null = null;
      // While the box is being resized the picture is not stretched with it: it keeps the size it was drawn at, centred, softened, until the new one is drawn (a stretched picture jumps, which is what the blur is there to hide)
      let shownW = 0;
      let shownH = 0;
      const holdSize = () => {
        if (!shownW || !shownH) return;
        const s = renderer.domElement.style;
        s.inset = "auto";
        s.width = `${shownW}px`;
        s.height = `${shownH}px`;
        s.left = `${(el.clientWidth - shownW) / 2}px`;
        s.top = `${(el.clientHeight - shownH) / 2}px`;
      };
      const releaseSize = () => {
        const s = renderer.domElement.style;
        s.inset = "0";
        s.left = "";
        s.top = "";
        s.width = "100%";
        s.height = "100%";
        shownW = el.clientWidth;
        shownH = el.clientHeight;
      };
      const sharpen = () => {
        settling = false;
        if (!announced) {
          announced = true;
          onReady?.();
        }
        renderer.domElement.style.transition = CANVAS_FADE;
        renderer.domElement.style.filter = "";
        renderer.domElement.style.opacity = "";
        opts.onRedrawn?.();
        // (once per build: the neon start-up begins when the picture comes into focus)
        const go = neonStart;
        neonStart = null;
        go?.();
      };
      soften("0");

      // the room the glow of the outermost columns needs around the slab, so the picture does not cut it
      const ROOM = roomFor(strips);
      // The year is a long strip of weeks; on a narrow page it is cut into `strips` strips of equal length laid one behind the other, so the slab is closer to a square and fills the width
      // (on a phone each strip is moved so that the weight of its blocks, not only its rectangle, is centred on the page)
      const { width, total, at, corners } = slabFor(layout.top.weeks, strips, shiftsFromLayers([layout.top, layout.bottom], strips));

      const scene = new THREE.Scene();
      const pmrem = new THREE.PMREMGenerator(renderer);
      const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = env;
      scene.environmentIntensity = 0.9;

      // glass: it transmits (refracts) what is behind it, the ground and the blocks' own colour tint what passes through
      /** The film grain's strength over the whole picture (0 for none). */
      const GRAIN = opts.grain ?? 0.012;
      /** (light theme) how strong the room's reflections (environment) and the clear coat's are, relative to what comes through the glass. */
      const LIGHT_ENV = 0.3;
      const LIGHT_COAT = 0.1;
      /** (light theme) how frosted the glass is (the core seen through it is a soft glow, not a hard bar) and how strong its specular glints are. */
      const LIGHT_GLASS_ROUGHNESS = 0.04;
      const LIGHT_SPECULAR = 0.35;
      const blockMaterial = new THREE.MeshPhysicalMaterial({
        vertexColors: true,
        roughness: 0.04,
        metalness: 0,
        transmission: 1,
        thickness: 1.6,
        ior: 1.5,
        dispersion: 0.35,
        attenuationColor: new THREE.Color(0xffffff),
        attenuationDistance: 4,
        clearcoat: 1,
        clearcoatRoughness: 0.03,
        specularIntensity: 1,
        envMapIntensity: 1.4,
      });
      // the empty days: a plain dull tile in the dark theme (not glass: glass reflects the room and is never dim)
      // (an unlit flat tile in the ground's own colour, a shade apart: it casts and receives nothing itself; the glow, the sun's shadows and the contact shadows are layers over it, as over the ground)
      const tileUnlit = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.BackSide });
      // the page's own background, read as the browser resolves it: the ground is that colour (so there is something to refract, and no seam with the page)
      const pageColour = () => {
        const css = resolveBackground(el, opts.background, isDark() ? "dark" : "light");
        const probe = document.createElement("canvas");
        probe.width = probe.height = 1;
        const ctx = probe.getContext("2d")!;
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        return new THREE.Color().setRGB(r! / 255, g! / 255, b! / 255, THREE.SRGBColorSpace);
      };

      // each block is a glass shell around a smaller opaque core of the same colour: the core is what the glass refracts, so the block has depth instead of reading as a pale solid
      // (light theme: the core is a lamp too, not a lit bar: unlit, a little lifted toward white, and the frosted glass turns it into a soft glow)
      const LIGHT_CORE_LIFT = 0;
      // (light theme) the core's brightness: below 1 is deeper and more saturated
      const LIGHT_CORE_DEPTH = 0.78;
      // (light theme) how much of white the glass shell's tint is mixed with (1: clear)
      const LIGHT_SHELL_WHITE = 0.78;
      /** (light theme) double-sided glass: the back faces of the blocks behind tint what is seen, but an isolated block is tinted by its own back faces too. Kept as a fallback; off. */
      const LIGHT_DOUBLE_SIDED = false;
      /** (light theme) the ground, baked, as what the glass sees behind it (see `groundLayers`): false to compare. */
      const LIGHT_BACKDROP = true;
      // (dark theme: the glass sees the ground's glow, see groundLayers) and how much of it
      const DARK_BACKDROP = true;
      const DARK_BACKDROP_GAIN = 200;
      /** (dark) the most the light seen behind the glass can add, on its brightest channel (a soft cap that keeps the hue). */
      const DARK_BACKDROP_CAP = 0.15;
      /** (light theme) how much of the colour of the blocks behind a block (as the camera sees it) its glass takes, when they cover all of its outline. */
      const LIGHT_BEHIND_TINT = 0.85;
      const coreMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
      // (the glass is perfectly clear; it is the core that is soft: its colour fades toward a pale haze of itself toward its silhouette, so it is a blurred glow in the middle of the block, with no hard edge)
      coreMaterial.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vCoreN;").replace("#include <begin_vertex>", "#include <begin_vertex>\n  vCoreN = normalize(normalMatrix * normal);");
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", "#include <common>\nvarying vec3 vCoreN;")
          .replace("#include <color_fragment>", "#include <color_fragment>\n  float cf = pow(clamp(abs(normalize(vCoreN).z), 0.0, 1.0), 0.9);\n  diffuseColor.rgb = mix(mix(diffuseColor.rgb, vec3(1.0), CORE_HAZE), diffuseColor.rgb, cf);".replace("CORE_HAZE", "0.5"));
      };
      // (in the dark theme the cores are lights: unlit, their colour is the light they give out, brighter than 1 for a busy day, which the bloom and the glow on the ground turn into a glow)
      // (dark) a rod is an emitter, not an absorber: it is drawn ADDITIVELY (`transparent` stays false, so that it is in the opaque pass the glass sees, and three.js still blends it additively): it adds its light to what is behind it and takes none away, so a dim rod is a faint light over whatever is lit there and an off rod is not there at all
      /** (dark) a rod's brightest channel is compressed above `ROD_KNEE` towards `ROD_MAX` (any hue), and whitened by up to `ROD_WHITE` where it is brightest. */
      const ROD_KNEE = 0.7;
      const ROD_MAX = 1.5;
      const ROD_WHITE = 0.35;
      const glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false });
      /** (dark) how much of the ground's light the glass shows, 1 at rest, lower when the lights are dimmed (see `applyLevels`): shared with the backdrop's shader. */
      const backdropDim = { value: 1 };
      /** GLSL: the light seen behind, `g` (linear), scaled and then capped softly on its brightest channel, so a strong hue is not overexposed whatever the palette: its colour is kept, only its level is compressed. */
      const softSeen = `vec3 softSeen(vec3 g) { float m = max(g.r, max(g.g, g.b)); if (m < 1e-6) return g; float k = ${DARK_BACKDROP_CAP.toFixed(3)}; return g * (k * tanh(min(m * ${DARK_BACKDROP_GAIN.toFixed(3)} / k, 12.0)) / m); }`;
      // how much each rod gives out, 0 to 1, one number per block, read by the rod's vertices (`aBlock` is the block's number): the neon start-up changes them over time
      // what is left of a block when its rod is off, the same for all of them: the glass's own glow and the room's reflections in it, as absolute intensities
      /** (dark) how much glow the green glass has of its own, against 0.6 of the blue's: a slight tint (0 is a clear glass). Pure green, never whitened: a whitened glow is a grey one. */
      const DARK_GREEN_GLOW = 0.2;
      // (the green glass filters the light that goes through it, Beer-Lambert: it multiplies, so the bright light of a rod behind it is turned green and the dark parts stay dark; smaller distance = stronger)
      // (the filter's colour is the layer's own palette colour, whatever the palette: a grey or white layer is not filtered)
      const LAYER_FILTER_DISTANCE = 2;
      // (how much of the layer's colour the filter takes: 1 would absorb the other channels completely, so a red glass would stop a blue light dead; real tinted glass is never that pure)
      const LAYER_FILTER_PURITY = 0.72;
      /** (dark) how much of the light the neighbours give out the glass of a block glows with: inside a group of lamps no glass is dark, and an isolated block's is. */
      const NEIGHBOUR_GLOW = 0.22;
      /** How much light behind a block it takes to light its glass most of the way (the share is `1 - e^-(light behind / this)`). */
      const BEHIND_SCALE = 1.6;
      /** How far the neighbours' light is tinted by the block's own colour, 0 to 1. */
      const GLOW_TINT = 1.0;
      // (the tint grows with the glow's own brightness: the brighter part of the light is tinted in full, the faint part only this much)
      const GLOW_TINT_FAINT = 0.35;
      // (the light of several neighbours of different colours adds up towards grey: it is pushed back to its colour, so that the glass takes the colour of the lamps around it, not a milk)
      const GLOW_SATURATION = 2.5;
      /** (dark) the least a green rod gives out, in the units of `emit(t) * (1 + 1.1 t)` (0.5 for the quietest day, about 3 for the busiest): a quiet green day still shows green, even over a bright blue block, whose light would otherwise be most of what lights it. */
      const GREEN_MIN_LEVEL = 1.1;
      const DARK_GLASS_ROUGHNESS = 0.04;
      const OFF_EMISSIVE = 0.0012;
      const OFF_ENV = 0.004;
      const MAX_LEVELS = 1024;
      // (two numbers a block: what its own rod gives out, and how much of the light of the blocks around it, which are on, reaches it, 0 to 1, against all of them on)
      const levelData = new Float32Array(MAX_LEVELS * 2).fill(1);
      const levelTex = new THREE.DataTexture(levelData, MAX_LEVELS, 1, THREE.RGFormat, THREE.FloatType);
      levelTex.needsUpdate = true;
      glowMaterial.onBeforeCompile = (shader) => {
        shader.uniforms.uLevels = { value: levelTex };
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nattribute float aBlock;\nattribute vec3 aInc;\nattribute vec2 aCtr;\nvarying float vRodA;\nuniform highp sampler2D uLevels;")
          .replace("#include <color_vertex>", "#include <color_vertex>\n#ifdef USE_COLOR\n  vec2 lv = texelFetch(uLevels, ivec2(int(aBlock + 0.5), 0), 0).rg;\n  float rodB = max(vColor.r, max(vColor.g, vColor.b)) * lv.r;\n  vColor.rgb = vColor.rgb * lv.r + vec3(0.029, 0.037, 0.053) * (1.0 - lv.r) + aInc * lv.g;\n  vRodA = smoothstep(0.0, 3.0, rodB);\n  float rodL = dot(vColor.rgb, vec3(0.299, 0.587, 0.114));\n  vColor.rgb = max(vec3(0.0), mix(vec3(rodL), vColor.rgb, 1.3 + 1.8 * (1.0 - clamp(lv.r, 0.0, 1.0))));\n#endif")
          .replace("#include <begin_vertex>", "#include <begin_vertex>\n  transformed.xz = aCtr + (transformed.xz - aCtr) * mix(0.6, 1.0, smoothstep(0.0, 2.5, rodB));");
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", "#include <common>\nvarying float vRodA;")
          .replace("#include <color_fragment>", "#include <color_fragment>\n  diffuseColor.rgb *= vRodA;\n  // (a very bright rod is not a flat blob of its colour: above the knee its level is compressed, whatever its hue, and what is left of it is whitened a little, as a real light too bright for the eye or the film turns to a hot white core with the colour round it; the faces' shading survives, as a smaller difference)\n  float rm = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));\n  if (rm > " + ROD_KNEE.toFixed(2) + ") {\n    float rc = " + ROD_KNEE.toFixed(2) + " + " + (ROD_MAX - ROD_KNEE).toFixed(2) + " * tanh(min((rm - " + ROD_KNEE.toFixed(2) + ") / " + (ROD_MAX - ROD_KNEE).toFixed(2) + ", 12.0));\n    // (only a SATURATED rod is held back: a pale one, like the stock blue whose brightness is light added to all three channels, is already a hot core and keeps its full power)\n    float rs = smoothstep(0.62, 0.85, (rm - min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b))) / rm);\n    diffuseColor.rgb = mix(diffuseColor.rgb, mix(diffuseColor.rgb * (rc / rm), vec3(rc), " + ROD_WHITE.toFixed(2) + " * smoothstep(" + ROD_KNEE.toFixed(2) + ", 3.0, rm)), rs);\n  }");
      };
      glowMaterial.customProgramCacheKey = () => "rod-levels";
      // `shade` (dark theme): the faces of a block are not all lit alike, as if the light were from above and to the left of the camera, and a block is brighter toward its top: its top is the brightest face, then the side that
      // faces left, then the one that faces the viewer, and the foot is dimmer. An emissive block has no light on it to give it a form, so this puts the form back (without it a busy blue stretch is a field of flat boxes).
      const paint = (g: BufferGeometry, col: Color, glow = 0, shade = false) => {
        const n = g.getAttribute("position").count;
        const colors = new Float32Array(n * 3);
        const pos = g.getAttribute("position");
        const nor = g.getAttribute("normal");
        let y0 = Infinity;
        let y1 = -Infinity;
        if (shade) for (let i = 0; i < n; i++) {
          y0 = Math.min(y0, pos.getY(i));
          y1 = Math.max(y1, pos.getY(i));
        }
        for (let i = 0; i < n; i++) {
          col.toArray(colors, i * 3);
          if (!shade || !nor) continue;
          const nx = nor.getX(i);
          const ny = nor.getY(i);
          const nz = nor.getZ(i);
          const face = 0.5 + 0.62 * Math.max(0, ny) + 0.3 * Math.max(0, -nx) + 0.08 * Math.max(0, -nz);
          const foot = 0.7 + 0.3 * (y1 > y0 ? (pos.getY(i) - y0) / (y1 - y0) : 1);
          const k = face * foot;
          colors[i * 3] = colors[i * 3]! * k;
          colors[i * 3 + 1] = colors[i * 3 + 1]! * k;
          colors[i * 3 + 2] = colors[i * 3 + 2]! * k;
        }
        g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        g.setAttribute("aGlow", new THREE.BufferAttribute(new Float32Array(n).fill(glow), 1));
        g.deleteAttribute("uv");
      };
      // The glow a column casts on the ground (the dark theme's answer to the shadows of the light one): a soft additive spot under each layer's column in its colour, as bright as the day was busy, painted on a canvas laid on the ground
      const GLOW_PAD = 9;
      // both sources light the ground the same way (same reach); GROUND_LIGHT is the radiance of a busy day's spot at its centre
      const GROUND_REACH = 1.75;
      const GROUND_LIGHT = 0.5;
      // (dark theme) how much of the ground's light is the soft pool (haze, scatter) and how much the traced light of the rods through the glass, and the power of that (a busy day's rod, in all the directions it sends)
      const POOL = 0.15;
      // (dark theme) how far from its block the traced light is at full strength, and where it has faded out (world units): far, as a real glow is, which is faint but wide
      const CAUSTIC_NEAR = 7;
      const CAUSTIC_FAR = 18;
      const CAUSTIC_POWER = 0.055;
      // (light theme) how strongly the glass takes the light that is not its colour away, per unit of glass crossed, and how much the traced caustics count
      const ABSORB = 2.6;
      const LIGHT_CAUSTIC = 1.0;
      const STRAIGHT = 0.92;
      // how deep the shadows go (a share of the traced loss of light) and how much the caustics are pushed
      const SHADOW = 0.72;
      // (light theme) how far the shadows are pushed from grey toward the glass's colour (1 as traced)
      const SHADE_SATURATION = 2.4;
      // (light theme) how bright the brightest channel of a column's contact shadow is: low is deep, the colour of the glass
      const LIGHT_SHADOW_DEPTH = 0.45;
      const GLEAM = 4.8;
      // (light theme) how far from its block the sun's light is counted in full, and where it has faded out
      const NOISE_FLOOR = 0.03;
      const GLEAM_MAX = 0.8;
      const SUN_NEAR = 3.4;
      const SUN_FAR = 6;
      const PX = 22;
      // the traced light is counted on a grid half as fine: enough rays in each cell to look like light and not like grain
      const LPX = PX / 2;
      let neonNeighbours: { j: number[]; m: number[] }[] = [];
      let neonBlocks: { x: number; z: number; pan: number; t: number; cell: number; peak: number }[] = [];
      let stampCtl: { update(levels: ArrayLike<number>): void } | null = null;
      // (dark) sets how much of its lamps' light each pit has, from the blocks' levels (the pits' shading follows the neon, see `groundLayers`)
      let pitLight: ((levels: ArrayLike<number>) => void) | null = null;
      let rimLight: ((levels: ArrayLike<number>) => void) | null = null;
      // `rodColor`: every rod is lit in a colour the caller picks (a string of lights, say), the same for a day each time. Its colour is the day's and its brightness is the activity, as ever; the glass is left clear so that the rod's
      // colour is what is seen, and the baked light on the ground takes the rod's colour like any other. The dark theme only (the glass of the light theme, lit by the sun, does not take coloured lights; the scene is rebuilt when the theme changes).
      const customOn = () => !!opts.rodColor && isDark();
      /** A white rod is as bright as this share of a coloured one: a white rod adds up in all three channels, so at the same level it clips to a flat white blob with no shading. */
      const WHITE_ROD = 0.62;
      const customHue = (cell: number, src: "bottom" | "top", t: number): Color | null => {
        const rgb = opts.rodColor!({ layer: src, index: cell, date: layout.top.cells[cell]!.date, t });
        return rgb ? new THREE.Color(rgb[0], rgb[1], rgb[2]) : null;
      };
      const groundLayers = (stack: { bottom: Matrix; top: Matrix }, tones: { bottom: [Color, Color]; top: [Color, Color] }, dark: boolean) => {
        const cw = Math.ceil((width + GLOW_PAD * 2) * PX);
        const ch = Math.ceil((total + GLOW_PAD * 2) * PX);
        const lw = Math.ceil((width + GLOW_PAD * 2) * LPX);
        const lh = Math.ceil((total + GLOW_PAD * 2) * LPX);
        const canvas = () => {
          const c2 = document.createElement("canvas");
          c2.width = cw;
          c2.height = ch;
          return c2;
        };
        // the contact shadow (ambient occlusion on the ground): a soft dark spot under every column, wider and darker for a taller one
        const ao = canvas();
        const actx = ao.getContext("2d")!;
        const occlude = (x: number, z: number, height: number, tint = "0,0,0") => {
          const cx = (x + GLOW_PAD) * PX;
          const cy = (z + GLOW_PAD) * PX;
          const r = (0.75 + 0.22 * height) * PX;
          const g = actx.createRadialGradient(cx, cy, 0.3 * PX, cx, cy, r);
          const a = Math.min(0.85, (dark ? 0.5 : 0.28) + 0.06 * height);
          g.addColorStop(0, `rgba(${tint},${a})`);
          g.addColorStop(0.5, `rgba(${tint},${a * 0.4})`);
          g.addColorStop(1, `rgba(${tint},0)`);
          actx.fillStyle = g;
          actx.fillRect(cx - r, cy - r, r * 2, r * 2);
        };
        // An empty day is a pit: the light that lies over the ground must not light its floor as it lights the ground, or it reads as a flat plate. Its rim shades the floor (an inner shadow) on the side that faces the light, which is where the
        // near wall keeps the light off the floor (and the opposite wall is the lit one, and the lip there takes the highlight): the light is the lamps around the pit in the dark theme (there is no sun), the sun in the light theme (top right of the screen:
        // -x and +z). `(lx, lz)` is the direction to the light, `amount` how one-sided it is (0 all round, 1 from one side).
        const pitCells: { x: number; z: number }[] = [];
        const recess = (x: number, z: number, lx: number, lz: number, amount: number, ctx: CanvasRenderingContext2D = actx) => {
          const cx = (x + GLOW_PAD) * PX;
          const cy = (z + GLOW_PAD) * PX;
          const half = 0.44 * PX;
          const rr = 0.16 * PX;
          const path = new Path2D();
          path.roundRect(cx - half, cy - half, half * 2, half * 2, rr);
          const frame = new Path2D();
          frame.rect(cx - 2 * PX, cy - 2 * PX, 4 * PX, 4 * PX);
          frame.addPath(path);
          ctx.save();
          ctx.clip(path);
          ctx.shadowColor = `rgba(0,0,0,${dark ? 0.9 : 0.5})`;
          ctx.shadowBlur = 0.16 * PX;
          // (the frame is moved away from the light: its edge on the light's side goes into the pit and shades the floor there)
          ctx.shadowOffsetX = -lx * amount * 0.09 * PX;
          ctx.shadowOffsetY = -lz * amount * 0.09 * PX;
          ctx.fillStyle = "#000";
          ctx.fill(frame, "evenodd");
          ctx.restore();
        };
        stack.top.cells.forEach((g, i) => {
          const w = stack.bottom.cells[i]!;
          const { x, z } = at(g.week, g.day);
          if (w.value > 0 || g.value > 0) {
            // (light theme: the shadow of a column is the colour of its glass, deep and saturated, not grey: light that went through tinted glass lies on the ground in that colour)
            let tint = "0,0,0";
            if (!dark) {
              const ww = w.value > 0 ? 0.18 + w.t * LAYER_MAX : 0;
              const wg = g.value > 0 ? 0.18 + g.t * LAYER_MAX : 0;
              const c = tones.bottom[1].clone().multiplyScalar(ww).add(tones.top[1].clone().multiplyScalar(wg)).multiplyScalar(1 / (ww + wg));
              const m = Math.max(c.r, c.g, c.b, 1e-3);
              const deep = c.clone().multiplyScalar(LIGHT_SHADOW_DEPTH / m);
              tint = [deep.r, deep.g, deep.b].map((v) => Math.round(255 * Math.min(1, v) ** (1 / 2.2))).join(",");
            }
            occlude(x, z, (w.value > 0 ? 0.18 + w.t * LAYER_MAX : 0) + (g.value > 0 ? 0.18 + g.t * LAYER_MAX : 0), tint);
          }
          else pitCells.push({ x, z });
        });
        // The layers of glass of every column, each as a block of its own: WakaTime's at the bottom, GitHub's on top (what the picture draws, see `build`).
        const t0 = performance.now();
        const glass: GlassLight[] = [];
        neonBlocks = [];
        const variety = (() => {
          let seed = 987654;
          return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        })();
        stack.top.cells.forEach((g, i) => {
          const w = stack.bottom.cells[i]!;
          const { x, z } = at(g.week, g.day);
          let top = 0;
          const add = (src: "bottom" | "top", y0: number, y1: number, t: number, [low, high]: [Color, Color], gain: number) => {
            const hy = (y1 - y0) / 2;
            const hue = (customOn() ? customHue(i, src, t) : null) ?? low.clone().lerp(high, t);
            // (dark) the light is the rod's, and the rod is near white where it is busy: its own chroma (as drawn, see `build`), normalised, the strength being `power`; (light) the colour of the glass
            const rod = customOn()
              ? // (`rodColor`: the light on the ground is the light's own colour, not lifted toward white as a busy rod is in the usual picture)
                hue.clone()
              : rodLight(src, hue, t, 1);
            // (how bright the rod is at its full level, as drawn: the selection lifts a quiet one to a minimum, see `focusOn`)
            const peak = Math.max(rod.r, rod.g, rod.b) * (customOn() ? 0.55 : 1);
            const col = dark ? rod.multiplyScalar(1 / Math.max(1e-4, rod.r, rod.g, rod.b)) : hue;
            // (`rodColor`: a white light adds to all three channels, so on the ground it washes out the colours around it: it lights the ground half as much)
            const whiteLight = customOn() && Math.max(hue.r, hue.g, hue.b) - Math.min(hue.r, hue.g, hue.b) < 0.15 * Math.max(hue.r, hue.g, hue.b) ? 0.5 : 1;
            // (no two blocks are alike: a small tilt of the glass of each, a strength and a reach of its own)
            const tilt = (): number => (variety() - 0.5) * 0.22;
            const luck = 0.6 + 0.8 * variety();
            const near = dark ? CAUSTIC_NEAR : SUN_NEAR;
            const far = dark ? CAUSTIC_FAR : SUN_FAR;
            neonBlocks.push({ x, z, // (the camera looks along -z, so the world's +x is on the LEFT of the screen: the stereo place is the other way round)
            pan: 1 - (x / width) * 2, t, cell: i, peak });
            glass.push({
              c: [x, y0 + hy, z],
              h: [0.46, hy, 0.46],
              r: Math.min(0.16, (2 * hy) / 2.2),
              bias: [tilt(), tilt() * 0.4, tilt()],
              col: [col.r, col.g, col.b],
              power: (0.05 + t * t) * gain * luck * CAUSTIC_POWER * whiteLight,
              near,
              far,
              // (the rod, as drawn: its width)
              rod: (0.5 - 0.2 * t ** 0.85) / 2,
              seed: [variety(), variety(), variety(), variety(), variety()],
              // (the soft pool: a haze under the block, as bright as its day was busy; it goes out with its rod)
              pool: (() => {
                const peak = POOL * GROUND_LIGHT * gain * (0.004 + 0.26 * t * t + 0.03 * t) * whiteLight;
                return { col: [hue.r * peak, hue.g * peak, hue.b * peak] as [number, number, number], r: 0.9 + GROUND_REACH * (0.5 + t * 1.5) };
              })(),
            });
          };
          if (w.value > 0) {
            add("bottom", 0, 0.18 + w.t * LAYER_MAX, w.t, tones.bottom, 1);
            top = 0.18 + w.t * LAYER_MAX + 0.04;
          }
          if (g.value > 0) add("top", top, top + 0.18 + g.t * LAYER_MAX, g.t, tones.top, 1.8);
        });
        // The light of the glass on the ground. (dark theme) There is no sun: the light is the rods'. What one block casts is baked (see `loadCausticTemplates`, from a path tracer): a fan out of every face and a faint wide glow;
        // here each block lays its own, in the colour of its rod and as strong as its day was busy, on the ground at the ground's own resolution. (light theme) The sun through the glass, traced on the graphics card
        // (see `ground-light.ts`), on a grid half as fine as the ground's other layers: parallel rays go through every block: refracted in, absorbed by the glass's colour (a blue block lets blue through and takes the rest),
        // refracted out, landing on the ground displaced and gathered. Where each lands the ground gets its power, and where it would have landed without the glass it loses it: so the ground is as bright as ever where no glass
        // reaches it, a shadow is a lack of light (in the glass's colour, not grey), and the caustics are its surplus. Two layers over the ground: one that multiplies it where it is darker, one that adds light where it is brighter.
        const ground = dark
          ? createGroundLight(THREE, renderer, { w: cw, h: ch, scale: PX, x0: -GLOW_PAD, z0: -GLOW_PAD })
          : createGroundLight(THREE, renderer, { w: lw, h: lh, scale: LPX, x0: -GLOW_PAD, z0: -GLOW_PAD });
        if (dark) {
          stampCtl = !templates ? null : ground.stamps(
            glass.map((g) => ({ x: g.c[0], z: g.c[2], height: 2 * g.h[1], foot: g.c[1] - g.h[1], col: [g.col[0] * g.power, g.col[1] * g.power, g.col[2] * g.power] as [number, number, number], poolCol: g.pool!.col, poolRadius: g.pool!.r })),
            templates,
          );
        } else {
          const sunDir = new THREE.Vector3().copy(sunBase).normalize().negate();
          ground.sun(glass, lite ? 40 : 64, [sunDir.x, sunDir.y, sunDir.z], ABSORB, STRAIGHT, (LPX * LPX) / -sunDir.y);
          ground.smooth(3);
        }
        if (dbg.metrics) console.info(`[activity] ground light drawn in ${Math.round(performance.now() - t0)} ms (${dark ? "dark" : "light"}, ${glass.length} blocks)`);
        const layers = new THREE.Group();
        const disposers: (() => void)[] = [];
        const plane = (tex: import("three").Texture, material: (tex: import("three").Texture) => import("three").MeshBasicMaterial | import("three").ShaderMaterial, order: number) => {
          const mat = material(tex);
          const mesh = new THREE.Mesh(new THREE.PlaneGeometry(cw / PX, ch / PX), mat);
          mesh.rotation.x = -Math.PI / 2;
          // (just above the empty tiles: the glow and the contact shadows lie over them as over the ground, so a tile is lit by its neighbours like the rest of the scene)
          mesh.position.set(width / 2, 0.11 + order * 0.002, total / 2);
          mesh.renderOrder = order;
          layers.add(mesh);
          disposers.push(() => {
            tex.dispose();
            mat.dispose();
          });
        };
        if (dark) plane(ground.texture, (map) => new THREE.MeshBasicMaterial({ map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), 1);
        else {
          // (the difference to the sun's light, turned into what multiplies the ground and what is added to it)
          const resolve = (shade: boolean) =>
            new THREE.ShaderMaterial({
              uniforms: { map: { value: ground.texture } },
              vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }",
              fragmentShader: `uniform sampler2D map; varying vec2 vUv;
void main() {
  vec3 v = texture2D(map, vUv).rgb;
  // (the differences of overlapping shadows are summed, but light that has been through two blocks has lost the share of each, not both shares: the product, which the exponential of the sum is) (below a small difference there is only the noise of the rays: it is not light)
  vec3 f = exp(${(LIGHT_CAUSTIC * 1.2).toFixed(3)} * sign(v) * max(abs(v) - ${NOISE_FLOOR.toFixed(3)}, 0.));
  ${shade ? `vec3 d = 1. - min(f, vec3(1.)); d = max(vec3(0.), mix(vec3(dot(d, vec3(0.3333))), d, ${SHADE_SATURATION.toFixed(2)})); gl_FragColor = vec4(vec3(1. - ${SHADOW.toFixed(3)} * min(d, vec3(1.))), 1.);` : `vec3 g = max(f - 1., 0.) * ${GLEAM.toFixed(3)}; gl_FragColor = vec4(${GLEAM_MAX.toFixed(3)} * tanh(min(g / ${GLEAM_MAX.toFixed(3)}, vec3(12.))), 1.);`}
}`,
              transparent: true,
              blending: shade ? THREE.MultiplyBlending : THREE.AdditiveBlending,
              premultipliedAlpha: shade,
              depthWrite: false,
            });
          plane(ground.texture, () => resolve(true), 0);
          plane(ground.texture, () => resolve(false), 1);
        }
        // (dark) The lamps around a pit shade its floor on the side that faces them, so with the lamps off there is nothing to shade it that way: the pits are drawn twice, with the shading of the lamps all on and with none (`aoSym`),
        // and the picture mixes the two by how much of their light there is, pit by pit (`pitLit`, set from the levels, see `layers.userData.setLevels`).
        const aoSym = dark ? canvas() : null;
        aoSym?.getContext("2d")!.drawImage(ao, 0, 0);
        const pitNear: { gi: number; wx: number; wz: number; w: number }[][] = [];
        const pitBase: number[] = [];
        const pitStrength: number[] = [];
        // (how one-sided the light is, and how strong: lamps all round cancel out)
        const amountOf = (lxv: number, lzv: number, st: number) => Math.min(1, (Math.hypot(lxv, lzv) / Math.max(st, 1e-6)) * 1.4) * Math.min(1, st * 6);
        for (const pc of pitCells) {
          let lx = 0;
          let lz = 0;
          let strength = 0;
          const near: { gi: number; wx: number; wz: number; w: number }[] = [];
          if (dark) {
            glass.forEach((g, gi) => {
              const dx = g.c[0] - pc.x;
              const dz = g.c[2] - pc.z;
              const dist = Math.hypot(dx, dz);
              if (dist < 0.5 || dist > 5) return;
              const w = (g.col[0] + g.col[1] + g.col[2]) * g.power * Math.exp(-(dist * dist) / (2 * 1.8 * 1.8));
              lx += (dx / dist) * w;
              lz += (dz / dist) * w;
              strength += w;
              near.push({ gi, wx: (dx / dist) * w, wz: (dz / dist) * w, w });
            });
          } else {
            lx = -0.63;
            lz = 0.77;
            strength = 1;
          }
          const len = Math.hypot(lx, lz);
          // (how one-sided the light is: lamps all round cancel out)
          const amount = dark ? amountOf(lx, lz, strength) : 1;
          recess(pc.x, pc.z, len > 0 ? lx / len : 0, len > 0 ? lz / len : 0, amount);
          if (aoSym) recess(pc.x, pc.z, 0, 0, 0, aoSym.getContext("2d")!);
          pitNear.push(near);
          pitBase.push(amount);
          pitStrength.push(strength);
        }
        const aoTex = new THREE.CanvasTexture(ao);
        aoTex.colorSpace = THREE.SRGBColorSpace;
        if (!aoSym) plane(aoTex, (map) => new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false }), 2);
        else {
          const symTex = new THREE.CanvasTexture(aoSym);
          symTex.colorSpace = THREE.SRGBColorSpace;
          // (how much of its lamps' light each pit has, 4 texels a unit over the whole ground: 1 = all on, as baked)
          const LT = 4;
          const litW = Math.ceil((cw / PX) * LT);
          const litH = Math.ceil((ch / PX) * LT);
          const litData = new Float32Array(litW * litH).fill(1);
          const litTex = new THREE.DataTexture(litData, litW, litH, THREE.RedFormat, THREE.FloatType);
          litTex.minFilter = THREE.NearestFilter;
          litTex.magFilter = THREE.NearestFilter;
          litTex.needsUpdate = true;
          plane(aoTex, (map) => {
            const m = new THREE.ShaderMaterial({
              uniforms: { full: { value: map }, sym: { value: symTex }, lit: { value: litTex } },
              vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }",
              fragmentShader: "uniform sampler2D full; uniform sampler2D sym; uniform sampler2D lit; varying vec2 vUv; void main() { float a = mix(texture2D(sym, vUv).a, texture2D(full, vUv).a, clamp(texture2D(lit, vUv).r, 0., 1.)); gl_FragColor = vec4(0., 0., 0., a); }",
              transparent: true,
              depthWrite: false,
            });
            return m;
          }, 2);
          disposers.push(() => {
            symTex.dispose();
            litTex.dispose();
          });
          layers.userData.setLevels = (levels: ArrayLike<number>) => {
            for (let k = 0; k < pitCells.length; k++) {
              let lx = 0;
              let lz = 0;
              let st = 0;
              for (const n of pitNear[k]!) {
                const lv = levels[n.gi] ?? 1;
                lx += n.wx * lv;
                lz += n.wz * lv;
                st += n.w * lv;
              }
              // (and in proportion to the light itself, not only to how one-sided it is: a lamp that is barely on does not give the full highlight)
              const lit = pitBase[k]! > 1e-4 && pitStrength[k]! > 1e-6 ? Math.min(1, (amountOf(lx, lz, st) / pitBase[k]!) * Math.min(1, st / pitStrength[k]!)) : 0;
              const u = pitCells[k]!.x + GLOW_PAD;
              const v = pitCells[k]!.z + GLOW_PAD;
              const i0 = Math.max(0, Math.floor((u - 0.44) * LT));
              const i1 = Math.min(litW - 1, Math.floor((u + 0.44) * LT));
              const j0 = Math.max(0, litH - 1 - Math.floor((v + 0.44) * LT));
              const j1 = Math.min(litH - 1, litH - 1 - Math.floor((v - 0.44) * LT));
              for (let jj = j0; jj <= j1; jj++) for (let ii = i0; ii <= i1; ii++) litData[jj * litW + ii] = lit;
            }
            litTex.needsUpdate = true;
          };
        }
        disposers.push(() => ground.dispose());
        if (!dark && LIGHT_BACKDROP) {
          // (light theme) What a glass sees behind it is only what three.js draws OPAQUE, and the shade, the caustics and the contact shadows are transparent layers over the paper: the glass would see bare paper where the ground is in shadow. So the ground
          // is baked once, from above (the paper, with every layer over it, as seen straight down), onto an opaque plane that is drawn ONLY into what the glass sees (it is thrown away in the picture itself, where the layers are as they were): the glass over
          // a shaded ground is seen through as shaded. The light theme's shadows never change (no lamp turns on or off), so it is baked once.
          const sizeX = cw / PX;
          const sizeZ = ch / PX;
          const bakeW = Math.min(2048, Math.ceil(sizeX * 48));
          const bakeH = Math.min(2048, Math.ceil((sizeZ / sizeX) * bakeW));
          const bake = new THREE.WebGLRenderTarget(bakeW, bakeH, { type: THREE.HalfFloatType, depthBuffer: false });
          const cam = new THREE.OrthographicCamera(-sizeX / 2, sizeX / 2, sizeZ / 2, -sizeZ / 2, 0.1, 20);
          cam.up.set(0, 0, -1);
          cam.position.set(width / 2, 5, total / 2);
          cam.lookAt(width / 2, 0, total / 2);
          const bakeScene = new THREE.Scene();
          bakeScene.add(layers);
          const prevTarget = renderer.getRenderTarget();
          const prevClear = renderer.getClearColor(new THREE.Color());
          const prevAlpha = renderer.getClearAlpha();
          renderer.setRenderTarget(bake);
          renderer.setClearColor(pageColour(), 1);
          renderer.clear();
          renderer.render(bakeScene, cam);
          renderer.setRenderTarget(prevTarget);
          renderer.setClearColor(prevClear, prevAlpha);
          bakeScene.remove(layers);
          const uBackdrop = { value: 0 };
          const proxyMat = new THREE.MeshBasicMaterial({ map: bake.texture, toneMapped: false });
          proxyMat.onBeforeCompile = (shader) => {
            shader.uniforms.uBackdrop = uBackdrop;
            shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uBackdrop;").replace("void main() {", "void main() {\n  if (uBackdrop < 0.5) discard;");
          };
          proxyMat.customProgramCacheKey = () => "ground-backdrop";
          const proxy = new THREE.Mesh(new THREE.PlaneGeometry(sizeX, sizeZ), proxyMat);
          proxy.rotation.x = -Math.PI / 2;
          proxy.position.set(width / 2, 0.01, total / 2);
          proxy.onBeforeRender = (r) => {
            uBackdrop.value = r.getRenderTarget() === sceneRT ? 0 : 1;
          };
          proxy.frustumCulled = false;
          layers.add(proxy);
          disposers.push(() => {
            bake.dispose();
            proxyMat.dispose();
            proxy.geometry.dispose();
          });
        }
        if (dark && DARK_BACKDROP) {
          // (dark theme) The same gap: the glow on the ground is an additive transparent layer, so the glass would see the bare dark ground behind it (black strips next to a lit floor). An opaque plane drawn ONLY into what the glass sees shows the dark ground plus the
          // very texture the glow is drawn from, which hover and the start-up update in place: the glass sees the live light, the picture itself is unchanged.
          const uBackdrop = { value: 0 };
          const page = pageColour();
          const proxyMat = new THREE.MeshBasicMaterial({ map: ground.texture, toneMapped: false });
          proxyMat.onBeforeCompile = (shader) => {
            shader.uniforms.uBackdrop = uBackdrop;
            shader.uniforms.uPage = { value: page };
            shader.uniforms.uDim = backdropDim;
            shader.fragmentShader = shader.fragmentShader
              .replace("#include <common>", "#include <common>\nuniform float uBackdrop;\nuniform float uDim;\nuniform vec3 uPage;")
              .replace("void main() {", softSeen + "\nvoid main() {\n  if (uBackdrop < 0.5) discard;")
              .replace("#include <opaque_fragment>", `outgoingLight = uPage + uDim * softSeen(outgoingLight);\n#include <opaque_fragment>`);
          };
          proxyMat.customProgramCacheKey = () => "ground-backdrop-dark";
          const proxy = new THREE.Mesh(new THREE.PlaneGeometry(cw / PX, ch / PX), proxyMat);
          proxy.rotation.x = -Math.PI / 2;
          proxy.position.set(width / 2, 0.01, total / 2);
          proxy.onBeforeRender = (r) => {
            uBackdrop.value = r.getRenderTarget() === sceneRT ? 0 : 1;
          };
          proxy.frustumCulled = false;
          layers.add(proxy);
          disposers.push(() => {
            proxyMat.dispose();
            proxy.geometry.dispose();
          });
        }
        layers.userData.dispose = () => disposers.forEach((d) => d());
        return layers;
      };

      // One column a day: WakaTime's coding time at the bottom, GitHub's contributions on top of it. Each layer's height and its tint follow how busy the day was (pale and low when quiet, saturated and tall when busy).
      const LAYER_MAX = 2.3;
      const roundedSquare = (() => {
        const half = 0.46;
        const r = 0.16;
        const sh = new THREE.Shape();
        sh.moveTo(-half + r, -half);
        sh.lineTo(half - r, -half);
        sh.absarc(half - r, -half + r, r, -Math.PI / 2, 0, false);
        sh.lineTo(half, half - r);
        sh.absarc(half - r, half - r, r, 0, Math.PI / 2, false);
        sh.lineTo(-half + r, half);
        sh.absarc(-half + r, half - r, r, Math.PI / 2, Math.PI, false);
        sh.lineTo(-half, -half + r);
        sh.absarc(-half + r, -half + r, r, Math.PI, Math.PI * 1.5, false);
        return sh;
      })();
      let tallest = 1;
      // The blocks' shapes, kept from one build to the next: a new colour or theme rebuilds the picture, but its blocks are the same (the data has not changed), and a rounded box costs far more to make than to copy.
      const boxes = new Map<string, BufferGeometry>();
      const roundedBox = (w: number, h: number, d: number, seg: number, r: number): BufferGeometry => {
        const key = `${w.toFixed(4)}|${h.toFixed(4)}|${d.toFixed(4)}|${seg}|${r.toFixed(4)}`;
        let g = boxes.get(key);
        if (!g) boxes.set(key, (g = new RoundedBoxGeometry(w, h, d, seg, r)));
        return g.clone();
      };
      // (whether a layer has the package's own colours: the rods' lift toward white is tuned to them; other colours get a generic one)
      const stock = { top: true, bottom: true };
      /** The rod's light, as a (dark theme) colour, for a day at busyness `t`, scaled by `level`. */
      const lum = (c: Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      const stockRod = (src: "top" | "bottom", hue: Color, t: number, level: number): Color =>
        src === "bottom"
          ? hue.clone().multiplyScalar(level * (0.5 + 0.45 * (1 - t) ** 2)).add(new THREE.Color(0.4, 0.56, 0.6).multiplyScalar(level * (0.06 + 1.32 * t * t)))
          : hue.clone().multiplyScalar(level * 1.25).add(new THREE.Color(0.22, 0.4, 0.24).multiplyScalar(level * (0.05 + 0.8 * t * t)));
      const rodLight = (src: "top" | "bottom", hue: Color, t: number, level: number): Color => {
        if (stock[src]) return stockRod(src, hue, t, level);
        // Any other colour keeps its hue (it is not lifted toward white, as the stock rods are), and is given the brightness of the stock rod on the same day: the same luminance, and never a brighter brightest channel
        // (a pale blue or a bright red would otherwise come out far brighter than the tuned defaults: a light colour has more luminance, a red needs a big red channel to match a green's).
        const [dl, dh] = DEFAULT_COLORS[src].dark;
        const ref = stockRod(src, new THREE.Color(dl).lerp(new THREE.Color(dh), t), t, level);
        const k = Math.min(lum(ref) / Math.max(lum(hue), 1e-3), Math.max(ref.r, ref.g, ref.b) / Math.max(hue.r, hue.g, hue.b, 1e-3));
        return hue.clone().multiplyScalar(k);
      };
      let bounds: ContentBounds | null = null;
      api.bounds = () => bounds;
      // the boxes a pointer can hit (one per layer of a column, one per empty day), for the picking
      interface PickBox { cell: number; x: number; z: number; y0: number; y1: number; pit?: boolean }
      let picks: PickBox[] = [];
      const LIFT = 0.04;
      const build = (stack: { bottom: Matrix; top: Matrix }, tones: { bottom: [Color, Color]; top: [Color, Color] }, dark: boolean) => {
        const tb0 = performance.now();
        picks = [];
        let tileShape = null as BufferGeometry | null;
        let ringShape0 = null as BufferGeometry | null;
        const rims: BufferGeometry[] = [];
        const pitRims: { geom: BufferGeometry; x: number; z: number }[] = [];
        const pitLamps: { si: number; w: number }[][] = [];
        // (the page's colour is read from the browser once a build, not once a tile: it makes a canvas and reads a pixel back)
        const page = pageColour();
        const shellsBy = new Map<string, BufferGeometry[]>();
        const shellHue = new Map<string, import("three").Color>();
      const shellTier = new Map<string, ["bottom" | "top", number]>();
        const cores: BufferGeometry[] = [];
        const tiles: BufferGeometry[] = [];
        // the layers are first only noted (where, how tall, how busy, which colour), so that each can be lit by the others before its geometry is made
        interface Spec { src: "bottom" | "top"; x: number; z: number; y0: number; h: number; t: number; hue: Color }
        const specs: Spec[] = [];
        // (a quiet day still has a faint light at its heart, an old bulb struggling: the floor of the emission)
        // (the lift is for the quietest days only: it fades out well before a busy one)
        const emit = (t: number) => 1.3 * (0.3 + 0.1 * (1 - t) ** 3 + 1.3 * t * t + 0.4 * t);
        const layer = (cell: number, src: "bottom" | "top", x: number, z: number, y0: number, t: number, [low, high]: [Color, Color]) => {
          const h = 0.18 + t * LAYER_MAX;
          picks.push({ cell, x, z, y0, y1: y0 + h });
          specs.push({ src, x, z, y0, h, t, hue: (customOn() ? customHue(cell, src, t) : null) ?? low.clone().lerp(high, t) });
          tallest = Math.max(tallest, y0 + h);
          return y0 + h;
        };
        stack.top.cells.forEach((g, i) => {
          const w = stack.bottom.cells[i]!;
          const { x, z } = at(g.week, g.day);
          if (w.value <= 0 && g.value <= 0) {
            // an empty day is a soft square pit dug in the ground (the same rounded corners as the blocks): its inside is what is seen (the walls and the floor, from inside: back faces), its floor darker than the page, its walls lighter near the rim
            // (the glow of the neighbours lies over it, so it reflects their light), and a thin rim round its opening takes a highlight on the edges that face the light
            if (!tileShape) {
              const PIT = 0.07;
              const BEVEL = 0.025;
              const g = new THREE.ExtrudeGeometry(roundedSquare, { depth: PIT, bevelEnabled: true, bevelSize: BEVEL, bevelThickness: BEVEL, bevelSegments: lite ? 1 : 3, curveSegments: lite ? 3 : 6 });
              g.rotateX(-Math.PI / 2);
              g.deleteAttribute("uv");
              g.translate(0, -(PIT + BEVEL), 0);
              const pos = g.getAttribute("position");
              const col = new Float32Array(pos.count * 3);
              const floor = dark ? page.clone().multiplyScalar(0.3) : page.clone().multiplyScalar(0.8);
              const wall = dark ? page.clone().add(new THREE.Color(0.012, 0.013, 0.016)) : page.clone().multiplyScalar(0.97);
              const c3 = new THREE.Color();
              for (let q = 0; q < pos.count; q++) {
                const d = Math.min(1, Math.max(0, -pos.getY(q) / (PIT + BEVEL)));
                c3.copy(wall).lerp(floor, d * d);
                c3.toArray(col, q * 3);
              }
              g.setAttribute("color", new THREE.BufferAttribute(col, 3));
              tileShape = g;
              // the rim: a thin ring round the opening, brighter on the edges that face the sun's side (a soft specular line, not a frame)
              const outer = roundedSquare.getPoints(lite ? 3 : 6);
              const ringShape = new THREE.Shape(outer.map((v) => v.clone().multiplyScalar(1.05)));
              ringShape.holes.push(new THREE.Path(outer.map((v) => v.clone().multiplyScalar(0.955)).reverse()));
              const ring = new THREE.ShapeGeometry(ringShape);
              ring.rotateX(-Math.PI / 2);
              ring.translate(0, 0.004, 0);
              ring.deleteAttribute("uv");
              const rp = ring.getAttribute("position");
              const rc = new Float32Array(rp.count * 3);
              for (let q = 0; q < rp.count; q++) {
                // (the light is the scene's own: the sun of the light theme comes from the top right on the screen, so a pit's lip catches it where its slope faces the top right: on the LEFT edge (+x here: the screen's left is +x) in full, and on the near, lower edge only a hint, as that bevel is turned away from the camera and foreshortened; a vertex of the ring is on an edge by its direction from the middle)
                const rx = rp.getX(q);
                const rz = rp.getZ(q);
                const rl = Math.hypot(rx, rz) || 1;
                const w = Math.pow(Math.max(0, rx / rl), 3) + 0.3 * Math.pow(Math.max(0, -rz / rl), 3);
                if (dark) c3.copy(page).add(new THREE.Color(0.024, 0.026, 0.034).multiplyScalar(Math.min(1, w)));
                else c3.copy(page).lerp(new THREE.Color(1, 1, 1), 0.3 * Math.min(1, w));
                c3.toArray(rc, q * 3);
              }
              ring.setAttribute("color", new THREE.BufferAttribute(rc, 3));
              ringShape0 = ring;
            }
            const tile = tileShape.clone();
            tile.translate(x, 0, z);
            tiles.push(tile);
            const rim = ringShape0!.clone();
            rim.translate(x, 0, z);
            rims.push(rim);
            pitRims.push({ geom: rim, x, z });
            picks.push({ cell: i, x, z, y0: 0, y1: 0.04, pit: true });
            return;
          }
          let y = 0;
          if (w.value > 0) y = layer(i, "bottom", x, z, 0, w.t, tones.bottom) + LIFT;
          if (g.value > 0) layer(i, "top", x, z, y, g.t, tones.top);
        });
        let blockIndex = 0;
        neonNeighbours = [];
        // (dark) the light of a rod that has glass in front of it, nearer the camera, is dimmed by that glass: a clump of bright blocks one in front of the other does not add up to one overexposed blob (the camera never moves, so it is known beforehand)
        const shades = dark ? glassShades(specs.map((q) => ({ x: q.x, z: q.z, y0: q.y0, h: q.h })), GLASS_ABSORB, GLASS_FLOOR) : [];
        const shadeOf = new Map(specs.map((q, k) => [q, shades[k] ?? 1] as const));
        // (dark) the glass is lit by what is behind it, as the camera sees it: lamps behind (their brightness, as much as they are covered by this block's outline) light it, a dark background does not; the share saturates (`1 - e^-x`) so that a stack
        // of bright blocks does not add up to one blob, and a block whose own rod is bright needs none
        const glowOf = new Map<(typeof specs)[number], number>();
        if (dark) {
          const bright = specs.map((q) => {
            const lv = Math.max(emit(q.t) * (1 + 1.1 * q.t), q.src === "top" ? GREEN_MIN_LEVEL : 0);
            const r = customOn() ? q.hue.clone().multiplyScalar(lv * 0.55) : rodLight(q.src, q.hue, q.t, lv);
            return Math.max(r.r, r.g, r.b);
          });
          const behind = lightBehind(specs.map((q) => ({ x: q.x, z: q.z, y0: q.y0, h: q.h })), bright);
          specs.forEach((q, k) => {
            const own = Math.min(1, Math.max(0, (bright[k]! - 0.5) / 1.5));
            glowOf.set(q, (1 - Math.exp(-(behind[k] ?? 0) / BEHIND_SCALE)) * (1 - own * own * (3 - 2 * own)));
          });
        }
        // (light) what is seen through a glass is what is behind it: where that is the paper it stays clear, where it is other blocks, the light that comes through them is tinted by them (they are not in what three.js lets the glass see). From the camera's view: the colour
        // of the blocks whose outline this one covers (weighted by how much of it they fill), and how much of it they cover.
        const behindTint = new Map<(typeof specs)[number], Color>();
        if (!dark && !LIGHT_DOUBLE_SIDED) {
          const boxes = specs.map((q) => ({ x: q.x, z: q.z, y0: q.y0, h: q.h }));
          const cover = lightBehind(boxes, specs.map(() => 1));
          const chans = [0, 1, 2].map((c) => lightBehind(boxes, specs.map((q) => [q.hue.r, q.hue.g, q.hue.b][c]!)));
          specs.forEach((q, k) => {
            const cv = cover[k] ?? 0;
            if (cv < 1e-3) return;
            const mean = new THREE.Color(chans[0]![k]! / cv, chans[1]![k]! / cv, chans[2]![k]! / cv);
            behindTint.set(q, new THREE.Color(1, 1, 1).lerp(mean, Math.min(1, cv) * LIGHT_BEHIND_TINT));
          });
        }
        for (const sp of specs) {
          const { src, x, z, y0, h, t, hue: hue0 } = sp;
          // (`hue` is the glass's: `rodColor` lets a white glass be tainted by the lights around it; the rod in the middle (`hue0`) is always the light's own colour)
          let hue = hue0;
          // (dark) the light the other days give out reaches this one: each neighbour's colour and brightness, weakened with the distance between the two blocks; a dim block beside or under a bright one is lit by it
          const inc = new THREE.Color(0, 0, 0);
          const nb: { j: number[]; m: number[] } = { j: [], m: [] };
          if (dark) {
            for (let oi = 0; oi < specs.length; oi++) {
              const o = specs[oi]!;
              if (o === sp) continue;
              const dx = o.x - x;
              const dz = o.z - z;
              if (Math.abs(dx) > 4 || Math.abs(dz) > 4) continue;
              const dy = o.y0 + o.h / 2 - (y0 + h / 2);
              const k = Math.exp(-(dx * dx + dz * dz + dy * dy) / (2 * 1.2 * 1.2)) * 0.11;
              inc.add(o.hue.clone().multiplyScalar(emit(o.t) * k));
              nb.j.push(oi);
              nb.m.push(emit(o.t) * k * (o.hue.r + o.hue.g + o.hue.b));
            }
          }
          neonNeighbours.push(nb);
          // (`rodColor`: a white light beside or on a coloured one takes its colour, as a white bulb does: it must not stand out as a grey block among the bright ones)
          if (dark && customOn() && Math.max(hue.r, hue.g, hue.b) - Math.min(hue.r, hue.g, hue.b) < 0.15 * Math.max(hue.r, hue.g, hue.b)) {
            const m = Math.max(inc.r, inc.g, inc.b);
            if (m > 1e-4) hue = hue.clone().lerp(inc.clone().multiplyScalar(1 / m).multiplyScalar(Math.max(hue.r, hue.g, hue.b)), Math.min(0.75, m * 3));
          }
          inc.r = Math.min(inc.r, 0.6);
          inc.g = Math.min(inc.g, 0.6);
          inc.b = Math.min(inc.b, 0.6);
          const incLum = (inc.r + inc.g + inc.b) / 3;
          // (the light of the neighbours lifts a dim block, and leaves a bright one as it is: in a dense, busy stretch the glass must stay clear around its core)
          const tEff = t + (1 - t) * Math.min(1, Math.sqrt(incLum * 1.2));
          const shell = roundedBox(0.92, h, 0.92, lite ? 2 : 3, Math.min(0.16, h / 2.2));
          shell.translate(x, y0 + h / 2, z);
          // dark: the glass is nearly clear (the light of its core shows through it); light: tinted by the level
          paint(shell, (dark ? new THREE.Color(0xffffff) : hue.clone().lerp(new THREE.Color(0xffffff), LIGHT_SHELL_WHITE).multiply(behindTint.get(sp) ?? new THREE.Color(1, 1, 1))).add(inc.clone().multiplyScalar(dark && customOn() ? 0.35 : 0.08)), 0, dark);
          shell.setAttribute("aBlock", new THREE.BufferAttribute(new Float32Array(shell.getAttribute("position").count).fill(blockIndex), 1));
          // (the light of the neighbours, for the glass to glow with: see `NEIGHBOUR_GLOW`; only where there are lamps BEHIND the glass as the camera sees it, and none against a dark background, or the glass would look opaque and washed out)
          const nbShare = glowOf.get(sp) ?? 0;
          // (the light that comes from the neighbours is tinted by the block's own colour, as it passes the gas: a green block lit by a white or blue one is lit green: full 1 is the block's colour as it is, 0 the neighbours' light as it is)
          const glowTint = (() => {
            const m = Math.max(hue0.r, hue0.g, hue0.b, 1e-3);
            return new THREE.Color(1, 1, 1).lerp(new THREE.Color(hue0.r / m, hue0.g / m, hue0.b / m), GLOW_TINT);
          })();
          const vcount = shell.getAttribute("position").count;
          shell.setAttribute("aInc", new THREE.BufferAttribute(Float32Array.from({ length: vcount * 3 }, (_, k) => [inc.r, inc.g, inc.b][k % 3]! * nbShare), 3));
          shell.setAttribute("aTint", new THREE.BufferAttribute(Float32Array.from({ length: vcount * 3 }, (_, k) => [glowTint.r, glowTint.g, glowTint.b][k % 3]!), 3));
          // the glass of a busy day glows on its own surface too (dark theme): three steps of emission per source, each its own material
          const tier = tEff < 0.34 ? 0 : tEff < 0.67 ? 1 : 2;
          const key = `${src}${tier}`;
          (shellsBy.get(key) ?? shellsBy.set(key, []).get(key)!).push(shell);
          shellTier.set(key, [src, tier]);
          if (!shellHue.has(key)) shellHue.set(key, hue0.clone());
          // (dark) the busier the day the thinner and the brighter its rod: a quiet one is as wide as before and dim, a busy one a slender, intense filament
          const cw = dark ? 0.5 - 0.2 * t ** 0.85 : 0.38;
          // (dark) the rod is the core of the block: as much glass above and below it as at its sides, so a tall block has a column, a block that is as tall as the rod is wide a cube, and a shorter one a flat core
          // (the gap is kept, down to a rod 0.1 high); the light theme keeps its rod at 80 % of the block
          const gap = (0.92 - cw) / 2;
          const hc = dark ? Math.max(0.1, h - 2 * Math.min(gap, (h - 0.1) / 2)) : h * 0.8;
          const core = roundedBox(cw, hc, cw, lite ? 1 : 2, Math.min(0.1, cw / 2.4, hc / 2.2));
          core.translate(x, y0 + h / 2, z);
          // A blue rod gets its brightness from light added to all three channels (not from more of the same blue, which only makes it bluer and more glowing): a brighter rod is a lighter, clearer blue, not a whiter one
          // (its hue is kept: the blue channel is the hue's own and the red and green rise with the busyness).
          const level = Math.max(emit(t) * (1 + 1.1 * t), src === "top" ? GREEN_MIN_LEVEL : 0);
          const rod = dark && customOn() ? hue0.clone().multiplyScalar(level * 0.55 * (Math.max(hue0.r, hue0.g, hue0.b) - Math.min(hue0.r, hue0.g, hue0.b) < 0.15 * Math.max(hue0.r, hue0.g, hue0.b) ? WHITE_ROD : 1)) : dark ? rodLight(src, hue, t, level) : hue;
          paint(core, dark ? rod.clone().multiplyScalar(shadeOf.get(sp) ?? 1) : hue.clone().lerp(new THREE.Color(0xffffff), LIGHT_CORE_LIFT).multiplyScalar(LIGHT_CORE_DEPTH));
          // (the light of the blocks around that reaches this rod when its own is off, on its own attribute: the shader adds it, as much as the neighbours that are on give)
          {
            const count = core.getAttribute("position").count;
            const incs = new Float32Array(count * 3);
            if (dark) for (let q = 0; q < count; q++) inc.toArray(incs, q * 3);
            core.setAttribute("aInc", new THREE.BufferAttribute(incs, 3));
          }
          core.setAttribute("aBlock", new THREE.BufferAttribute(new Float32Array(core.getAttribute("position").count).fill(blockIndex++), 1));
          // (where the rod stands, across: a dim rod is drawn thinner about it)
          core.setAttribute("aCtr", new THREE.BufferAttribute(Float32Array.from({ length: core.getAttribute("position").count * 2 }, (_, k) => (k % 2 ? z : x)), 2));
          cores.push(core);
        }
        // (dark) there is no sun: the lip of a pit shines with the light of the neon around it, on the edge that faces the lamps (a lamp on one side lights the lip on the other side, whose slope faces it), in the lamps' colours; nothing where no lamp is near
        if (dark) {
          pitRims.forEach((pr, pi) => {
            pr.geom.setAttribute("aPit", new THREE.BufferAttribute(new Float32Array(pr.geom.getAttribute("position").count).fill(pi), 1));
            // (what the lamps give this pit's lip, by lamp: the lip's light follows them as they come on, see `rimLight`)
            const lamps: { si: number; w: number }[] = [];
            specs.forEach((sp, si) => {
              const d = Math.hypot(sp.x - pr.x, sp.z - pr.z);
              if (d >= 0.5 && d <= 4) lamps.push({ si, w: emit(sp.t) * Math.exp(-(d * d) / (2 * 1.6 * 1.6)) });
            });
            pitLamps.push(lamps);
            const rp = pr.geom.getAttribute("position");
            const rc = pr.geom.getAttribute("color");
            for (let q = 0; q < rp.count; q++) {
              const rx = rp.getX(q) - pr.x;
              const rz = rp.getZ(q) - pr.z;
              const rl = Math.hypot(rx, rz) || 1;
              let r = 0;
              let gg = 0;
              let bb = 0;
              for (const sp of specs) {
                const dx = sp.x - pr.x;
                const dz = sp.z - pr.z;
                const dist = Math.hypot(dx, dz);
                if (dist < 0.5 || dist > 4) continue;
                const facing = Math.max(0, (-(rx / rl) * dx - (rz / rl) * dz) / dist);
                if (facing <= 0) continue;
                const k = emit(sp.t) * Math.exp(-(dist * dist) / (2 * 1.6 * 1.6)) * facing * facing * 0.018;
                r += sp.hue.r * k;
                gg += sp.hue.g * k;
                bb += sp.hue.b * k;
              }
              rc.setXYZ(q, page.r + Math.min(r, 0.1), page.g + Math.min(gg, 0.1), page.b + Math.min(bb, 0.1));
            }
            rc.needsUpdate = true;
          });
        }
        const tb1 = performance.now();
        const group = new THREE.Group();
        const groundGroup = groundLayers(stack, tones, dark);
        pitLight = (groundGroup.userData.setLevels as typeof pitLight) ?? null;
        group.add(groundGroup);
        const tb2 = performance.now();
        rimLight = null;
        if (tiles.length) {
          const tile = new THREE.Mesh(mergeGeometries(tiles), tileUnlit);
          group.add(tile);
          const rim = new THREE.Mesh(mergeGeometries(rims), tileUnlit.clone());
          const rimMat = rim.material as import("three").MeshBasicMaterial;
          rimMat.side = THREE.FrontSide;
          if (dark && pitLamps.length === pitRims.length && pitRims.length > 0) {
            // (dark) the lip of a pit shines with the lamps around it, so it follows them: its colour above the ground's is scaled by how much of their light there is now (per pit, from the levels)
            const litData = new Float32Array(pitRims.length).fill(1);
            const litTex = new THREE.DataTexture(litData, pitRims.length, 1, THREE.RedFormat, THREE.FloatType);
            litTex.needsUpdate = true;
            rimMat.onBeforeCompile = (shader) => {
              shader.uniforms.uPitLit = { value: litTex };
              shader.uniforms.uPage = { value: page };
              shader.vertexShader = shader.vertexShader
                .replace("#include <common>", "#include <common>\nattribute float aPit;\nuniform highp sampler2D uPitLit;\nuniform vec3 uPage;")
                .replace("#include <color_vertex>", "#include <color_vertex>\n#ifdef USE_COLOR\n  vColor.rgb = uPage + (vColor.rgb - uPage) * texelFetch(uPitLit, ivec2(int(aPit + 0.5), 0), 0).r;\n#endif");
            };
            rimMat.customProgramCacheKey = () => "pit-rim-lit";
            const totals = pitLamps.map((l) => l.reduce((acc, q) => acc + q.w, 0));
            rimLight = (levels) => {
              for (let k = 0; k < pitLamps.length; k++) {
                let on = 0;
                for (const q of pitLamps[k]!) on += q.w * Math.min(1, levels[q.si] ?? 1);
                litData[k] = totals[k]! > 1e-6 ? on / totals[k]! : 0;
              }
              litTex.needsUpdate = true;
            };
          }
          group.add(rim);
        }
        const materials: import("three").MeshPhysicalMaterial[] = [];
        for (const [key, list] of shellsBy) {
          const [src, tier] = shellTier.get(key)!;
          const mat = blockMaterial.clone();
          // (development only, `?wireframe`: the glass as a wire cage, to check that the rod is centred in it)
          if (dbg.wireframe) {
            mat.wireframe = true;
            mat.transmission = 0;
            mat.transparent = true;
            mat.opacity = 0.9;
          }
          mat.emissive.copy(customOn() ? new THREE.Color(0x000000) : tones[src][1]);
          // (dark) the glass absorbs what is not its own colour as the light goes through it: a green block lets a blue rod behind it show only dimly, and the other way round
          if (dark) {
            // (the glass is clear: it does not filter what is seen through it, the rods give the colour)
            // (only the GitHub layer filters, and in its own palette colour, lifted to its brightest channel; a layer with no hue stays clear)
            const lh = shellHue.get(key);
            const m = lh ? Math.max(lh.r, lh.g, lh.b, 1e-3) : 1;
            const sat = lh ? (m - Math.min(lh.r, lh.g, lh.b)) / m : 0;
            mat.attenuationColor.copy(lh && src === "top" ? new THREE.Color(1, 1, 1).lerp(new THREE.Color(lh.r / m, lh.g / m, lh.b / m), LAYER_FILTER_PURITY) : new THREE.Color(1, 1, 1));
            mat.attenuationDistance = src === "top" && sat > 0.15 ? LAYER_FILTER_DISTANCE / Math.min(1, sat * 1.5) : 1e3;
          }
          // (dark: the green glass has no glow of its own at all, it is clear; only the blue keeps a faint one: whatever glow a glass has is a tint, and grey where it should be black)
          mat.emissiveIntensity = dark ? [0.02, 0.08, 0.15][tier]! * (src === "top" ? DARK_GREEN_GLOW : 0.6) : 0;
          if (dark) {
            // the glass shines as its rod does, down to a little ambient light of the night (the floor 0.14): its own glow and the room's reflections in it follow the rod's level, so that a block whose rod is off is dark
            mat.onBeforeCompile = (shader) => {
              shader.uniforms.uLevels = { value: levelTex };
              // (what is left of the glow and of the reflections when the rod is off is the same for every block, whatever its size or its day: as a share of this tier's own intensities, whatever they are)
              shader.uniforms.uFloorEm = { value: OFF_EMISSIVE / Math.max(mat.emissiveIntensity, 1e-4) };
              shader.uniforms.uFloorEnv = { value: mat.envMapIntensity > 0 ? OFF_ENV / mat.envMapIntensity : 0 };
              shader.vertexShader = shader.vertexShader
                .replace("#include <common>", "#include <common>\nattribute float aBlock;\nattribute vec3 aInc;\nattribute vec3 aTint;\nvarying vec3 vInc;\nvarying vec3 vTint;\nuniform highp sampler2D uLevels;\nuniform float uFloorEm;\nuniform float uFloorEnv;\nvarying float vLevelEm;\nvarying float vLevelEnv;\nvarying float vOn;")
                .replace("#include <begin_vertex>", "#include <begin_vertex>\n  vec2 lv = texelFetch(uLevels, ivec2(int(aBlock + 0.5), 0), 0).rg;\n  float own = max(lv.r, 0.3 * lv.g);\n  vOn = clamp(own, 0.0, 1.0);\n  vLevelEm = max(own, uFloorEm);\n  vLevelEnv = max(own, uFloorEnv);\n  vInc = aInc * lv.g * lv.g * lv.g;\n  vTint = aTint;");
              shader.fragmentShader = shader.fragmentShader
                .replace("#include <common>", "#include <common>\nvarying float vLevelEm;\nvarying float vLevelEnv;\nvarying float vOn;\nvarying vec3 vInc;\nvarying vec3 vTint;")
                .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n  // (right off, the glass glows the same cool grey whatever its source; as soon as there is a light in it, its own colour, darker the dimmer the light: a dimmed block is a tinted, darker one, not a grey one)\n  float offGrey = 1.0 - smoothstep(0.05, 0.6, vOn);\n  totalEmissiveRadiance = mix(totalEmissiveRadiance, vec3(dot(totalEmissiveRadiance, vec3(0.333))) * vec3(0.85, 0.95, 1.15), offGrey) * mix(pow(vLevelEm, 2.0), vLevelEm, offGrey);\n  vec3 nb = min(vInc * " + NEIGHBOUR_GLOW.toFixed(3) + ", vec3(0.1));\n  nb = max(vec3(0.0), mix(vec3(dot(nb, vec3(0.299, 0.587, 0.114))), nb, " + GLOW_SATURATION.toFixed(2) + "));\n  nb *= mix(vec3(1.0), vTint, smoothstep(0.05, 0.6, vOn) * mix(" + GLOW_TINT_FAINT.toFixed(3) + ", 1.0, smoothstep(0.02, 0.1, max(nb.r, max(nb.g, nb.b)))));\n  totalEmissiveRadiance += nb;")
                // (the glass's tint is the light of its rod made visible: with the rod off the glass is clear)
                .replace("#include <lights_physical_fragment>", "#include <lights_physical_fragment>\n#ifdef USE_TRANSMISSION\n  material.attenuationColor = mix(vec3(1.0), material.attenuationColor, smoothstep(0.12, 0.9, vOn));\n#endif")
                .replace("#include <lights_fragment_maps>", "#include <lights_fragment_maps>\n#if defined( RE_IndirectSpecular )\n  radiance *= vLevelEnv;\n#ifdef USE_CLEARCOAT\n  clearcoatRadiance *= vLevelEnv;\n#endif\n#endif\n#if defined( RE_IndirectDiffuse )\n  iblIrradiance *= vLevelEnv;\n#endif");
            };
            mat.customProgramCacheKey = () => "glass-levels";
          }
          // (the room's reflections are a light too: a quiet day must not shine with them)
          // (a material's own `envMap` is what `envMapIntensity` scales; without it the scene's environment is used as it is)
          // (dark: the room's reflections in the glass and the clear coat's glint are kept, a little dimmer than they were, and tinted with the glass's own colour instead of white; the clear coat is a white layer, so it is made fainter)
          mat.envMap = dark ? env : null;
          mat.envMapIntensity = dark ? [0.02, 0.18, 0.55][tier]! * 0.1 : LIGHT_ENV;
          if (dark) {
            mat.specularColor = new THREE.Color(0xffffff);
            mat.clearcoat = 0.15;
            // (a little frosted: the transmission is blurred, so that the light of the rods spreads in the glass and the glass is not purely clear; the blur is a mip level of the picture seen through it, so it costs next to nothing)
            mat.roughness = DARK_GLASS_ROUGHNESS;
          }
          if (!dark) {
            // (light theme: the glass's own colour is what is seen, through it; the room's reflections on the top and the edges are fainter, and tinted by the glass instead of grey, so that they read as glass and not as polished metal)
            mat.clearcoat = LIGHT_COAT;
            mat.roughness = LIGHT_GLASS_ROUGHNESS;
            mat.specularIntensity = LIGHT_SPECULAR;
            mat.specularColor = tones[src][1].clone().lerp(new THREE.Color(0xffffff), 0.75);
            // (two-sided: three.js draws the BACK faces of a double-sided glass into what the glass in front of it sees, so a block behind another tints it)
            mat.side = LIGHT_DOUBLE_SIDED ? THREE.DoubleSide : THREE.FrontSide;
          }
          materials.push(mat);
          const glass = new THREE.Mesh(mergeGeometries(list)!, mat);
          glass.castShadow = true;
          glass.receiveShadow = true;
          group.add(glass);
          list.forEach((p) => p.dispose());
        }
        group.userData.dispose = () => materials.forEach((m) => m.dispose());
        if (cores.length) {
          const core = new THREE.Mesh(mergeGeometries(cores), dark ? glowMaterial : coreMaterial);
          // (after the opaque things it adds to, the ground's backdrop first: an additive rod drawn before it would be painted over)
          if (dark) core.renderOrder = 10;
          core.castShadow = false;
          group.add(core);
        }
        [...cores, ...tiles].forEach((p) => p.dispose());
        tileShape?.dispose();
        ringShape0?.dispose();
        if (dbg.metrics) console.info(`[activity] build: geometry ${Math.round(tb1 - tb0)} ms, ground ${Math.round(tb2 - tb1)} ms, merge ${Math.round(performance.now() - tb2)} ms`);
        return group;
      };

      const blocks = new THREE.Group();
      scene.add(blocks);
      const ground0 = () => ((ground.material as import("three").ShadowMaterial).opacity = isDark() ? 0 : 0.05);
      const buildBlocks = () => {
        showMat.uniforms.bloom!.value = isDark() ? (customOn() ? 0.4 : 1) : 0;
        showMat.uniforms.veil!.value = customOn() ? 0.75 : 0;
        // night: no sun and no room, the only light is what the days give out
        scene.environmentIntensity = isDark() ? 0 : 0.9;
        sun.intensity = isDark() ? 0 : 2.2;
        ground0();
        blocks.traverse((o) => {
          (o as Mesh).geometry?.dispose();
          (o.userData.dispose as (() => void) | undefined)?.();
        });
        blocks.clear();
        const dark = isDark();
        const pair = (layer: "top" | "bottom"): [Color, Color] => {
          const [low, high] = colorOf(layer, dark);
          const [dl, dh] = DEFAULT_COLORS[layer][dark ? "dark" : "light"];
          stock[layer] = sameColor(low, dl) && sameColor(high, dh);
          // (any other colour is brought into the range where the rods, the glass and the ground light look right: see `clampTone`)
          if (!stock[layer]) {
            const [lo, hi] = clampTone(high);
            return [new THREE.Color(lo), new THREE.Color(hi)];
          }
          return [new THREE.Color(low), new THREE.Color(high)];
        };
        blocks.add(build({ bottom: layout.bottom, top: layout.top }, { bottom: pair("bottom"), top: pair("top") }, dark));
      };

      const floor = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshBasicMaterial({ color: pageColour() }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(width / 2, -0.02, total / 2);
      scene.add(floor);
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.ShadowMaterial({ opacity: 0.32, depthWrite: false }));
      ground.rotation.x = -Math.PI / 2;
      // (above the empty tiles, under the glow and contact-shadow layers: the sun's shadows fall on a tile as on the ground)
      ground.position.set(width / 2, 0.06, total / 2);
      ground.receiveShadow = true;
      scene.add(ground);

      const sun = new THREE.DirectionalLight(0xffffff, 2.2);
      const sunBase = new THREE.Vector3(-0.45, 1, 0.55).normalize().multiplyScalar(60);
      sun.castShadow = true;
      sun.shadow.mapSize.set(lite ? 2048 : 4096, lite ? 2048 : 4096);
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.03;
      const sc = sun.shadow.camera;
      sc.left = -width * 1.4;
      sc.right = width * 1.4;
      sc.top = total * 6;
      sc.bottom = -total * 6;
      sc.near = 1;
      sc.far = 160;
      sun.target.position.set(width / 2, 0, total / 2);
      scene.add(sun, sun.target);

      // the isometric camera: from the front-right, above, looking at the middle of the slab; orthographic, so the grid stays a grid
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 1900);
      const centre = new THREE.Vector3(width / 2, 1.2, total / 2);
      // (far away: the glass's refraction takes its view direction from the camera's position, as for a perspective camera, so with this camera orthographic a near one bends the view differently across the picture, and the cores sit off-centre on one side)
      camera.position.copy(centre).add(new THREE.Vector3(...CAMERA_DIR).normalize().multiplyScalar(900));
      camera.up.set(0, 1, 0);
      camera.lookAt(centre);

      // the accumulation: scene -> `sceneRT`, added into `accumRT`, shown as sum / n by a quad
      const sceneRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
      const accumRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
      const quadGeo = new THREE.PlaneGeometry(2, 2);
      const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const addMat = new THREE.ShaderMaterial({
        uniforms: { map: { value: sceneRT.texture } },
        vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }",
        fragmentShader: "uniform sampler2D map; varying vec2 vUv; void main(){ gl_FragColor = texture2D(map, vUv); }",
        // a running average (new * k + old * (1 - k), k = 1 / (n + 1)): the values stay in 0..1, where a half float is precise; a plain sum grows to ~100 and its rounding errors tint the whole picture
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.ConstantAlphaFactor,
        blendDst: THREE.OneMinusConstantAlphaFactor,
        blendSrcAlpha: THREE.ConstantAlphaFactor,
        blendDstAlpha: THREE.OneMinusConstantAlphaFactor,
        depthTest: false,
        depthWrite: false,
      });
      // the bloom (dark theme): what is brighter than 1 is cut out of the picture, blurred wide (a separable gaussian at half and at quarter resolution: smooth, no streaks) and added back, so a glowing block gives off a halo
      const VERT = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }";
      const rt = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
      const halfA = rt();
      const halfB = rt();
      const quarterA = rt();
      const quarterB = rt();
      const brightMat = new THREE.ShaderMaterial({
        uniforms: { map: { value: accumRT.texture } },
        vertexShader: VERT,
        fragmentShader: "uniform sampler2D map; varying vec2 vUv; void main(){ vec3 c = texture2D(map, vUv).rgb; gl_FragColor = vec4(max(c - 1.0, 0.), 1.); }",
        depthTest: false,
        depthWrite: false,
      });
      const blurMat = new THREE.ShaderMaterial({
        uniforms: { map: { value: halfA.texture }, stepv: { value: new THREE.Vector2() } },
        vertexShader: VERT,
        fragmentShader: `uniform sampler2D map; uniform vec2 stepv; varying vec2 vUv;
void main(){
  vec3 c = texture2D(map, vUv).rgb * 0.227027;
  c += (texture2D(map, vUv + stepv * 1.3846154).rgb + texture2D(map, vUv - stepv * 1.3846154).rgb) * 0.3162162;
  c += (texture2D(map, vUv + stepv * 3.2307692).rgb + texture2D(map, vUv - stepv * 3.2307692).rgb) * 0.0702703;
  gl_FragColor = vec4(c, 1.);
}`,
        depthTest: false,
        depthWrite: false,
      });
      // what is shown: the average, with the bloom added in the dark theme
      const showMat = new THREE.ShaderMaterial({
        uniforms: { map: { value: accumRT.texture }, bloom: { value: 0 }, veil: { value: 0 }, grain: { value: GRAIN }, near: { value: halfA.texture }, far: { value: quarterA.texture } },
        vertexShader: VERT,
        fragmentShader: `uniform sampler2D map; uniform sampler2D near; uniform sampler2D far; uniform float bloom; uniform float veil; uniform float grain; varying vec2 vUv;
void main(){
  vec4 c = texture2D(map, vUv);
  if (bloom > 0.) {
    vec3 halo = texture2D(near, vUv).rgb * 0.24 + texture2D(far, vUv).rgb * 0.17;
    // The halo is cut out of the picture before the rods are taken toward white, so it keeps the saturated blue of their raw light: a near-white rod would glow deep blue. It takes the rod's colour (the same pull toward white), only dimmer; green is left as it is.
    float hm = max(max(halo.r, halo.g), halo.b);
    float haloBlue = smoothstep(0., 0.25, (halo.b - halo.g) / max(hm, 1e-4));
    halo = mix(halo, vec3(hm), haloBlue * 0.6);
    // (the blue's halo is fainter, the green's a little stronger)
    c.rgb += bloom * halo * mix(1.3, 0.38, haloBlue);
  }
  // (rodColor: the grey-white veil that the glass's reflections, the halo and the emissive add to every channel is taken off: what is left is the rod's own colour, as saturated as it is, at the same brightness)
  if (veil > 0.) { float mx = max(c.r, max(c.g, c.b)); float mn = min(c.r, min(c.g, c.b)); float k = smoothstep(0.12, 0.5, (mx - mn) / max(mx, 1e-4)); c.rgb -= mn * veil * k; c.rgb *= mix(1., mix(0.15, 1., k), smoothstep(0.04, 0.2, mx) * (1. - smoothstep(0.2, 0.4, mx))); }
  // A hue-preserving soft clip: a channel past 1 (a busy blue: its blue is far over, its green and red are not) would clip alone and turn the colour pale; the whole colour is brought back so that its brightest channel
  // only just passes 1, and the hue and the saturation stay.
  float m = max(max(c.r, c.g), c.b);
  // A blue light far over 1 (a busy day's rod) is taken toward white as it rises, so the rod is whiter than the blue glass around it (whose reflections and refractions stay under 1); green is left as it is.
  float blueish = smoothstep(0., 0.25, (c.b - c.g) / max(m, 1e-4));
  float hot = smoothstep(1., 3., m);
  c.rgb = mix(c.rgb, vec3(m), blueish * hot * 0.55 * step(veil, 0.));
  if (m > 1.) c.rgb *= (1. + (m - 1.) * 0.12) / m;
  gl_FragColor = c;
#include <colorspace_fragment>
  // Camera grain: a fine, fixed noise over the whole picture, added after the lighting (on what is shown, not in it). It is meant to read as the noise of a good camera, not as rendering noise: soft (the sum of three
  // uniform numbers, so close to a gaussian and not the harsh specks of a single one), the same for every colour of the picture (it is not gated by brightness: a coloured block gets as much as a grey one), growing with the light (as a sensor's does: the dark glows stay clean) and easing off in the highlights (so that a bright surface does not burn); brightness only, no colour noise.
  if (grain > 0.) {
    vec3 q = fract(vec3(gl_FragCoord.xyx) * vec3(.1031, .1030, .0973));
    q += dot(q, q.yzx + 33.33);
    vec3 h = fract((q.xxy + q.yzz) * q.zyx);
    float g = (h.x + h.y + h.z - 1.5) * 0.7;
    float lum = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    // (the noise of a sensor grows with the light it gets, as its square root: the dark glows stay clean, the lit surfaces carry the grain)
    // (and none at all in the near-blacks: in an 8-bit picture a tiny noise there only flips single pixels between two levels, which is a speckle, not a grain)
    float tone = sqrt(clamp(lum, 0., 1.)) * smoothstep(0.08, 0.3, lum) * (1. - smoothstep(0.7, 1.0, lum) * 0.8);
    // (a soft rise or loss of brightness, a few per cent, never a dark speck: the colour is scaled, its hue kept, and there is no colour noise)
    gl_FragColor.rgb *= 1. + g * grain * 5. * tone;
  }
}`,
        depthTest: false,
        depthWrite: false,
      });
      const fsMesh = new THREE.Mesh(quadGeo, brightMat);
      const fsScene = new THREE.Scene();
      fsScene.add(fsMesh);
      const pass = (material: import("three").ShaderMaterial, target: import("three").WebGLRenderTarget | null) => {
        fsMesh.material = material;
        renderer.setRenderTarget(target);
        renderer.render(fsScene, quadCam);
      };
      const blur = (from: import("three").WebGLRenderTarget, to: import("three").WebGLRenderTarget, size: [number, number], radius: number) => {
        blurMat.uniforms.map!.value = from.texture;
        blurMat.uniforms.stepv!.value.set(radius / size[0], 0);
        pass(blurMat, to);
        blurMat.uniforms.map!.value = to.texture;
        blurMat.uniforms.stepv!.value.set(0, radius / size[1]);
        pass(blurMat, from);
      };
      const addQuad = new THREE.Mesh(quadGeo, addMat);
      const showQuad = new THREE.Mesh(quadGeo, showMat);
      const quadScene = new THREE.Scene();
      quadScene.add(addQuad);

      let w = 1;
      let h = 1;
      let n = 0;
      // (how many frames are added up before the loop stops: all of them, but only a few while the lights are changing, so that the picture keeps up with them)
      let samplesCap = samples;
      let raf = 0;
      const halton = (i: number, b: number) => {
        let f = 1;
        let r = 0;
        for (let k = i + 1; k > 0; k = Math.floor(k / b)) {
          f /= b;
          r += f * (k % b);
        }
        return r;
      };

      const fit = () => {
        const size = renderSize({ cssWidth: el.clientWidth, cssHeight: el.clientHeight, devicePixelRatio: window.devicePixelRatio, lite, maxPixelRatio: opts.maxPixelRatio, maxPixels: opts.maxPixels, maxSize: renderer.capabilities.maxTextureSize });
        w = size.width;
        h = size.height;
        renderer.setPixelRatio(1);
        renderer.setSize(w, h, false);
        sceneRT.setSize(w, h);
        accumRT.setSize(w, h);
        halfA.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
        halfB.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
        quarterA.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
        quarterB.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
        // the slab (with its tallest blocks) projected into the camera's frame fills the view, centred
        camera.updateMatrixWorld();
        const inv = camera.matrixWorldInverse;
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const [cx, cz] of corners(ROOM)) for (const cy of [0, tallest]) {
          const p = new THREE.Vector3(cx, cy, cz).applyMatrix4(inv);
          x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
        }
        if (dbg.metrics) el.dataset.fit = ((x1 - x0) / (y1 - y0)).toFixed(3);
        const aspect = w / h;
        // With strips (a phone) the picture is centred on its rows' centre of gravity (each strip's middle, after `stripShifts` has brought the weight of its blocks there), not on its bounding box: the staggered rows make the box lopsided
        let gx = (x0 + x1) / 2;
        if (strips > 1) {
          const perStrip = Math.ceil(layout.top.weeks / strips);
          let sum = 0;
          for (let k = 0; k < strips; k++) {
            const c = at(k * perStrip + (perStrip - 1) / 2, 3);
            sum += new THREE.Vector3(c.x, 0, c.z).applyMatrix4(inv).x;
          }
          gx = sum / strips;
        }
        const halfH = Math.max((y1 - y0) / 2, Math.max(x1 - gx, gx - x0) / aspect) * 1.04;
        const mx = gx;
        const my = (y0 + y1) / 2;
        camera.left = mx - halfH * aspect;
        camera.right = mx + halfH * aspect;
        camera.top = my + halfH;
        camera.bottom = my - halfH;
        camera.updateProjectionMatrix();
        releaseSize();
        publishBounds();
        restart();
      };

      // Where the blocks are on the screen, in CSS pixels of the container: the footprints of the days that have a block (their left and right edges and their foot), and the top of the tallest column.
      // Written to the container as `--nag-content-left` / `-right` / `-top` / `-bottom` (px) and given to `onLayout`, so a caption can be lined up with the picture, not with the box.
      const publishBounds = () => {
        camera.updateMatrixWorld();
        let l = Infinity, r = -Infinity, t = Infinity, b = -Infinity;
        const cw = el.clientWidth;
        const ch = el.clientHeight;
        const px = (x: number, y: number, z: number) => {
          const p = new THREE.Vector3(x, y, z).project(camera);
          return { x: ((p.x + 1) / 2) * cw, y: ((1 - p.y) / 2) * ch };
        };
        layout.top.cells.forEach((g, i) => {
          if (g.value <= 0 && layout.bottom.cells[i]!.value <= 0) return;
          const { x, z } = at(g.week, g.day);
          for (const [dx, dz] of [[-0.46, -0.46], [0.46, -0.46], [-0.46, 0.46], [0.46, 0.46]] as const) {
            const foot = px(x + dx, 0, z + dz);
            l = Math.min(l, foot.x);
            r = Math.max(r, foot.x);
            b = Math.max(b, foot.y);
          }
          t = Math.min(t, px(x, topOf(i), z).y);
        });
        if (!Number.isFinite(l)) return;
        bounds = { left: l, right: r, top: t, bottom: b };
        for (const [k, v] of Object.entries(bounds)) el.style.setProperty(`--nag-content-${k}`, `${v.toFixed(1)}px`);
        opts.onLayout?.(bounds);
      };

      const frames: number[] = [];
      const frame = () => cm(() => frameBody());
      // `count` samples are added up before anything is shown (one, when the picture is converging frame by frame; a few at once for an update of the lights, so that the picture never shows its first, rawest samples in a row: that is a shimmer of the whole picture)
      // (`blendFloor`: the least weight a new sample has in the picture; `jitter`: where the sun and the camera are in their sequences, which goes on at every light update, so that the samples of an update are not the same few again)
      let blendFloor = 0;
      let jitter = 0;
      const frameBody = (count = 1) => {
        raf = 0;
        const f0 = performance.now();
        for (let c = 0; c < count; c++) {
          // the sun moves on a disc (the soft shadow), the camera a sub-pixel (the anti-aliasing)
          const a = halton(n + jitter, 2) * Math.PI * 2;
          const r = Math.sqrt(halton(n + jitter, 3)) * 9;
          sun.position.copy(sunBase).add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)).add(sun.target.position);
          camera.setViewOffset(w, h, halton(n + jitter, 5) - 0.5, halton(n + jitter, 7) - 0.5, w, h);
          renderer.setRenderTarget(sceneRT);
          renderer.setClearColor(0x000000, 0);
          renderer.clear();
          renderer.render(scene, camera);
          renderer.setRenderTarget(accumRT);
          renderer.autoClear = false;
          addMat.blendAlpha = Math.max(1 / (n + 1), blendFloor);
          renderer.render(quadScene, quadCam);
          renderer.autoClear = true;
          n++;
        }
        // (a light update while the picture settles caps the samples at 2 or 3: that is all it will get then, so it comes into focus on them rather than waiting for ten that never come)
        if (settling && n >= Math.min(10, samples, samplesCap)) sharpen();
        if (showMat.uniforms.bloom!.value > 0) {
          // bright part -> half resolution, blurred twice (near halo); that, blurred again at quarter resolution (far halo)
          pass(brightMat, halfA);
          blur(halfA, halfB, [w >> 1, h >> 1], 1.5);
          blur(halfA, halfB, [w >> 1, h >> 1], 3);
          blurMat.uniforms.map!.value = halfA.texture;
          blurMat.uniforms.stepv!.value.set(0, 0);
          pass(blurMat, quarterA);
          blur(quarterA, quarterB, [w >> 1, h >> 1], 3);
          if (!lite) blur(quarterA, quarterB, [w >> 1, h >> 1], 5);
        }
        renderer.setRenderTarget(null);
        renderer.clear();
        renderer.render(showQuad, quadCam);
        if (dbg.metrics) {
          // (development only: how long a frame takes, the GPU included: `finish` waits for it)
          renderer.getContext().finish();
          frames.push(performance.now() - f0);
          el.dataset.frameMs = (frames.reduce((x, y) => x + y, 0) / frames.length).toFixed(1);
        }
        if (n < samplesCap) raf = requestAnimationFrame(frame);
        else if (dbg.metrics) el.dataset.renderMs = String(Math.round(performance.now() - t0));
      };
      function restart() {
        n = 0;
        if (!raf) raf = requestAnimationFrame(frame);
      }
      // (an update of the lights while the picture is otherwise done: `k` samples drawn at once and shown together, then it stops)
      // An update of the lights, drawn as ONE sample blended into the picture (a running average, the new sample weighing at least `floor`): the camera does not move, so the last picture is a good start for the next, and the noise of the one sample
      // is averaged with the few before it, where `burst` drew several at once from nothing. A fifth of the cost of five samples, with the light changes a few frames late. `n` is kept low, so that the picture can go on to the full number from here.
      const ema = (floor = 0.3) => {
        cancelAnimationFrame(raf);
        raf = 0;
        n = Math.min(n, 6);
        jitter += 1;
        samplesCap = 0;
        blendFloor = floor;
        cm(() => frameBody(1));
        blendFloor = 0;
      };

      // --- the neon start-up of the dark theme (not for those who ask for less motion) ---
      let neon: ReturnType<typeof createNeon> | null = null;
      let neonApplyMs = 0;
      let neonTicks = 0;
      const neonAllowed = () => !(opts.reducedMotion === "auto" || opts.reducedMotion === undefined ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : opts.reducedMotion);
      // (the idle flickers of the neon only when the picture is in view)
      let inView = true;
      const viewObserver = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries) => (inView = entries.some((e) => e.isIntersecting)));
      viewObserver?.observe(el);
      // (the caller's own part of the start-up, `startup`: prepared with it, started with it, stopped with it)
      let hook: Startup | null = null;
      const stopNeon = () => {
        hook?.stop?.();
        hook = null;
        neon?.stop();
        neon = null;
        neonStart = null;
        samplesCap = samples;
        levelData.fill(1);
        levelTex.needsUpdate = true;
      };
      // the levels as numbers for the shaders: each block's own, and the light that reaches it from the neighbours that are on
      const uploadLevels = (levels: ArrayLike<number>, idle = false) => {
        for (let i = 0; i < neonNeighbours.length && i < MAX_LEVELS; i++) {
          const nb = neonNeighbours[i]!;
          let on = 0;
          let all = 0;
          for (let k = 0; k < nb.j.length; k++) {
            on += nb.m[k]! * levels[nb.j[k]!]!;
            all += nb.m[k]!;
          }
          levelData[i * 2] = levels[i]!;
          // (a tube out in a lit sign is a dimmer gap, not a black one: it gets a bit more than half of what its neighbours would give it at the start-up)
          levelData[i * 2 + 1] = all > 0 ? (idle ? 0.55 * (on / all) + 0.45 * Math.min(1, levels[i]!) : on / all) : 1;
        }
        levelTex.needsUpdate = true;
      };
      // --- the selected day (dark theme): its blocks glow brighter and the others dim, smoothly, a moment after the pointer has settled on it. It multiplies the neon's levels, so it works with the start-up and the flickers. ---
      const FOCUS_ON = 1.7;
      /** (dark) the least the brightest channel of a selected rod reaches (a rod's own full level is 0.5 for a quiet day to 3 for the busiest), so that a small block selected glows as remarkably as a big one; and the most it is lifted for it. */
      const FOCUS_MIN_PEAK = 1.7;
      const FOCUS_MAX_GAIN = 5;
      const FOCUS_OFF = 0.34;
      /** The power of the share of lit blocks that dims the backdrop (2: all dimmed to 0.34 leaves about an eighth). */
      const BACKDROP_DIM_POWER = 2;
      let focusCtl: { update(levels: ArrayLike<number>): void } | null = null;
      let focus = new Float32Array(0);
      let focusTo = new Float32Array(0);
      let effective = new Float32Array(0);
      let lastLevels: ArrayLike<number> = new Float32Array(0);
      let idleLook = false;
      let focusRaf = 0;
      let focusTimer = 0;
      const applyLevels = (levels: ArrayLike<number>) => {
        lastLevels = levels;
        const n = neonBlocks.length;
        if (effective.length !== n) effective = new Float32Array(n).fill(1);
        for (let i = 0; i < n; i++) effective[i] = levels[i]! * (focus[i] ?? 1);
        uploadLevels(effective, idleLook);
        focusCtl?.update(effective);
        pitLight?.(effective);
        rimLight?.(effective);
        // (the ground's light seen through the glass follows how lit the scene is, and more than in proportion: with every light dimmed it all but goes out)
        let lit = 0;
        for (let i = 0; i < n; i++) lit += Math.min(1, effective[i]!);
        backdropDim.value = n > 0 ? (lit / n) ** BACKDROP_DIM_POWER : 1;
      };
      // (the hum of the selected neon follows its brightness, once the start-up is over and when the page may make sound)
      const hum = createHoverHum();
      let humOk = false;
      const humLevel = () => {
        if (!humOk || !(opts.sound ?? true)) return hum.set(0);
        // (the level is the brightest of the blocks, whichever, so that it dies with the light; the voice is the neon that is under the pointer, and none when none is: then the last one's hum only fades)
        let lvl = 0;
        let held = -1;
        for (let i = 0; i < focus.length; i++) {
          lvl = Math.max(lvl, Math.min(1, (focus[i]! - 1) / (FOCUS_ON - 1)));
          if (focusTo[i]! > 1 && (held < 0 || focusTo[i]! > focusTo[held]!)) held = i;
        }
        if (held < 0) return hum.set(lvl);
        hum.set(lvl, neonBlocks[held]!.pan, neonBlocks[held]!.cell, neonBlocks[held]!.t);
      };
      const stepFocus = () => {
        focusRaf = 0;
        let moving = false;
        for (let i = 0; i < focus.length; i++) {
          const d = focusTo[i]! - focus[i]!;
          if (Math.abs(d) > 0.01) {
            focus[i]! += d * 0.28;
            moving = true;
          } else focus[i] = focusTo[i]!;
        }
        applyLevels(lastLevels);
        humLevel();
        // (each step of the fade is drawn from a few samples at once and shown together, not sample by sample: the first of a restart, alone, is the noisiest picture there is)
        ema(lite ? 0.45 : 0.3);
        if (moving) focusRaf = window.setTimeout(stepFocus, 1000 / (lite ? 20 : 30)) as unknown as number;
        else {
          // (the fade is over: the picture goes on from the samples it has, up to the full number, it does not start again from one)
          samplesCap = samples;
          if (!raf) raf = requestAnimationFrame(frame);
        }
      };
      // (a debounce: the day is taken a moment after the pointer stops on it, and let go a moment after it leaves)
      const GHOST = 0.12;
      const focusOn = (cell: number, ghosts: number[] = []) => {
        window.clearTimeout(focusTimer);
        if (!focusCtl) return;
        focusTimer = window.setTimeout(() => {
          for (let i = 0; i < focusTo.length; i++) focusTo[i] = cell < 0 ? 1 : neonBlocks[i]!.cell === cell ? Math.min(FOCUS_MAX_GAIN, Math.max(FOCUS_ON, FOCUS_MIN_PEAK / Math.max(neonBlocks[i]!.peak, 1e-3))) : ghosts.includes(neonBlocks[i]!.cell) ? GHOST : FOCUS_OFF;
          window.clearTimeout(focusRaf);
          stepFocus();
        }, cell < 0 ? 140 : 70);
      };
      const prepareNeon = (skipStartup = false) => {
        stopNeon();
        humOk = false;
        hum.stop();
        // (`onLit`: whether the picture is lit, for the page's greeting: not while the start-up runs, always when there is none)
        onLit?.(false);
        window.clearTimeout(focusTimer);
        window.clearTimeout(focusRaf);
        focusCtl = isDark() && stampCtl && neonBlocks.length > 0 && neonBlocks.length <= MAX_LEVELS ? stampCtl : null;
        focus = new Float32Array(neonBlocks.length).fill(1);
        focusTo = new Float32Array(neonBlocks.length).fill(1);
        effective = new Float32Array(neonBlocks.length).fill(1);
        lastLevels = new Float32Array(neonBlocks.length).fill(1);
        idleLook = false;
        backdropDim.value = 1;
        if (focusCtl) applyLevels(lastLevels);
        if (!isDark() || !neonAllowed() || skipStartup || !stampCtl || neonBlocks.length === 0 || neonBlocks.length > MAX_LEVELS) return void ((humOk = true), onLit?.(true));
        const ctl = stampCtl;
        neonApplyMs = 0;
        neonTicks = 0;
        neon = createNeon({
          blocks: neonBlocks,
          sound: opts.sound ?? true,
          canPlay: () => inView,
          // (a weak device, a phone: half the updates, so half the redraws of the picture while the lights flicker)
          fps: lite ? 10 : 20,
          // (the wobble is redrawn more often than the flickers: 40 a second, 15 on a weak device)
          wobbleFps: lite ? 15 : 40,
          apply: (levels, idle) => {
            const a0 = performance.now();
            idleLook = !!idle;
            applyLevels(levels);
            neonApplyMs += performance.now() - a0;
            neonTicks++;
            if (dbg.metrics) {
              let mn = 1;
              let sum = 0;
              for (let q = 0; q < levels.length; q++) {
                mn = Math.min(mn, levels[q]!);
                sum += levels[q]!;
              }
              el.dataset.neonMin = mn.toFixed(2);
              el.dataset.neonMean = (sum / levels.length).toFixed(3);
            }
            ema(lite ? 0.45 : 0.3);
          },
          done: () => {
            humOk = true;
            onLit?.(true);
            // (the picture goes on from the samples it has to the full number: it does not start again from one, the noisiest picture there is)
            samplesCap = samples;
            if (!raf) raf = requestAnimationFrame(frame);
            if (dbg.metrics) {
              el.dataset.neonTicks = String(neonTicks);
              el.dataset.neonApplyMs = (neonApplyMs / Math.max(1, neonTicks)).toFixed(2);
              el.dataset.neonFrameMs = (frames.reduce((x, y) => x + y, 0) / Math.max(1, frames.length)).toFixed(1);
              el.dataset.neonDone = "1";
            }
          },
        });
        hook = opts.startup?.({ inView: () => inView }) ?? null;
        if (dbg.metrics) el.dataset.neonRods = String(neon.count);
        // (the flickering rods are off from the first frame: the picture is not seen before it starts)
        applyLevels(neon.levels);
        neonStart = () => {
          frames.length = 0;
          hook?.start?.();
          neon?.start();
        };
        // (development only, `?neonhold`: the start-up never begins, and the picture is held half on, half off, to look at it with rods off)
        if (dbg.neonHold) {
          neonStart = null;
          // (and the left part of the picture is on, the right part off: to see a block that is off beside blocks that are on)
          const half = Float32Array.from(neonBlocks, (b) => (b.pan > -0.1 ? 1 : Number(dbg.neonHold) > 0 && Number(dbg.neonHold) < 1 ? Number(dbg.neonHold) : 0));
          uploadLevels(half);
          ctl.update(half);
        }
      };
      buildBlocks();
      prepareNeon();
      // --- hovering: the day under the pointer (or the key) ---
      const dom = renderer.domElement;
      const ray = new THREE.Raycaster();
      const ndc = new THREE.Vector2();
      let current = -1;
      let pinned = false;
      const cells = layout.top.cells;
      const topOf = (cell: number) => picks.filter((b) => b.cell === cell).reduce((m, b) => Math.max(m, b.y1), 0);
      // every day under the point, the nearest first (a day behind a taller one is under the same point: it is reached by cycling through these)
      const pickAll = (cx: number, cy: number) => {
        const r = dom.getBoundingClientRect();
        ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
        camera.updateMatrixWorld();
        ray.setFromCamera(ndc, camera);
        const o = ray.ray.origin;
        const d = ray.ray.direction;
        const hits = new Map<number, number>();
        for (const b of picks) {
          // the ray against the box (the slab method)
          let t0 = -Infinity;
          let t1 = Infinity;
          for (const [oo, dd, lo, hi] of [[o.x, d.x, b.x - 0.46, b.x + 0.46], [o.y, d.y, b.y0, b.y1], [o.z, d.z, b.z - 0.46, b.z + 0.46]] as const) {
            if (Math.abs(dd) < 1e-9) {
              if (oo < lo || oo > hi) t0 = Infinity;
              continue;
            }
            const a = (lo - oo) / dd;
            const c = (hi - oo) / dd;
            t0 = Math.max(t0, Math.min(a, c));
            t1 = Math.min(t1, Math.max(a, c));
          }
          if (t0 <= t1 && t0 < (hits.get(b.cell) ?? Infinity)) hits.set(b.cell, t0);
        }
        return [...hits.entries()].sort((x, y) => x[1] - y[1]).map(([cell]) => cell);
      };
      const toCss = (v: import("three").Vector3) => {
        const p = v.clone().project(camera);
        return { x: ((p.x + 1) / 2) * el.clientWidth, y: ((1 - p.y) / 2) * el.clientHeight };
      };
      const hull = (pts: { x: number; y: number }[]) => {
        const s2 = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
        const cr = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
        const lower: typeof pts = [];
        for (const p of s2) {
          while (lower.length >= 2 && cr(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
          lower.push(p);
        }
        const upper: typeof pts = [];
        for (const p of [...s2].reverse()) {
          while (upper.length >= 2 && cr(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
          upper.push(p);
        }
        return [...lower.slice(0, -1), ...upper.slice(0, -1)];
      };
      // The outline is always 64 points along the silhouette from its top-most one, so that the outline of one day can glide into the next one's (a path with the same number of points is interpolated by the browser)
      const resample = (poly: { x: number; y: number }[], n: number) => {
        let start = 0;
        poly.forEach((p, i) => {
          if (p.y < poly[start]!.y) start = i;
        });
        const ring = [...poly.slice(start), ...poly.slice(0, start)];
        const lens = ring.map((p, i) => Math.hypot(ring[(i + 1) % ring.length]!.x - p.x, ring[(i + 1) % ring.length]!.y - p.y));
        const total = lens.reduce((x, y) => x + y, 0);
        const out: { x: number; y: number }[] = [];
        let seg = 0;
        let acc = 0;
        for (let k = 0; k < n; k++) {
          const target = (k / n) * total;
          while (acc + lens[seg]! < target && seg < ring.length - 1) acc += lens[seg++]!;
          const f = lens[seg]! > 0 ? (target - acc) / lens[seg]! : 0;
          const a2 = ring[seg]!;
          const b2 = ring[(seg + 1) % ring.length]!;
          out.push({ x: a2.x + (b2.x - a2.x) * f, y: a2.y + (b2.y - a2.y) * f });
        }
        return out;
      };
      // (days behind one another under the pointer: the stack, where the pointer was when it was made, and whether the visitor is cycling through it)
      let stack: number[] = [];
      let stackAt = { x: 0, y: 0 };
      let cycling = false;
      const announce = (cell: number, behind?: { index: number; count: number }) => {
        current = cell;
        // (the days in front of the one looked at are ghosts: it is seen through them)
        focusOn(cell, behind ? stack.slice(0, behind.index) : []);
        if (cell < 0 || !onHover) return onHover?.(null);
        const g = cells[cell]!;
        const { x, z } = at(g.week, g.day);
        const top = topOf(cell);
        // The silhouette of the day's rounded blocks: each block is a rounded box (corner radius `r`, as built), so its outline is that of its eight corner spheres, which the (orthographic) camera sees as circles of the same size; the hull of
        // them is the outline, with the rounded corners and no flat bevels.
        camera.updateMatrixWorld();
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
        const origin = toCss(new THREE.Vector3(x, 0, z));
        const unit = Math.hypot(toCss(new THREE.Vector3(x, 0, z).add(right)).x - origin.x, toCss(new THREE.Vector3(x, 0, z).add(right)).y - origin.y);
        const corners: { x: number; y: number }[] = [];
        for (const b of picks) {
          if (b.cell !== cell) continue;
          // (a pit's outline is the rounded square it is, not the squashed box of its pick)
          const r = b.pit ? 0.16 : Math.min(0.16, (b.y1 - b.y0) / 2.2);
          for (const dx of [-1, 1]) for (const dz of [-1, 1]) for (const y of b.pit ? [0] : [b.y0 + r, b.y1 - r]) {
            const p = toCss(new THREE.Vector3(x + dx * (0.46 - r), y, z + dz * (0.46 - r)));
            for (let k = 0; k < 10; k++) corners.push({ x: p.x + r * unit * Math.cos((k / 10) * Math.PI * 2), y: p.y + r * unit * Math.sin((k / 10) * Math.PI * 2) });
          }
        }
        const c = toCss(new THREE.Vector3(x, top, z));
        onHover({ index: cell, date: g.date, top: g.value, bottom: layout.bottom.cells[cell]?.value ?? 0, outline: resample(hull(corners), 64).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "), x: c.x, y: c.y, behind });
      };
      const onMove = (e: PointerEvent) => {
        if (e.pointerType === "touch" || settling) return;
        // (cycling holds the selection until the pointer moves away from where it was clicked)
        if (cycling && Math.hypot(e.clientX - stackAt.x, e.clientY - stackAt.y) > 8) {
          cycling = false;
          pinned = false;
        }
        if (pinned) return;
        const here = pickAll(e.clientX, e.clientY);
        const cell = here[0] ?? -1;
        if (cell !== current) {
          stack = here;
          stackAt = { x: e.clientX, y: e.clientY };
          announce(cell, here.length > 1 ? { index: 0, count: here.length } : undefined);
        }
      };
      const onLeave = () => {
        if (!pinned && current !== -1) announce(-1);
      };
      // (a tap on a phone pins a day; a second tap on it, or on nothing, lets it go)
      const onDown = (e: PointerEvent) => {
        if (settling) return;
        const here = pickAll(e.clientX, e.clientY);
        const sameSpot = Math.hypot(e.clientX - stackAt.x, e.clientY - stackAt.y) <= 8 && stack.length > 1;
        if (e.pointerType !== "touch") {
          // (a click on days that are behind one another: the next one behind; after the last, the nearest again)
          if (here.length < 2) return;
          if (!sameSpot || !stack.includes(current)) {
            stack = here;
            stackAt = { x: e.clientX, y: e.clientY };
          }
          const next = (Math.max(0, stack.indexOf(current)) + 1) % stack.length;
          cycling = true;
          pinned = true;
          announce(stack[next]!, { index: next, count: stack.length });
          return;
        }
        // (a tap pins a day; a tap on the same spot goes to the next one behind it, and after the last lets go; a tap elsewhere pins that spot's nearest)
        if (pinned && sameSpot && current >= 0) {
          const next = stack.indexOf(current) + 1;
          if (next < stack.length) return announce(stack[next]!, { index: next, count: stack.length });
          pinned = false;
          return announce(-1);
        }
        const cell = here[0] ?? -1;
        stack = here;
        stackAt = { x: e.clientX, y: e.clientY };
        pinned = cell !== -1 && cell !== current;
        announce(pinned ? cell : -1, pinned && here.length > 1 ? { index: 0, count: here.length } : undefined);
      };
      // (the keys: the arrows walk the days, Escape lets go)
      const onKey = (e: KeyboardEvent) => {
        const last = cells.length - 1;
        let next = current;
        if (e.key === "Escape") {
          pinned = false;
          return announce(-1);
        }
        const step = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }[e.key];
        if (step === undefined) return;
        e.preventDefault();
        next = current < 0 ? last : Math.min(last, Math.max(0, current + step));
        pinned = true;
        announce(next);
      };
      // (not in the tab order: a focus ring round the whole picture is ugly; a click still focuses it, so the arrow keys walk the days after one)
      el.tabIndex = -1;
      dom.addEventListener("pointermove", onMove);
      dom.addEventListener("pointerleave", onLeave);
      dom.addEventListener("pointerdown", onDown);
      el.addEventListener("keydown", onKey);
      el.addEventListener("blur", onLeave);
      // (the first size is taken at once; the next ones wait for the resizing to pause: the old picture is softened meanwhile)
      let first = true;
      let resizeTimer = 0;
      let seenW = 0;
      let seenH = 0;
      const ro = new ResizeObserver(() => {
        if (first) {
          first = false;
          seenW = el.clientWidth;
          seenH = el.clientHeight;
          fit();
          return;
        }
        // (a change of less than a pixel is not a resize: nothing is redrawn for it)
        if (Math.abs(el.clientWidth - seenW) < 1 && Math.abs(el.clientHeight - seenH) < 1) return;
        seenW = el.clientWidth;
        seenH = el.clientHeight;
        soften();
        holdSize();
        pinned = false;
        if (current !== -1) announce(-1);
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(fit, 180);
      });
      ro.observe(el);
      // `recolour`: the colours changed, nothing else: the blocks are built again, but the start-up does not play again (the tubes are simply on)
      const rethink = (recolour = false) => cm(() => rethinkBody(recolour));
      const rethinkBody = (recolour: boolean) => {
        // (a change of theme: the page has already changed, and the old picture, light on a dark page or the reverse, must not stay on it: it goes at once, with no fade: the rebuild blocks the page, and a fade would start only after it, with the old picture on show for its first frames)
        if (!recolour) renderer.domElement.style.transition = "none";
        soften(recolour ? "0.85" : "0");
        pinned = false;
        if (current !== -1) announce(-1);
        (floor.material as import("three").MeshBasicMaterial).color.copy(pageColour());
        // (switching to the dark theme from the light one: the baked light is fetched first, and the blocks are built once, when it is there: built without it they had no neon to start up, so they were drawn lit, then built again, off, and flickered on)
        if (isDark() && !templates && !templatesFailed) {
          // (the old picture's frames must stop meanwhile: its accumulation would reach its tenth sample and bring the old, light picture back into focus on the dark page)
          cancelAnimationFrame(raf);
          raf = 0;
          void wantTemplates().then(() => !cancelled && rethink(recolour));
          return;
        }
        buildBlocks();
        prepareNeon(recolour);
        restart();
      };
      // (`theme: "auto"` follows the system's)
      const onScheme = () => st.theme === "auto" && rethink(false);
      mq.addEventListener("change", onScheme);
      api.rethink = (recolour) => rethink(recolour);

      api.stop = () => {
        stopNeon();
        hum.stop();
        window.clearTimeout(focusTimer);
        window.clearTimeout(focusRaf);
        cancelAnimationFrame(raf);
        window.clearTimeout(resizeTimer);
        dom.removeEventListener("pointermove", onMove);
        dom.removeEventListener("pointerleave", onLeave);
        dom.removeEventListener("pointerdown", onDown);
        el.removeEventListener("keydown", onKey);
        el.removeEventListener("blur", onLeave);
        onHover?.(null);
        ro.disconnect();
        mq.removeEventListener("change", onScheme);
        el.removeAttribute("tabindex");
        blocks.traverse((o) => {
          (o as Mesh).geometry?.dispose();
          (o.userData.dispose as (() => void) | undefined)?.();
        });
        boxes.forEach((g) => g.dispose());
        blockMaterial.dispose();
        coreMaterial.dispose();
        glowMaterial.dispose();
        levelTex.dispose();
        viewObserver?.disconnect();
        templates?.texture.dispose();
        tileUnlit.dispose();
        sceneRT.dispose();
        accumRT.dispose();
        [halfA, halfB, quarterA, quarterB].forEach((t) => t.dispose());
        env.dispose();
        pmrem.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
      });

    })().catch((e) => console.error("[neon-activity-graph]", e));
  return {
    stop() {
      cancelled = true;
      api.stop();
      el.removeAttribute("role");
      el.removeAttribute("aria-roledescription");
      el.removeAttribute("aria-label");
    },
    rethink: (recolour?: boolean) => api.rethink(recolour),
    bounds: () => api.bounds(),
    ready,
  };
}
