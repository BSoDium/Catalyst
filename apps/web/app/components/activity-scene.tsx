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
 * The activity of the year as two matrices of blocks seen from an isometric camera that never moves (GitHub's contributions in front, WakaTime's coding time behind it): the height
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
      const GAP = 4;
      const matrixDepth = 7 * PITCH;
      const width = layout.github.weeks * PITCH;
      const total = matrixDepth * 2 + GAP;

      const scene = new THREE.Scene();
      const pmrem = new THREE.PMREMGenerator(renderer);
      const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = env;
      scene.environmentIntensity = 0.9;

      const blockMaterial = new THREE.MeshPhysicalMaterial({
        vertexColors: true,
        roughness: 0.18,
        metalness: 0,
        transmission: 0.55,
        thickness: 0.9,
        ior: 1.45,
        clearcoat: 1,
        clearcoatRoughness: 0.12,
        transparent: false,
      });

      const build = (m: Matrix, z0: number, heightOf: (t: number) => number, low: Color, high: Color) => {
        const parts: BufferGeometry[] = [];
        for (const c of m.cells) {
          const h = c.value > 0 ? 0.16 + heightOf(c.t) : 0.1;
          const g = new RoundedBoxGeometry(0.92, h, 0.92, 3, Math.min(0.16, h / 2.2));
          g.translate(c.week * PITCH + 0.5, h / 2, z0 + c.day * PITCH + 0.5);
          const col = c.value > 0 ? low.clone().lerp(high, c.t) : new THREE.Color(isDark() ? 0x2a3038 : 0xcfd5dc);
          const n = g.getAttribute("position").count;
          const colors = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) col.toArray(colors, i * 3);
          g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
          g.deleteAttribute("uv");
          parts.push(g);
        }
        const mesh = new THREE.Mesh(mergeGeometries(parts), blockMaterial);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        parts.forEach((p) => p.dispose());
        return mesh;
      };

      const blocks = new THREE.Group();
      scene.add(blocks);
      const buildBlocks = () => {
        blocks.children.forEach((o) => (o as Mesh).geometry.dispose());
        blocks.clear();
        const dark = isDark();
        // GitHub's in front (low z is nearest the camera at the left, see the camera below), WakaTime behind
        blocks.add(build(layout.github, 0, (t) => 0.2 + t * 5.2, new THREE.Color(dark ? 0x1f6f4a : 0x8fd8b0), new THREE.Color(dark ? 0x58f0a0 : 0x0f8f58)));
        blocks.add(build(layout.wakatime, matrixDepth + GAP, (t) => 0.2 + t * 5.2, new THREE.Color(dark ? 0x3a3f8f : 0xa9b4f5), new THREE.Color(dark ? 0x8fa2ff : 0x3340d0)));
      };
      buildBlocks();

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
      sc.top = total;
      sc.bottom = -total;
      sc.near = 1;
      sc.far = 160;
      sun.target.position.set(width / 2, 0, total / 2);
      scene.add(sun, sun.target);

      // the isometric camera: from the front-right, above, looking at the middle of the slab; orthographic, so the grid stays a grid
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);
      const centre = new THREE.Vector3(width / 2, 1.5, total / 2);
      camera.position.copy(centre).add(new THREE.Vector3(-0.5, 0.8, -1).normalize().multiplyScalar(150));
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
        for (const cx of [0, width]) for (const cy of [0, 6]) for (const cz of [0, total]) {
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
        blocks.children.forEach((o) => (o as Mesh).geometry.dispose());
        blockMaterial.dispose();
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
