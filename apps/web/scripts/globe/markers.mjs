// Regression check: every marker is drawn AS A WHOLE or not at all, never half-clipped by the globe.
//   CHROME_PATH=... BASE_URL=http://localhost:5174 node apps/web/scripts/globe/markers.mjs [quick]
//
// How: the debug hook `setMarkerProbe(true)` draws marker ink in pure red and marker fill in pure blue, so marker
// pixels can be told from the (identical-looking) linework under them. For hundreds of views, the drawing buffer is
// read back and compared, pixel for pixel, with the pattern each SHOWN marker should have (3x3 block; 5x5 route
// stop; 7x7 focused; 9x9 ring with centre dot when selected), centred on the cell `project()` reports. So:
//   - a shown marker must have its full footprint (a missing pixel = a partial marker),
//   - a hidden marker must have no pixel at all (and far-side markers must be hidden),
//   - the drawn cell equals the label/pick anchor cell.
// Independently of the app's own visibility answer, an on-canvas marker within 40 deg of the view centre must be shown and one
// beyond 95 deg must be hidden. Sweeps: the view rotates all the way round at several latitudes (so every marker
// crosses the limb, northern and southern ones), and each place is walked from 50 to 100 deg off-centre along four
// bearings; at overview, mid and high zoom; desktop and a 2 px-art-pixel mobile viewport; unselected and with a place
// selected (ring marker + route stops). Exits 1 on any failure.
import fs from "node:fs";
import { launch, open, waitGlobe, DESKTOP, MOBILE, sleep } from "./_lib.mjs";

const quick = process.argv.includes("quick");
const demo = JSON.parse(fs.readFileSync(new URL("../../../../packages/published/fixtures/demo.json", import.meta.url), "utf8"));
const places = demo.places.map((p) => ({ slug: p.slug, lat: p.coordinates.lat, lon: p.coordinates.lon }));
const routeStops = Object.fromEntries(demo.routes.map((r) => [r.id, r.stops]));

/** Runs in the page: sweep `views` (each {lon, lat, zoom|null}) and compare with the expected patterns. */
function sweepInPage({ places, views, selected, stops }) {
  const d = window.__globeDebug;
  const canvas = document.querySelector("canvas");
  const gl = canvas.getContext("webgl2");
  const W = canvas.width;
  const H = canvas.height;
  const P = d.inset().pixel;
  const buf = new Uint8Array(W * H * 4);
  const DEG = Math.PI / 180;
  const vec = (lon, lat) => [Math.cos(lat * DEG) * Math.sin(lon * DEG), Math.sin(lat * DEG), Math.cos(lat * DEG) * Math.cos(lon * DEG)];
  const sizeOf = (slug) => (slug === selected ? 9 : stops.includes(slug) ? 5 : 3);
  const failures = [];
  const stat = { views: 0, shownMarkerFrames: 0, hiddenMarkerFrames: 0, clippedByCanvasEdge: 0 };
  d.setMarkerProbe(true);
  // With the detail panel open the GL scissor cuts drawing at the panel's edge by design (it is masked there):
  // turn it off so only the globe's own occlusion is under test.
  d.setScissor(false);
  for (const v of views) {
    d.setView({ lon: v.lon, lat: v.lat, zoom: v.zoom ?? d.minZoom() + 0.3 });
    d.renderNow();
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    stat.views++;
    const view = d.view();
    const rect = canvas.getBoundingClientRect();
    // Expected picture: later markers are drawn over earlier ones, as on the GPU.
    const exp = new Uint8Array(W * H);
    const cells = [];
    const vc = vec(view.lon, view.lat);
    for (const p of places) {
      const s = d.project(p.slug);
      const col = Math.round((s.x - rect.left) / P - 0.5);
      const row = Math.round((s.y - rect.top) / P - 0.5);
      const ang = Math.acos(Math.min(1, Math.max(-1, vec(p.lon, p.lat).reduce((a, x, i) => a + x * vc[i], 0)))) / DEG;
      cells.push({ slug: p.slug, col, row, shown: s.visible, ang });
      const onCanvas = col >= 0 && row >= 0 && col < W && row < H;
      if (ang < 40 && onCanvas && !s.visible) failures.push({ kind: "front marker hidden", slug: p.slug, ang: +ang.toFixed(1), view });
      if (ang > 95 && s.visible) failures.push({ kind: "far-side marker shown", slug: p.slug, ang: +ang.toFixed(1), view });
      if (!s.visible) {
        stat.hiddenMarkerFrames++;
        continue;
      }
      stat.shownMarkerFrames++;
      const size = sizeOf(p.slug);
      const h = (size - 1) / 2;
      for (let dy = -h; dy <= h; dy++)
        for (let dx = -h; dx <= h; dx++) {
          const x = col + dx;
          const y = row + dy;
          if (x < 0 || y < 0 || x >= W || y >= H) {
            stat.clippedByCanvasEdge++;
            continue;
          }
          const r = Math.max(Math.abs(dx), Math.abs(dy));
          exp[y * W + x] = size === 9 && r > 0 && r < 4 ? 2 : 1; // 1 = ink (red), 2 = fill (blue)
        }
    }
    let bad = 0;
    let first = null;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = (H - 1 - y) * W * 4 + x * 4;
        const r = buf[i], g = buf[i + 1], b = buf[i + 2];
        const got = r > 200 && g < 40 && b < 40 ? 1 : b > 200 && r < 40 && g < 40 ? 2 : 0;
        if (got !== exp[y * W + x]) {
          bad++;
          first ??= { x, y, got, want: exp[y * W + x] };
        }
      }
    if (bad) {
      let near = null;
      let nd = Infinity;
      for (const c of cells) {
        const dist = Math.hypot(c.col - first.x, c.row - first.y);
        if (dist < nd) [nd, near] = [dist, c];
      }
      failures.push({ kind: "footprint mismatch (partial or stray marker)", pixels: bad, first, nearest: near, view });
    }
  }
  d.setMarkerProbe(false);
  d.setScissor(true);
  return { failures: failures.slice(0, 12), failureCount: failures.length, stat };
}

