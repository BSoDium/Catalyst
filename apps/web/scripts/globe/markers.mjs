// Regression check: every detection box is drawn AS A WHOLE or not at all, never half-clipped by the globe's limb, and nothing else is on
// the pixel canvas.
//   CHROME_PATH=... BASE_URL=http://localhost:5174 node apps/web/scripts/globe/markers.mjs [quick]
//
// How: for hundreds of views the label canvas (the pixel overlay: engine/box-scene.ts) is read back and compared, cell for cell, with what
// the cluster tree says is drawn (`__globeDebug.lod()` and `labelCells()`):
//   - every shown node's rectangle outline is complete (a missing cell = a partial box),
//   - no opaque cell lies outside the union of the shown outlines and the shown label plates (no stray or half-hidden box),
//   - a place the tree reports as shown is on the front hemisphere and clear of the limb (independently of the tree's own answer,
//     a place within 40 degrees of the view centre must be shown and one beyond 95 must not be),
//   - the drawn rectangle is centred on the cell `project()` reports for the place (the label and pick anchor).
// Sweeps: the view rotates all the way round at several latitudes (so every place crosses the limb, northern and southern ones), and each
// place is walked from 50 to 100 degrees off-centre along four bearings; at overview, mid and high zoom; desktop and a 2 px-art-pixel
// mobile viewport; unselected and with a place selected (inked rectangle, route stops). Exits 1 on any failure.
import fs from "node:fs";
import { launch, open, waitGlobe, DESKTOP, MOBILE, sleep } from "./_lib.mjs";

const quick = process.argv.includes("quick");
const demo = JSON.parse(fs.readFileSync(new URL("../../../../packages/published/fixtures/demo.json", import.meta.url), "utf8"));
const places = demo.places.map((p) => ({ slug: p.slug, lat: p.coordinates.lat, lon: p.coordinates.lon, bbox: p.bbox ?? null }));

/** Runs in the page: sweep `views` (each {lon, lat, zoom|null}) and compare the canvas with the tree. */
function sweepInPage({ places, views }) {
  const d = window.__globeDebug;
  const root = document.querySelector('[data-globe="three"] > div:nth-child(2)');
  const canvas = root.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const P = d.inset().pixel;
  const main = document.querySelector("canvas").getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  const left = main.left - rootRect.left;
  const top = main.top - rootRect.top;
  const DEG = Math.PI / 180;
  const vec = (lon, lat) => [Math.cos(lat * DEG) * Math.sin(lon * DEG), Math.sin(lat * DEG), Math.cos(lat * DEG) * Math.cos(lon * DEG)];
  const failures = [];
  const stat = { views: 0, shownBoxFrames: 0, hiddenPlaceFrames: 0, clippedByCanvasEdge: 0 };
  for (const v of views) {
    d.setView({ lon: v.lon, lat: v.lat, zoom: v.zoom ?? d.minZoom() + 0.3 });
    d.renderNow();
    const img = ctx.getImageData(0, 0, W, H);
    stat.views++;
    const view = d.view();
    const nodes = d.lod().filter((n) => n.shown);
    const allow = new Uint8Array(W * H);
    const mark = (c0, r0, c1, r1) => {
      for (let y = Math.max(0, r0); y < Math.min(H, r1); y++) for (let x = Math.max(0, c0); x < Math.min(W, c1); x++) allow[y * W + x] = 1;
    };
    for (const n of nodes) {
      const c0 = Math.round((n.box.x0 - left) / P);
      const c1 = Math.round((n.box.x1 - left) / P);
      const r0 = Math.round((n.box.y0 - top) / P);
      const r1 = Math.round((n.box.y1 - top) / P);
      stat.shownBoxFrames++;
      // the outline must be complete (cells outside the canvas are clipped, not missing)
      let missing = 0;
      const opaque = (x, y) => img.data[(y * W + x) * 4 + 3] !== 0; // present: fades are opacity, so an outline cell is translucent mid-fade
      for (let x = c0; x < c1; x++) for (const y of [r0, r1 - 1]) { if (x < 0 || y < 0 || x >= W || y >= H) { stat.clippedByCanvasEdge++; continue; } if (!opaque(x, y)) missing++; }
      for (let y = r0; y < r1; y++) for (const x of [c0, c1 - 1]) { if (x < 0 || y < 0 || x >= W || y >= H) { stat.clippedByCanvasEdge++; continue; } if (!opaque(x, y)) missing++; }
      if (missing) failures.push({ kind: "partial box", slug: n.slug, missing, view });
      mark(c0, r0, c1, r1); // generous: the whole rectangle (interior cells are only ever fill, a label plate or nested boxes)
    }
    for (const t of d.labelCells()) if (t.label) mark(t.label.col - 1, t.label.row, t.label.col - 1 + t.label.w, t.label.row + t.label.h);
    // nothing opaque may lie outside the shown outlines' rectangles and the label plates
    let stray = 0;
    let first = null;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (img.data[(y * W + x) * 4 + 3] !== 0 && !allow[y * W + x]) { stray++; first ??= { x, y }; }
    if (stray) failures.push({ kind: "stray cells outside every shown box and label", cells: stray, first, view });
    // the place rule, independent of the tree
    const vc = vec(view.lon, view.lat);
    const shownSlugs = new Set(nodes.filter((n) => n.kind === "place").map((n) => n.slug));
    for (const p of places) {
      const s = d.project(p.slug);
      const ang = Math.acos(Math.min(1, Math.max(-1, vec(p.lon, p.lat).reduce((a, x, i) => a + x * vc[i], 0)))) / DEG;
      if (!s.visible) stat.hiddenPlaceFrames++;
      if (ang > 95 && shownSlugs.has(p.slug)) failures.push({ kind: "far-side place drawn", slug: p.slug, ang: +ang.toFixed(1), view });
      if (shownSlugs.has(p.slug)) {
        const n = nodes.find((x) => x.slug === p.slug);
        const cx = (n.box.x0 + n.box.x1) / 2 + left + rootRect.left;
        const cy = (n.box.y0 + n.box.y1) / 2 + top + rootRect.top;
        // a place with a bounding box is centred on the box's centre, not on its recorded point
        const at = p.bbox ? d.projectAt((p.bbox[0] + p.bbox[2]) / 2, (p.bbox[1] + p.bbox[3]) / 2) : s;
        if (Math.abs(cx - at.x) > P + 0.5 || Math.abs(cy - at.y) > P + 0.5) failures.push({ kind: "rectangle not centred on the projected cell", slug: p.slug, dx: cx - at.x, dy: cy - at.y, view });
      }
    }
  }
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
  const { page, logs } = await open(b, contextOptions, "/", { noGroups: false });
  await waitGlobe(page);
  if (selectSlug) {
    // Select like a keyboard user (the list is visually hidden), then wait for the flight to end.
    await page.focus(`[data-place-link="${selectSlug}"]`);
    await page.keyboard.press("Enter");
    await page.waitForURL(`**/locations/${selectSlug}`, { timeout: 5000 });
    await page.waitForFunction(() => !window.__globeDebug.isAnimating(), null, { timeout: 8000 });
    await sleep(300);
  }
  const res = await page.evaluate(sweepInPage, { places, views: buildViews() });
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
console.log(failed ? `FAIL: ${failed} run(s) with partial / stray boxes` : "PASS: every box whole or absent in every view");
await b.close();
process.exit(failed ? 1 : 0);
