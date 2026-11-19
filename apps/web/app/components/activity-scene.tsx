import { useEffect, useRef } from "react";
import type { BufferGeometry, Color, Mesh } from "three";
import { layoutActivity, type Activity, type HoverInfo, type Matrix } from "~/lib/activity";
import { CAMERA_DIR, roomFor, slabFor } from "~/lib/activity-view";

/** How many jittered frames are averaged before the picture is final (soft shadows, anti-aliasing): the scene never moves, so it is drawn once, a frame at a time, and then not at all. */
const SAMPLES = 96;

/**
 * How much the device is asked to do: a phone, or a machine with few cores or little memory, gets the light version (a third of the frames, a lower resolution, simpler blocks, a smaller shadow map, a single bloom);
 * the page can also leave the scene out altogether (`ActivityPanel`: no WebGL 2, "save data"). Not measured on real devices yet (owner, 2026-11-19: it needs heavy testing before it ships).
 */
const isLite = () => {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return window.matchMedia("(pointer: coarse)").matches || (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) < 4;
};

const isDark = () => {
  const forced = document.documentElement.getAttribute("data-scheme");
  return forced ? forced === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
};

/**
 * The activity of the year as two matrices of blocks seen from an isometric camera that never moves (WakaTime's coding time at the bottom of each day's column, GitHub's contributions on top): the height
 * and the colour of a block follow the intensity of the day. Because nothing moves the picture is progressive: each animation frame renders the scene with the sun a little elsewhere
 * (an area light's soft shadow) and the camera a sub-pixel away (anti-aliasing) and adds it to an accumulation buffer; after `SAMPLES` frames the loop stops and the canvas keeps the
 * result. Translucent rounded blocks (transmission, refraction) lit by a room environment, on a ground that only receives the shadows, so it sits on the page's own background.
 */
