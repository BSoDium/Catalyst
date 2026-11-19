import { useEffect, useRef } from "react";
import type { BufferGeometry, Color, Mesh } from "three";
import { layoutActivity, type Activity, type Matrix } from "~/lib/activity";

/** How many jittered frames are averaged before the picture is final (soft shadows, anti-aliasing): the scene never moves, so it is drawn once, a frame at a time, and then not at all. */
const SAMPLES = 96;

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
export function ActivityScene({ activity, className }: { activity: Activity; className?: string }) {
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
      const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "high-performance" });
      renderer.setClearColor(0x000000, 0);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      el.appendChild(renderer.domElement);
      renderer.domElement.style.cssText = "display:block;width:100%;height:100%";

      const PITCH = 1.12;
      const width = layout.github.weeks * PITCH;
      const total = 7 * PITCH;

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
      const paint = (g: BufferGeometry, col: Color) => {
        const n = g.getAttribute("position").count;
        const colors = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) col.toArray(colors, i * 3);
        g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        g.deleteAttribute("uv");
      };
      // One column a day: WakaTime's coding time at the bottom, GitHub's contributions on top of it. Each layer's height and its tint follow how busy the day was (pale and low when quiet, saturated and tall when busy).
      const LAYER_MAX = 2.3;
      const LIFT = 0.04;
      const build = (stack: { waka: Matrix; github: Matrix }, tones: { waka: [Color, Color]; github: [Color, Color] }) => {
        const shells: BufferGeometry[] = [];
        const cores: BufferGeometry[] = [];
        const white = new THREE.Color(0xffffff);
        const layer = (x: number, z: number, y0: number, t: number, [low, high]: [Color, Color]) => {
          const h = 0.18 + t * LAYER_MAX;
          const shell = new RoundedBoxGeometry(0.92, h, 0.92, 4, Math.min(0.16, h / 2.2));
          shell.translate(x, y0 + h / 2, z);
          paint(shell, low.clone().lerp(high, t).lerp(white, 0.22 * (1 - t)));
          shells.push(shell);
          const hc = h * 0.8;
          const core = new RoundedBoxGeometry(0.5, hc, 0.5, 3, Math.min(0.1, hc / 2.2));
          core.translate(x, y0 + hc / 2 + 0.03, z);
          paint(core, low.clone().lerp(high, t));
          cores.push(core);
          return y0 + h;
        };
        stack.github.cells.forEach((g, i) => {
          const w = stack.waka.cells[i]!;
          const x = g.week * PITCH + 0.5;
          const z = g.day * PITCH + 0.5;
          if (w.value <= 0 && g.value <= 0) {
            const tile = new RoundedBoxGeometry(0.92, 0.1, 0.92, 3, 0.04);
            tile.translate(x, 0.05, z);
            paint(tile, new THREE.Color(isDark() ? 0x39414b : 0xe4e8ed));
            shells.push(tile);
            return;
          }
          let y = 0;
          if (w.value > 0) y = layer(x, z, 0, w.t, tones.waka) + LIFT;
          if (g.value > 0) layer(x, z, y, g.t, tones.github);
        });
        const group = new THREE.Group();
        const glass = new THREE.Mesh(mergeGeometries(shells), blockMaterial);
        glass.castShadow = true;
        glass.receiveShadow = true;
        group.add(glass);
        if (cores.length) {
          const core = new THREE.Mesh(mergeGeometries(cores), coreMaterial);
          core.castShadow = true;
          group.add(core);
        }
        [...shells, ...cores].forEach((p) => p.dispose());
        return group;
      };

      const blocks = new THREE.Group();
      scene.add(blocks);
      const buildBlocks = () => {
        blocks.traverse((o) => (o as Mesh).geometry?.dispose());
        blocks.clear();
        const dark = isDark();
        const c = (hex: number) => new THREE.Color(hex);
        // WakaTime: embers (dull brown to a hot orange); GitHub: violet to a bright magenta, on top
        blocks.add(
          build(
            { waka: layout.wakatime, github: layout.github },
            { waka: [c(dark ? 0x6b3a22 : 0xd9a27a), c(dark ? 0xff7a2a : 0xf2560f)], github: [c(dark ? 0x4b3a7a : 0xa595d6), c(dark ? 0xd86bff : 0x9c27d6)] },
          ),
        );
      };
      buildBlocks();

      const floor = new THREE.Mesh(new THREE.PlaneGeometry(width * 3, total * 3), new THREE.MeshBasicMaterial({ color: pageColour() }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(width / 2, -0.02, total / 2);
      scene.add(floor);
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(width * 3, total * 3), new THREE.ShadowMaterial({ opacity: 0.32 }));
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(width / 2, 0, total / 2);
      ground.receiveShadow = true;
      scene.add(ground);

      const sun = new THREE.DirectionalLight(0xffffff, 2.2);
      const sunBase = new THREE.Vector3(-0.45, 1, 0.55).normalize().multiplyScalar(60);
      sun.castShadow = true;
      sun.shadow.mapSize.set(4096, 4096);
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.03;
      const sc = sun.shadow.camera;
      sc.left = -width * 0.75;
      sc.right = width * 0.75;
      sc.top = total * 1.5;
      sc.bottom = -total * 1.5;
      sc.near = 1;
      sc.far = 160;
      sun.target.position.set(width / 2, 0, total / 2);
      scene.add(sun, sun.target);

      // the isometric camera: from the front-right, above, looking at the middle of the slab; orthographic, so the grid stays a grid
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);
      const centre = new THREE.Vector3(width / 2, 1.2, total / 2);
      camera.position.copy(centre).add(new THREE.Vector3(-0.3, 0.5, -1).normalize().multiplyScalar(150));
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
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
        blendSrcAlpha: THREE.OneFactor,
        blendDstAlpha: THREE.OneFactor,
        depthTest: false,
        depthWrite: false,
      });
      const showMat = new THREE.ShaderMaterial({
        uniforms: { map: { value: accumRT.texture }, n: { value: 1 } },
        vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }",
        fragmentShader: "uniform sampler2D map; uniform float n; varying vec2 vUv;\nvoid main(){\n gl_FragColor = texture2D(map, vUv) / n;\n#include <colorspace_fragment>\n}",
        depthTest: false,
        depthWrite: false,
      });
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
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        w = Math.max(1, Math.round(el.clientWidth * dpr));
        h = Math.max(1, Math.round(el.clientHeight * dpr));
        renderer.setPixelRatio(1);
        renderer.setSize(w, h, false);
        sceneRT.setSize(w, h);
        accumRT.setSize(w, h);
        // the slab (with its tallest blocks) projected into the camera's frame fills the view, centred
        camera.updateMatrixWorld();
        const inv = camera.matrixWorldInverse;
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const cx of [0, width]) for (const cy of [0, 5.2]) for (const cz of [0, total]) {
          const p = new THREE.Vector3(cx, cy, cz).applyMatrix4(inv);
          x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
        }
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

      const frame = () => {
        raf = 0;
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
        if (n === 0) renderer.clear();
        renderer.render(quadScene, quadCam);
        renderer.autoClear = true;
        n++;
        showMat.uniforms.n!.value = n;
        renderer.setRenderTarget(null);
        renderer.clear();
        renderer.render(showQuad, quadCam);
        if (n < SAMPLES) raf = requestAnimationFrame(frame);
      };
      function restart() {
        n = 0;
        if (!raf) raf = requestAnimationFrame(frame);
      }

      const ro = new ResizeObserver(fit);
      ro.observe(el);
      const rethink = () => {
        (floor.material as import("three").MeshBasicMaterial).color.copy(pageColour());
        buildBlocks();
        restart();
      };
      const mo = new MutationObserver(rethink);
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-scheme"] });
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", rethink);
      fit();

      stop = () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        mo.disconnect();
        mq.removeEventListener("change", rethink);
        blocks.traverse((o) => (o as Mesh).geometry?.dispose());
        blockMaterial.dispose();
        coreMaterial.dispose();
        sceneRT.dispose();
        accumRT.dispose();
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
  }, [activity]);

  return <div ref={host} role="img" aria-label="Activity over the last year: GitHub contributions and WakaTime coding time, one block a day" className={className} />;
}
