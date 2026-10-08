// Checks for the skybox (engine/sky.ts, engine/sky-layer.ts, docs/web-architecture.md "Skybox"), Playwright + headless Chrome.
//
//   CHROME_PATH=... BASE_URL=http://localhost:5290 node apps/web/scripts/globe/sky.mjs [flags|rest|pixels|parity|spin|orbit|timed|reduced|mobile]
//
// Any content works (no screenshot is taken). Pages run in debug mode, where the sky is OFF by default (`?sky` turns it on).
// `parity` imports the engine's pure modules from the page, so it needs a DEV server (a production build has no addressable modules): it is
// skipped with a note otherwise.
//
// flags    a debug page has no sky, `?sky` has it, `?sky&no-sky` has none
// rest     zero frames, zero ticks and zero rAF calls with the sky on, at rest, at the world view; the layer is fully on
// pixels   the sky region of the drawing buffer holds only the page colour and the sky's two palette tones; both tones are below the graticule's
//          level (and so are the palette levels it uses); nothing within the fade zone at the silhouette
// parity   the GPU's picture equals the CPU's twin (`toneAt`, `sampleBand`, `skyFade`, `viewToGalactic`) pixel for pixel (band: >= 99 %), and
//          every star the CPU projects is lit on the GPU (>= 97 %)
// spin     the idle rotation turns the earth and does NOT move one sky pixel (the era compensates the longitude)
// orbit    a camera orbit changes the sky; going back restores it exactly
// timed    zooming in until the globe covers the picture switches the sky off with a TIMED transition (a few frames, then a stopped loop, off at
//          rest); zooming back switches it on; no resting frame has a half-faded sky
// reduced  under reduced motion the switch is instant
// mobile   390x844@3: on at the world view, palette-only
import { launch, open, waitGlobe, DESKTOP, MOBILE, sleep } from "./_lib.mjs";