export function ActivityScene({ activity, strips = 1, onReady, onHover, className }: { activity: Activity; strips?: number; onReady?: () => void; onHover?: (info: HoverInfo | null) => void; className?: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let stop = () => {};
    let cancelled = false;
    (async () => {
      const THREE = await import("three");
      const { RoundedBoxGeometry } = await import("three/examples/jsm/geometries/RoundedBoxGeometry.js");
      const { mergeGeometries } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");
      const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
      if (cancelled) return;

      const layout = layoutActivity(activity);
      const lite = isLite();
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
      const sharpen = () => {
        settling = false;
        if (!announced) {
          announced = true;
          onReady?.();
        }
        renderer.domElement.style.filter = "";
        renderer.domElement.style.opacity = "";
      };
      soften("0");

      // the room the glow of the outermost columns needs around the slab, so the picture does not cut it
      const ROOM = roomFor(strips);
      // The year is a long strip of weeks; on a narrow page it is cut into `strips` strips of equal length laid one behind the other, so the slab is closer to a square and fills the width
      const { width, total, at } = slabFor(layout.github.weeks, strips);

      const scene = new THREE.Scene();
      const pmrem = new THREE.PMREMGenerator(renderer);
      const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = env;
      scene.environmentIntensity = 0.9;

      // glass: it transmits (refracts) what is behind it, the ground and the blocks' own colour tint what passes through
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
        const probe = document.createElement("canvas");
        probe.width = probe.height = 1;
        const ctx = probe.getContext("2d")!;
        const el2 = document.createElement("div");
        el2.style.cssText = "position:fixed;visibility:hidden;background:var(--background)";
        document.body.appendChild(el2);
        const css = getComputedStyle(el2).backgroundColor;
        el2.remove();
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        return new THREE.Color().setRGB(r! / 255, g! / 255, b! / 255, THREE.SRGBColorSpace);
      };

      // each block is a glass shell around a smaller opaque core of the same colour: the core is what the glass refracts, so the block has depth instead of reading as a pale solid
      const coreMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0 });
      // (in the dark theme the cores are lights: unlit, their colour is the light they give out, brighter than 1 for a busy day, which the bloom and the glow on the ground turn into a glow)
      const glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
      const paint = (g: BufferGeometry, col: Color, glow = 0) => {
        const n = g.getAttribute("position").count;
        const colors = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) col.toArray(colors, i * 3);
        g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        g.setAttribute("aGlow", new THREE.BufferAttribute(new Float32Array(n).fill(glow), 1));
        g.deleteAttribute("uv");
      };
      // The glow a column casts on the ground (the dark theme's answer to the shadows of the light one): a soft additive spot under each layer's column in its colour, as bright as the day was busy, painted on a canvas laid on the ground
      const GLOW_PAD = 5;
      const PX = 22;
      const groundLayers = (stack: { waka: Matrix; github: Matrix }, tones: { waka: [Color, Color]; github: [Color, Color] }, dark: boolean) => {
        const cw = Math.ceil((width + GLOW_PAD * 2) * PX);
        const ch = Math.ceil((total + GLOW_PAD * 2) * PX);
        const canvas = () => {
          const c2 = document.createElement("canvas");
          c2.width = cw;
          c2.height = ch;
          return c2;
        };
        const cv = canvas();
        const ctx = cv.getContext("2d")!;
        ctx.globalCompositeOperation = "lighter";
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
        const spot = (x: number, z: number, t: number, [low, high]: [Color, Color], reach: number) => {
          const col = low.clone().lerp(high, t);
          const rgb = `${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)}`;
          const cx = (x + GLOW_PAD) * PX;
          const cy = (z + GLOW_PAD) * PX;
          const r = (0.9 + reach * (0.5 + t * 1.5)) * PX;
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
          const a = 0.004 + 0.3 * t * t + 0.03 * t;
          g.addColorStop(0, `rgba(${rgb},${a})`);
          g.addColorStop(0.45, `rgba(${rgb},${a * 0.35})`);
          g.addColorStop(1, `rgba(${rgb},0)`);
          ctx.fillStyle = g;
          ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
        };
        stack.github.cells.forEach((g, i) => {
          const w = stack.waka.cells[i]!;
          const { x, z } = at(g.week, g.day);
          if (dark && w.value > 0) spot(x, z, w.t, tones.waka, 1.1);
          if (dark && g.value > 0) spot(x, z, g.t, tones.github, 1.5);
          if (w.value > 0 || g.value > 0) occlude(x, z, (w.value > 0 ? 0.18 + w.t * LAYER_MAX : 0) + (g.value > 0 ? 0.18 + g.t * LAYER_MAX : 0));
        });
        const layers = new THREE.Group();
        const disposers: (() => void)[] = [];
        const plane = (source: HTMLCanvasElement, material: (tex: import("three").CanvasTexture) => import("three").MeshBasicMaterial, order: number) => {
          const tex = new THREE.CanvasTexture(source);
          tex.colorSpace = THREE.SRGBColorSpace;
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
        if (dark) plane(cv, (map) => new THREE.MeshBasicMaterial({ map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), 1);
        plane(ao, (map) => new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false }), 2);
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
      const build = (stack: { waka: Matrix; github: Matrix }, tones: { waka: [Color, Color]; github: [Color, Color] }, dark: boolean) => {
        picks = [];
        const shellsBy = new Map<string, BufferGeometry[]>();
        const shellTier = new Map<string, ["waka" | "github", number]>();
        const cores: BufferGeometry[] = [];
        const tiles: BufferGeometry[] = [];
        // the layers are first only noted (where, how tall, how busy, which colour), so that each can be lit by the others before its geometry is made
        interface Spec { src: "waka" | "github"; x: number; z: number; y0: number; h: number; t: number; hue: Color }
        const specs: Spec[] = [];
        // (a quiet day still has a faint light at its heart, an old bulb struggling: the floor of the emission)
        // (the lift is for the quietest days only: it fades out well before a busy one)
        const emit = (t: number) => 0.3 + 0.1 * (1 - t) ** 3 + 1.6 * t * t + 0.4 * t;
        const layer = (cell: number, src: "waka" | "github", x: number, z: number, y0: number, t: number, [low, high]: [Color, Color]) => {
          const h = 0.18 + t * LAYER_MAX;
          picks.push({ cell, x, z, y0, y1: y0 + h });
          specs.push({ src, x, z, y0, h, t, hue: low.clone().lerp(high, t) });
          tallest = Math.max(tallest, y0 + h);
          return y0 + h;
        };
        stack.github.cells.forEach((g, i) => {
          const w = stack.waka.cells[i]!;
          const { x, z } = at(g.week, g.day);
          if (w.value <= 0 && g.value <= 0) {
            // a flat tile with the same rounded corners as the blocks (a rounded square, extruded 0.04)
            const tile = new THREE.ExtrudeGeometry(roundedSquare, { depth: 0.04, bevelEnabled: false, curveSegments: lite ? 3 : 6 });
            tile.rotateX(-Math.PI / 2);
            tile.deleteAttribute("uv");
            tile.translate(x, 0, z);
            paint(tile, pageColour().multiplyScalar(dark ? 1.5 : 0.93));
            tiles.push(tile);
            picks.push({ cell: i, x, z, y0: 0, y1: 0.04 });
            return;
          }
          let y = 0;
          if (w.value > 0) y = layer(i, "waka", x, z, 0, w.t, tones.waka) + LIFT;
          if (g.value > 0) layer(i, "github", x, z, y, g.t, tones.github);
        });
        for (const sp of specs) {
          const { src, x, z, y0, h, t, hue } = sp;
          // (dark) the light the other days give out reaches this one: each neighbour's colour and brightness, weakened with the distance between the two blocks; a dim block beside or under a bright one is lit by it
          const inc = new THREE.Color(0, 0, 0);
          if (dark) {
            for (const o of specs) {
              if (o === sp) continue;
              const dx = o.x - x;
              const dz = o.z - z;
              if (Math.abs(dx) > 4 || Math.abs(dz) > 4) continue;
              const dy = o.y0 + o.h / 2 - (y0 + h / 2);
              const k = Math.exp(-(dx * dx + dz * dz + dy * dy) / (2 * 1.2 * 1.2)) * 0.11;
              inc.add(o.hue.clone().multiplyScalar(emit(o.t) * k));
            }
          }
          inc.r = Math.min(inc.r, 0.6);
          inc.g = Math.min(inc.g, 0.6);
          inc.b = Math.min(inc.b, 0.6);
          const incLum = (inc.r + inc.g + inc.b) / 3;
          const tEff = Math.min(1, Math.sqrt(t * t + incLum * 1.2));
          const shell = new RoundedBoxGeometry(0.92, h, 0.92, lite ? 2 : 3, Math.min(0.16, h / 2.2));
          shell.translate(x, y0 + h / 2, z);
          // dark: the glass is nearly clear (the light of its core shows through it); light: tinted by the level
          paint(shell, hue.clone().lerp(new THREE.Color(0xffffff), dark ? 0.15 : 0.12).multiplyScalar(dark ? 0.12 + 0.88 * tEff : 1).add(inc.clone().multiplyScalar(0.3)));
          // the glass of a busy day glows on its own surface too (dark theme): three steps of emission per source, each its own material
          const tier = tEff < 0.34 ? 0 : tEff < 0.67 ? 1 : 2;
          const key = `${src}${tier}`;
          (shellsBy.get(key) ?? shellsBy.set(key, []).get(key)!).push(shell);
          shellTier.set(key, [src, tier]);
          const hc = h * 0.8;
          const core = new RoundedBoxGeometry(0.5, hc, 0.5, lite ? 1 : 2, Math.min(0.1, hc / 2.2));
          core.translate(x, y0 + hc / 2 + 0.03, z);
          paint(core, dark ? hue.clone().multiplyScalar(emit(t)).add(inc) : hue);
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
          mat.emissive.copy(tones[src][1]);
          mat.emissiveIntensity = dark ? [0.02, 0.12, 0.3][tier]! : 0;
          // (the room's reflections are a light too: a quiet day must not shine with them)
          // (a material's own `envMap` is what `envMapIntensity` scales; without it the scene's environment is used as it is)
          mat.envMap = dark ? env : null;
          mat.envMapIntensity = dark ? [0.02, 0.18, 0.55][tier]! : 1.4;
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
      const ground0 = () => ((ground.material as import("three").ShadowMaterial).opacity = isDark() ? 0 : 0.32);
      const buildBlocks = () => {
        showMat.uniforms.bloom!.value = isDark() ? 1 : 0;
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
        const c = (hex: number) => new THREE.Color(hex);
        // each source has its own hue and the level of the day is the brightness: a quiet day is a dim dark shade, a busy one the brightest (GitHub: its own green, #0fbf3e; WakaTime: the site's BSoD blue, #0078d7)
        blocks.add(
          build(
            { waka: layout.wakatime, github: layout.github },
            { waka: [c(dark ? 0x0f5aa8 : 0x1658b8), c(dark ? 0x1f9bff : 0x1a8cff)], github: [c(dark ? 0x0f8a2c : 0x0a8f2c), c(dark ? 0x0fbf3e : 0x00d63c)] },
            dark,
          ),
        );
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
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);
      const centre = new THREE.Vector3(width / 2, 1.2, total / 2);
      camera.position.copy(centre).add(new THREE.Vector3(...CAMERA_DIR).normalize().multiplyScalar(150));
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
        uniforms: { map: { value: accumRT.texture }, bloom: { value: 0 }, near: { value: halfA.texture }, far: { value: quarterA.texture } },
        vertexShader: VERT,
        fragmentShader: `uniform sampler2D map; uniform sampler2D near; uniform sampler2D far; uniform float bloom; varying vec2 vUv;
void main(){
  vec4 c = texture2D(map, vUv);
  if (bloom > 0.) c.rgb += bloom * (texture2D(near, vUv).rgb * 0.5 + texture2D(far, vUv).rgb * 0.35);
  gl_FragColor = c;
#include <colorspace_fragment>
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
        const dpr = lite ? 1 : Math.min(window.devicePixelRatio || 1, 2);
        w = Math.max(1, Math.round(el.clientWidth * dpr));
        h = Math.max(1, Math.round(el.clientHeight * dpr));
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
        for (const cx of [-ROOM.side, width + ROOM.side]) for (const cy of [0, tallest]) for (const cz of [-ROOM.near, total + ROOM.far]) {
          const p = new THREE.Vector3(cx, cy, cz).applyMatrix4(inv);
          x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
        }
        if (import.meta.env.DEV) el.dataset.fit = ((x1 - x0) / (y1 - y0)).toFixed(3);
        const aspect = w / h;
        const halfH = Math.max((y1 - y0) / 2, (x1 - x0) / 2 / aspect) * 1.04;
        const mx = (x0 + x1) / 2;
        const my = (y0 + y1) / 2;
        camera.left = mx - halfH * aspect;
        camera.right = mx + halfH * aspect;
        camera.top = my + halfH;
        camera.bottom = my - halfH;
        camera.updateProjectionMatrix();
        restart();
      };

      const frames: number[] = [];
      const frame = () => {
        raf = 0;
        const f0 = performance.now();
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
        if (import.meta.env.DEV) {
          // (development only: how long a frame takes, the GPU included: `finish` waits for it)
          renderer.getContext().finish();
          frames.push(performance.now() - f0);
          el.dataset.frameMs = (frames.reduce((x, y) => x + y, 0) / frames.length).toFixed(1);
        }
        if (n < samples) raf = requestAnimationFrame(frame);
        else if (import.meta.env.DEV) el.dataset.renderMs = String(Math.round(performance.now() - t0));
      };
      function restart() {
        n = 0;
        if (!raf) raf = requestAnimationFrame(frame);
      }

      buildBlocks();
      // --- hovering: the day under the pointer (or the key) ---
      const dom = renderer.domElement;
      const ray = new THREE.Raycaster();
      const ndc = new THREE.Vector2();
      let current = -1;
      let pinned = false;
      const cells = layout.github.cells;
      const topOf = (cell: number) => picks.filter((b) => b.cell === cell).reduce((m, b) => Math.max(m, b.y1), 0);
      const pick = (cx: number, cy: number) => {
        const r = dom.getBoundingClientRect();
        ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
        camera.updateMatrixWorld();
        ray.setFromCamera(ndc, camera);
        const o = ray.ray.origin;
        const d = ray.ray.direction;
        let best = Infinity;
        let cell = -1;
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
          if (t0 <= t1 && t0 < best) {
            best = t0;
            cell = b.cell;
          }
        }
        return cell;
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
      const announce = (cell: number) => {
        current = cell;
        if (cell < 0 || !onHover) return onHover?.(null);
        const g = cells[cell]!;
        const { x, z } = at(g.week, g.day);
        const top = topOf(cell);
        const corners: { x: number; y: number }[] = [];
        for (const dx of [-0.46, 0.46]) for (const dz of [-0.46, 0.46]) for (const y of [0, top]) corners.push(toCss(new THREE.Vector3(x + dx, y, z + dz)));
        const c = toCss(new THREE.Vector3(x, top, z));
        onHover({ date: g.date, contributions: g.value, hours: layout.wakatime.cells[cell]?.value ?? 0, outline: hull(corners).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "), x: c.x, y: c.y });
      };
      const onMove = (e: PointerEvent) => {
        if (e.pointerType === "touch" || pinned || settling) return;
        const cell = pick(e.clientX, e.clientY);
        if (cell !== current) announce(cell);
      };
      const onLeave = () => {
        if (!pinned && current !== -1) announce(-1);
      };
      // (a tap on a phone pins a day; a second tap on it, or on nothing, lets it go)
      const onDown = (e: PointerEvent) => {
        if (e.pointerType !== "touch" || settling) return;
        const cell = pick(e.clientX, e.clientY);
        pinned = cell !== -1 && cell !== current;
        announce(pinned ? cell : -1);
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
      el.tabIndex = 0;
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
      const rethink = () => {
        soften();
        pinned = false;
        if (current !== -1) announce(-1);
        (floor.material as import("three").MeshBasicMaterial).color.copy(pageColour());
        buildBlocks();
        restart();
      };
      const mo = new MutationObserver(rethink);
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-scheme"] });
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", rethink);

      stop = () => {
        cancelAnimationFrame(raf);
        window.clearTimeout(resizeTimer);
        dom.removeEventListener("pointermove", onMove);
        dom.removeEventListener("pointerleave", onLeave);
        dom.removeEventListener("pointerdown", onDown);
        el.removeEventListener("keydown", onKey);
        el.removeEventListener("blur", onLeave);
        onHover?.(null);
        ro.disconnect();
        mo.disconnect();
        mq.removeEventListener("change", rethink);
        blocks.traverse((o) => {
          (o as Mesh).geometry?.dispose();
          (o.userData.dispose as (() => void) | undefined)?.();
        });
        blockMaterial.dispose();
        coreMaterial.dispose();
        glowMaterial.dispose();
        tileUnlit.dispose();
        sceneRT.dispose();
        accumRT.dispose();
        [halfA, halfB, quarterA, quarterB].forEach((t) => t.dispose());
        env.dispose();
        pmrem.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, [activity, strips]);

  return <div ref={host} role="group" aria-roledescription="interactive chart" aria-label="Activity over the last year: GitHub contributions and WakaTime coding time, one column a day. Use the arrow keys to move between days."  className={className} />;
}
