// Checks for the detection boxes (every place and group is a rectangle; the hierarchy is cut in screen space), Playwright + headless Chrome with the GPU.
//
//   CHROME_PATH=... BASE_URL=http://localhost:5174 [SHOTS=1] node apps/web/scripts/globe/groups.mjs [lod|cases|pixels|empty|timed|at-rest|reduced|pick|targets|flicker|open|cost|idle|handover|shots]
//
// Serve the app with demo content (`pnpm dev:demo`, or a production build with CATALYST_CONTENT=demo): the demo projection has
// a hierarchy (3 continents, a region, a subregion, 3 countries, an area; 18 places). `handover` also needs the local tile server
// (the script starts it itself, and needs CATALYST_TILES_FALLBACK_URL=http://127.0.0.1:5240/places.pmtiles on the app).
//
// lod       the demo tree: isolated places are rectangles at every zoom, a handful of rectangles on the world view, at rest every node is fully
//           drawn (binary), exactly one level per branch, no drawn node with a drawn ancestor
// cases     three hand-made cases (`?lod-cases`): 10 close places = one box (second line "10 places") that opens on zoom into ten boxes, a lone place =
//           its own rectangle at every zoom, a country with two far apart places = two rectangles and no group
// pixels    the boxes are drawn on the pixel canvas as whole cells: the corner arms and dashes of every outline are there, nothing but palette colours
//           is on the canvas (no grey), and the canvas is exactly cols x rows cells scaled by the cell
// empty     `?no-groups`: every place is its own rectangle at every zoom, no group (the globe as it was before groups)
// timed     a camera that opens a group and then STOPS: the boxes cross-fade by time (about 200 ms, whatever the camera does) and every transition
//           ends: the frame loop runs until they have, the last frame is fully drawn or not at all (no frozen half-faded frame)
// at-rest   (also in `targets` form for the preview data) wheel zoom with inertia, then let go, over the world -> continent -> city path and at the
//           thresholds: after the camera stops, no label, box, mask or layer has an opacity strictly between 0 and 1, every label is exactly at its
//           target (the glides have ended, no plan is owed), and no frame is pending
// reduced   reduced motion: every alpha is 0 or 1 (no cross-fade), one switch per box
// pick      click a small box (its border or its inside) = flies to frame its circle (its places appear), the label plate is a hit area, a
//           place's rectangle inside opens its page, hover highlights the box
// targets   whatever the content (demo or your preview): over a sweep of views (world, continents, Europe, the Balkans, a city cluster and a grid of
//           lon/lat/zoom), at rest, EVERY drawn box has its label (100 %: none dropped, none dimmed, each plate on the grid, no two plates overlapping
//           unless one is the last resort) and is at full opacity, no node is half-faded, and hovering a box, its label and the gap between them
//           shows the pointer and the node's hover state; the label is a real DOM element (text, opacity, place) for every drawn box; at rest every label is exactly at its target (no glide left)
// flicker   a scripted pan and zoom of 3 s over a crowded view: the labels move all the time and never teleport (a plate that moves by more
//           than its box plus a small glide step in one frame: 0), a slot change is a glide (slot changes per label, the worst frame), the plan runs at
//           a bounded rate, the loop is quiet after the labels arrived (none gliding, none owed), and hovering label after label re-plans nothing
// open      (the owner's preview, or any content with a group of several places) a group OPENS EARLY into its most important places and cross-fades with
//           them (docs/web-architecture.md, "Opening a group into its most important children"). At Western Europe, the Balkans, Iberia, Central Europe
//           and Italy: a slow zoom sweep at rest, at every frame NO drawn node has a drawn ancestor, every box is fully drawn with its label element opaque
//           and no plate over another, each group is replaced by two or more of its places well before the size rule; then a scripted zoom with the clock
//           running through the opening of Western Europe, sampled at every animation frame: the group's opacity and any node below it sum to 1.05 at
//           most, the cross-fade is seen mid-way and lasts about 200 ms, the label elements follow the nodes' opacity, a click on a child that is fading in
//           picks the child (the group stops taking clicks below half); and a slow zoom on the way in never takes a node away except by opening its group
// cost      the cost of the cluster pass with 18, 186, 1000 and 5000 nodes
// idle      no frames, no rAF, no label canvas redraw while nothing moves
// handover  the same boxes and dots are drawn by the globe's and the street overlay's drawing of one camera
// shots     (SHOTS=1) docs/screenshots/clusters-*.png: world view light and dark, a contact sheet through one cluster opening
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { launch, open, waitGlobe, DESKTOP, MOBILE, sleep } from "./_lib.mjs";
import { HCMC, ensureTiles, openApp, settleApp, setCamera, waitStreetOk } from "./handover-lib.mjs";

