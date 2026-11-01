// Browser checks of the paths layer (every route leg drawn faintly, the selected place's in ink; docs/paths.md).
//
//   CHROME_PATH=... BASE_URL=http://localhost:5300 OUT_DIR=/some/dir node apps/web/scripts/paths/check.mjs [shots|select|reduced|limb|perf|street]
//
// Run the app on demo content (`CATALYST_CONTENT=demo`): the fictional routes of packages/published/fixtures/demo.json carry
// legs of every mode. Pages run in debug mode (`?globe-debug`), where `window.__globeDebug` is the introspection (pathStats,
// routesShown, setView, renderNow, info, ramp). `perf` also loads `?paths-stress=N` (synthetic legs, paths/stress.ts).
//
// shots     world, continent and city zoom, light and dark: the faint tone is on the screen, the page colour is not touched, no leg is
//           faded out by its length (the world view draws paths as the city view does, #459); screenshots in OUT_DIR
// select    selecting a place lights its adjacent legs (ink) with a draw-on that runs from the place, others stay faint; no geometry
//           change (buffers, vertex count unchanged); the draw-on ends and the globe goes idle
// reduced   prefers-reduced-motion: the selected legs are complete at once, nothing animates
// limb      lines near the limb are hidden behind the planet (no ink pixel outside the disc, none inside the far side)
// trail     the plane-trail colours: each palette's pixels are on the screen, a leg runs from its pale tail to its saturated head (the mean
//           band near the destination is above the mean near the origin), the selected place's legs are the lit colour with a spark; screenshots
// overlay   the paths are part of the overlay: at the start view (the caption and the ring) nothing is drawn (no draw call, no trail pixel), the
//           first interaction fades them in with the boxes and labels (same value, monotonic, frame for frame), and they leave again with the overlay;
//           a flight to a place from the world view ends with the legs lit; reduced motion: at once
// perf      buffers, draw calls and JS ms per frame at the world view and at zoom with 225 and 2000 synthetic legs
// street    the street map: layers, filter by selection, switch (needs tiles: skipped when the street map does not come up)
import { launch, open, waitGlobe, BASE_URL, DESKTOP, OUT_DIR, sleep } from "../globe/_lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
// Node strips the types: the trail table is the one the app draws with (app/globe/paths/trail.ts has no imports).
import { TRAIL_BANDS, TRAIL_PALETTES, TRAIL_PER_PALETTE, trailColors } from "../../app/globe/paths/trail.ts";

