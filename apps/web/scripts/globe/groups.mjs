// Checks for the detection boxes (every place and group is a rectangle; the hierarchy is cut in screen space), Playwright + headless Chrome with the GPU.
//
//   CHROME_PATH=... BASE_URL=http://localhost:5174 [SHOTS=1] node apps/web/scripts/globe/groups.mjs [lod|cases|pixels|empty|reduced|pick|cost|idle|handover|shots]
//
// Serve the app with demo content (`pnpm dev:demo`, or a production build with CATALYST_CONTENT=demo): the demo projection has
// a hierarchy (3 continents, a region, a subregion, 3 countries, an area; 18 places). `handover` also needs the local tile server
// (the script starts it itself, and needs CATALYST_TILES_FALLBACK_URL=http://127.0.0.1:5240/places.pmtiles on the app).
//
// lod       the demo tree: isolated places are rectangles at every zoom, a handful of rectangles on the world view, per zoom step the alphas along
//           every branch sum to 1 (one level per branch), no alpha jump, nodes enter and leave through the faintest tone
// cases     three hand-made cases (`?lod-cases`): 10 close places = one box (chip "10 entries") that opens on zoom into ten boxes, a lone place =
//           its own rectangle at every zoom, a country with two far apart places = two rectangles and no group
// pixels    the boxes are drawn on the pixel canvas as whole cells: every outline cell is there, nothing but palette colours
//           is on the canvas (no grey), and the canvas is exactly cols x rows cells scaled by the cell
// empty     `?no-groups`: every place is its own rectangle at every zoom, no group (the globe as it was before groups)
// reduced   reduced motion: every alpha is 0 or 1 (no cross-fade), one switch per box
// pick      click a box's border = flies to frame its circle (its places appear), the interior is not a hit area, the label plate is, a
//           place's rectangle inside opens its page, hover highlights the box
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
const ALPHA_MIN = 0.06; // LOD.alphaMin

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
    window.__globeDebug.renderNow();
    return window.__globeDebug.lod();
  }, v);

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
    let worstEdge = 0;
    let worstAt = null;
    let worstEdgeAt = null;
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
            out.push({ z, nodes: d.lod().map((n) => [n.slug, n.alpha]) });
          }
          return out;
        },
        { lon, lat, minZoom },
      );
      let prev = null;
      for (const s of series) {
        steps++;
        const a = new Map(s.nodes);
        for (const pl of places) {
          if (!a.has(pl)) continue; // not drawn (far side, or off the visible hemisphere)
          const sum = chainOf(pl).reduce((x, c) => x + (a.get(c) ?? 0), 0);
          if (sum > 1 + 1e-6 || sum < 1 - 6 * ALPHA_MIN) bad ??= { target: slug, z: s.z, place: pl, sum };
        }
        // Pops at the globe's limb are the whole-or-nothing rule for markers (a place is drawn or not, scripts/globe/markers.mjs): the
        // continuity checks run on views where no place is near it (up to zoom 4.6, a 55 degree cap).
        if (prev && s.z <= 4.6) {
          for (const [k, v] of a) {
            const was = prev.get(k);
            if (was === undefined) v > worstEdge && ((worstEdge = v), (worstEdgeAt = { k, z: s.z, v }));
            else if (Math.abs(v - was) > worst) ((worst = Math.abs(v - was)), (worstAt = { slug, k, z: s.z, was, v }));
          }
          for (const [k, v] of prev) if (!a.has(k) && v > worstEdge) ((worstEdge = v), (worstEdgeAt = { k, z: s.z, v, gone: true }));
        }
        prev = a;
      }
    }
    expect(`sweep (${centres.length} targets, ${steps} steps): the alphas along every drawn place's branch sum to 1, never more`, bad === null, bad);
    expect(`sweep (to zoom 4.6, away from the limb): no alpha jump above 0.2 per 0.02 zoom (worst ${worst.toFixed(3)})`, worst < 0.2, worstAt);
    expect(`sweep (to zoom 4.6): nodes enter and leave through the faintest tones (largest alpha at entry/exit ${worstEdge.toFixed(3)})`, worstEdge < ALPHA_MIN + 0.15, worstEdgeAt);
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
          const l = d.lod();
          const box = l.find((n) => n.slug === "case-crowd");
          const dots = l.filter((n) => n.slug.startsWith("crowd-"));
          out.push({ z, box: box ? box.alpha : 0, dots: dots.length, dotAlpha: dots.length ? Math.min(...dots.map((n) => n.alpha)) : 0 });
        }
        return out;
      },
      { minZoom },
    );
    for (const s of series) {
      if (boxGone === null && s.box === 0) boxGone = s.z;
      if (allDots === null && s.dots === 10 && s.dotAlpha === 1) allDots = s.z;
    }
    expect(`zooming in: the box is gone at zoom ${boxGone?.toFixed(2)} and all ten rectangles are in at ${allDots?.toFixed(2)}`, boxGone !== null && allDots !== null && allDots >= boxGone - 0.02 && allDots < 6.5, { boxGone, allDots });
    const sums = series.map((s) => s.box + (s.dots ? s.dotAlpha : 0));
    expect("never a gap: group alpha + place alpha is 1 along the way (within the draw threshold)", sums.every((x) => x >= 1 - 2 * ALPHA_MIN && x <= 1 + 1e-6), sums.filter((x) => x < 1 - 2 * ALPHA_MIN || x > 1 + 1e-6).slice(0, 3));
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
          const inkAndBg = [ramp[0], ramp[ramp.length - 1]];
          const stat = { views: 0, boxes: 0, outlineMissing: 0, offPalette: 0, scaleOk: true, first: null };
          const rect = canvas.getBoundingClientRect();
          if (Math.abs(rect.width - canvas.width * P) > 0.01 || Math.abs(rect.height - canvas.height * P) > 0.01) stat.scaleOk = false;
          const minZoom = d.minZoom();
          const views = [];
          for (const z of [minZoom, minZoom + 0.5, minZoom + 1, minZoom + 1.6, minZoom + 2.4, minZoom + 3.4]) for (const [lon, lat] of [[15, 38], [108, 16], [10, 47], [16, 44]]) views.push({ lon, lat, zoom: z });
          for (const v of views) {
            d.setView(v);
            d.renderNow();
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
              if (!near(inkAndBg[0]) && !near(inkAndBg[1])) stat.offPalette++;
            }
            for (const n of d.lod()) {
              if (!n.shown || n.alpha < 0.99) continue;
              stat.boxes++;
              const c0 = Math.round((n.box.x0 - (rect.left - rootRect.left)) / P);
              const c1 = Math.round((n.box.x1 - (rect.left - rootRect.left)) / P);
              const r0 = Math.round((n.box.y0 - (rect.top - rootRect.top)) / P);
              const r1 = Math.round((n.box.y1 - (rect.top - rootRect.top)) / P);
              const opaque = (x, y) => x >= 0 && y >= 0 && x < canvas.width && y < canvas.height && img.data[(y * canvas.width + x) * 4 + 3] === 255;
              let missing = 0;
              for (let x = c0; x < c1; x++) for (const y of [r0, r1 - 1]) if (x >= 0 && x < canvas.width && y >= 0 && y < canvas.height && !opaque(x, y)) missing++;
              for (let y = r0; y < r1; y++) for (const x of [c0, c1 - 1]) if (x >= 0 && x < canvas.width && y >= 0 && y < canvas.height && !opaque(x, y)) missing++;
              if (missing) {
                stat.outlineMissing++;
                stat.first ??= { n: n.slug, view: v, missing, c0, c1, r0, r1 };
              }
            }
          }
          void mainRect;
          return stat;
        });
        expect(`${name} ${scheme}: ${res.views} views, ${res.boxes} boxes: every outline cell is drawn, whole cells`, res.outlineMissing === 0 && res.boxes > 10, res);
        expect(`${name} ${scheme}: at rest, nothing on the label canvas but the page colour and the ink, fully opaque (a fade is opacity: unit-tested)`, res.offPalette === 0, res);
        expect(`${name} ${scheme}: the label canvas is cols x rows cells scaled by exactly one cell`, res.scaleOk, res);
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

  /* ----------------------------------------------------------------------------------------------- pick */
  if (run("pick")) {
    const { page, logs } = await openGlobe(browser, DESKTOP, "&lod-cases");
    const view = () => page.evaluate(() => window.__globeDebug.view());
    await page.evaluate(() => {
      window.__globeDebug.setView({ lon: 13.2, lat: 9.5, zoom: window.__globeDebug.minZoom() + 0.6 });
      window.__globeDebug.renderNow();
    });
    const box = (await page.evaluate(() => window.__globeDebug.lod())).find((n) => n.slug === "case-crowd");
    expect("the crowd is one box on screen", !!box && box.members === 10, box);
    const b = box.box;
    const hoverBorder = { x: b.x0 + 1, y: (b.y0 + b.y1) / 2 };
    await page.mouse.move(hoverBorder.x, hoverBorder.y);
    await sleep(150);
    expect("hover on a box's border shows the pointer cursor", (await page.evaluate(() => document.querySelector("canvas").style.cursor)) === "pointer", null);
    await page.mouse.move((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
    await sleep(150);
    expect("the interior is not a hit area (cursor grab)", (await page.evaluate(() => document.querySelector("canvas").style.cursor)) === "grab", null);
    const v0 = await view();
    await page.mouse.click((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
    await sleep(300);
    const v1 = await view();
    expect("a click on the interior does not move the camera", Math.abs(v1.zoom - v0.zoom) < 1e-9, { v0, v1 });
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
      window.__globeDebug.renderNow();
    });
    const tab = (await page.evaluate(() => window.__globeDebug.labelCells())).find((l) => l.slug === "case-crowd");
    const cell = await page.evaluate(() => window.__globeDebug.inset().pixel);
    const left = await page.evaluate(() => document.querySelector("canvas").getBoundingClientRect().left);
    const top = await page.evaluate(() => document.querySelector("canvas").getBoundingClientRect().top);
    const lab = tab?.label;
    expect(
      `the label reads "${tab?.text}" with the chip "${tab?.chip}", text only, just above the box's top-left corner on the same baseline`,
      !!tab && !!lab && tab.text === "Crowd" && tab.chip === "10 entries" && lab.col === tab.rect.c0 && lab.row + lab.h === tab.rect.r0 && lab.chipCol > lab.col && lab.baseline === lab.row + lab.h - 2,
      tab,
    );
    await page.mouse.click(left + (lab.col - 1 + lab.w / 2) * cell, top + (lab.row + lab.h / 2) * cell);
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
    await sleep(600);
    const a = await page.evaluate(() => ({ raf: window.__raf.calls, frames: window.__globeDebug.frames(), clears: window.__clears ?? 0, labels: window.__globeDebug.labelStats() }));
    await sleep(2500);
    const b = await page.evaluate(() => ({ raf: window.__raf.calls, frames: window.__globeDebug.frames(), clears: window.__clears ?? 0, labels: window.__globeDebug.labelStats() }));
    expect(`idle with boxes on screen: 0 rAF calls, 0 frames, 0 clears, 0 label canvas draws over 2.5 s`, a.raf === b.raf && a.frames === b.frames && a.clears === b.clears && a.labels.drawn === b.labels.drawn, { a, b });
    await page.mouse.move(700, 400);
    await page.mouse.move(720, 420);
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