const only = process.argv.slice(2);
const run = (n) => only.length === 0 || only.includes(n);
const SHOT_DIR = new URL("../../../../docs/screenshots/", import.meta.url).pathname;
const failures = [];
const expect = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : " " + JSON.stringify(detail)}`);
  if (!ok) failures.push(name);
};

const globeUrl = (extra = "") => `/?globe-debug&no-street${extra}`;
const openGlobe = async (browser, ctxOpts, extra = "", scheme = "light", reduced = "no-preference") => {
  const o = await open(browser, { ...ctxOpts, colorScheme: scheme, reducedMotion: reduced }, globeUrl(extra), { noGroups: false });
  await waitGlobe(o.page);
  await sleep(300);
  return o;
};
const at = (page, v) =>
  page.evaluate((v) => {
    window.__globeDebug.setView(v);
    window.__globeDebug.settle(); // every timed transition run to its end: the resting frame of this camera
    return window.__globeDebug.lod();
  }, v);

/** Whether `slug` is below the group `ancestor` in the tree list of the debug hook. */
function underGroup(tree, slug, ancestor) {
  const parent = new Map(tree.map((n) => [n.slug, n.parent]));
  for (let c = parent.get(slug); c; c = parent.get(c)) if (c === ancestor) return true;
  return false;
}

const browser = await launch();
try {
  /* ----------------------------------------------------------------------------------------------- lod */
  if (run("lod")) {
    const { page, logs } = await openGlobe(browser, DESKTOP);
    const tree = await page.evaluate(() => window.__globeDebug.tree());
    const parentOf = Object.fromEntries(tree.map((n) => [n.slug, n.parent]));
    const places = tree.filter((n) => n.kind === "place").map((n) => n.slug);
    const chainOf = (slug) => {
      const out = [];
      for (let c = slug; c; c = parentOf[c]) out.push(c);
      return out;
    };
    const minZoom = await page.evaluate(() => window.__globeDebug.minZoom());

    const world = await at(page, { lon: 15, lat: 28, zoom: minZoom });
    console.log(`     world view: ${world.map((n) => `${n.slug}${n.kind === "place" ? "" : `[${n.members}]`}`).join(", ")}`);
    expect("world view: a handful of rectangles, each continent boxed only because its places are crowded (every box has at least two places in it)", world.length <= 12 && world.every((n) => n.kind === "place" || n.members >= 2), world);
    for (const [slug, lon, lat] of [["cape-town", 18.4, -33.9], ["wellington", 174.8, -41.3]]) {
      let always = true;
      for (let z = minZoom; z <= 6.5; z += 0.1) {
        const l = await at(page, { lon, lat, zoom: z });
        const n = l.find((x) => x.slug === slug);
        if (!n || n.alpha !== 1 || !n.shown) always = false;
      }
      expect(`${slug} (a place in no group) is its own rectangle at every zoom`, always, null);
    }

    let worst = 0;
    let worstAt = null;
    let steps = 0;
    let bad = null;
    // sweep towards a few places: per step, every drawn place's branch has exactly one level, in sum
    const centres = [["hue", 107.59, 16.46], ["zagreb", 15.98, 45.81], ["paris", 2.35, 48.86], ["kyoto", 135.77, 35.01], ["hoi-an", 108.33, 15.88]];
    for (const [slug, lon, lat] of centres) {
      const series = await page.evaluate(
        ({ lon, lat, minZoom }) => {
          const d = window.__globeDebug;
          const out = [];
          for (let z = minZoom; z <= 6.5; z += 0.02) {
            d.setView({ lon, lat, zoom: z });
            d.settle();
            out.push({ z, nodes: d.lod().map((n) => [n.slug, n.alpha]) });
          }
          return out;
        },
        { lon, lat, minZoom },
      );
      for (const s of series) {
        steps++;
        const a = new Map(s.nodes);
        for (const pl of places) {
          if (!a.has(pl)) continue; // not drawn (far side, or off the visible hemisphere)
          const sum = chainOf(pl).reduce((x, c) => x + (a.get(c) ?? 0), 0);
          if (Math.abs(sum - 1) > 1e-6) bad ??= { target: slug, z: s.z, place: pl, sum };
        }
        for (const [k, v] of a) if (v !== 1) worst = Math.max(worst, Math.min(v, 1 - v)), (worstAt ??= { slug, k, z: s.z, v });
      }
    }
    expect(`sweep (${centres.length} targets, ${steps} steps): exactly one level on every drawn place's branch at rest (the opacities along it sum to 1)`, bad === null, bad);
    expect(`sweep: at rest every drawn node is fully opaque, never half way (worst distance from 0 or 1: ${worst.toFixed(3)})`, worst === 0, worstAt);
    expect("no console errors", logs.length === 0, logs);
    await page.context().close();
  }

  /* --------------------------------------------------------------------------------------------- cases */
  if (run("cases")) {
    const { page, logs } = await openGlobe(browser, DESKTOP, "&lod-cases");
    const minZoom = await page.evaluate(() => window.__globeDebug.minZoom());
    const names = (l) => l.map((n) => n.slug).sort();
    // world view over Africa and the Atlantic: all three cases in view
    const w = await at(page, { lon: 20, lat: 10, zoom: minZoom });
    expect(`ten places 110 km apart are ONE rectangle at the world view (${names(w).join(" ")})`, w.some((n) => n.slug === "case-crowd" && n.alpha === 1 && n.members === 10) && !w.some((n) => n.slug.startsWith("crowd-")), w);
    expect("a country with two far apart places shows two rectangles and no group", w.some((n) => n.slug === "pair-a") && w.some((n) => n.slug === "pair-b") && !w.some((n) => n.slug === "case-pair"), w);
    const lone = await at(page, { lon: -30, lat: 30, zoom: minZoom });
    expect("a lone place whose group holds only it is its own rectangle, never grouped", lone.some((n) => n.slug === "lone" && n.alpha === 1) && !lone.some((n) => n.slug === "case-solo-group"), lone);
    // zoom into the crowd: the box fades out, the dots come in
    let boxGone = null;
    let allDots = null;
    const series = await page.evaluate(
      ({ minZoom }) => {
        const d = window.__globeDebug;
        const out = [];
        for (let z = minZoom; z <= 6.5; z += 0.02) {
          d.setView({ lon: 13.2, lat: 9.5, zoom: z });
          d.settle();
          const l = d.lod();
          const box = l.find((n) => n.slug === "case-crowd");
          const dots = l.filter((n) => n.slug.startsWith("crowd-"));
          out.push({ z, box: box ? box.alpha : 0, dots: dots.length, dotAlpha: dots.length ? Math.min(...dots.map((n) => n.alpha)) : 0 });
        }
        return out;
      },
      { minZoom },
    );
    let atOpen = 0;
    let fewer = null;
    let prevDots = 0;
    for (const s of series) {
      if (boxGone === null && s.box === 0) {
        boxGone = s.z;
        atOpen = s.dots;
      }
      if (allDots === null && s.dots === 10 && s.dotAlpha === 1) allDots = s.z;
      if (boxGone !== null && s.dots < prevDots) fewer ??= s.z; // (a place that went away again on the way in)
      prevDots = s.dots;
    }
    // the box is replaced by the places that fit (two or more, not all ten), the rest come in as the zoom lets them in, before the size rule needs to
    expect(`zooming in: the box is gone at zoom ${boxGone?.toFixed(2)} with ${atOpen} of the ten rectangles in, all ten are in at zoom ${allDots?.toFixed(2)}, none goes away again (${fewer})`, boxGone !== null && allDots !== null && atOpen >= 2 && atOpen < 10 && allDots >= boxGone && allDots < 6.5 && fewer === null, { boxGone, allDots, atOpen, fewer });
    const sums = series.map((s) => s.box + (s.dots ? s.dotAlpha : 0));
    expect("never a gap, never both: at rest group alpha + place alpha is exactly 1 over the whole zoom sweep", sums.every((x) => x === 1), sums.filter((x) => x !== 1).slice(0, 3));
    // coming back out: the same box
    const back = await at(page, { lon: 13.2, lat: 9.5, zoom: minZoom });
    expect("zooming back out: the box is back", back.some((n) => n.slug === "case-crowd" && n.alpha === 1), back);
    expect("no console errors", logs.length === 0, logs);
    await page.context().close();
  }

  /* --------------------------------------------------------------------------------------------- pixels */
  if (run("pixels")) {
    for (const [name, ctxOpts] of [["desktop", DESKTOP], ["mobile (2 px art pixel)", MOBILE]]) {
      for (const scheme of ["light", "dark"]) {
        const { page, logs } = await openGlobe(browser, ctxOpts, "", scheme);
        const res = await page.evaluate(() => {
          const d = window.__globeDebug;
          const root = document.querySelector('[data-globe="three"] > div:nth-child(2)');
          const canvas = root.querySelector("canvas");
          const ctx = canvas.getContext("2d");
          const P = d.inset().pixel;
          const mainRect = document.querySelector("canvas").getBoundingClientRect();
          const rootRect = root.getBoundingClientRect();
          const ramp = d.ramp(); // 0..255 per level
          const inkAndBg = [ramp[0], ramp[ramp.length - 1], ramp[ramp.length - 2], ramp[ramp.length - 3]]; // the page colour, the ink, the peak level (boxes and text at rest) and the level a counter may use
          const stat = { views: 0, boxes: 0, outlineMissing: 0, offPalette: 0, scaleOk: true, first: null };
          const rect = canvas.getBoundingClientRect();
          if (Math.abs(rect.width - canvas.width * P) > 0.01 || Math.abs(rect.height - canvas.height * P) > 0.01) stat.scaleOk = false;
          const minZoom = d.minZoom();
          const views = [];
          for (const z of [minZoom, minZoom + 0.5, minZoom + 1, minZoom + 1.6, minZoom + 2.4, minZoom + 3.4]) for (const [lon, lat] of [[15, 38], [108, 16], [10, 47], [16, 44]]) views.push({ lon, lat, zoom: z });
          for (const v of views) {
            d.setView(v);
            d.settle();
            stat.views++;
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            // Mid-fade, a label's text over its plate is two translucent marks of the two colours: optically right, but a blend in the
            // canvas's straight-alpha bytes. The palette is judged on views at rest (every drawn node and interior mask fully opaque or absent).
            const atRest = d.labelCells().every((t) => t.alpha === 1 && (t.fillAlpha === 0 || t.fillAlpha === 1));
            for (let i = 0; i < img.data.length && atRest; i += 4) {
              if (img.data[i + 3] === 0) continue;
              stat.cells = (stat.cells ?? 0) + 1;
              if (img.data[i + 3] !== 255) {
                stat.offPalette++;
                continue;
              }
              const near = (c) => Math.abs(img.data[i] - c[0]) <= 4 && Math.abs(img.data[i + 1] - c[1]) <= 4 && Math.abs(img.data[i + 2] - c[2]) <= 4;
              if (!inkAndBg.some(near)) stat.offPalette++;
            }
            const drawnCells = new Map(d.labelCells().map((t) => [t.slug, t]));
            for (const n of d.lod()) {
              const cellInfo = drawnCells.get(n.slug);
              if (!n.shown || n.alpha < 0.99 || !cellInfo || cellInfo.alpha < 0.99) continue;
              n.solid = cellInfo.solid;
              stat.boxes++;
              const c0 = Math.round((n.box.x0 - (rect.left - rootRect.left)) / P);
              const c1 = Math.round((n.box.x1 - (rect.left - rootRect.left)) / P);
              const r0 = Math.round((n.box.y0 - (rect.top - rootRect.top)) / P);
              const r1 = Math.round((n.box.y1 - (rect.top - rootRect.top)) / P);
              const opaque = (x, y) => x >= 0 && y >= 0 && x < canvas.width && y < canvas.height && img.data[(y * canvas.width + x) * 4 + 3] === 255;
              // The outline at rest: the four corner arms solid, the rest of each edge dashed (2 on, then a gap, from the arm's end, anchored to the edge's own corner); the arm
              // and the gap grow with the box's smaller side (`dashingFor`, engine/pixel-labels.ts: arm 10 % in 3..14 cells, gap 3.5 % in 2..9), a box
              // too short for two arms and a gap is solid; the selected box (drawn solid) is one uninterrupted line.
              const solid = !!n.solid;
              const side = Math.min(c1 - c0, r1 - r0);
              const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
              const arm = clampInt(side * 0.1, 3, 14);
              const gap = clampInt(side * 0.035, 2, 9);
              // each edge is counted from its anchor: top from its left corner, bottom from its right, left from its top, right from its bottom (`edgeLit`)
              const lit = (i, len) => {
                if (solid || len < 2 * arm + gap) return true;
                return i < arm || i >= len - arm || (i - arm) % (2 + gap) >= gap;
              };
              let missing = 0;
              for (let x = c0; x < c1; x++) for (const y of [r0, r1 - 1]) if (lit(y === r0 ? x - c0 : c1 - 1 - x, c1 - c0) && x >= 0 && x < canvas.width && y >= 0 && y < canvas.height && !opaque(x, y)) missing++;
              for (let y = r0; y < r1; y++) for (const x of [c0, c1 - 1]) if (lit(x === c0 ? y - r0 : r1 - 1 - y, r1 - r0) && x >= 0 && x < canvas.width && y >= 0 && y < canvas.height && !opaque(x, y)) missing++;
              if (missing) {
                stat.outlineMissing++;
                stat.first ??= { n: n.slug, view: v, missing, c0, c1, r0, r1 };
              }
            }
          }
          void mainRect;
          return stat;
        });
        expect(`${name} ${scheme}: ${res.views} views, ${res.boxes} boxes: every lit cell of the outline (corner arms and dashes, solid when hovered) is drawn, whole cells`, res.outlineMissing === 0 && res.boxes > 10, res);
        expect(`${name} ${scheme}: at rest, nothing on the box canvas but the page colour and the ink and peak levels, fully opaque (a fade is opacity: unit-tested)`, res.offPalette === 0, res);
        expect(`${name} ${scheme}: the box canvas is cols x rows cells scaled by exactly one cell`, res.scaleOk, res);
        expect(`${name} ${scheme}: no console errors`, logs.length === 0, logs);
        await page.context().close();
      }
    }
  }

  /* ---------------------------------------------------------------------------------------------- empty */
  if (run("empty")) {
    const { page, logs } = await openGlobe(browser, DESKTOP, "&no-groups");
    const minZoom = await page.evaluate(() => window.__globeDebug.minZoom());
    let ok = true;
    let detail = null;
    for (const z of [minZoom, minZoom + 1, 4, 5.5, 6.5]) {
      const r = await page.evaluate((z) => {
        window.__globeDebug.setView({ lon: 20, lat: 30, zoom: z });
        window.__globeDebug.settle();
        const l = window.__globeDebug.lod();
        return { n: l.length, boxes: l.filter((x) => x.kind !== "place").length, allFull: l.every((x) => x.alpha === 1) };
      }, z);
      if (r.boxes !== 0 || !r.allFull) {
        ok = false;
        detail = { z, r };
      }
    }
    expect("no groups: every drawn place is at full alpha at every zoom, no group rectangle", ok, detail);
    expect("no console errors", logs.length === 0, logs);
    await page.context().close();
  }

  /* -------------------------------------------------------------------------------------------- reduced */
  if (run("reduced")) {
    const { page, logs } = await openGlobe(browser, DESKTOP, "&lod-cases", "light", "reduce");
    const minZoom = await page.evaluate(() => window.__globeDebug.minZoom());
    const r = await page.evaluate((minZoom) => {
      const d = window.__globeDebug;
      let nonBinary = 0;
      let steps = 0;
      const flips = [];
      let last = null;
      for (let z = minZoom; z <= 6.5; z += 0.01) {
        d.setView({ lon: 13.2, lat: 9.5, zoom: z });
        d.renderNow(); // no settle: under reduced motion the very next frame is the resting one
        const l = d.lod();
        steps++;
        for (const n of l) if (n.alpha !== 0 && n.alpha !== 1) nonBinary++;
        const key = l.map((n) => n.slug).sort().join(",");
        if (key !== last) flips.push(z.toFixed(2));
        last = key;
      }
      return { nonBinary, steps, flips };
    }, minZoom);
    expect(`reduced motion: every alpha is 0 or 1 over ${r.steps} zoom steps`, r.nonBinary === 0, r);
    console.log(`     the drawn set changes only at zooms ${r.flips.join(", ")}`);
    expect("no console errors", logs.filter((l) => !/Reduced Motion/.test(l)).length === 0, logs);
    await page.context().close();
  }

  /* ----------------------------------------------------------------------------------------------- timed */
  if (run("timed")) {
    const { page, logs } = await openGlobe(browser, DESKTOP, "&lod-cases");
    const minZoom = await page.evaluate(() => window.__globeDebug.minZoom());
    await page.evaluate(({ minZoom }) => {
      const d = window.__globeDebug;
      d.setView({ lon: 13.2, lat: 9.5, zoom: minZoom + 0.6 });
      d.settle();
    }, { minZoom });
    // The camera jumps to a zoom where the crowd opens and then STOPS. Every animation frame is sampled from there.
    const tl = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const d = window.__globeDebug;
          const out = [];
          const t0 = performance.now();
          d.setView({ lon: 13.2, lat: 9.5, zoom: 6.4 });
          const tick = () => {
            const l = d.lod();
            const box = l.find((n) => n.slug === "case-crowd");
            const dots = l.filter((n) => n.slug.startsWith("crowd-"));
            out.push({ t: Math.round(performance.now() - t0), box: box ? box.alpha : 0, dots: dots.length ? Math.max(...dots.map((n) => n.alpha)) : 0, n: dots.length, animating: d.layers().animating });
            if (performance.now() - t0 < 700) requestAnimationFrame(tick);
            else resolve(out);
          };
          requestAnimationFrame(tick);
        }),
    );
    const mid = tl.filter((x) => (x.box > 0 && x.box < 1) || (x.dots > 0 && x.dots < 1));
    const last = tl[tl.length - 1];
    const doneAt = tl.find((x) => x.box === 0 && x.dots === 1 && x.n === 10);
    console.log(`     timeline: ${tl.filter((_, i) => i % 3 === 0).map((x) => `${x.t}ms box ${x.box.toFixed(2)} dots ${x.dots.toFixed(2)}`).join(" | ")}`);
    expect(`the crowd opens by TIME with the camera still: ${mid.length} frames mid-transition, done at ${doneAt?.t} ms`, mid.length >= 3 && !!doneAt && doneAt.t >= 120 && doneAt.t <= 400, { mid: mid.length, doneAt });
    expect("while both are on screen their opacities sum to 1", mid.every((x) => Math.abs(x.box + x.dots - 1) < 0.1), mid.filter((x) => Math.abs(x.box + x.dots - 1) >= 0.1).slice(0, 3));
    expect("the last frame is fully resolved: the group gone, ten places at full opacity, nothing still animating", last.box === 0 && last.dots === 1 && last.n === 10 && !last.animating, last);
    const idle = await page.evaluate(async () => {
      const d = window.__globeDebug;
      const f0 = d.frames();
      await new Promise((r) => setTimeout(r, 600));
      return { frames: d.frames() - f0, pending: d.isAnimating() };
    });
    expect("and the frame loop has stopped (no frozen half-faded frame, no spinning)", idle.frames === 0 && !idle.pending, idle);
    expect("no console errors", logs.length === 0, logs);
    await page.context().close();
  }

  /* --------------------------------------------------------------------------------------------- at-rest */
  if (run("at-rest")) {
    const { page, logs } = await openGlobe(browser, DESKTOP);
    const minZoom = await page.evaluate(() => window.__globeDebug.minZoom());
    const rest = async () => {
      // the camera has stopped: wait for the frame loop to go quiet (twice in a row), then read the frame
      for (let i = 0; i < 80; i++) {
        // quiet = no transition, no frame pending, and the labels have ARRIVED (no glide left, no plan owed)
        const q = await page.evaluate(() => {
          const l = window.__globeDebug.layers();
          const s = window.__globeDebug.labelStats();
          return !l.animating && !l.framePending && s.gliding === 0 && !s.owed;
        });
        if (q) {
          await sleep(80);
          if (await page.evaluate(() => !window.__globeDebug.layers().framePending && window.__globeDebug.labelStats().gliding === 0)) return true;
        }
        await sleep(50);
      }
      return false;
    };
    const bad = [];
    let frames = 0;
    let boxes = 0;
    const check = async (what) => {
      const quiet = await rest();
      const r = await page.evaluate(() => {
        const d = window.__globeDebug;
        return { cells: d.labelCells(), layers: d.layers(), lod: d.lod(), view: d.view() };
      });
      frames++;
      if (!quiet) bad.push({ what, bad: "the frame loop never went quiet", layers: r.layers });
      for (const c of r.cells) {
        boxes++;
        // at rest every label is EXACTLY at its target offset (no half-glided plate)
        const why = c.alpha !== 1 ? `box alpha ${c.alpha}` : c.fillAlpha !== 0 && c.fillAlpha !== 1 ? `mask ${c.fillAlpha}` : !c.label ? "no label" : c.label.glide !== 0 || c.label.tx !== c.label.x || c.label.ty !== c.label.y ? `label ${c.label.glide} px from its target` : null;
        if (why) bad.push({ what, slug: c.slug, why, view: r.view });
      }
      for (const n of r.lod) if (n.alpha !== 1 || (n.fillAlpha !== 0 && n.fillAlpha !== 1)) bad.push({ what, slug: n.slug, why: `lod alpha ${n.alpha} mask ${n.fillAlpha}` });
      const b = r.layers.borders.value;
      if (b !== 0 && b !== 1) bad.push({ what, why: `borders at ${b}`, view: r.view });
      if (r.layers.borders.on !== (b === 1)) bad.push({ what, why: "borders not at their target", layers: r.layers.borders });
    };
    // 1. a trackpad: bursts of wheel events that decay (momentum), then let go, along world -> continent -> city, in and back out
    const centre = { x: 720, y: 450 };
    await page.mouse.move(centre.x, centre.y);
    await page.evaluate(({ minZoom }) => window.__globeDebug.setView({ lon: 10, lat: 47, zoom: minZoom }), { minZoom });
    for (const [dir, n] of [[-1, 9], [1, 9]]) {
      for (let k = 0; k < n; k++) {
        const amp = 60 + ((k * 37) % 120);
        for (let i = 0; i < 16; i++) {
          await page.mouse.wheel(0, dir * amp * Math.exp(-i / 5));
          await sleep(16);
        }
        await check(`wheel ${dir < 0 ? "in" : "out"} burst ${k}`);
      }
    }
    // 2. a fling (drag and release: pan inertia) at several zooms, with the camera moving across the limb
    for (const z of [minZoom, minZoom + 1, minZoom + 2.5]) {
      await page.evaluate((z) => window.__globeDebug.setView({ lon: 10, lat: 40, zoom: z }), z);
      await sleep(250);
      await page.mouse.move(500, 450);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) {
        await page.mouse.move(500 + i * 40, 450 + i * 6);
        await sleep(8);
      }
      await page.mouse.up();
      await check(`fling at zoom ${z.toFixed(2)}`);
    }
    // 3. the thresholds: every zoom at which the drawn set changes along a path, landed on from both sides by a hair, camera still afterwards
    const path = [[10, 47], [2.35, 48.8], [15.98, 45.8], [-0.12, 51.5]];
    let thresholds = 0;
    for (const [lon, lat] of path) {
      const zs = await page.evaluate(({ lon, lat, minZoom }) => {
        const d = window.__globeDebug;
        const out = [];
        let last = null;
        for (let z = minZoom; z <= 6.5; z += 0.01) {
          d.setView({ lon, lat, zoom: z });
          d.settle();
          const key = d.lod().map((n) => n.slug).sort().join(",");
          if (last !== null && key !== last) out.push(z);
          last = key;
        }
        return out;
      }, { lon, lat, minZoom });
      for (const z of zs.slice(0, 6)) {
        thresholds++;
        for (const dz of [-0.012, 0.012, -0.004, 0.004]) {
          await page.evaluate(({ lon, lat, z }) => window.__globeDebug.setView({ lon, lat, zoom: z }), { lon, lat, z: z + dz });
          await check(`threshold ${z.toFixed(2)} ${dz > 0 ? "+" : "-"}`);
        }
      }
    }
    // 4. the borders' own threshold (internal zoom 3.25)
    for (const z of [3.1, 3.2, 3.22, 3.28, 3.3, 3.4, 3.2, 3.0]) {
      await page.evaluate((z) => window.__globeDebug.setView({ lon: 10, lat: 47, zoom: z }), z);
      await check(`borders at zoom ${z}`);
    }
    expect(`at rest after the camera stops (${frames} resting frames, ${boxes} boxes, ${thresholds} thresholds): every box, mask and layer is fully on or fully off, every box has its label EXACTLY at its target (no half-glided plate), no frame pending, no plan owed`, frames > 30 && bad.length === 0, bad.slice(0, 6));
    expect("no console errors", logs.filter((l) => !/404/.test(l)).length === 0, logs);
    await page.context().close();
  }

  /* ----------------------------------------------------------------------------------------------- pick */
  if (run("pick")) {
    const { page, logs } = await openGlobe(browser, DESKTOP, "&lod-cases");
    const view = () => page.evaluate(() => window.__globeDebug.view());
    await page.evaluate(() => {
      window.__globeDebug.setView({ lon: 13.2, lat: 9.5, zoom: window.__globeDebug.minZoom() + 0.6 });
      window.__globeDebug.settle();
    });
    const box = (await page.evaluate(() => window.__globeDebug.lod())).find((n) => n.slug === "case-crowd");
    expect("the crowd is one box on screen", !!box && box.members === 10, box);
    const b = box.box;
    const hoverBorder = { x: b.x0 + 1, y: (b.y0 + b.y1) / 2 };
    await page.mouse.move(hoverBorder.x, hoverBorder.y);
    await sleep(150);
    expect("hover on a box's border shows the pointer cursor", (await page.evaluate(() => document.querySelector("canvas").style.cursor)) === "pointer", null);
    // The interior of a box is part of its target (the convex hull of the box and its label, engine/hit-area.ts); a point well outside is not.
    await page.mouse.move((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
    await sleep(150);
    expect("hover inside a small box shows the pointer cursor (the hull includes the box)", (await page.evaluate(() => document.querySelector("canvas").style.cursor)) === "pointer", null);
    await page.mouse.move(b.x1 + 60, b.y1 + 60);
    await sleep(150);
    expect("well outside the box and its label the cursor is grab", (await page.evaluate(() => document.querySelector("canvas").style.cursor)) === "grab", null);
    const v0 = await view();
    // the border: flies to frame the group's circle, its places show
    await page.mouse.click(hoverBorder.x, hoverBorder.y);
    await page.waitForFunction(() => !window.__globeDebug.isAnimating(), null, { timeout: 8000 });
    await sleep(200);
    const v2 = await view();
    const after = await page.evaluate(() => window.__globeDebug.lod());
    expect(`click on the border flies to the group (zoom ${v0.zoom.toFixed(2)} to ${v2.zoom.toFixed(2)}, centre ${v2.lon.toFixed(1)},${v2.lat.toFixed(1)})`, v2.zoom > v0.zoom + 0.5 && Math.abs(v2.lon - 13.2) < 0.01 && Math.abs(v2.lat - 9.5) < 0.01, { v0, v2 });
    expect("its places are showing and the box is gone", !after.some((n) => n.slug === "case-crowd") && after.filter((n) => n.slug.startsWith("crowd-") && n.alpha === 1).length >= 8, after.map((n) => n.slug));
    expect("the URL did not change (a group has no page)", !page.url().includes("/locations/"), page.url());
    // the label plate of a box is a hit area too
    await page.evaluate(() => {
      window.__globeDebug.setView({ lon: 13.2, lat: 9.5, zoom: window.__globeDebug.minZoom() + 0.6 });
      window.__globeDebug.settle();
    });
    const tab = (await page.evaluate(() => window.__globeDebug.labelCells())).find((l) => l.slug === "case-crowd");
    // label coordinates are the container's CSS px: the labels root is the origin
    const root = await page.evaluate(() => {
      const r = document.querySelector('[data-globe="three"] > div:nth-child(2)').getBoundingClientRect();
      return { left: r.left, top: r.top };
    });
    const lab = tab?.label;
    expect(
      `the label reads "${tab?.text}" over "${tab?.subWhole}", HTML text above the box's top-left corner (3 px of clear room, the plate's left edge on the box's left edge), the whole label at its first position`,
      !!tab && !!lab && tab.text === "Crowd" && tab.subWhole === "10 places" && lab.text === "Crowd" && lab.sub === "10 places" && Math.abs(lab.x - tab.box.x0) < 0.01 && Math.abs(lab.y + lab.h + 3 - tab.box.y0) < 0.01 && !lab.inside && lab.variant === 0 && lab.cand === 0,
      tab,
    );
    const dom = (await page.evaluate(() => window.__globeDebug.labelsDom())).find((l) => l.slug === "case-crowd");
    expect(`the DOM label is real text, "${dom?.text}" and "${dom?.sub}", at the planned place (within a device pixel)`, !!dom && dom.text === "Crowd" && dom.sub === "10 places" && Math.abs(dom.rect.x0 - (root.left + lab.x)) <= 0.5 && Math.abs(dom.rect.y0 - (root.top + lab.y)) <= 0.5, { dom, lab, root });
    await page.mouse.click(root.left + lab.x + lab.w / 2, root.top + lab.y + lab.h / 2);
    await page.waitForFunction(() => !window.__globeDebug.isAnimating(), null, { timeout: 8000 });
    expect("a click on the tab also flies to the group", (await view()).zoom > v0.zoom + 0.5, await view());
    // a place's rectangle: its border opens its page
    const one = (await page.evaluate(() => window.__globeDebug.lod())).find((n) => n.slug === "crowd-3");
    await page.mouse.click(one.box.x0 + 1, (one.box.y0 + one.box.y1) / 2);
    await page.waitForURL(/\/locations\/crowd-3/, { timeout: 4000 }).catch(() => {});
    expect("a click on a place's rectangle selects the place (/locations/:slug)", page.url().includes("/locations/crowd-3"), page.url());
    expect("no console errors", logs.filter((l) => !/404/.test(l)).length === 0, logs);
    await page.context().close();
  }

  /* --------------------------------------------------------------------------------------------- targets */
  if (run("targets")) {
    const { page, logs } = await openGlobe(browser, DESKTOP);
    // labels and targets are in the container's CSS px: the labels root is the origin
    const origin = await page.evaluate(() => {
      const r = document.querySelector('[data-globe="three"] > div:nth-child(2)').getBoundingClientRect();
      return { left: r.left, top: r.top };
    });
    const minZoom = await page.evaluate(() => window.__globeDebug.minZoom());
    let seen = 0;
    const domBad = [];
    let shortened = 0;
    let overlapped = 0;
    let nested = 0;
    const halfState = [];
    const layoutBad = [];
    const unlabelled = [];
    const collisions = [];
    const samples = [];
    const NAMED = {
      world: { lon: 10, lat: 30, dz: 0 },
      "continents (Europe and Africa)": { lon: 12, lat: 30, dz: 0.4 },
      "Asia and the Pacific": { lon: 105, lat: 15, dz: 0.4 },
      "the Americas": { lon: -70, lat: 0, dz: 0.4 },
      Europe: { lon: 12, lat: 47, dz: 1.4 },
      "the Balkans": { lon: 21, lat: 43, dz: 2.2 },
      "a city cluster (London, Brussels, Paris)": { lon: 1, lat: 50.5, dz: 3 },
      "Paris and Switzerland": { lon: 5, lat: 47, dz: 3.4 },
    };
    const views = Object.entries(NAMED).map(([name, v]) => ({ name, ...v }));
    for (const lon of [-120, -80, -40, 0, 20, 60, 100, 140]) for (const lat of [-25, 10, 30, 45, 60]) for (const dz of [0, 0.3, 0.7, 1.1, 1.6, 2.4, 3.2]) views.push({ name: "sweep", lon, lat, dz });
    for (const v of views) {
      const cells = await page.evaluate(
        ({ lon, lat, zoom }) => {
          window.__globeDebug.setView({ lon, lat, zoom });
          window.__globeDebug.settle();
          return { cells: window.__globeDebug.labelCells(), dom: window.__globeDebug.labelsDom() };
        },
        { lon: v.lon, lat: v.lat, zoom: minZoom + v.dz },
      );
      const domOf = new Map(cells.dom.map((d) => [d.slug, d]));
      if (cells.dom.length !== cells.cells.length) domBad.push({ wrong: "element count", dom: cells.dom.length, cells: cells.cells.length, view: v });
      const placed = [];
      for (const c of cells.cells) {
        seen++;
        const l = c.label;
        // At rest nothing is half way (a node is fully drawn, its mask on or off) and EVERY drawn box has its label: none dropped, none dimmed.
        const bad = c.alpha !== 1 ? "half-faded" : c.fillAlpha !== 0 && c.fillAlpha !== c.alpha ? "half mask" : !l ? "no label" : l.w <= 0 ? "empty label" : null;
        if (bad) {
          (bad === "no label" || bad === "empty label" ? unlabelled : halfState).push({ ...v, slug: c.slug, bad, alpha: c.alpha, fill: c.fillAlpha });
          continue;
        }
        if (l.variant > 0) shortened++;
        if (l.overlap) overlapped++;
        if (l.inside) nested++;
        placed.push({ slug: c.slug, x0: l.x, y0: l.y, x1: l.x + l.w, y1: l.y + l.h, overlap: l.overlap });
        // the element is really in the DOM: the same text, fully opaque, at rest, where the plan put it
        const el = domOf.get(c.slug);
        const wrong = !el ? "no element" : el.text !== l.text || (el.sub ?? null) !== (l.sub ?? null) ? "text" : el.opacity !== 1 ? "half opacity" : el.mode !== "rest" ? "state" : l.glide !== 0 || l.tx !== l.x || l.ty !== l.y ? `not at its target (${l.glide} px away)` : (() => {
                // settled: every label is exactly at its target, and the element is where the label says (within a device pixel)
                const m = /translate3d\(([-\d.]+)px,\s*([-\d.]+)px/.exec(el.transform);
                return !m || Math.abs(Number(m[1]) - l.x) > 0.3 || Math.abs(Number(m[2]) - l.y) > 0.3 ? "position" : null;
              })();
        if (wrong) domBad.push({ slug: c.slug, wrong, el, l });
        else {
          // the plate's edge is the box's outer edge (above its top-left corner), 3 px of clear room above the box, the text starts after the padding,
          // two lines when there is a second line, and the feather is the plate's twin in the layer below
          const alignedLeft = l.cand === 0 && !l.overlap && Math.abs(l.x - c.box.x0) > 0.01 ? "plate not on the box's left edge" : null;
          const gap = l.cand === 0 && !l.overlap && Math.abs(l.y + l.h + 3 - c.box.y0) > 0.01 ? "gap above the box is not 3 px" : null;
          const pad = Math.abs(el.nameRect.x0 - el.rect.x0 - 6) > 0.6 ? "text not 6 px inside the plate" : null;
          const lines = l.sub ? (el.subRect.y1 - el.subRect.y0 > 0 && el.subRect.y0 >= el.nameRect.y1 - 0.5 ? null : "second line not under the name") : el.subRect.y1 - el.subRect.y0 > 0.5 ? "second line shown without text" : null;
          const halo = !el.halo || el.halo.transform !== el.transform || Math.abs(el.halo.x1 - el.halo.x0 - l.w) > 1 || Math.abs(el.halo.y1 - el.halo.y0 - l.h) > 1 ? "feather not the plate's twin" : null;
          const size = Math.abs(el.rect.x1 - el.rect.x0 - l.w) > 0.01 || Math.abs(el.rect.y1 - el.rect.y0 - l.h) > 1.01 ? "the plate is not the planned size" : null;
          const why = alignedLeft || gap || pad || lines || halo || size;
          if (why) layoutBad.push({ slug: c.slug, why, l, el: { rect: el.rect, nameRect: el.nameRect, subRect: el.subRect, halo: el.halo } });
        }
      }
      // plates are disjoint (a cell of clearance) unless one of the two is the last resort
      for (let i = 0; i < placed.length; i++)
        for (let j = i + 1; j < placed.length; j++) {
          const p = placed[i];
          const q = placed[j];
          if (p.overlap || q.overlap) continue;
          if (p.x0 < q.x1 && p.x1 > q.x0 && p.y0 < q.y1 && p.y1 > q.y0) collisions.push({ ...v, a: p.slug, b: q.slug });
        }
      if (v.name === "sweep" && v.dz > 0 && cells.cells.length && samples.length < 40) samples.push({ lon: v.lon, lat: v.lat, zoom: minZoom + v.dz });
    }
    expect(`at rest, over ${views.length} views (world, continents, Europe, the Balkans, a city cluster, a lon/lat/zoom sweep) and ${seen} drawn boxes: 100 % have their label (${unlabelled.length} without), none half-faded or dimmed (${shortened} labels shortened, ${overlapped} drawn over another as the last resort, ${nested} nested inside their box)`, seen > 20 && unlabelled.length === 0 && halfState.length === 0, { unlabelled: unlabelled.slice(0, 5), halfState: halfState.slice(0, 5) });
    expect("at rest, no two label plates overlap unless one of them is the last resort", collisions.length === 0, collisions.slice(0, 5));
    expect(`every label's layout in the real DOM: plate on the box's left edge, 3 px above it, text 6 px inside the plate, second line under the name, the planner's size equal to the element's, the feather the plate's twin (${layoutBad.length} wrong)`, layoutBad.length === 0, layoutBad.slice(0, 5));
    expect(`at rest every drawn box has its label as a REAL element in the DOM: its text, fully opaque (no half-fade), at the planned place, EXACTLY at its target offset (${domBad.length} wrong); and no element without a box`, domBad.length === 0, domBad.slice(0, 5));

    // Hover: the box, its label and the gap between them are one target; the hovered node is drawn solid.
    const ptOf = (cx, cy) => ({ x: origin.left + cx, y: origin.top + cy });
    let tested = 0;
    const bad = [];
    for (const v of samples.slice(0, 12)) {
      const cells = await page.evaluate((v) => {
        window.__globeDebug.setView(v);
        window.__globeDebug.settle();
        return window.__globeDebug.labelCells();
      }, v);
      const plateOf = (o) => (o.label ? { x0: o.label.x, y0: o.label.y, x1: o.label.x + o.label.w, y1: o.label.y + o.label.h } : null);
      const BIG = 0.45 * Math.min(1440, 900); // HIT.bigBoxFrac of the smaller side, in px: a big box has no interior target
      const isBig = (o) => Math.max(o.box.x1 - o.box.x0, o.box.y1 - o.box.y0) > BIG;
      const near = (r, x, y, m) => x >= r.x0 - m && x <= r.x1 + m && y >= r.y0 - m && y <= r.y1 + m;
      const inOthers = (c, x, y) =>
        cells.some((o) => {
          if (o === c) return false; // any other drawn node, however faint, may share the point: those probes are skipped
          const r = o.box;
          const pl = plateOf(o);
          if (pl && near(pl, x, y, 10)) return true;
          if (!isBig(o)) return near(pl ? { x0: Math.min(r.x0, pl.x0), y0: Math.min(r.y0, pl.y0), x1: Math.max(r.x1, pl.x1), y1: Math.max(r.y1, pl.y1) } : r, x, y, 10); // the hull lies inside the bounding box of the box and its label
          return near(r, x, y, 12) && !(x > r.x0 + 12 && x < r.x1 - 12 && y > r.y0 + 12 && y < r.y1 - 12);
        });
      for (const c of cells) {
        if (c.alpha < 0.9 || !c.label || isBig(c) || c.label.overlap) continue;
        const r = c.box;
        const pl = plateOf(c);
        const probes = [
          ["box", (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2],
          ["label", (pl.x0 + pl.x1) / 2, (pl.y0 + pl.y1) / 2],
        ];
        // the triangle under a label that is wider than its box, between the box's top-right corner and the label's bottom-right corner
        // (above the box: under the plate's right end, next to the box's top edge; below it: the same against the bottom edge)
        if (pl.x1 - r.x1 > 20 && pl.y1 <= r.y0) probes.push(["gap", r.x1 + (pl.x1 - r.x1) * 0.3, r.y0 + 5]);
        else if (pl.x1 - r.x1 > 20 && pl.y0 >= r.y1) probes.push(["gap", r.x1 + (pl.x1 - r.x1) * 0.3, r.y1 - 5]);
        for (const [what, cx, cy] of probes) {
          if (inOthers(c, cx, cy) || cx < 15 || cy < 15 || cx > 1440 - 15 || cy > 900 - 15) continue; // another node shares the point, or it is at the edge of the viewport
          const p = ptOf(cx, cy);
          await page.mouse.move(p.x, p.y);
          await sleep(60);
          const cursor = await page.evaluate(() => document.querySelector("canvas").style.cursor);
          const hovered = (await page.evaluate(() => window.__globeDebug.labelCells())).filter((o) => o.active).map((o) => o.slug);
          tested++;
          if (cursor !== "pointer" || !hovered.includes(c.slug)) bad.push({ slug: c.slug, what, cursor, hovered, view: v, alpha: c.alpha, at: [cx, cy], picked: await page.evaluate(([x, y]) => window.__globeDebug.pick(x, y), [p.x - origin.left, p.y - origin.top]) });
        }
        await page.mouse.move(2, 2);
        if (tested > 60) break;
      }
    }
    expect(`hovering a box, its label and the gap under a wide label shows the pointer and the hover state (${tested} probes)`, tested > 10 && bad.length === 0, bad.slice(0, 5));
    // far from every target: the grab cursor, nothing hovered
    await page.mouse.move(origin.left + 3, origin.top + 3);
    await sleep(80);
    expect("away from every target the cursor is grab", (await page.evaluate(() => document.querySelector("canvas").style.cursor)) === "grab", null);
    expect("no console errors", logs.filter((l) => !/404/.test(l)).length === 0, logs);
    await page.context().close();
  }

  /* ------------------------------------------------------------------------------------------------- open */
  if (run("open")) {
    const { page, logs } = await openGlobe(browser, DESKTOP);
    const tree = await page.evaluate(() => window.__globeDebug.tree());
    const have = (slug) => tree.some((n) => n.slug === slug);
    const GROUPS = [
      ["western-europe", 5, 46],
      ["balkans", 19.9, 43.5],
      ["iberia", -3.6, 40.3],
      ["central-europe", 17.5, 49.5],
      ["italy", 12.5, 43.5],
      // the areas of the multi-scale hierarchy (an area in an area in a country): their long-named boxes may open through ONE place
      ["morocco", -11.8, 28.8, 1],
      ["marrakesh-region", -8.2, 31.6, 1],
      ["laayoune-area", -12.2, 27.8, 1],
    ].filter(([slug]) => have(slug));
    expect(`the preview (or any content) has the groups of the complaint (${GROUPS.map((g) => g[0]).join(", ")})`, GROUPS.length >= 1, tree.filter((n) => n.kind !== "place").map((n) => n.slug));
    const parentOf = new Map(tree.map((n) => [n.slug, n.parent]));
    const read = (pg) =>
      pg.evaluate(() => {
        const d = window.__globeDebug;
        return { cells: d.labelCells(), lod: d.lod(), dom: d.labelsDom() };
      });

    // 1. A slow zoom sweep, every frame at rest. At every resting frame: no drawn node has a drawn ancestor (no exemption), every box is fully drawn,
    // has its label element at full opacity, and no plate is over another unless it is the last resort. Per group: the zoom where it opens.
    const bad = [];
    const opens = [];
    let frames = 0;
    let maxBoxes = 0;
    for (const [slug, lon, lat, minLater = 2] of GROUPS) {
      let openedAt = -1;
      let shownAtOpen = 0;
      let shownLater = -1;
      // (a fresh page per group: the opening depends on what was drawn before, so the sweep starts from the world view, as a first visit does)
      const pageG = (await openGlobe(browser, DESKTOP)).page;
      for (let z = 2.2; z <= 7.5; z += 0.05) {
        await pageG.evaluate((v) => {
          window.__globeDebug.setView(v);
          window.__globeDebug.settle();
        }, { lon, lat, zoom: z });
        const r = await read(pageG);
        frames++;
        const drawn = new Set(r.cells.map((c) => c.slug));
        const onScreen = r.cells.filter((c) => c.box.x1 > 0 && c.box.x0 < 1440 && c.box.y1 > 0 && c.box.y0 < 900);
        maxBoxes = Math.max(maxBoxes, onScreen.length);
        for (const c of r.cells) {
          // no group together with anything below it
          for (let a = parentOf.get(c.slug); a; a = parentOf.get(a)) if (drawn.has(a)) bad.push({ slug, z, node: c.slug, ancestor: a, why: "a node drawn together with a drawn ancestor" });
          if (c.parented) bad.push({ slug, z, node: c.slug, why: "parented at rest" });
          if (c.alpha !== 1 || (c.fillAlpha !== 0 && c.fillAlpha !== 1)) bad.push({ slug, z, node: c.slug, why: `half-faded at rest (alpha ${c.alpha}, mask ${c.fillAlpha})` });
          if (!c.label || c.label.w <= 0) bad.push({ slug, z, node: c.slug, why: "a box without a label" });
          const el = r.dom.find((x) => x.slug === c.slug);
          if (!el || el.opacity !== 1) bad.push({ slug, z, node: c.slug, why: `no label element, or not opaque (${el?.opacity})` });
        }
        for (let i = 0; i < r.cells.length; i++)
          for (let j = i + 1; j < r.cells.length; j++) {
            const p = r.cells[i].label;
            const q = r.cells[j].label;
            if (p && q && !p.overlap && !q.overlap && p.x < q.x + q.w && p.x + p.w > q.x && p.y < q.y + q.h && p.y + p.h > q.y) bad.push({ slug, z, a: r.cells[i].slug, b: r.cells[j].slug, why: "two plates overlap" });
          }
        // OPEN = the group's own box is not drawn and something below it is (a group nested in a group can open in the very frame its parent does,
        // so it need not have been seen as a box first; one whose box does not fit opens THROUGH its single most important place)
        if (!drawn.has(slug)) {
          const below = [...drawn].filter((s) => { for (let a = parentOf.get(s); a; a = parentOf.get(a)) if (a === slug) return true; return false; });
          if (below.length > 0 && openedAt < 0) {
            openedAt = z;
            shownAtOpen = below.length;
          }
          if (openedAt > 0 && z >= openedAt + 0.29 && shownLater < 0) shownLater = below.length; // (a third of a level on: the rest has come in)
        }
      }
      opens.push({ slug, openedAt, shownAtOpen, shownLater, minLater });
      await pageG.context().close();
    }
    expect(`${frames} resting frames over ${GROUPS.length} groups (zoom 2.2 to 7.5): no node drawn with a drawn ancestor, every box fully drawn with its label element opaque, no plate over another; at most ${maxBoxes} boxes on screen`, frames > 0 && bad.length === 0, bad.slice(0, 6));
    for (const o of opens) expect(`${o.slug}: its box is replaced by ${o.shownAtOpen} of its places at zoom ${o.openedAt.toFixed(2)} (${o.shownLater} a third of a level later; the size rule alone opens them at 4.7 to 7.8), never both`, o.openedAt > 0 && o.openedAt < 5.2 && o.shownAtOpen >= 1 && o.shownLater >= o.minLater, o);

    // 2. The cross-fade itself, with the clock running: a slow zoom through the opening of Western Europe on a fresh page (the way in to 2.6 at rest, then
    // one step per animation frame up to 4.8), sampling the opacity of every drawn node (the tree's own value), the label elements' CSS opacity, and the
    // pick at the children. Nothing is settled.
    const [wslug, wlon, wlat] = GROUPS.find((g) => g[0] === "western-europe") ?? GROUPS[0];
    await page.context().close();
    const fresh = await openGlobe(browser, DESKTOP);
    const page2 = fresh.page;
    const series = await page2.evaluate(
      async ({ lon, lat, from, to }) => {
        const d = window.__globeDebug;
        // the way in up to `from`, at rest step after step (the hysteresis memory is the one a real zoom leaves), then the clock runs
        for (let z = 2.2; z < from; z += 0.05) {
          d.setView({ lon, lat, zoom: z });
          d.settle();
        }
        const out = [];
        const t0 = performance.now();
        await new Promise((resolve) => {
          let z = from;
          const step = () => {
            d.setView({ lon, lat, zoom: z });
            z += (to - from) / 120;
            requestAnimationFrame(() => {
              const lod = d.lod();
              const dom = d.labelsDom();
              out.push({ t: performance.now() - t0, z, lod: lod.map((n) => ({ slug: n.slug, alpha: n.alpha, wanted: n.wanted, box: n.box })), dom: dom.map((e) => ({ slug: e.slug, opacity: e.opacity })), animating: d.layers().animating });
              if (z <= to + 1e-9 || d.layers().animating) requestAnimationFrame(step);
              else resolve();
            });
          };
          requestAnimationFrame(step);
        });
        return out;
      },
      { lon: wlon, lat: wlat, from: 2.6, to: 4.8 },
    );
    let worstSum = 0;
    let worst = "";
    let domWorst = 0;
    let mid = 0;
    let firstKid = -1;
    let lastParent = -1;
    let sampled = 0;
    const kids = new Set(tree.filter((n) => underGroup(tree, n.slug, wslug)).map((n) => n.slug));
    for (const f of series) {
      const alpha = new Map(f.lod.map((n) => [n.slug, n.alpha]));
      const domOp = new Map(f.dom.map((e) => [e.slug, e.opacity]));
      sampled++;
      for (const [slug, a] of alpha) {
        for (let p = parentOf.get(slug); p; p = parentOf.get(p)) {
          const ap = alpha.get(p);
          if (ap !== undefined && ap + a > worstSum) {
            worstSum = ap + a;
            worst = `${p} ${ap.toFixed(2)} + ${slug} ${a.toFixed(2)} at z ${f.z.toFixed(3)}`;
          }
        }
        // the label element follows the box's own opacity (a quantum of 1/64 and the frame between the two reads)
        const o = domOp.get(slug);
        if (o !== undefined) domWorst = Math.max(domWorst, Math.abs(o - a));
      }
      const parent = alpha.get(wslug) ?? 0;
      const kidMax = Math.max(0, ...[...alpha].filter(([s]) => kids.has(s)).map(([, v]) => v));
      if (parent > 0.2 && parent < 0.8 && kidMax > 0.2) mid++;
      if (kidMax > 0 && firstKid < 0) firstKid = f.t;
      if (parent > 0) lastParent = f.t;
    }
    expect(`during a scripted zoom through the opening of ${wslug} (${sampled} frames, the clock running) a group and a node below it never sum above 1.05 (${worstSum.toFixed(3)} ${worst})`, sampled > 20 && worstSum <= 1.05, { worstSum, worst });
    expect(`...the cross-fade was seen mid-way (${mid} frames with the group between 0.2 and 0.8 and a child above 0.2), starting together and lasting about 200 ms (${(lastParent - firstKid).toFixed(0)} ms from the first child to the last frame of the group; the first and last 30 ms are below the opacity that is drawn)`, mid >= 1 && lastParent - firstKid >= 80 && lastParent - firstKid <= 450, { mid, firstKid, lastParent });
    expect(`...the label elements follow the nodes' opacity (largest difference ${domWorst.toFixed(3)})`, domWorst <= 0.08, domWorst);

    // 3. Picking while it cross-fades: the parent stops taking clicks once below half, the children are targets from the first frames.
    const cross = series.filter((f) => {
      const p = f.lod.find((n) => n.slug === wslug);
      return p && p.alpha > 0.05 && p.alpha < 1 && f.lod.some((n) => kids.has(n.slug) && n.alpha > 0.35);
    });
    expect(`a frame with the group fading out and a child at least a third there was sampled (${cross.length})`, cross.length >= 1, null);
    {
      // replay the middle of the cross-fade with the clock paused: set the camera, advance by hand, ask `pick` at the children's centres
      const probe = await page2.evaluate(
        async ({ lon, lat, from, to }) => {
          const d = window.__globeDebug;
          const parentOfSlug = new Map(d.tree().map((n) => [n.slug, n.parent]));
          for (let z = 2.2; z < from; z += 0.05) {
            d.setView({ lon, lat, zoom: z });
            d.settle();
          }
          const res = [];
          await new Promise((resolve) => {
            let z = from;
            const step = () => {
              d.setView({ lon, lat, zoom: z });
              z += (to - from) / 160;
              requestAnimationFrame(() => {
                const lod = d.lod();
                const cells = d.labelCells();
                for (const n of lod) {
                  const c = cells.find((x) => x.slug === n.slug);
                  if (!c || !c.wanted || n.alpha < 0.3 || n.alpha > 0.98) continue;
                  const ancestor = (() => { for (let a = parentOfSlug.get(n.slug); a; a = parentOfSlug.get(a)) { const m = lod.find((x) => x.slug === a); if (m && m.alpha > 0 && !m.wanted) return m; } return null; })();
                  if (!ancestor) continue;
                  const cx = (c.box.x0 + c.box.x1) / 2;
                  const cy = (c.box.y0 + c.box.y1) / 2;
                  res.push({ child: n.slug, childAlpha: n.alpha, parent: ancestor.slug, parentAlpha: ancestor.alpha, picked: d.pick(cx, cy) });
                }
                if (z <= to + 1e-9) requestAnimationFrame(step);
                else resolve();
              });
            };
            requestAnimationFrame(step);
          });
          return res;
        },
        { lon: wlon, lat: wlat, from: 2.6, to: 4.8 },
      );
      // (the smallest target wins, so a click on a child's centre may pick a still smaller node on top of it: what must not happen is the group
      // that is fading out, or nothing)
      const wrong = probe.filter((p) => p.picked === null || p.picked === p.parent);
      expect(`a click on a child that is fading in (at least 0.3 there) never picks the group fading out nor nothing (${probe.length} probes)`, probe.length >= 1 && wrong.length === 0, wrong.slice(0, 4));
    }

    // 4. A slow zoom, every 0.02 at rest: nothing on the screen goes away again on the way in except a group that opens.
    await page2.context().close();
    const again = await openGlobe(browser, DESKTOP);
    const back = [];
    for (const [slug, lon, lat] of GROUPS) {
      const walk = await again.page.evaluate(
        async ({ lon, lat }) => {
          const d = window.__globeDebug;
          // (reached the way a person does: by zooming OUT from the last view, a group open through its places merges back to its box on the way)
          for (let z = 7; z >= 2.4; z -= 0.05) {
            d.setView({ lon, lat, zoom: z });
            d.settle();
          }
          d.setView({ lon, lat, zoom: 2.4 });
          d.settle();
          const out = [];
          let prev = [];
          for (let z = 2.4; z <= 7; z += 0.02) {
            d.setView({ lon, lat, zoom: z });
            d.settle();
            const want = d.lod().map((n) => [n.slug, n.box]);
            const now = new Set(want.map((w) => w[0]));
            // (whether what went is still on the visible side of the globe)
            out.push({ z, want, onGlobe: Object.fromEntries(prev.filter((s) => !now.has(s)).map((s) => [s, d.project(s)?.visible ?? true])) });
            prev = [...now];
          }
          return out;
        },
        { lon, lat },
      );
      let prev = new Map();
      for (const s of walk) {
        const now = new Map(s.want);
        for (const [k, box] of prev) {
          if (now.has(k)) continue;
          const n = tree.find((t) => t.slug === k);
          // off the screen (or the globe's limb) a node goes without a word; on it a group box goes when it opens (a node below it is wanted)
          const onScreen = box.x1 > 60 && box.x0 < 1380 && box.y1 > 60 && box.y0 < 840; // (well inside: a node at the edge goes by panning off it)
          const replaced = n.kind !== "place" && [...now.keys()].some((w) => underGroup(tree, w, k));
          if (onScreen && !replaced && s.onGlobe[k] !== false) back.push({ view: slug, node: k, z: s.z });
        }
        prev = now;
      }
    }
    expect(`a slow zoom on the way in (0.02 steps, at rest) over ${GROUPS.length} views: a node on the screen goes only when its group opens (${back.length} others)`, back.length === 0, back.slice(0, 6));
    expect("no console errors", [...logs, ...fresh.logs, ...again.logs].filter((l) => !/404/.test(l)).length === 0, [...logs, ...fresh.logs, ...again.logs]);
    await again.page.context().close();
  }

  /* ------------------------------------------------------------------------------------------------ cost */
  if (run("cost")) {
    for (const [label, extra] of [["18 places (demo)", ""], ["186 nodes (synthetic)", "&lod-stress=186"], ["1000 nodes (synthetic)", "&lod-stress=1000"], ["5000 nodes (synthetic)", "&lod-stress=5000"], ["demo, no groups", "&no-groups"]]) {
      const { page } = await openGlobe(browser, DESKTOP, extra);
      const minZoom = await page.evaluate(() => window.__globeDebug.minZoom());
      const res = await page.evaluate(
        ({ minZoom }) => {
          const d = window.__globeDebug;
          const out = {};
          for (const [k, z] of [["world", minZoom], ["mid", minZoom + 1.3], ["deep", 5.5]]) {
            d.setView({ lon: 20, lat: 35, zoom: z });
            d.renderNow();
            const b = d.benchLod(1000);
            const times = [];
            for (let i = 0; i < 300; i++) {
              d.setView({ lon: 20 + i * 0.05, lat: 35, zoom: z + Math.sin(i / 20) * 0.2 });
              const t = performance.now();
              d.renderNow();
              times.push(performance.now() - t);
            }
            times.sort((a, b) => a - b);
            out[k] = { lodUs: +(b.msPerEval * 1000).toFixed(1), visited: b.visited, nodes: b.nodes, frameP50: +times[150].toFixed(3), frameP95: +times[285].toFixed(3), stats: d.lodStats() };
          }
          return out;
        },
        { minZoom },
      );
      console.log(`     ${label}:`);
      for (const [k, v] of Object.entries(res)) console.log(`       ${k}: cluster pass ${v.lodUs} us/eval (visited ${v.visited} of ${v.nodes}); full frame p50 ${v.frameP50} / p95 ${v.frameP95} ms JS; drawn ${v.stats.drawnMarkers} dots + ${v.stats.drawnGroups} boxes`);
      if (extra.includes("lod-stress=1000")) expect("the cluster pass over 1000 nodes stays under 600 microseconds per evaluation", Object.values(res).every((v) => v.lodUs < 600), res);
      await page.context().close();
    }
  }

  /* ------------------------------------------------------------------------------------------------ idle */
  if (run("idle")) {
    const { page } = await openGlobe(browser, DESKTOP);
    await page.evaluate(() => {
      window.__globeDebug.setView({ lon: 12, lat: 45, zoom: 4 });
    });
    // the camera jumped: the labels re-plan and glide to their places (about a second), then the map is idle: wait for that, it is not idle before
    for (let i = 0; i < 80; i++) {
      await sleep(50);
      if (await page.evaluate(() => { const s = window.__globeDebug.labelStats(); return s.gliding === 0 && !s.owed && !window.__globeDebug.isAnimating(); })) break;
    }
    await sleep(300);
    const a = await page.evaluate(() => ({ raf: window.__raf.calls, frames: window.__globeDebug.frames(), clears: window.__clears ?? 0, labels: window.__globeDebug.labelStats() }));
    await sleep(2500);
    const b = await page.evaluate(() => ({ raf: window.__raf.calls, frames: window.__globeDebug.frames(), clears: window.__clears ?? 0, labels: window.__globeDebug.labelStats() }));
    expect(`idle with boxes on screen: 0 rAF calls, 0 frames, 0 clears, 0 label canvas draws over 2.5 s`, a.raf === b.raf && a.frames === b.frames && a.clears === b.clears && a.labels.drawn === b.labels.drawn, { a, b });
    await page.mouse.move(60, 300); // off the globe: nothing under the pointer on any content
    await page.mouse.move(80, 320);
    await sleep(500);
    const c = await page.evaluate(() => ({ frames: window.__globeDebug.frames() }));
    expect("moving the pointer over the map without changing the hover draws nothing", c.frames - b.frames <= 1, { b, c });
    // a camera that moves but changes no label: the canvas is not redrawn
    const before = await page.evaluate(() => window.__globeDebug.labelStats());
    await page.evaluate(() => {
      const d = window.__globeDebug;
      for (let i = 0; i < 20; i++) {
        d.setView({ lon: 12 + i * 1e-7, lat: 45, zoom: 4 });
        d.renderNow();
      }
    });
    const after = await page.evaluate(() => window.__globeDebug.labelStats());
    expect(`20 frames of a sub-pixel camera change redraw the label canvas at most once (${after.drawn - before.drawn} draws, ${after.skipped - before.skipped} skipped)`, after.drawn - before.drawn <= 1, { before, after });
    await page.context().close();
  }

  /* ---------------------------------------------------------------------------------------------- flicker */
  if (run("flicker")) {
    // A scripted camera on the real app: a pan that swings both ways while the zoom breathes, one synchronous frame at a time (60 per second
    // of the page's own clock), over a crowded view of the preview or the demo. Per frame the labels are read back (candidate position, way of
    // writing it, plate as DRAWN, glide left) and the FLICKER METRIC is counted as in `label-track.test.ts`: a TELEPORT is a plate that moved
    // in one frame (its nearer edge on each axis) by more than its box did plus `SNAP_PX` (6 px) plus what its own glide may move it by (1.1 x omega x dt x the glide left); a CHANGE is a
    // label shown in two consecutive frames with another slot (a change is a glide, not a flicker); VISIBILITY a label that appeared or
    // disappeared (the camera and the cut decide it).
    const { page, logs } = await openGlobe(browser, DESKTOP);
    const minZoom = await page.evaluate(() => window.__globeDebug.minZoom());
    const OMEGA = 14; // TRACK.omega (engine/label-track.ts)
    // Slack of the teleport test beyond what the box moved: the box is snapped to art cells (2.5 to 3 px) and the plate to device pixels, and a plate
    // whose wording changes in a plan (whole -> truncated) is put at its slot's place for the new width. The sweep moves a large box up to 30 px in a
    // frame; a left-anchored label whose text got shorter was seen 4.5 px beyond the box in 1 of 3 sweeps (2026-10-09; was 4, which made the check flap:
    // 0 or 1 teleport per sweep on the same code). A hop of a plate is tens of px (52 px in the every-frame plan of label-track.test.ts), so 6 still sees it.
    const SNAP_PX = 6;
    const run1 = (start) =>
      page.evaluate(
        async ({ start, minZoom, OMEGA, SNAP_PX }) => {
          const d = window.__globeDebug;
          d.setView(start);
          d.settle();
          // The camera is a function of TIME (3 s), not of the frame count: at 120 Hz the same path took 1.5 s, which gave 19 plans and about half the
          // slot changes per label of a 60 Hz run (3 s, 33 plans) on the same code, so a limit set at one rate failed at the other.
          const DURATION = 3000;
          let last = new Map();
          const t0 = performance.now();
          let lastT = t0;
          const prevChange = new Map();
          const out = { changes: 0, reversals: 0, teleports: 0, gliding: 0, maxStep: 0, visibility: 0, shown: 0, worstFrame: 0, labels: new Set(), mid: 0, domWrites: 0, frames: 0, slow: 0 };
          const w0 = d.labelStats().labelWrites;
          for (let f = 0; ; f++) {
            await new Promise((r) => requestAnimationFrame(r));
            const now0 = performance.now();
            const dt = Math.min(0.05, (now0 - lastT) / 1000);
            lastT = now0;
            const u = Math.min(1, (now0 - t0) / DURATION);
            d.setView({ lon: start.lon + 14 * Math.sin(2 * Math.PI * u * 1.5), lat: start.lat + 5 * Math.sin(2 * Math.PI * u), zoom: start.zoom + 0.45 * (0.5 - 0.5 * Math.cos(2 * Math.PI * u)) });
            d.renderNow();
            const now = new Map();
            for (const c of d.labelCells()) now.set(c.slug, { cand: c.label.cand, variant: c.label.variant, text: c.label.text, x: c.label.x, y: c.label.y, x1: c.label.x + c.label.w, y1: c.label.y + c.label.h, g: c.label.glide, box: c.box, mode: c.label.mode });
            let frameChanges = 0;
            for (const [k, s] of now) {
              out.labels.add(k);
              out.shown++;
              if (s.g > 0) out.gliding++;
              const p = last.get(k);
              if (!p) {
                if (f > 0) out.visibility++;
                continue;
              }
              if (p.cand !== s.cand || p.variant !== s.variant) {
                frameChanges++;
                // a REVERSAL: back to the slot it left less than one dwell (350 ms) ago, a wobble
                const to = `${s.variant}/${s.cand}`;
                const was = prevChange.get(k);
                if (was && was.from === to && now0 - was.t < 350) out.reversals++;
                prevChange.set(k, { t: now0, from: `${p.variant}/${p.cand}` });
              }
              const boxMove = Math.max(Math.abs(p.box.x0 - s.box.x0), Math.abs(p.box.y0 - s.box.y0), Math.abs(p.box.x1 - s.box.x1), Math.abs(p.box.y1 - s.box.y1));
              // the plate's nearer edge on each axis: a text that gets shorter (a plate anchored on one edge of its box) keeps the other edge where it was
              const step = Math.max(Math.min(Math.abs(p.x - s.x), Math.abs(p.x1 - s.x1)), Math.min(Math.abs(p.y - s.y), Math.abs(p.y1 - s.y1)));
              out.maxStep = Math.max(out.maxStep, step - boxMove);
              if (step > boxMove + SNAP_PX + 1.1 * OMEGA * dt * Math.max(p.g, s.g)) out.teleports++;
            }
            for (const k of last.keys()) if (!now.has(k)) out.visibility++;
            out.changes += frameChanges;
            out.worstFrame = Math.max(out.worstFrame, frameChanges);
            out.frames = f + 1;
            last = now;
            if (u >= 1) break;
          }
          out.domWrites = d.labelStats().labelWrites - w0;
          out.labels = out.labels.size;
          return out;
        },
        { start, minZoom, OMEGA, SNAP_PX },
      );
    const stat = async () => page.evaluate(() => window.__globeDebug.labelStats());
    const starts = [
      ["Europe", { lon: 12, lat: 47, zoom: minZoom + 1.4 }],
      ["the Balkans", { lon: 21, lat: 43, zoom: minZoom + 2.2 }],
      ["the Atlantic, Iberia and Morocco", { lon: -6, lat: 36, zoom: minZoom + 2.4 }],
    ];
    for (const [name, start] of starts) {
      const before = await stat();
      const t0 = Date.now();
      const r = await run1(start);
      // the camera is at rest: the last plan runs, the labels arrive, the frame loop goes quiet (poll: how long it takes)
      const tStop = Date.now();
      let quietAfter = -1;
      for (let i = 0; i < 80 && quietAfter < 0; i++) {
        const q = await page.evaluate(() => {
          const s = window.__globeDebug.labelStats();
          return s.gliding === 0 && !s.owed && !window.__globeDebug.isAnimating();
        });
        if (q) quietAfter = Date.now() - tStop;
        else await sleep(50);
      }
      await sleep(150);
      const after = await stat();
      const seconds = (tStop - t0) / 1000;
      console.log(`     ${name}: ${r.labels} labels, ${r.shown} label-frames (${r.gliding} gliding, largest step against the box ${r.maxStep.toFixed(1)} px), ${r.changes} slot changes (${(r.changes / Math.max(1, r.labels)).toFixed(2)} per label, ${r.reversals} of them back to the slot just left), ${r.teleports} teleports, ${r.visibility} appearances and disappearances, worst frame ${r.worstFrame}; ${r.domWrites} element writes (${(r.domWrites / Math.max(1, r.frames)).toFixed(1)} per frame); plans ${after.replans - before.replans} in ${seconds.toFixed(1)} s, labels placed in the gaps ${after.partials - before.partials}; quiet ${quietAfter} ms after the camera stopped`);
      // Limits (docs/web-architecture.md, "Inertia and flicker", 2026-10-09 recalibration). Slot changes per label depend on how crowded the view is:
      // on the owner's preview the sweeps measured 1.6 to 2.9 per label with 18 to 26 labels (a group opens only when ALL its places fit) and 2.3 to
      // 3.4 with 38 to 49 (the early opening of groups shows twice as many labels in the same area), with the same planner; the sweep is far
      // faster than a hand (14 degrees of longitude swing 1.5 times in 3 s). So the average limit is 4 (3 was calibrated on the 72-label synthetic
      // sweep of label-track.test.ts, 1.68 per label, and on a view of 18 to 26 labels). The wobble is measured apart: a change back to the slot it
      // left less than one dwell before is at most 25 percent of the changes (9 to 14 percent now, 5 to 8 percent with the old rule), and no
      // frame changes more than max(16, 55 percent of the labels) as before. A plate that jumps is `teleports`, below.
      expect(`${name}: over a scripted pan and zoom of 3 s a label changes its slot less than four times on average (${(r.changes / Math.max(1, r.labels)).toFixed(2)}; each change is a glide), at most 25 percent of the changes go back to the slot just left (${r.reversals} of ${r.changes}) and no frame changes more than max(16, 55 percent of the labels)`, r.labels > 5 && r.changes / r.labels < 4 && r.reversals <= 0.25 * r.changes && r.worstFrame <= Math.max(16, Math.ceil(r.labels * 0.55)), r);
      expect(`${name}: no plate teleports against its box (${r.teleports}), the labels move (${r.gliding} label-frames gliding)`, r.teleports === 0, r);
      expect(`${name}: re-planned at a bounded rate (${after.replans - before.replans} plans in ${seconds.toFixed(1)} s: at most one per 100 ms) and the loop is quiet ${quietAfter} ms after the camera stopped`, after.replans - before.replans >= 1 && (after.replans - before.replans) <= seconds * 10 + 8 && quietAfter >= 0 && quietAfter < 2500 && !(await page.evaluate(() => window.__globeDebug.isAnimating())), { before, after, seconds, quietAfter });
      expect(`${name}: at rest no label is gliding and none is owed a plan`, after.gliding === 0 && !after.owed, after);
      // at rest, after the last plan and the glides: every box has its label in the DOM, none left half way, and no two plates overlap unless one is the last resort
      const rest = await page.evaluate(() => ({ cells: window.__globeDebug.labelCells(), dom: window.__globeDebug.labelsDom() }));
      const domOf = new Map(rest.dom.map((x) => [x.slug, x]));
      const missing = rest.cells.filter((c) => !domOf.get(c.slug) || domOf.get(c.slug).text !== c.label.text || domOf.get(c.slug).opacity !== 1 || c.label.glide !== 0).map((c) => c.slug);
      let collisions = 0;
      for (let i = 0; i < rest.cells.length; i++)
        for (let j = i + 1; j < rest.cells.length; j++) {
          const p = rest.cells[i].label;
          const q = rest.cells[j].label;
          if (!p.overlap && !q.overlap && p.x < q.x + q.w && p.x + p.w > q.x && p.y < q.y + q.h && p.y + p.h > q.y) collisions++;
        }
      expect(`${name}, at rest after the sweep: ${rest.cells.length} boxes, every one has its label element, fully opaque, none half-faded; ${collisions} overlapping plates`, rest.cells.length > 3 && missing.length === 0 && collisions === 0 && rest.dom.length === rest.cells.length, { missing, collisions });
    }
    // Hover never re-plans: hovering label after label, no other label changes its slot or its place, and nothing is re-planned.
    {
      await page.evaluate((v) => {
        window.__globeDebug.setView(v);
        window.__globeDebug.settle();
      }, { lon: 12, lat: 47, zoom: minZoom + 1.8 });
      await sleep(300);
      const origin = await page.evaluate(() => {
        const r = document.querySelector('[data-globe="three"] > div:nth-child(2)').getBoundingClientRect();
        return { left: r.left, top: r.top };
      });
      const snap = () => page.evaluate(() => window.__globeDebug.labelCells().map((c) => ({ slug: c.slug, cand: c.label.cand, variant: c.label.variant, x: c.label.x, y: c.label.y, mode: c.label.mode, text: c.label.text, sub: c.label.sub })));
      const base = await snap();
      const s0 = await stat();
      let moved = 0;
      let expanded = 0;
      let probes = 0;
      for (const c of base.slice(0, 14)) {
        const box = (await page.evaluate(() => window.__globeDebug.labelCells())).find((x) => x.slug === c.slug).box;
        await page.mouse.move(origin.left + (box.x0 + box.x1) / 2, origin.top + (box.y0 + box.y1) / 2);
        await sleep(40);
        const now = await snap();
        probes++;
        for (const n of now) {
          const b = base.find((x) => x.slug === n.slug);
          if (n.mode !== "rest") {
            // the hovered label is written exactly as it was (same text, size and place): hover changes the box's colours and nothing about the text
            if (!b || b.text !== n.text || b.sub !== n.sub || Math.abs(b.x - n.x) > 0.01 || Math.abs(b.y - n.y) > 0.01) expanded++;
            continue;
          }
          if (!b || b.cand !== n.cand || b.variant !== n.variant || Math.abs(b.x - n.x) > 0.01 || Math.abs(b.y - n.y) > 0.01) moved++;
        }
      }
      await page.mouse.move(origin.left + 3, origin.top + 3);
      await sleep(200);
      const s1 = await stat();
      expect(`hover never re-plans: ${probes} hovers, ${moved} other labels moved or changed their text, ${s1.replans - s0.replans} re-plans, ${s1.partials - s0.partials} labels placed (${expanded} hovered labels were written differently from their rest state)`, probes > 5 && moved === 0 && expanded === 0 && s1.replans === s0.replans && s1.partials === s0.partials, { moved, s0, s1 });
    }
    expect("no console errors", logs.filter((l) => !/404/.test(l)).length === 0, logs);
    await page.context().close();
  }

  /* -------------------------------------------------------------------------------------------- handover */
  if (run("handover")) {
    const tiles = await ensureTiles();
    const { page, logs } = await openApp(browser, DESKTOP, { path: "/" });
    await waitStreetOk(page).catch(() => {});
    const compare = async (label, view) => {
      await setCamera(page, view);
      await page.waitForTimeout(400);
      await waitStreetOk(page).catch(() => {});
      // tiles outside the local extract never finish loading: wait for the camera only
      await settleApp(page, 8000).catch(() => {});
      const r = await page.evaluate(async () => {
        const d = window.__handoverDebug;
        const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        d.forceBlend(0);
        d.globe.renderNow();
        await frames();
        const g = d.globe.lod().map((n) => ({ ...n }));
        d.forceBlend(1);
        d.globe.renderNow();
        await frames();
        const s = d.street()?.debug().lod() ?? null;
        d.forceBlend(null);
        return { g, s };
      });
      await settleApp(page);
      if (!r.s) return expect(`${label}: street overlay available`, false, null);
      const gm = new Map(r.g.map((n) => [n.slug, n]));
      const sm = new Map(r.s.map((n) => [n.slug, n]));
      const sameSet = JSON.stringify([...gm.keys()].sort()) === JSON.stringify([...sm.keys()].sort());
      let worstPx = 0;
      let boxPx = 0;
      let toneDiff = 0;
      let alphaDiff = 0;
      const placeEdge = [];
      for (const [k, a] of gm) {
        const b = sm.get(k);
        if (!b) continue;
        if (a.shown !== b.shown) {
          if (a.kind === "place") placeEdge.push(`${a.slug} (${Math.round(a.x)},${Math.round(a.y)})`);
          continue;
        }
        if (!a.shown) continue;
        if (a.kind === "place") worstPx = Math.max(worstPx, Math.hypot(a.x - b.x, a.y - b.y));
        else boxPx = Math.max(boxPx, Math.abs(a.box.x0 - b.box.x0), Math.abs(a.box.x1 - b.box.x1), Math.abs(a.box.y0 - b.box.y0), Math.abs(a.box.y1 - b.box.y1));
        toneDiff += a.level !== b.level ? 1 : 0;
        alphaDiff = Math.max(alphaDiff, Math.abs(a.alpha - b.alpha));
      }
      const boxes = r.g.filter((n) => n.kind !== "place");
      console.log(`     ${label}: ${r.g.length} nodes (${boxes.length} boxes: ${boxes.map((n) => `${n.slug}[${n.members}]`).join(" ") || "none"}); dots differ by at most ${worstPx.toFixed(2)} px, boxes by ${boxPx.toFixed(2)} px${placeEdge.length ? `; dots dropped by one overlay only (at the edge): ${placeEdge.join(", ")}` : ""}`);
      expect(`${label}: the same nodes are drawn by both renderers`, sameSet, { g: [...gm.keys()], s: [...sm.keys()] });
      expect(`${label}: same tone levels and alphas`, toneDiff === 0 && alphaDiff < 1e-6, { toneDiff, alphaDiff });
      expect(`${label}: dots and boxes agree within an art pixel or two (the renderers' grids differ by the canvas offset only)`, worstPx <= 3.01 && boxPx <= 6.01, { worstPx, boxPx });
    };
    await compare("Vietnam, zoom 5.1", { lon: 107, lat: 16, zoom: 5.1 });
    await compare("Da Nang area, zoom 6.4", { lon: 108.2, lat: 16, zoom: 6.4 });
    await compare("Balkans, zoom 5.3", { lon: 17.5, lat: 45.4, zoom: 5.3 });
    await compare("Europe, zoom 5.06", { lon: 10, lat: 48, zoom: 5.06 });
    // The globe-to-street cut and its way back are `HANDOVER.cutZoom` and `cutBackZoom` (app/globe/handover/maths.ts): read, never copied.
    const maths = fs.readFileSync(new URL("../../app/globe/handover/maths.ts", import.meta.url), "utf8");
    const cutZoom = Number(/\bcutZoom:\s*([\d.]+)/.exec(maths)?.[1]);
    const cutBackZoom = Number(/\bcutBackZoom:\s*([\d.]+)/.exec(maths)?.[1]);
    expect(`the cut zooms are read from the source (${cutZoom}, back ${cutBackZoom})`, cutZoom > 0 && cutBackZoom > 0 && cutBackZoom < cutZoom, { cutZoom, cutBackZoom });
    // Ho Chi Minh City: inside the local tile extract, so the street map can really take over at the cut. The zoom goes up through the
    // cut and back down through the way back (hysteresis: the owner flips at `cutZoom` going in and at `cutBackZoom` going out), each
    // time straddling the threshold by a hair, where the drawn set must not change (further away it legitimately does: groups open and close).
    const view = { lon: HCMC.lon, lat: HCMC.lat };
    const EDGE = 0.04;
    await setCamera(page, { ...view, zoom: cutZoom - 0.3 });
    await settleApp(page);
    const seq = [];
    for (const z of [cutZoom - 0.3, cutZoom - EDGE, cutZoom + EDGE, cutZoom + 0.3, cutBackZoom + EDGE, cutBackZoom - EDGE, cutBackZoom - 0.3]) {
      await setCamera(page, { ...view, zoom: z });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await settleApp(page);
      seq.push(await page.evaluate(() => ({ z: window.__handoverDebug.zoom(), owner: window.__handoverDebug.owner(), set: (window.__handoverDebug.owner() === "street" ? window.__handoverDebug.street().debug().lod() : window.__handoverDebug.globe.lod()).map((n) => n.slug).sort().join(",") })));
    }
    console.log("     across the cut:", seq.map((s) => `${s.z.toFixed(2)} ${s.owner}`).join(" | "));
    expect("the globe owns the view below the cut and the street map above it, and again the globe below the way back", seq[1].owner === "globe" && seq[2].owner === "street" && seq[4].owner === "street" && seq[5].owner === "globe", seq);
    expect(`across the real cut the drawn set is the same on both sides (${seq[1].set.split(",").length} nodes)`, seq[1].set !== "" && seq[1].set === seq[2].set, [seq[1], seq[2]]);
    expect(`across the way back the drawn set is the same on both sides (${seq[4].set.split(",").length} nodes)`, seq[4].set !== "" && seq[4].set === seq[5].set, [seq[4], seq[5]]);
    expect("no console errors", logs.length === 0, logs);
    await page.context().close();
    await tiles.stop();
  }

  /* ------------------------------------------------------------------------------------------------ shots */
  if (process.env.SHOTS === "1" && run("shots")) {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    for (const scheme of ["light", "dark"]) {
      const { page, logs } = await openGlobe(browser, { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 }, "&lod-cases", scheme);
      const min = await page.evaluate(() => window.__globeDebug.minZoom());
      await page.evaluate((min) => window.__globeDebug.setView({ lon: 20, lat: 15, zoom: min + 0.15 }), min);
      await sleep(500);
      await page.screenshot({ path: `${SHOT_DIR}clusters-world-${scheme}.png` });
      console.log(`     clusters-world-${scheme}.png`);
      expect(`${scheme}: shots taken without console errors`, logs.length === 0, logs);
      await page.context().close();
    }
    // a frame sequence through one cluster opening: the box fades out while its places come in
    const { page } = await openGlobe(browser, { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }, "&lod-cases", "light");
    const dir = `${process.env.TMPDIR ?? "/tmp"}/groups-frames`;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const frames = [4.8, 5.2, 5.5, 5.7, 5.85, 5.95, 6.05, 6.2, 6.5, 7.2];
    for (const [i, z] of frames.entries()) {
      await page.evaluate((z) => window.__globeDebug.setView({ lon: 13.2, lat: 9.5, zoom: z }), z);
      await sleep(250);
      await page.screenshot({ path: `${dir}/f${String(i).padStart(2, "0")}.png`, clip: { x: 340, y: 200, width: 600, height: 400 } });
    }
    await page.context().close();
    execFileSync("python3", [new URL("./groups-sheet.py", import.meta.url).pathname, dir, `${SHOT_DIR}clusters-opening.png`, frames.map((z) => z.toFixed(2)).join(",")], { stdio: "inherit" });
    console.log("     clusters-opening.png");
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n - ${failures.join("\n - ")}`);
  process.exit(1);
}
console.log("\nall cluster checks passed");