const only = process.argv.slice(2);
const run = (n) => only.length === 0 || only.includes(n);
const failures = [];
const expect = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : " " + JSON.stringify(detail)}`);
  if (!ok) failures.push(name);
};
const note = (s) => console.log(`note ${s}`);

const URL_SKY = "/?globe-debug&no-street&sky";
const openSky = async (browser, ctxOpts = DESKTOP, path = URL_SKY, opts = {}) => {
  const o = await open(browser, ctxOpts, path, { noGroups: false, ...opts });
  await waitGlobe(o.page);
  return o;
};

/** The drawing buffer as an RGB array, read in the same task as a render (the buffer is not preserved). */
const readBuffer = (page) =>
  page.evaluate(() => {
    const d = window.__globeDebug;
    d.renderNow();
    const src = document.querySelector('[data-globe="three"] canvas');
    const c = document.createElement("canvas");
    c.width = src.width;
    c.height = src.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(src, 0, 0);
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    const rgb = new Uint8Array(c.width * c.height * 3);
    for (let i = 0, j = 0; i < px.length; i += 4, j += 3) (rgb[j] = px[i]), (rgb[j + 1] = px[i + 1]), (rgb[j + 2] = px[i + 2]);
    return { w: c.width, h: c.height, rgb: Array.from(rgb) };
  });

const geometry = (page) => page.evaluate(() => ({ ramp: window.__globeDebug.ramp(), sky: window.__globeDebug.sky() }));

/** Which tone (0 page colour, 1 dim, 2 bright, -1 anything else) every pixel is, and how many of each. */
function tones(buf, ramp, top) {
  const same = (j, c) => buf.rgb[j] === c[0] && buf.rgb[j + 1] === c[1] && buf.rgb[j + 2] === c[2];
  const out = new Int8Array(buf.w * buf.h);
  const count = { 0: 0, 1: 0, 2: 0, other: 0 };
  for (let i = 0; i < out.length; i++) {
    const j = i * 3;
    out[i] = same(j, ramp[0]) ? 0 : same(j, ramp[1]) ? 1 : same(j, ramp[top]) ? 2 : -1;
    count[out[i] < 0 ? "other" : out[i]]++;
  }
  return { out, count };
}

/** Mask of the buffer's pixels at least `rho` earth radii from the globe's centre (the silhouette comes from `__globeDebug.sky()`). */
async function farMask(page, rho) {
  return page.evaluate(
    ({ rho }) => {
      const d = window.__globeDebug;
      const g = d.sky();
      const w = d.inset().bufW;
      const h = Math.ceil(document.querySelector('[data-globe="three"] canvas').height);
      const mask = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[y * w + x] = Math.hypot(x + 0.5 - g.cx, h - (y + 0.5) - g.cy) / g.radius >= rho ? 1 : 0;
      return { mask: Array.from(mask), g };
    },
    { rho },
  );
}

const browser = await launch();
try {
  /* ---------------------------------------------------------------------------------------------------- flags */
  if (run("flags")) {
    for (const [path, want, label] of [
      ["/?globe-debug&no-street", false, "a debug page has no sky by default"],
      ["/?globe-debug&no-street&sky", true, "?sky turns it on in a debug page"],
      ["/?globe-debug&no-street&sky&no-sky", false, "?no-sky beats ?sky"],
    ]) {
      const { page, logs } = await openSky(browser, DESKTOP, path);
      const s = await page.evaluate(() => window.__globeDebug.sky());
      expect(label, (s !== null) === want && logs.length === 0, { s, logs });
      await page.context().close();
    }
  }

  /* ---------------------------------------------------------------------------------------------------- rest */
  if (run("rest")) {
    const { page, logs } = await openSky(browser);
    await sleep(1500);
    const a = await page.evaluate(() => ({ f: window.__globeDebug.frames(), t: window.__globeDebug.ticks(), raf: window.__raf.calls, clears: window.__clears, sky: window.__globeDebug.sky(), animating: window.__globeDebug.isAnimating() }));
    await sleep(3500);
    const b = await page.evaluate(() => ({ f: window.__globeDebug.frames(), t: window.__globeDebug.ticks(), raf: window.__raf.calls, clears: window.__clears, sky: window.__globeDebug.sky(), animating: window.__globeDebug.isAnimating() }));
    expect("sky on at the world view, fully on at rest", a.sky && a.sky.on && a.sky.value === 1 && a.sky.drawn, a.sky);
    expect("zero frames, ticks, rAF calls and gl.clear over 3.5 s at rest with the sky on", a.f === b.f && a.t === b.t && a.raf === b.raf && a.clears === b.clears && !b.animating, { a, b });
    expect("no console error or warning", logs.length === 0, logs);
    await page.context().close();
  }

  /* ---------------------------------------------------------------------------------------------------- pixels */
  if (run("pixels") || run("mobile")) {
    for (const [label, ctx, scheme] of [
      ["desktop dark", DESKTOP, "dark"],
      ["desktop light", DESKTOP, "light"],
      ["mobile dark", MOBILE, "dark"],
    ]) {
      if (!run("pixels") && !label.startsWith("mobile")) continue;
      const o = await open(browser, { ...ctx, colorScheme: scheme }, URL_SKY, { noGroups: false });
      await waitGlobe(o.page);
      const g = await geometry(o.page);
      const buf = await readBuffer(o.page);
      const top = 2;
      const t = tones(buf, g.ramp, top);
      const { mask, g: sg } = await farMask(o.page, 1.05); // the horizon outline is a pixel or two wide on rho = 1
      // outside the silhouette the buffer holds the sky only: page colour and the two tones, nothing else
      let other = 0;
      let lit = 0;
      let near = 0;
      for (let i = 0; i < mask.length; i++) {
        if (!mask[i]) continue;
        if (t.out[i] < 0) other++;
        else if (t.out[i] > 0) lit++;
      }
      // inside the fade's inner radius nothing is lit
      const lim = sg.fadeFrom;
      for (let i = 0; i < mask.length; i++) {
        const x = i % buf.w, y = Math.floor(i / buf.w);
        const rho = Math.hypot(x + 0.5 - sg.cx, buf.h - (y + 0.5) - sg.cy) / sg.radius;
        // the horizon outline (the graticule's tone, level 3) sits on rho = 1, a pixel or two wide
        if (rho > 1 + 3 / sg.radius && rho < lim && t.out[i] > 0) near++;
      }
      expect(`${label}: outside the globe only the page colour and the two sky tones (${lit} lit pixels)`, other === 0 && lit > 50, { other, lit });
      expect(`${label}: nothing lit between the silhouette and the fade's inner radius`, near === 0, { near });
      const gridLevel = 3;
      const lumaOf = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      const dist = (k) => Math.abs(lumaOf(g.ramp[k]) - lumaOf(g.ramp[0]));
      expect(`${label}: both tones are fainter than the graticule's level`, dist(1) < dist(gridLevel) && dist(2) < dist(gridLevel) && dist(1) > 0, { ramp: g.ramp.slice(0, 4) });
      await o.page.context().close();
    }
  }

  /* ---------------------------------------------------------------------------------------------------- parity */
  if (run("parity")) {
    const { page } = await openSky(browser, { ...DESKTOP, colorScheme: "dark" });
    const dev = await page.evaluate(() => import("/app/globe/engine/sky.ts").then(() => true, () => false));
    if (!dev) note("parity skipped: no addressable modules (production build); run it against a dev server");
    else {
      for (const view of [{ lon: 15, lat: 28 }, { lon: -75, lat: -35 }, { lon: 140, lat: 60 }]) {
        await page.evaluate((v) => {
          const d = window.__globeDebug;
          d.setSkyEra(70);
          d.setView({ ...v, zoom: d.minZoom() });
          d.settle();
        }, view);
        const buf = await readBuffer(page);
        const res = await page.evaluate(async () => {
          const geo = await import("/app/globe/engine/geo.ts");
          const sky = await import("/app/globe/engine/sky.ts");
          const { SKY } = await import("/app/globe/engine/tuning.ts");
          const d = window.__globeDebug;
          const ins = d.inset();
          const v = d.view();
          const era = d.sky().era;
          const bufW = ins.bufW;
          const bufH = Math.ceil(document.querySelector('[data-globe="three"]').clientHeight / ins.pixel);
          const b = geo.viewBasis(v, bufH * ins.pixel);
          const m = sky.viewToGalactic(b, era);
          const g = sky.skyGeometry(b.d, bufW, bufH, ins.shiftBuf);
          const f = geo.focalPx(bufH);
          const map = sky.bakeBand();
          const expected = new Int8Array(bufW * bufH);
          for (let y = 0; y < bufH; y++)
            for (let x = 0; x < bufW; x++) {
              const dir = [(x + 0.5 + ins.shiftBuf - bufW / 2) / f, (bufH / 2 - (y + 0.5)) / f, -1];
              const n = Math.hypot(...dir);
              const gv = sky.mulVec3(m, [dir[0] / n, dir[1] / n, dir[2] / n]);
              const { l, b: lat } = sky.galacticLonLat(gv);
              const rho = Math.hypot(x + 0.5 - g.cx, bufH - (y + 0.5) - g.cy) / g.radius;
              const val = sky.sampleBand(map, l, lat) * sky.skyFade(rho);
              expected[y * bufW + x] = sky.toneAt(val, sky.bayerThreshold(x, bufH - 1 - y));
            }
          // the stars the CPU keeps and where it puts them
          const s = sky.makeStars();
          const stars = [];
          for (let i = 0; i < s.count; i++) {
            const gv = [s.position[i * 3], s.position[i * 3 + 1], s.position[i * 3 + 2]];
            const vv = sky.mulVec3(sky.transpose(m), gv); // galactic -> view
            if (vv[2] >= -1e-6) continue;
            const px = bufW / 2 - ins.shiftBuf + (f * vv[0]) / -vv[2];
            const py = bufH / 2 - (f * vv[1]) / -vv[2];
            const x = Math.floor(px), y = Math.floor(py);
            if (x < 0 || y < 0 || x >= bufW || y >= bufH) continue;
            const rho = Math.hypot(px - g.cx, bufH - py - g.cy) / g.radius;
            if (s.keep[i] < sky.skyFade(rho) && rho > 1) stars.push([x, y, s.tier[i], rho]);
          }
          return { bufW, bufH, expected: Array.from(expected), stars, fadeFrom: SKY.fade.from, g };
        });
        const t = tones(buf, (await geometry(page)).ramp, 2);
        let compared = 0, wrong = 0;
        const starAt = new Set(res.stars.map(([x, y]) => y * res.bufW + x));
        for (let i = 0; i < res.expected.length; i++) {
          const x = i % res.bufW, y = Math.floor(i / res.bufW);
          const rho = Math.hypot(x + 0.5 - res.g.cx, res.bufH - (y + 0.5) - res.g.cy) / res.g.radius;
          if (rho < res.fadeFrom || starAt.has(i)) continue; // a star may sit on a band pixel; the silhouette's neighbourhood holds the outline
          compared++;
          if (t.out[i] !== res.expected[i]) wrong++;
        }
        let litStars = 0;
        for (const [x, y] of res.stars) if (t.out[y * res.bufW + x] > 0) litStars++;
        expect(`parity at ${JSON.stringify(view)}: band tones equal the CPU twin (${wrong} of ${compared} differ)`, wrong / compared < 0.01, { wrong, compared });
        expect(`parity at ${JSON.stringify(view)}: ${litStars} of ${res.stars.length} projected stars are lit`, res.stars.length > 20 && litStars / res.stars.length >= 0.97, { litStars, stars: res.stars.length });
      }
    }
    await page.context().close();
  }

  /* ---------------------------------------------------------------------------------------------------- spin */
  if (run("spin")) {
    const { page, logs } = await open(browser, { ...DESKTOP, colorScheme: "dark" }, "/?globe-debug&no-street&sky&rotate&spin-idle=1200", { noGroups: false });
    await waitGlobe(page);
    const { mask } = await farMask(page, 1.06);
    const hashSky = async () => {
      const buf = await readBuffer(page);
      let h = 2166136261;
      let n = 0;
      for (let i = 0; i < mask.length; i++) {
        if (!mask[i]) continue;
        h = Math.imul(h ^ buf.rgb[i * 3], 16777619) >>> 0;
        if (buf.rgb[i * 3] !== buf.rgb[0]) n++;
      }
      return { h, lit: n };
    };
    const before = await hashSky();
    const s0 = await page.evaluate(() => ({ lon: window.__globeDebug.view().lon, era: window.__globeDebug.sky().era }));
    await page.waitForFunction(() => window.__globeDebug.spin().spinning, null, { timeout: 8000 });
    await sleep(3500);
    const s1 = await page.evaluate(() => ({ lon: window.__globeDebug.view().lon, era: window.__globeDebug.sky().era, spinning: window.__globeDebug.spin().spinning }));
    const after = await hashSky();
    const turned = ((((s0.lon - s1.lon + 180) % 360) + 360) % 360) - 180;
    const eraUp = ((((s1.era - s0.era + 180) % 360) + 360) % 360) - 180;
    expect("the earth turned (the view's longitude went down) while the sky stayed", s1.spinning && turned > 1.5, { s0, s1 });
    expect("the era went up by exactly what the longitude went down by", Math.abs(turned - eraUp) < 1e-6, { turned, eraUp });
    expect(`not one pixel of the sky moved during the rotation (${before.lit} lit pixels outside the fade zone)`, before.h === after.h && before.lit > 100, { before, after });
    expect("no console error or warning", logs.length === 0, logs);
    await page.context().close();
  }

  /* ---------------------------------------------------------------------------------------------------- orbit */
  if (run("orbit")) {
    const { page } = await openSky(browser, { ...DESKTOP, colorScheme: "dark" });
    const hashAll = async () => {
      const buf = await readBuffer(page);
      const { mask } = await farMask(page, 1.06);
      let h = 2166136261;
      for (let i = 0; i < mask.length; i++) if (mask[i]) h = Math.imul(h ^ buf.rgb[i * 3], 16777619) >>> 0;
      return h;
    };
    const set = (v) => page.evaluate((v) => { window.__globeDebug.setView({ ...v, zoom: window.__globeDebug.minZoom() }); window.__globeDebug.settle(); }, v);
    const h0 = await hashAll();
    await set({ lon: 75, lat: 28 });
    const h1 = await hashAll();
    await set({ lon: 15, lat: 28 });
    const h2 = await hashAll();
    expect("a camera orbit changes the sky and going back restores it exactly", h0 !== h1 && h0 === h2, { h0, h1, h2 });
    await page.context().close();
  }

  /* ---------------------------------------------------------------------------------------------------- timed */
  if (run("timed")) {
    const { page } = await openSky(browser, { ...DESKTOP, colorScheme: "dark" });
    // a view in which the globe fills the picture: the sky is off; track the frames of the transition
    const trace = (z) =>
      page.evaluate(
        (z) =>
          new Promise((resolve) => {
            const d = window.__globeDebug;
            const vals = [];
            const t0 = performance.now();
            d.setView({ zoom: z });
            const poll = () => {
              const s = d.sky();
              vals.push(Math.round(s.value * 100) / 100);
              if ((!d.isAnimating() && performance.now() - t0 > 100) || performance.now() - t0 > 2000) return resolve({ vals, ms: performance.now() - t0, sky: s, pending: d.isAnimating() });
              requestAnimationFrame(poll);
            };
            requestAnimationFrame(poll);
          }),
        z,
      );
    const out = await trace(3.6);
    expect("zooming in: the sky ends fully off, not drawn, with the frame loop stopped", out.sky.value === 0 && !out.sky.drawn && !out.sky.on && !out.pending, out);
    const mid = out.vals.filter((v) => v > 0 && v < 1);
    expect("the switch took a timed ramp of several frames (not one jump)", mid.length >= 3 && out.vals.every((v, i, a) => i === 0 || v <= a[i - 1]), out.vals);
    const back = await trace(await page.evaluate(() => window.__globeDebug.minZoom()));
    expect("zooming back out: fully on again, drawn, loop stopped", back.sky.value === 1 && back.sky.drawn && back.sky.on && !back.pending, back);
    // every resting frame of a slow zoom path is fully on or fully off
    const rests = await page.evaluate(async () => {
      const d = window.__globeDebug;
      const bad = [];
      const min = d.minZoom();
      for (let z = min; z <= 3.7; z += 0.02) {
        d.setView({ zoom: z });
        d.settle();
        const s = d.sky();
        if (s.value !== 0 && s.value !== 1) bad.push([z, s.value]);
        if ((s.value === 1) !== s.drawn) bad.push([z, "drawn", s.drawn]);
      }
      return bad;
    });
    expect("settled at every zoom from the whole globe to the cut: the sky is fully on or fully off", rests.length === 0, rests.slice(0, 5));
    await page.context().close();
  }

  /* ---------------------------------------------------------------------------------------------------- reduced */
  if (run("reduced")) {
    const o = await open(browser, { ...DESKTOP, colorScheme: "dark", reducedMotion: "reduce" }, URL_SKY, { noGroups: false });
    await waitGlobe(o.page);
    await o.page.evaluate(() => window.__globeDebug.setView({ zoom: 3.6 }));
    await sleep(100);
    const s = await o.page.evaluate(() => ({ sky: window.__globeDebug.sky(), pending: window.__globeDebug.isAnimating() }));
    expect("reduced motion: the sky switches off at once, no transition", s.sky.value === 0 && !s.sky.drawn && !s.pending, s);
    await o.page.context().close();
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.log(`\n${failures.length} FAILED`);
  process.exit(1);
}
console.log("\nall sky checks passed");