/** Destination point from (lon, lat) after `deg` degrees along `bearing` (degrees clockwise from north). */
function destination(lon, lat, deg, bearing) {
  const R = Math.PI / 180;
  const a = deg * R, b = bearing * R, p1 = lat * R, l1 = lon * R;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(a) + Math.cos(p1) * Math.sin(a) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(a) * Math.cos(p1), Math.cos(a) - Math.sin(p1) * Math.sin(p2));
  return { lon: ((((l2 / R + 180) % 360) + 360) % 360) - 180, lat: p2 / R };
}

function buildViews() {
  const views = [];
  const zooms = [null, 3.6, 5.5];
  // 1. Spin all the way round at several latitudes: every marker crosses the limb, north and south.
  const lats = quick ? [-50, 0, 50] : [-70, -45, -20, 0, 20, 45, 70];
  for (const zoom of zooms) for (const lat of lats) for (let lon = -180; lon < 180; lon += quick ? 6 : 3) views.push({ lon, lat, zoom });
  // 2. Walk each place from 50 to 100 degrees off-centre along four bearings (it crosses the limb on each).
  for (const zoom of zooms)
    for (const p of places)
      for (const bearing of quick ? [0, 180] : [0, 90, 180, 270])
        for (let deg = 50; deg <= 100; deg += quick ? 2 : 1) {
          const c = destination(p.lon, p.lat, deg, bearing);
          views.push({ lon: c.lon, lat: Math.max(-80, Math.min(80, c.lat)), zoom });
        }
  return views;
}

const b = await launch();
const summary = [];
let failed = 0;

async function run(label, contextOptions, selectSlug) {
  const { page, logs } = await open(b, contextOptions, "/");
  await waitGlobe(page);
  if (selectSlug) {
    // Select like a keyboard user (the list is visually hidden), then wait for the flight to end.
    await page.focus(`[data-place-link="${selectSlug}"]`);
    await page.keyboard.press("Enter");
    await page.waitForURL(`**/locations/${selectSlug}`, { timeout: 5000 });
    await page.waitForFunction(() => !window.__globeDebug.isAnimating(), null, { timeout: 8000 });
    await sleep(300);
  }
  const route = selectSlug ? demo.routes.find((r) => r.stops.includes(selectSlug)) : null;
  const stops = route ? route.stops.filter((s) => s !== selectSlug) : [];
  const res = await page.evaluate(sweepInPage, { places, views: buildViews(), selected: selectSlug ?? null, stops });
  const consoleProblems = logs.filter((l) => !/favicon/.test(l));
  const ok = res.failureCount === 0 && consoleProblems.length === 0;
  if (!ok) failed++;
  summary.push({ label, ok, ...res.stat, failureCount: res.failureCount, examples: res.failures, console: consoleProblems });
  await page.close();
}

await run("desktop, nothing selected", DESKTOP, null);
for (const slug of quick ? ["reykjavik"] : ["reykjavik", "cape-town", "hanoi"]) await run(`desktop, ${slug} selected`, DESKTOP, slug);
await run("mobile (2 px art pixel), nothing selected", MOBILE, null);

console.log(JSON.stringify(summary, null, 1));
console.log(failed ? `FAIL: ${failed} run(s) with partial / stray markers` : "PASS: every marker whole or absent in every view");
await b.close();
process.exit(failed ? 1 : 0);
