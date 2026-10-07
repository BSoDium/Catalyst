// GPU = CPU: the ease pass (gl/pixel-pass.ts FRAG_EASE) against its CPU twin (core/ease.ts easeImage) on random frames: lines, fills,
// dashes, tile arrivals, removals, tone steps, over identity, whole-cell, fractional, zoom and globe warps, at several steps. Every cell
// of every frame must be identical, except where a warp with a scale puts a cell centre on an exact cell boundary and float32 (GPU) and
// float64 (CPU) floor() to different cells: at most 0.05 % of the cells, and none at all for the identity and the whole-cell or
// fractional pans.
//   BASE_URL=http://localhost:5481 node scripts/street/ease-twin.mjs
import { launch, open, dev } from "./_lib.mjs";

const browser = await launch();
let failed = 0;
try {
  const { page } = await open(browser, { viewport: { width: 800, height: 560 }, deviceScaleFactor: 1 });
  await page.goto(dev("/dev/street", { source: "primary", hud: 0, view: "2,46,3" }));
  await page.waitForFunction(() => window.__streetDebug?.map(), null, { timeout: 60000 });
  const res = await page.evaluate(async () => {
    const { PixelPass } = await import("/app/globe/street/gl/pixel-pass.ts");
    const E = await import("/app/globe/street/core/ease.ts");
    const Wp = await import("/app/globe/street/core/warp.ts");
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    const pass = new PixelPass(gl);
    const cols = 150, rows = 90;
    let seed = 99;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const mk = () => ({ lvl: new Uint8Array(cols * rows), line: new Uint8Array(cols * rows) });
    const put = (i, x, y, l, line) => { if (x < 0 || y < 0 || x >= cols || y >= rows) return; i.lvl[y * cols + x] = l; i.line[y * cols + x] = l ? line : 0; };
    // a scene: random polylines of random tones (some dashed), a patch of fill lattice
    const scene = (jitter, shiftX = 0, shiftY = 0, scale = 1) => {
      const img = mk();
      let s2 = 5;
      const r2 = () => ((s2 = (s2 * 1103515245 + 12345) >>> 0) / 4294967296);
      for (let n = 0; n < 40; n++) {
        const x0 = r2() * cols, y0 = r2() * rows, a = r2() * 6.283, len = 20 + r2() * 90, lv = 1 + Math.floor(r2() * 10), dash = r2() < 0.3;
        for (let t = 0; t < len; t++) {
          if (dash && t % 5 > 2) continue;
          const x = Math.round(((x0 + Math.cos(a) * t) - cols / 2) * scale + cols / 2 + shiftX + (jitter ? (rnd() < 0.05 ? 1 : 0) : 0));
          const y = Math.round(((y0 + Math.sin(a) * t) - rows / 2) * scale + rows / 2 + shiftY + (jitter ? (rnd() < 0.05 ? 1 : 0) : 0));
          put(img, x, y, lv, 1);
        }
      }
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (x > 20 && x < 80 && y > 10 && y < 50 && (y & 3) === 0 && (x + ((y >> 2) & 1) * 3) % 6 < 3) put(img, x, y, 4, 0);
      return img;
    };
    const cases = [];
    const cam = (o) => ({ lon: 2.35, lat: 48.85, zoom: 13, cx: cols * 2.5 / 2, cy: rows * 2.5 / 2, cell: 2.5, ...o });
    const panE = (cells, z = 13) => ((cells * 2.5) / (512 * 2 ** z)) * 360;
    for (const [name, camA, camB, shiftX, scale] of [
      ["identity", cam({}), cam({}), 0, 1],
      ["pan 3 cells", cam({}), cam({ lon: 2.35 + panE(3) }), -3, 1],
      ["pan 2.4 cells", cam({}), cam({ lon: 2.35 + panE(2.4) }), -2, 1],
      ["zoom 0.04", cam({}), cam({ zoom: 13.04 }), 0, 1.028],
      ["zoom + pan", cam({}), cam({ zoom: 13.03, lon: 2.35 + panE(1.5) }), -1, 1.021],
      ["globe pan z6", cam({ zoom: 6 }), cam({ zoom: 6, lon: 2.35 + panE(2, 6) }), -2, 1],
      ["globe zoom z4.5", cam({ zoom: 4.5 }), cam({ zoom: 4.56 }), 0, 1.04],
    ]) {
      for (const step of [0, 1, 2, 5]) {
        const prevT = scene(false);
        const prevP = mk();
        for (let i = 0; i < prevT.lvl.length; i++) { prevP.lvl[i] = rnd() < 0.7 ? prevT.lvl[i] : Math.floor(rnd() * 11) * (prevT.lvl[i] ? 1 : 0); prevP.line[i] = prevT.line[i]; }
        const T = scene(true, shiftX, 0, scale);
        // new content and removed content
        for (let n = 0; n < 200; n++) put(T, Math.floor(rnd() * cols), Math.floor(rnd() * rows), 1 + Math.floor(rnd() * 10), rnd() < 0.8 ? 1 : 0);
        const mesh = Wp.buildWarpMesh(camA, camB, cols, rows);
        const radius = name === "identity" ? 0 : E.matchRadius(mesh);
        pass.debugLoad(cols, rows, T, prevT, prevP);
        pass.ease(step, mesh.kind === "identity" ? null : mesh, radius);
        const gpu = pass.readPresentedFull();
        const cpu = E.easeImage({ cols, rows, target: T, prevTarget: prevT, prev: prevP, mesh: mesh.kind === "identity" ? null : mesh, step, radius });
        let diff = 0;
        for (let i = 0; i < cpu.lvl.length; i++) if (cpu.lvl[i] !== gpu.lvl[i] || cpu.line[i] !== gpu.line[i]) diff++;
        cases.push({ name, step, radius, kind: mesh.kind, diff });
      }
    }
    pass.dispose();
    return cases;
  });
  for (const c of res) {
    const ok = c.diff <= (/^(identity|pan)/.test(c.name) ? 0 : Math.ceil(0.0005 * 150 * 90));
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${c.name.padEnd(16)} warp ${c.kind.padEnd(8)} radius ${c.radius} step ${c.step}: ${c.diff} cells differ`);
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