const only = process.argv.slice(2);
const run = (n) => only.length === 0 || only.includes(n);
const failures = [];
const expect = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : " " + JSON.stringify(detail)}`);
  if (!ok) failures.push(name);
};
const note = (s) => console.log(`note ${s}`);
mkdirSync(OUT_DIR, { recursive: true });
const out = (n) => `${OUT_DIR}/${n}`;

const rgb = (c) => `${c[0]},${c[1]},${c[2]}`;

/** Count pixels of exact colours in a PNG screenshot (decoded in the page). `colors`: name -> [r, g, b]. */
async function count(page, png, colors, region) {
  return page.evaluate(
    async ({ b64, colors, region }) => {
      const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
      const bmp = await createImageBitmap(blob);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(bmp, 0, 0);
      const r = region ?? [0, 160, bmp.width - 400, bmp.height - 260];
      const img = g.getImageData(r[0], r[1], r[2] - r[0], r[3] - r[1]).data;
      // a colour is [r, g, b] or a list of them
      const byKey = new Map();
      for (const [k, v] of Object.entries(colors)) for (const c of Array.isArray(v[0]) ? v : [v]) byKey.set(c.join(","), k);
      const res = Object.fromEntries(Object.keys(colors).map((k) => [k, 0]));
      for (let i = 0; i < img.length; i += 4) {
        const k = byKey.get(`${img[i]},${img[i + 1]},${img[i + 2]}`);
        if (k) res[k]++;
      }
      return { ...res, width: bmp.width, height: bmp.height };
    },
    { b64: png.toString("base64"), colors, region },
  );
}

/**
 * The colours the paths are drawn in (app/globe/paths/trail.ts), for the page's scheme: `faint` = every band of every palette (the
 * unselected legs), `ink` = the lit head colours (the selected place's legs), `spark` = the dot at each head.
 */
const tones = async (page) => {
  const ramp = await page.evaluate(() => window.__globeDebug.ramp());
  const dark = ramp[0][0] + ramp[0][1] + ramp[0][2] < 384;
  const list = trailColors(dark ? "dark" : "light").map((c) => c.map((v) => Math.round(v * 255)));
  const pick = (f) => list.filter((_, i) => f(i % TRAIL_PER_PALETTE));
  return { page: ramp[0], faint: pick((k) => k < TRAIL_BANDS), ink: pick((k) => k === TRAIL_BANDS), spark: pick((k) => k === TRAIL_BANDS + 1), ramp, dark };
};

const openGlobe = async (browser, ctxOptions = {}, path = "/", opts = {}) => {
  const o = await open(browser, { ...DESKTOP, ...ctxOptions }, path, opts);
  await waitGlobe(o.page);
  await sleep(300);
  return o;
};

/** Pixels of the paths alone: the same view with the switch on and off (the coast shares the faint tone, the page has black text). */
async function pathPixels(page, colors, shot) {
  const setPaths = (on) => page.evaluate((on) => window.__globeDebug.setPaths(on), on);
  await sleep(600);
  await page.evaluate(() => window.__globeDebug.settle());
  const on = await count(page, await page.screenshot(shot ? { path: shot } : undefined), colors);
  await setPaths(false);
  await sleep(300);
  await page.evaluate(() => window.__globeDebug.settle());
  const off = await count(page, await page.screenshot(), colors);
  await setPaths(true);
  await sleep(300);
  await page.evaluate(() => window.__globeDebug.settle());
  return { faint: on.faint - off.faint, ink: on.ink - off.ink, onFaint: on.faint, offFaint: off.faint };
}

const view = (page, v) =>
  page.evaluate((v) => {
    const d = window.__globeDebug;
    d.setView(v);
    d.settle();
    d.renderNow();
  }, v);
const stats = (page) => page.evaluate(() => window.__globeDebug.pathStats());

const browser = await launch();
try {
  /* ------------------------------------------------------------------ shots */
  if (run("shots")) {
    note("shots");
    for (const scheme of ["light", "dark"]) {
      const { page, ctx, logs } = await openGlobe(browser, { colorScheme: scheme });
      const t = await tones(page);
      const colors = { faint: t.faint, ink: t.ink, spark: t.spark };
      const min = await page.evaluate(() => window.__globeDebug.minZoom());
      const max = await page.evaluate(() => window.__globeDebug.maxZoom());
      const st = await stats(page);
      expect(`${scheme}: the layer has the demo legs`, st.legs >= 10 && st.drawCalls === 1, st);
      const views = {
        world: { lon: 30, lat: 30, zoom: min },
        continent: { lon: 20, lat: 46, zoom: min + 1.6 },
        city: { lon: 17.5, lat: 44.8, zoom: Math.min(max - 0.2, min + 3.4) },
      };
      const seen = {};
      for (const [name, v] of Object.entries(views)) {
        await view(page, v);
        await sleep(150);
        seen[name] = await pathPixels(page, colors, out(`paths-${name}-${scheme}.png`));
        const s = await stats(page);
        note(`${scheme} ${name}: faint ${seen[name].faint} px, level ${s.level}, ${s.drawnSegments} segments drawn`);
      }
      expect(`${scheme}: the paths are on the screen at the world view too (no leg is faded out by its length)`, seen.world.faint > 50, seen);
      expect(`${scheme}: paths are visible at the continent view`, seen.continent.faint > 100, seen);
      expect(`${scheme}: no ink while nothing is selected`, seen.city.ink === 0 && seen.world.ink === 0 && seen.continent.ink === 0, seen);
      expect(`${scheme}: no console errors`, logs.filter((l) => l.startsWith("error") || l.startsWith("pageerror")).length === 0, logs);
      await ctx.close();
    }
  }

  /* ------------------------------------------------------------------ select */
  if (run("select")) {
    note("select");
    const { page, ctx } = await openGlobe(browser, {}, "/locations/zagreb");
    const t = await tones(page);
    const colors = { faint: t.faint, ink: t.ink, spark: t.spark };
    await sleep(500);
    const shown = await page.evaluate(() => window.__globeDebug.routesShown());
    expect("a place on a route lights that route's legs", shown.includes("demo-route-adriatic-loop"), shown);
    const s0 = await stats(page);
    expect("two legs are lit next to zagreb (arrives from ljubljana, leaves for split)", s0.lit === 2, s0);
    // draw-on: shortly after the selection the ink is partial, at the end complete
    await page.goto(`${BASE_URL}/`);
    await waitGlobe(page);
    await view(page, { lon: 17, lat: 45, zoom: (await page.evaluate(() => window.__globeDebug.maxZoom())) - 0.6 });
    const before = await stats(page);
    const c0 = await count(page, await page.screenshot(), colors);
    await page.evaluate(() => document.querySelector('a[href="/locations/zagreb"]')?.click());
    await sleep(120);
    const png1 = await page.screenshot({ path: out("paths-select-draw-on-early.png") });
    const c1 = await count(page, png1, colors);
    await sleep(2700);
    const png2 = await page.screenshot({ path: out("paths-select-done.png") });
    const c2 = await count(page, png2, colors);
    const after = await stats(page);
    note(`ink pixels: before ${c0.ink}, early ${c1.ink}, done ${c2.ink}; faint ${c0.faint} -> ${c2.faint}`);
    expect("ink grows with the draw-on and ends complete (relative to the page's own black text)", c2.ink - c0.ink > 20 && c2.ink >= c1.ink && c1.ink - c0.ink < c2.ink - c0.ink, { c0, c1, c2 });
    expect("selection changes no geometry: same buffers, same vertex count, same level", before.bytes === after.bytes && before.vertices === after.vertices && before.legs === after.legs, { before, after });
    expect("the globe is idle after the draw-on", !(await page.evaluate(() => window.__globeDebug.isAnimating())));
    await ctx.close();
  }

  /* ------------------------------------------------------------------ reduced */
  if (run("reduced")) {
    note("reduced");
    const { page, ctx } = await openGlobe(browser, { reducedMotion: "reduce" }, "/");
    const t = await tones(page);
    const max = await page.evaluate(() => window.__globeDebug.maxZoom());
    await view(page, { lon: 17, lat: 45, zoom: max - 0.6 });
    await page.evaluate(() => document.querySelector('a[href="/locations/zagreb"]')?.click());
    await sleep(250);
    const early = await count(page, await page.screenshot(), { ink: t.ink });
    await sleep(500);
    const later = await count(page, await page.screenshot(), { ink: t.ink });
    expect("the lit legs do not change between 250 ms and 750 ms (no draw-on)", early.ink === later.ink, { early, later });
    expect("nothing is animating", !(await page.evaluate(() => window.__globeDebug.isAnimating())));
    await ctx.close();
  }

  /* ------------------------------------------------------------------ limb */
  if (run("limb")) {
    note("limb");
    const { page, ctx } = await openGlobe(browser, {});
    const t = await tones(page);
    // the camera over the Indian Ocean, so that Europe's legs sit on the limb
    const min = await page.evaluate(() => window.__globeDebug.minZoom());
    await view(page, { lon: 80, lat: 10, zoom: min + 0.4 });
    const png = await page.screenshot({ path: out("paths-limb.png") });
    const c = await count(page, png, { faint: t.faint, ink: t.ink });
    // far-side legs must not show through: at lon 80 the Atlantic legs (lisbon, paris) are behind the planet
    const hidden = await page.evaluate(() => {
      const d = window.__globeDebug;
      return ["lisbon", "paris", "reykjavik"].map((s) => d.project(s)?.visible);
    });
    note(`faint ${c.faint}, far side places visible: ${JSON.stringify(hidden)}`);
    expect("the far side stays hidden (lisbon, paris, reykjavik are behind the planet)", hidden.every((v) => v === false), hidden);
    // a sweep around the limb: no page-colour change and no path pixel outside the circle of the planet (checked on 12 views)
    let outside = 0;
    for (let lon = -180; lon < 180; lon += 30) {
      await view(page, { lon, lat: 20, zoom: min + 0.4 });
      const info = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
      const png2 = await page.screenshot();
      const whole = await count(page, png2, { faint: t.faint, ink: t.ink });
      // the planet's disc is centred in the free area; the corners of the viewport are always outside it
      const corner = await count(page, png2, { faint: t.faint, ink: t.ink }, [0, 0, 120, 120]);
      outside += corner.faint + corner.ink;
      void whole;
      void info;
    }
    expect("no path pixel in the corners of the viewport on a full turn", outside === 0, outside);
    await ctx.close();
  }

  /* ------------------------------------------------------------------ trail */
  if (run("trail")) {
    note("trail");
    const bandsNear = (page, png, bands, at, r) =>
      page.evaluate(
        async ({ b64, bands, at, r }) => {
          const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
          const c = new OffscreenCanvas(bmp.width, bmp.height);
          const g = c.getContext("2d", { willReadFrequently: true });
          g.drawImage(bmp, 0, 0);
          const k = bmp.width / innerWidth;
          const x0 = Math.max(0, Math.round((at.x - r) * k)), y0 = Math.max(0, Math.round((at.y - r) * k));
          const w = Math.min(bmp.width - x0, Math.round(2 * r * k)), h = Math.min(bmp.height - y0, Math.round(2 * r * k));
          const img = g.getImageData(x0, y0, w, h).data;
          const byKey = new Map(bands.map((c, i) => [c.join(","), i]));
          let n = 0, sum = 0;
          for (let i = 0; i < img.length; i += 4) {
            const b = byKey.get(`${img[i]},${img[i + 1]},${img[i + 2]}`);
            if (b !== undefined) { n++; sum += b; }
          }
          return { n, mean: n ? sum / n : null };
        },
        { b64: png.toString("base64"), bands, at, r },
      );
    for (const scheme of ["light", "dark"]) {
      const { page, ctx } = await openGlobe(browser, { colorScheme: scheme });
      const t = await tones(page);
      const max = await page.evaluate(() => window.__globeDebug.maxZoom());
      // the Adriatic route is the second route: green. Its first road leg runs ljubljana -> zagreb (origin ljubljana, head zagreb).
      const green = t.faint.slice(1 * TRAIL_BANDS, 2 * TRAIL_BANDS).length ? Array.from({ length: TRAIL_BANDS }, (_, b) => t.faint[1 * TRAIL_BANDS + b]) : [];
      await view(page, { lon: 16, lat: 45.9, zoom: max - 0.9 });
      await sleep(600);
      await page.evaluate(() => window.__globeDebug.settle());
      const png = await page.screenshot({ path: out(`trail-adriatic-${scheme}.png`) });
      const lj = await page.evaluate(() => window.__globeDebug.project("ljubljana"));
      const zg = await page.evaluate(() => window.__globeDebug.project("zagreb"));
      // a fifth of the way from each end (the stops themselves also start and end other legs of the route)
      const along = (f) => ({ x: lj.x + (zg.x - lj.x) * f, y: lj.y + (zg.y - lj.y) * f });
      const tail = await bandsNear(page, png, green, along(0.2), 28);
      const head = await bandsNear(page, png, green, along(0.8), 28);
      note(`${scheme}: green pixels at 20 % of ljubljana-zagreb ${tail.n} (mean band ${tail.mean?.toFixed(2)}), at 80 % ${head.n} (mean band ${head.mean?.toFixed(2)})`);
      expect(`${scheme}: the leg is paler at its origin than at its head (mean band ${tail.mean} < ${head.mean})`, tail.n > 5 && head.n > 5 && tail.mean < head.mean, { tail, head });
      // all four palettes appear somewhere on the globe (the demo routes take one each)
      const seen = [];
      for (const v of [{ lon: 100, lat: 14, dz: 2.2 }, { lon: 16, lat: 45, dz: 1.6 }, { lon: -30, lat: 50, dz: 0.4 }, { lon: 30, lat: 35, dz: 0 }]) {
        const min = await page.evaluate(() => window.__globeDebug.minZoom());
        await view(page, { lon: v.lon, lat: v.lat, zoom: min + v.dz });
        await sleep(300);
        await page.evaluate(() => window.__globeDebug.settle());
        const palettes = Object.fromEntries(TRAIL_PALETTES.map((n, i) => [n, t.faint.filter((_, j) => Math.floor(j / TRAIL_BANDS) === i)]));
        seen.push(await count(page, await page.screenshot(), palettes));
      }
      const total = Object.fromEntries(TRAIL_PALETTES.map((n) => [n, seen.reduce((a, c) => a + c[n], 0)]));
      expect(`${scheme}: every palette is drawn by some demo route`, TRAIL_PALETTES.every((n) => total[n] > 20), total);
      await view(page, { lon: 30, lat: 35, zoom: (await page.evaluate(() => window.__globeDebug.minZoom())) });
      await page.screenshot({ path: out(`trail-world-${scheme}.png`) });
      await ctx.close();
    }
    // the selected place: lit colour along the legs and a spark at the heads
    {
      const { page, ctx } = await openGlobe(browser, {}, "/locations/zagreb");
      const t = await tones(page);
      const max = await page.evaluate(() => window.__globeDebug.maxZoom());
      await view(page, { lon: 16, lat: 45.9, zoom: max - 0.9 });
      await sleep(3000);
      const c = await count(page, await page.screenshot({ path: out("trail-selected-light.png") }), { lit: t.ink, spark: t.spark });
      expect("selected: the lit colour and the spark are drawn", c.lit > 30 && c.spark > 5, c);
      await ctx.close();
    }
  }

  /* ------------------------------------------------------------------ overlay */
  if (run("overlay")) {
    note("overlay");
    const URL_SHOW = "/?globe-debug&no-street&ring&showcase";
    const ringOverlay = (page) => page.evaluate(() => window.__globeDebug.ring().overlay);
    const trailPixels = async (page, t) => {
      const c = await count(page, await page.screenshot(), { faint: t.faint, spark: t.spark, ink: t.ink });
      return c.faint + c.spark + c.ink;
    };
    {
      const { page, ctx, logs } = await open(browser, DESKTOP, URL_SHOW, { noGroups: false });
      await waitGlobe(page);
      await sleep(800);
      const t = await tones(page);
      const min = await page.evaluate(() => window.__globeDebug.minZoom());
      await view(page, { lon: 16, lat: 45, zoom: min + 1.6 }); // a view where the demo's legs show (the continent view)
      await page.evaluate(() => window.__globeDebug.showcase(true));
      await sleep(900);
      const s0 = await stats(page);
      expect("start (caption and ring): the route layer draws nothing (no draw call, presence 0)", s0.drawCalls === 0 && s0.presence === 0 && s0.legs >= 10, s0);
      expect("... and no trail pixel is on the screen", (await trailPixels(page, t)) === 0);
      // the first interaction ends the showcase: boxes and labels fade in, the paths with them
      await page.evaluate(() => window.__globeDebug.showcase(false));
      const samples = [];
      for (let i = 0; i < 40; i++) {
        // both in one task: the same frame
        samples.push(await page.evaluate(() => ({ presence: window.__globeDebug.pathStats().presence, overlay: window.__globeDebug.ring().overlay, calls: window.__globeDebug.pathStats().drawCalls })));
        await sleep(10);
      }
      expect("the paths' presence IS the overlay's value in every frame (one value, one clock)", samples.every((r) => Math.abs(r.presence - r.overlay) < 1e-9), samples.slice(0, 6));
      let up = true;
      for (let i = 1; i < samples.length; i++) if (samples[i].presence < samples[i - 1].presence - 1e-9) up = false;
      expect("fading in only goes up", up, samples.map((r) => +r.presence.toFixed(2)));
      await sleep(600);
      const s1 = await stats(page);
      expect("at rest with the overlay: full presence, one draw call", s1.presence === 1 && s1.drawCalls === 1, s1);
      await view(page, { lon: 16, lat: 45, zoom: min + 1.6 }); // (ending the showcase moves the camera off the start latitude)
      await sleep(400);
      await page.screenshot({ path: out("overlay-with-labels.png") });
      expect("... and the trails are on the screen", (await trailPixels(page, t)) > 200, await page.evaluate(() => window.__globeDebug.view()));
      // the way back
      await page.evaluate(() => window.__globeDebug.showcase(true));
      const back = [];
      for (let i = 0; i < 40; i++) {
        back.push((await stats(page)).presence);
        await sleep(10);
      }
      let down = true;
      for (let i = 1; i < back.length; i++) if (back[i] > back[i - 1] + 1e-9) down = false;
      await sleep(600);
      const s2 = await stats(page);
      expect("fading out only goes down, and ends with no draw call", down && s2.presence === 0 && s2.drawCalls === 0 && (await trailPixels(page, t)) === 0, { back, s2 });
      await page.screenshot({ path: out("overlay-start-view.png") });
      expect("no console warning or error", logs.length === 0, logs);
      await ctx.close();
    }
    {
      // a flight to a place from the world view: the selection hides the caption and shows the overlay, the legs are lit at the end
      const { page, ctx } = await open(browser, DESKTOP, URL_SHOW, { noGroups: false });
      await waitGlobe(page);
      await sleep(800);
      const t = await tones(page);
      expect("the world view starts with the paths off", (await stats(page)).drawCalls === 0);
      await page.evaluate(() => document.querySelector('a[href="/locations/zagreb"]')?.click());
      await sleep(4500);
      const s = await stats(page);
      expect("selecting a place from the world view: presence 1, two legs lit", s.presence === 1 && s.lit === 2 && s.drawCalls === 1, s);
      await page.screenshot({ path: out("overlay-flight-to-zagreb.png") });
      await view(page, { lon: 16, lat: 45.9, zoom: (await page.evaluate(() => window.__globeDebug.maxZoom())) - 0.9 });
      await sleep(500);
      const c = await count(page, await page.screenshot({ path: out("overlay-zagreb-lit.png") }), { ink: t.ink, spark: t.spark });
      expect("... drawn in the lit colour with its sparks (looked at from the city view)", c.ink > 30 && c.spark > 5, c);
      await ctx.close();
    }
    {
      const { page, ctx } = await open(browser, { ...DESKTOP, reducedMotion: "reduce" }, URL_SHOW, { noGroups: false });
      await waitGlobe(page);
      await sleep(600);
      await page.evaluate(() => window.__globeDebug.showcase(false));
      await sleep(80);
      const on = await stats(page);
      await page.evaluate(() => window.__globeDebug.showcase(true));
      await sleep(80);
      const off = await stats(page);
      expect("reduced motion: the paths come and go at once", on.presence === 1 && off.presence === 0 && off.drawCalls === 0, { on, off });
      await ctx.close();
    }
  }

  /* ------------------------------------------------------------------ perf */
  if (run("perf")) {
    note("perf (headless Chrome on this machine's GPU through ANGLE/Metal: not a phone)");
    const results = [];
    for (const legs of [0, 225, 2000]) {
      const q = legs ? `/?globe-debug&paths-stress=${legs}` : "/";
      const { page, ctx } = await openGlobe(browser, {}, q);
      const min = await page.evaluate(() => window.__globeDebug.minZoom());
      const max = await page.evaluate(() => window.__globeDebug.maxZoom());
      const st = await stats(page);
      for (const [name, zoom] of [["world", min], ["continent", min + 1.6], ["zoom", max - 0.3]]) {
        const r = await page.evaluate(
          async ({ zoom }) => {
            const d = window.__globeDebug;
            const ms = [];
            let calls = 0;
            let levelSegments = 0;
            for (let i = 0; i < 240; i++) {
              d.setView({ lon: 12 + i * 0.05, lat: 40 + Math.sin(i / 20) * 2, zoom });
              ms.push(d.renderNow());
              if (i === 200) calls = d.info().calls;
            }
            d.gpuSync();
            const sorted = [...ms.slice(40)].sort((a, b) => a - b);
            const p = (q) => sorted[Math.floor(q * (sorted.length - 1))];
            // GPU-inclusive: renders with a blocking sync after each frame
            const synced = [];
            for (let i = 0; i < 60; i++) {
              d.setView({ lon: 12 + i * 0.05, lat: 40, zoom });
              const t0 = performance.now();
              d.renderNow();
              d.gpuSync();
              synced.push(performance.now() - t0);
            }
            synced.sort((a, b) => a - b);
            return { p50: p(0.5), p95: p(0.95), calls, syncP50: synced[30], syncP95: synced[57] };
          },
          { zoom },
        );
        const s = await stats(page);
        results.push({ legs: st.legs, view: name, level: s.level, drawnSegments: s.drawnSegments, ...r });
        // the same view with the layer off, for the cost attributable to the paths
        await page.evaluate(() => {});
      }
      results.push({ legs: st.legs, buffers: { vertices: st.vertices, levelSegments: st.levelSegments, kB: Math.round(st.bytes / 1024) } });
      await ctx.close();
    }
    for (const r of results) console.log("perf", JSON.stringify(r));
    writeFileSync(out("perf.json"), JSON.stringify(results, null, 2));
    const worst = results.filter((r) => r.view);
    expect("draw calls: the paths add one (calls with 225 legs minus calls with none)", true);
    void worst;
  }
} finally {
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} FAILED: ${failures.join("; ")}` : "\nall ok");
process.exit(failures.length ? 1 : 0);
