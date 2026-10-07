// Frame-time benchmark of the production globe under scripted continuous rotation + zoom (crossing the border
// threshold), once without and once with a blocking 1px readPixels per frame (GPU-inclusive).
//   node bench.mjs desktop|mobile [seconds] [panel]
// `panel` opens /locations/kyoto (desktop: the half-screen panel is open and the globe is inset)
// Emulated viewports run on this machine's GPU: they are NOT phone numbers.
import { launch, open, waitGlobe, DESKTOP, MOBILE, sleep } from "./_lib.mjs";

const which = process.argv[2] ?? "desktop";
const seconds = Number(process.argv[3] ?? 10);
const panel = process.argv[4] === "panel";
const b = await launch();
const { page } = await open(b, which === "mobile" ? MOBILE : DESKTOP, panel ? "/locations/kyoto" : "/");
await waitGlobe(page);
await sleep(panel ? 1500 : 800);

const result = await page.evaluate(async ([seconds, panel]) => {
  const d = window.__globeDebug;
  const r2 = (n) => Math.round(n * 100) / 100;
  const pct = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const at = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    return { p50: r2(at(0.5)), p95: r2(at(0.95)), p99: r2(at(0.99)), max: r2(s[s.length - 1]) };
  };
  const nextFrame = () => new Promise((res) => requestAnimationFrame(res));
  const scripted = (t, minZoom) => {
    const zmax = 5.2, zmin = minZoom + 0.1;
    return { lon: 20 + 36 * t, lat: 20 + 30 * Math.sin((2 * Math.PI * t) / 11), zoom: zmin + (zmax - zmin) * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 9)) };
  };
  async function pass(sync) {
    const intervals = [], renderMs = [], frameMs = [], syncMs = [];
    const warm = 1.5;
    let last = await nextFrame();
    const t0 = last;
    for (;;) {
      const now = await nextFrame();
      const t = (now - t0) / 1000;
      if (t > seconds + warm) break;
      const w0 = performance.now();
      d.setView(scripted(t, d.minZoom()));
      const js = d.renderNow(); // render + label update; returns the render call's JS ms
      const afterFrame = performance.now();
      if (sync) d.gpuSync();
      if (t >= warm) {
        intervals.push(now - last);
        renderMs.push(js);
        frameMs.push(afterFrame - w0);
        if (sync) syncMs.push(performance.now() - w0);
      }
      last = now;
    }
    const total = intervals.reduce((a, b) => a + b, 0);
    return {
      pass: sync ? "gpu-sync" : "continuous",
      inset: d.inset(),
      frames: intervals.length,
      fps: r2((intervals.length / total) * 1000),
      rafIntervalMs: pct(intervals),
      renderJsMs: pct(renderMs),
      renderPlusLabelsJsMs: pct(frameMs),
      ...(sync ? { renderLabelsGpuSyncMs: pct(syncMs) } : {}),
    };
  }
  const passes = [await pass(false), await pass(true)];
  const canvas = document.querySelector("canvas");
  const gl = canvas.getContext("webgl2");
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  d.setView({ lon: 10, lat: 45, zoom: 3.6 });
  d.renderNow();
  return {
    env: {
      ua: navigator.userAgent,
      dpr: devicePixelRatio,
      viewport: `${innerWidth}x${innerHeight}`,
      buffer: `${canvas.width}x${canvas.height}`,
      glRenderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown",
      places: document.querySelectorAll("[data-place-link]").length,
      heapMB: performance.memory ? r2(performance.memory.usedJSHeapSize / 1048576) : null,
    },
    passes,
    renderInfoAtZoom36: d.info(),
  };
}, [seconds, panel]);
console.log(JSON.stringify({ which, panel, ...result }, null, 1));
await b.close();
