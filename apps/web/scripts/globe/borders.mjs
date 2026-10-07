// Regression check for the far-zoom border bug: "even after country borders have faded in, certain borders flicker or
// don't display at all (the USA-Canada border is cut off in the middle, Alaska-Canada flickers)".
//   CHROME_PATH=... BASE_URL=http://localhost:5174 [SHOTS=1] node apps/web/scripts/globe/borders.mjs
//
// Root cause (docs/web-architecture.md, "Borders at far zoom"): a GL line is a straight chord through the globe and the
// occluder disc is 0.002 under the surface, so every border segment longer than about 7 degrees (the simplified data has
// 10 to 40 degree ones along the 49th parallel and the 141st meridian) sank into the disc in its middle. The fix cuts every
// segment into pieces of at most 1 degree (engine/geometry.ts MAX_CHORD_DEG).
//
// Check: for known border lines (49 N from 122.5 W to 97 W, 141 W from 62 N to 69 N), sample points along them; for each,
// the drawing buffer must hold a non-background pixel within one art pixel of where the projection puts it. Run over
// North America at overview to medium zoom (3.2 to 5.5, the tone ramp 3.0 to 3.5 included), light and dark, desktop and
// mobile (2 px art pixel), and through 60 consecutive frames of a slow drag (frame to frame: no sample may lose its pixel
// in one frame and get it back in the next, i.e. no flicker). Exits 1 on any failure.
import fs from "node:fs";
import { launch, open, waitGlobe, DESKTOP, MOBILE, sleep } from "./_lib.mjs";

const SHOT_DIR = new URL("../../../../docs/screenshots/", import.meta.url).pathname;
const failures = [];
const expect = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : " " + JSON.stringify(detail)}`);
  if (!ok) failures.push(name);
};

const samples = [];
for (let lon = -122.5; lon <= -97; lon += 0.5) samples.push({ name: "49N", lon, lat: 49 });
for (let lat = 62; lat <= 69; lat += 0.5) samples.push({ name: "141W", lon: -141, lat });

/** In the page: for each view, the set of samples that have ink within one cell of their projection. */
function probeInPage({ samples, views }) {
  const d = window.__globeDebug;
  const canvas = document.querySelector("canvas");
  const gl = canvas.getContext("webgl2");
  const W = canvas.width;
  const H = canvas.height;
  const P = d.inset().pixel;
  const buf = new Uint8Array(W * H * 4);
  const out = [];
  for (const v of views) {
    d.setView(v);
    d.renderNow();
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const rect = canvas.getBoundingClientRect();
    const bg = [buf[0], buf[1], buf[2]]; // the page colour in the corner (the ocean)
    const inkAt = (c, r) => {
      if (c < 0 || r < 0 || c >= W || r >= H) return false;
      const o = ((H - 1 - r) * W + c) * 4; // readPixels rows start at the bottom
      return buf[o] !== bg[0] || buf[o + 1] !== bg[1] || buf[o + 2] !== bg[2];
    };
    const present = [];
    let onScreen = 0;
    for (const s of samples) {
      const p = d.projectAt(s.lon, s.lat);
      const col = Math.round((p.x - rect.left) / P - 0.5);
      const row = Math.round((p.y - rect.top) / P - 0.5);
      const inside = p.visible && col > 2 && row > 2 && col < W - 3 && row < H - 3;
      if (!inside) {
        present.push(null);
        continue;
      }
      onScreen++;
      let hit = false;
      for (let dc = -1; dc <= 1 && !hit; dc++) for (let dr = -1; dr <= 1 && !hit; dr++) hit = inkAt(col + dc, row + dr);
      present.push(hit);
    }
    out.push({ present, onScreen });
  }
  return out;
}

const browser = await launch();
try {
  for (const [dev, ctxOpts] of [["desktop", DESKTOP], ["mobile", MOBILE]]) {
    for (const scheme of ["light", "dark"]) {
      const { page, logs } = await open(browser, { ...ctxOpts, colorScheme: scheme }, "/?globe-debug&no-street&no-groups");
      await waitGlobe(page);
      await sleep(300);
      // 1. overview to medium zoom, centred where the borders are, and off-centre
      const views = [];
      for (let z = 3.2; z <= 5.5001; z += 0.1) for (const [lon, lat] of [[-105, 52], [-95, 45], [-120, 55], [-80, 40]]) views.push({ lon, lat, zoom: z });
      const res = await page.evaluate(probeInPage, { samples, views });
      let worst = 1;
      let worstAt = null;
      let total = 0;
      let missing = 0;
      res.forEach((r, i) => {
        const seen = r.present.filter((x) => x !== null);
        if (seen.length === 0) return;
        const frac = seen.filter(Boolean).length / seen.length;
        total += seen.length;
        missing += seen.filter((x) => !x).length;
        if (frac < worst) {
          worst = frac;
          worstAt = views[i];
        }
      });
      expect(`${dev} ${scheme}: ${total} border samples over ${views.length} views, ${missing} without a pixel (worst view ${(worst * 100).toFixed(1)} %)`, total > 500 && worst >= 0.97, { worst, worstAt });

      // 2. a slow drag: 60 consecutive frames, no sample may blink
      for (const z of [3.3, 3.7, 4.4]) {
        const frames = [];
        for (let k = 0; k < 60; k++) frames.push({ lon: -112 + k * 0.35, lat: 51 + Math.sin(k / 9) * 2, zoom: z });
        const fr = await page.evaluate(probeInPage, { samples, views: frames });
        let blinks = 0;
        let lost = 0;
        let seenTotal = 0;
        for (let k = 1; k < fr.length - 1; k++) {
          for (let s = 0; s < samples.length; s++) {
            const a = fr[k - 1].present[s];
            const b = fr[k].present[s];
            const c = fr[k + 1].present[s];
            if (a === null || b === null || c === null) continue;
            seenTotal++;
            if (!b) lost++;
            if (a && !b && c) blinks++; // present, absent, present again
          }
        }
        expect(`${dev} ${scheme} zoom ${z}: 60-frame drag, ${seenTotal} sample-frames, ${lost} without a pixel, ${blinks} blinks`, seenTotal > 800 && lost / seenTotal < 0.02 && blinks === 0, { lost, blinks, seenTotal });
      }
      expect(`${dev} ${scheme}: no console output`, logs.length === 0, logs);
      if (process.env.SHOTS && dev === "desktop") {
        for (const z of [3.3, 4.0]) {
          await page.evaluate((v) => window.__globeDebug.setView(v), { lon: -105, lat: 52, zoom: z });
          await sleep(300);
          await page.screenshot({ path: `${SHOT_DIR}borders-after-${scheme}-z${z}.png`, clip: { x: 0, y: 0, width: 1440, height: 900 } });
        }
      }
      await page.context().close();
    }
  }
} finally {
  await browser.close();
}
void fs;
if (failures.length) {
  console.log(`\n${failures.length} FAILED`);
  process.exit(1);
}
console.log("\nall ok");
