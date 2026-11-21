import type { BufferGeometry, Color, Mesh } from "three";
import { createGroundLight, loadCausticTemplates, type CausticTemplates, type GlassLight } from "./ground-light";
import { layoutGraph, type Matrix } from "./layout";
import { createNeon } from "./neon";
import { renderSize } from "./size";
import type { GraphData, GraphOptions, LayerColors, Startup, Tones } from "./types";
import { CAMERA_DIR, roomFor, slabFor, stripShifts } from "./view";

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
  stop(): void;
  rethink(): void;
  ready: Promise<void>;
}

/**
 * The activity of the year as two matrices of blocks seen from an isometric camera that never moves (the bottom layer at the bottom of each day's column, the top layer on top): the height
 * and the colour of a block follow the intensity of the day. Because nothing moves the picture is progressive: each animation frame renders the scene with the sun a little elsewhere
 * (an area light's soft shadow) and the camera a sub-pixel away (anti-aliasing) and adds it to an accumulation buffer; after `SAMPLES` frames the loop stops and the canvas keeps the
 * result. Translucent rounded blocks (transmission, refraction) lit by a room environment, on a ground that only receives the shadows, so it sits on the page's own background.
 */
export function mountScene(el: HTMLElement, opts: GraphOptions & { data: GraphData }, st: { theme: "light" | "dark" | "auto" }): SceneHandle {
  const api = { stop: () => {}, rethink: () => {} };
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
      renderer.domElement.style.cssText = "display:block;width:100%;height:100%;transition:filter .4s ease,opacity .4s ease";
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
      const sharpen = () => {
        settling = false;
        if (!announced) {
          announced = true;
          onReady?.();
        }
        renderer.domElement.style.filter = "";
        renderer.domElement.style.opacity = "";
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
      const weigh = new Map<number, number>();
      for (const m of [layout.top, layout.bottom]) for (const c of m.cells) weigh.set(c.week * 7 + c.day, (weigh.get(c.week * 7 + c.day) ?? 0) + 0.18 + c.t * 2.2);
      const { width, total, at, corners } = slabFor(layout.top.weeks, strips, stripShifts(layout.top.weeks, strips, (week, day) => weigh.get(week * 7 + day) ?? 0.18));

      const scene = new THREE.Scene();
      const pmrem = new THREE.PMREMGenerator(renderer);
      const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = env;
      scene.environmentIntensity = 0.9;

      // glass: it transmits (refracts) what is behind it, the ground and the blocks' own colour tint what passes through
      /** The film grain's strength over the whole picture (0 for none). */
      const GRAIN = opts.grain ?? 0.012;
      /** (light theme) how strong the room's reflections (environment) and the clear coat's are, relative to what comes through the glass. */
      const LIGHT_ENV = 0.85;
      const LIGHT_COAT = 0.4;
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
      const tileUnlit = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
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
      const coreMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0 });
      // (in the dark theme the cores are lights: unlit, their colour is the light they give out, brighter than 1 for a busy day, which the bloom and the glow on the ground turn into a glow)
      const glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
      // how much each rod gives out, 0 to 1, one number per block, read by the rod's vertices (`aBlock` is the block's number): the neon start-up changes them over time
      // what is left of a block when its rod is off, the same for all of them: the glass's own glow and the room's reflections in it, as absolute intensities
      const OFF_EMISSIVE = 0.0115;
      const OFF_ENV = 0.029;
      const MAX_LEVELS = 1024;
      // (two numbers a block: what its own rod gives out, and how much of the light of the blocks around it, which are on, reaches it, 0 to 1, against all of them on)
      const levelData = new Float32Array(MAX_LEVELS * 2).fill(1);
      const levelTex = new THREE.DataTexture(levelData, MAX_LEVELS, 1, THREE.RGFormat, THREE.FloatType);
      levelTex.needsUpdate = true;
      glowMaterial.onBeforeCompile = (shader) => {
        shader.uniforms.uLevels = { value: levelTex };
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nattribute float aBlock;\nattribute vec3 aInc;\nuniform highp sampler2D uLevels;")
          .replace("#include <color_vertex>", "#include <color_vertex>\n#ifdef USE_COLOR\n  vec2 lv = texelFetch(uLevels, ivec2(int(aBlock + 0.5), 0), 0).rg;\n  vColor.rgb = vColor.rgb * lv.r + vec3(0.029, 0.037, 0.053) * (1.0 - lv.r) + aInc * lv.g;\n#endif");
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
      const ABSORB = 1.1;
      const LIGHT_CAUSTIC = 1.0;
      const STRAIGHT = 0.65;
      // how deep the shadows go (a share of the traced loss of light) and how much the caustics are pushed
      const SHADOW = 0.5;
      const GLEAM = 2.2;
      // (light theme) how far from its block the sun's light is counted in full, and where it has faded out
      const NOISE_FLOOR = 0.03;
      const GLEAM_MAX = 0.45;
      const SUN_NEAR = 3.4;
      const SUN_FAR = 6;
      const PX = 22;
      // the traced light is counted on a grid half as fine: enough rays in each cell to look like light and not like grain
      const LPX = PX / 2;
      let neonNeighbours: { j: number[]; m: number[] }[] = [];
      let neonBlocks: { x: number; z: number; pan: number; t: number; cell: number }[] = [];
      let stampCtl: { update(levels: ArrayLike<number>): void } | null = null;
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
        const occlude = (x: number, z: number, height: number) => {
          const cx = (x + GLOW_PAD) * PX;
          const cy = (z + GLOW_PAD) * PX;
          const r = (0.75 + 0.22 * height) * PX;
          const g = actx.createRadialGradient(cx, cy, 0.3 * PX, cx, cy, r);
          const a = Math.min(0.85, (dark ? 0.5 : 0.28) + 0.06 * height);
          g.addColorStop(0, `rgba(0,0,0,${a})`);
          g.addColorStop(0.5, `rgba(0,0,0,${a * 0.4})`);
          g.addColorStop(1, "rgba(0,0,0,0)");
          actx.fillStyle = g;
          actx.fillRect(cx - r, cy - r, r * 2, r * 2);
        };
        stack.top.cells.forEach((g, i) => {
          const w = stack.bottom.cells[i]!;
          const { x, z } = at(g.week, g.day);
          if (w.value > 0 || g.value > 0) occlude(x, z, (w.value > 0 ? 0.18 + w.t * LAYER_MAX : 0) + (g.value > 0 ? 0.18 + g.t * LAYER_MAX : 0));
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
              : src === "bottom"
                ? hue.clone().multiplyScalar(0.5).add(new THREE.Color(0.4, 0.56, 0.6).multiplyScalar(0.38 + 0.98 * t))
                : hue.clone().multiplyScalar(1.25).add(new THREE.Color(0.22, 0.4, 0.24).multiplyScalar(0.15 + 0.7 * t));
            const col = dark ? rod.multiplyScalar(1 / Math.max(1e-4, rod.r, rod.g, rod.b)) : hue;
            // (`rodColor`: a white light adds to all three channels, so on the ground it washes out the colours around it: it lights the ground half as much)
            const whiteLight = customOn() && Math.max(hue.r, hue.g, hue.b) - Math.min(hue.r, hue.g, hue.b) < 0.15 * Math.max(hue.r, hue.g, hue.b) ? 0.5 : 1;
            // (no two blocks are alike: a small tilt of the glass of each, a strength and a reach of its own)
            const tilt = (): number => (variety() - 0.5) * 0.22;
            const luck = 0.6 + 0.8 * variety();
            const near = dark ? CAUSTIC_NEAR : SUN_NEAR;
            const far = dark ? CAUSTIC_FAR : SUN_FAR;
            neonBlocks.push({ x, z, pan: (x / width) * 2 - 1, t, cell: i });
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
  ${shade ? `gl_FragColor = vec4(vec3(1. - ${SHADOW.toFixed(3)} * (1. - min(f, vec3(1.)))), 1.);` : `vec3 g = max(f - 1., 0.) * ${GLEAM.toFixed(3)}; gl_FragColor = vec4(${GLEAM_MAX.toFixed(3)} * tanh(g / ${GLEAM_MAX.toFixed(3)}), 1.);`}
}`,
              transparent: true,
              blending: shade ? THREE.MultiplyBlending : THREE.AdditiveBlending,
              premultipliedAlpha: shade,
              depthWrite: false,
            });
          plane(ground.texture, () => resolve(true), 0);
          plane(ground.texture, () => resolve(false), 1);
        }
        const aoTex = new THREE.CanvasTexture(ao);
        aoTex.colorSpace = THREE.SRGBColorSpace;
        plane(aoTex, (map) => new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false }), 2);
        disposers.push(() => ground.dispose());
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
      // the boxes a pointer can hit (one per layer of a column, one per empty day), for the picking
      interface PickBox { cell: number; x: number; z: number; y0: number; y1: number }
      let picks: PickBox[] = [];
      const LIFT = 0.04;
      const build = (stack: { bottom: Matrix; top: Matrix }, tones: { bottom: [Color, Color]; top: [Color, Color] }, dark: boolean) => {
        picks = [];
        const shellsBy = new Map<string, BufferGeometry[]>();
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
            // a flat tile with the same rounded corners as the blocks (a rounded square, extruded 0.04)
            const tile = new THREE.ExtrudeGeometry(roundedSquare, { depth: 0.04, bevelEnabled: false, curveSegments: lite ? 3 : 6 });
            tile.rotateX(-Math.PI / 2);
            tile.deleteAttribute("uv");
            tile.translate(x, 0, z);
            // (dark) a very dim grey of its own, a little over the page's: an empty day is a faint plate, not a hole
            paint(tile, dark ? pageColour().add(new THREE.Color(0.006, 0.006, 0.006)) : pageColour().multiplyScalar(0.93));
            tiles.push(tile);
            picks.push({ cell: i, x, z, y0: 0, y1: 0.04 });
            return;
          }
          let y = 0;
          if (w.value > 0) y = layer(i, "bottom", x, z, 0, w.t, tones.bottom) + LIFT;
          if (g.value > 0) layer(i, "top", x, z, y, g.t, tones.top);
        });
        let blockIndex = 0;
        neonNeighbours = [];
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
          const shell = new RoundedBoxGeometry(0.92, h, 0.92, lite ? 2 : 3, Math.min(0.16, h / 2.2));
          shell.translate(x, y0 + h / 2, z);
          // dark: the glass is nearly clear (the light of its core shows through it); light: tinted by the level
          paint(shell, hue.clone().lerp(new THREE.Color(0xffffff), dark ? 0.14 : 0.12).multiplyScalar(dark ? 0.3 + 0.7 * tEff : 1).add(inc.clone().multiplyScalar(dark && customOn() ? 0.35 : 0.08)), 0, dark);
          shell.setAttribute("aBlock", new THREE.BufferAttribute(new Float32Array(shell.getAttribute("position").count).fill(blockIndex), 1));
          // the glass of a busy day glows on its own surface too (dark theme): three steps of emission per source, each its own material
          const tier = tEff < 0.34 ? 0 : tEff < 0.67 ? 1 : 2;
          const key = `${src}${tier}`;
          (shellsBy.get(key) ?? shellsBy.set(key, []).get(key)!).push(shell);
          shellTier.set(key, [src, tier]);
          const hc = h * 0.8;
          // (dark) the busier the day the thinner and the brighter its rod: a quiet one is as wide as before and dim, a busy one a slender, intense filament
          const cw = dark ? 0.5 - 0.2 * t ** 0.85 : 0.5;
          const core = new RoundedBoxGeometry(cw, hc, cw, lite ? 1 : 2, Math.min(0.1, cw / 2.4, hc / 2.2));
          core.translate(x, y0 + h / 2, z);
          // A blue rod gets its brightness from light added to all three channels (not from more of the same blue, which only makes it bluer and more glowing): a brighter rod is a lighter, clearer blue, not a whiter one
          // (its hue is kept: the blue channel is the hue's own and the red and green rise with the busyness).
          const level = emit(t) * (1 + 1.1 * t);
          const rod = dark && customOn() ? hue0.clone().multiplyScalar(level * 0.55 * (Math.max(hue0.r, hue0.g, hue0.b) - Math.min(hue0.r, hue0.g, hue0.b) < 0.15 * Math.max(hue0.r, hue0.g, hue0.b) ? WHITE_ROD : 1)) : dark && src === "bottom" ? hue.clone().multiplyScalar(level * 0.5).add(new THREE.Color(0.4, 0.56, 0.6).multiplyScalar(level * (0.38 + 0.98 * t))) : dark ? hue.clone().multiplyScalar(level * 1.25).add(new THREE.Color(0.22, 0.4, 0.24).multiplyScalar(level * (0.15 + 0.7 * t))) : hue;
          paint(core, dark ? rod : hue);
          // (the light of the blocks around that reaches this rod when its own is off, on its own attribute: the shader adds it, as much as the neighbours that are on give)
          {
            const count = core.getAttribute("position").count;
            const incs = new Float32Array(count * 3);
            if (dark) for (let q = 0; q < count; q++) inc.toArray(incs, q * 3);
            core.setAttribute("aInc", new THREE.BufferAttribute(incs, 3));
          }
          core.setAttribute("aBlock", new THREE.BufferAttribute(new Float32Array(core.getAttribute("position").count).fill(blockIndex++), 1));
          cores.push(core);
        }
        const group = new THREE.Group();
        group.add(groundLayers(stack, tones, dark));
        if (tiles.length) {
          const tile = new THREE.Mesh(mergeGeometries(tiles), tileUnlit);
          group.add(tile);
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
            mat.attenuationColor.copy(customOn() ? new THREE.Color(0xffffff) : tones[src][1]);
            // (the blue glass absorbs less: a rod that is meant to be near white would otherwise be seen through a blue filter and come out saturated)
            mat.attenuationDistance = src === "bottom" ? 3.6 : 2.2;
            // A green filter passes green and stops the rest: blue light behind it is not turned into green, it is nearly all absorbed (what comes through is a few percent, not a green of the same brightness).
            if (src === "top" && !customOn()) {
              mat.attenuationColor.r *= 0.2;
              mat.attenuationColor.b *= 0.15;
              mat.attenuationDistance = 1.6;
            }
          }
          mat.emissiveIntensity = dark ? [0.02, 0.08, 0.15][tier]! : 0;
          if (dark) {
            // the glass shines as its rod does, down to a little ambient light of the night (the floor 0.14): its own glow and the room's reflections in it follow the rod's level, so that a block whose rod is off is dark
            mat.onBeforeCompile = (shader) => {
              shader.uniforms.uLevels = { value: levelTex };
              // (what is left of the glow and of the reflections when the rod is off is the same for every block, whatever its size or its day: as a share of this tier's own intensities, whatever they are)
              shader.uniforms.uFloorEm = { value: OFF_EMISSIVE / Math.max(mat.emissiveIntensity, 1e-4) };
              shader.uniforms.uFloorEnv = { value: OFF_ENV / Math.max(mat.envMapIntensity, 1e-4) };
              shader.vertexShader = shader.vertexShader
                .replace("#include <common>", "#include <common>\nattribute float aBlock;\nuniform highp sampler2D uLevels;\nuniform float uFloorEm;\nuniform float uFloorEnv;\nvarying float vLevelEm;\nvarying float vLevelEnv;\nvarying float vOn;")
                .replace("#include <begin_vertex>", "#include <begin_vertex>\n  vec2 lv = texelFetch(uLevels, ivec2(int(aBlock + 0.5), 0), 0).rg;\n  float own = max(lv.r, 0.3 * lv.g);\n  vOn = clamp(own, 0.0, 1.0);\n  vLevelEm = max(own, uFloorEm);\n  vLevelEnv = max(own, uFloorEnv);");
              shader.fragmentShader = shader.fragmentShader
                .replace("#include <common>", "#include <common>\nvarying float vLevelEm;\nvarying float vLevelEnv;\nvarying float vOn;")
                .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n  // (off, the glass glows the same cool grey whatever its source; on, its own colour)\n  totalEmissiveRadiance = mix(vec3(dot(totalEmissiveRadiance, vec3(0.333))) * vec3(0.85, 0.95, 1.15), totalEmissiveRadiance, vOn) * vLevelEm;")
                .replace("#include <lights_fragment_maps>", "#include <lights_fragment_maps>\n#if defined( RE_IndirectSpecular )\n  radiance *= vLevelEnv;\n#ifdef USE_CLEARCOAT\n  clearcoatRadiance *= vLevelEnv;\n#endif\n#endif\n#if defined( RE_IndirectDiffuse )\n  iblIrradiance *= vLevelEnv;\n#endif");
            };
            mat.customProgramCacheKey = () => "glass-levels";
          }
          // (the room's reflections are a light too: a quiet day must not shine with them)
          // (a material's own `envMap` is what `envMapIntensity` scales; without it the scene's environment is used as it is)
          mat.envMap = dark ? env : null;
          mat.envMapIntensity = dark ? [0.02, 0.18, 0.55][tier]! : LIGHT_ENV;
          if (!dark) {
            // (light theme: the glass's own colour is what is seen, through it; the room's reflections on the top and the edges are fainter, and tinted by the glass instead of grey, so that they read as glass and not as polished metal)
            mat.clearcoat = LIGHT_COAT;
            mat.specularColor = tones[src][1].clone().lerp(new THREE.Color(0xffffff), 0.35);
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
          core.castShadow = !dark;
          group.add(core);
        }
        [...cores, ...tiles].forEach((p) => p.dispose());
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
          return [new THREE.Color(low), new THREE.Color(high)];
        };
        blocks.add(build({ bottom: layout.bottom, top: layout.top }, { bottom: pair("bottom"), top: pair("top") }, dark));
      };

      const floor = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshBasicMaterial({ color: pageColour() }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(width / 2, -0.02, total / 2);
      scene.add(floor);
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.ShadowMaterial({ opacity: 0.32 }));
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
        restart();
      };

      const frames: number[] = [];
      const frame = () => cm(() => frameBody());
      // `count` samples are added up before anything is shown (one, when the picture is converging frame by frame; a few at once for an update of the lights, so that the picture never shows its first, rawest samples in a row: that is a shimmer of the whole picture)
      const frameBody = (count = 1) => {
        raf = 0;
        const f0 = performance.now();
        for (let c = 0; c < count; c++) {
          // the sun moves on a disc (the soft shadow), the camera a sub-pixel (the anti-aliasing)
          const a = halton(n, 2) * Math.PI * 2;
          const r = Math.sqrt(halton(n, 3)) * 9;
          sun.position.copy(sunBase).add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)).add(sun.target.position);
          camera.setViewOffset(w, h, halton(n, 5) - 0.5, halton(n, 7) - 0.5, w, h);
          renderer.setRenderTarget(sceneRT);
          renderer.setClearColor(0x000000, 0);
          renderer.clear();
          renderer.render(scene, camera);
          renderer.setRenderTarget(accumRT);
          renderer.autoClear = false;
          addMat.blendAlpha = 1 / (n + 1);
          renderer.render(quadScene, quadCam);
          renderer.autoClear = true;
          n++;
        }
        if (settling && n >= Math.min(10, samples)) sharpen();
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
      const burst = (k: number) => {
        cancelAnimationFrame(raf);
        raf = 0;
        n = 0;
        samplesCap = k;
        cm(() => frameBody(k));
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
      const FOCUS_OFF = 0.42;
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
        samplesCap = Math.min(samplesCap, lite ? 2 : 3);
        restart();
        if (moving) focusRaf = window.setTimeout(stepFocus, 1000 / (lite ? 20 : 30)) as unknown as number;
        else {
          samplesCap = samples;
          restart();
        }
      };
      // (a debounce: the day is taken a moment after the pointer stops on it, and let go a moment after it leaves)
      const GHOST = 0.12;
      const focusOn = (cell: number, ghosts: number[] = []) => {
        window.clearTimeout(focusTimer);
        if (!focusCtl) return;
        focusTimer = window.setTimeout(() => {
          for (let i = 0; i < focusTo.length; i++) focusTo[i] = cell < 0 ? 1 : neonBlocks[i]!.cell === cell ? FOCUS_ON : ghosts.includes(neonBlocks[i]!.cell) ? GHOST : FOCUS_OFF;
          window.clearTimeout(focusRaf);
          stepFocus();
        }, cell < 0 ? 140 : 70);
      };
      const prepareNeon = () => {
        stopNeon();
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
        if (focusCtl) applyLevels(lastLevels);
        if (!isDark() || !neonAllowed() || !stampCtl || neonBlocks.length === 0 || neonBlocks.length > MAX_LEVELS) return void onLit?.(true);
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
            burst(lite ? 2 : 3);
          },
          done: () => {
            onLit?.(true);
            samplesCap = samples;
            restart();
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
          const half = Float32Array.from(neonBlocks, (b) => (b.pan < 0.1 ? 1 : 0));
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
          const r = Math.min(0.16, (b.y1 - b.y0) / 2.2);
          for (const dx of [-1, 1]) for (const dz of [-1, 1]) for (const y of [b.y0 + r, b.y1 - r]) {
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
      const ro = new ResizeObserver(() => {
        if (first) {
          first = false;
          fit();
          return;
        }
        soften();
        pinned = false;
        if (current !== -1) announce(-1);
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(fit, 180);
      });
      ro.observe(el);
      const rethink = () => cm(rethinkBody);
      const rethinkBody = () => {
        soften();
        pinned = false;
        if (current !== -1) announce(-1);
        (floor.material as import("three").MeshBasicMaterial).color.copy(pageColour());
        // (switching to the dark theme from the light one: the baked light is fetched then, and the blocks built again when it is there)
        if (isDark() && !templates && !templatesFailed) void wantTemplates().then(() => !cancelled && templates && rethink());
        buildBlocks();
        prepareNeon();
        restart();
      };
      // (`theme: "auto"` follows the system's)
      const onScheme = () => st.theme === "auto" && rethink();
      mq.addEventListener("change", onScheme);
      api.rethink = rethink;

      api.stop = () => {
        stopNeon();
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
    rethink: () => api.rethink(),
    ready,
  };
}
