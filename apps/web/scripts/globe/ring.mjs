// Checks for the ring of type (engine/ring.ts, engine/ring-layer.ts, docs/web-architecture.md "Ring of type"), Playwright + headless Chrome.
//
//   CHROME_PATH=... BASE_URL=http://localhost:5490 node apps/web/scripts/globe/ring.mjs [flags|rest|fade|fit|layers|spin|reduced|panel|wheel|cost|mobile]
//
// Any content works. Pages run in debug mode, where the ring is OFF by default (`?ring` turns it on, like `?sky`); `?no-ring` is the
// flag of every other page. `window.__globeDebug.ring()` is the introspection (null without a ring).
//
// flags    a debug page has no ring, `?ring` has one, `?ring&no-ring` none; without it the lowest zoom IS the whole-globe fit
// rest     with the ring on, the world view is exactly the fit (the ring is found by zooming out), the ring is not shown and costs nothing:
//          zero rAF calls, zero frames, no canvas pixels, the wrapper hidden
// fade     from the fit down to the lowest zoom the ring's tone only grows, it is gone at the fit and before it, full at the floor; going back
//          up it is gone again and its pixels are released
// fit      at the lowest zoom the whole ring (every glyph) is inside the viewport with room to spare and below the header, at 1440x900, 1024x700,
//          390x844, 844x390 and 1920x1080
// layers   wrapper is aria-hidden, pointer-events none, after the GL canvas and before the labels in the stacking order; a point on the ring
//          still hits the globe's canvas (drag and wheel work through it); the ring's text is not in the page's text
// spin     the ring turns clockwise on its own clock at RING.degPerSec, with no GL frame and no camera tick, a repaint at most every
//          RING.frameMs; not coupled to the globe's idle rotation
// reduced  under reduced motion the ring is there and static: no rAF call, the same phase
// panel    the panel's inset: the lowest zoom follows the free area, the ring is inside it
// wheel    real wheel events: zoom out reaches the floor, the app's view reports zoom 0 (the world view: the hero keeps its rules), zoom in fades it
// cost     per-frame JS cost of a ring frame at the floor and a full minute-less run's share of a frame budget
// mobile   390x844@3 touch: pinch-free, the same, with the ring inside the screen
// overlay  with the showcase (the home screen) the ring gives way to the boxes and labels: it is full at rest in the world view (as on main), fades out
//          with them the moment they come back (the same value and clock as their own opacity), stays away while they are there, and is back at rest;
//          reduced motion: at once; without the showcase (a debug page) the ring is a function of the zoom alone, as above
import { launch, open, waitGlobe, DESKTOP, MOBILE, sleep } from "./_lib.mjs";

const only = process.argv.slice(2);
const run = (n) => only.length === 0 || only.includes(n);
const failures = [];
const expect = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : " " + JSON.stringify(detail)}`);
  if (!ok) failures.push(name);
};
const note = (s) => console.log(`note ${s}`);

// The line of the ring is the site identity (app/lib/site.ts `SITE`, built by app/globe/ring-text.ts `ringPhrases`, joined by engine/ring.ts `ringText`):
// its length and its letters that are not spaces are read from the page (`ring().length`, `ring().letters`), so the checks follow the identity.

const URL_RING = "/?globe-debug&no-street&ring";
const openRing = async (browser, ctxOpts = DESKTOP, path = URL_RING, opts = {}) => {
  const o = await open(browser, ctxOpts, path, { noGroups: false, ...opts });
  await waitGlobe(o.page);
  return o;
};
const ring = (page) => page.evaluate(() => window.__globeDebug.ring());
const goto = (page, zoom) =>
  page.evaluate((zoom) => {
    const d = window.__globeDebug;
    d.setView({ zoom });
    d.renderNow();
    return d.ring();
  }, zoom);
const nums = (page) => page.evaluate(() => ({ min: window.__globeDebug.floorZoom(), fit: window.__globeDebug.fitZoom() }));

const browser = await launch();
try {
  if (run("flags")) {
    note("flags");
    {
      const { page, ctx } = await open(browser, DESKTOP, "/?globe-debug&no-street", { noGroups: false });
      await waitGlobe(page);
      expect("a debug page has no ring", (await ring(page)) === null);
      const n = await nums(page);
      expect("... and its lowest zoom is the whole-globe fit", Math.abs(n.min - n.fit) < 1e-9, n);
      await ctx.close();
    }
    {
      const { page, ctx } = await openRing(browser);
      const r = await ring(page);
      const n = await nums(page);
      expect("?ring has one", r !== null);
      expect("... and the lowest zoom is below the fit", n.min < n.fit - 0.3, n);
      await ctx.close();
    }
    {
      const { page, ctx } = await openRing(browser, DESKTOP, "/?globe-debug&no-street&ring&no-ring");
      expect("?no-ring wins", (await ring(page)) === null);
      await ctx.close();
    }
    {
      // A normal page (not debug): the ring is on by default, ?no-ring switches it off. No debug introspection there: read the DOM.
      const { page, ctx } = await open(browser, DESKTOP, "/", { debug: false, noStreet: false, noGroups: false });
      await page.waitForSelector('[data-globe="three"][data-state="ready"]', { timeout: 20000 });
      expect("a normal page mounts the ring's wrapper", (await page.locator("[data-ring]").count()) === 1);
      await ctx.close();
      const o = await open(browser, DESKTOP, "/?no-ring", { debug: false, noStreet: false, noGroups: false });
      await o.page.waitForSelector('[data-globe="three"][data-state="ready"]', { timeout: 20000 });
      expect("?no-ring mounts none", (await o.page.locator("[data-ring]").count()) === 0);
      await o.ctx.close();
    }
  }

  if (run("rest")) {
    note("rest");
    const { page, ctx, logs } = await openRing(browser);
    await sleep(500);
    const n = await nums(page);
    const v = await page.evaluate(() => window.__globeDebug.view());
    expect("the world view is the fit, not the floor", Math.abs(v.zoom - n.fit) < 1e-6, { v, n });
    const r = await ring(page);
    expect("the ring is not shown there", r.shown === false && r.frames === 0, r);
    const before = await page.evaluate(() => ({ raf: window.__raf.calls, frames: window.__globeDebug.frames(), clears: window.__clears ?? 0 }));
    await sleep(2500);
    const after = await page.evaluate(() => ({ raf: window.__raf.calls, frames: window.__globeDebug.frames(), clears: window.__clears ?? 0 }));
    expect("zero rAF, zero frames, zero clears at rest with the ring on and hidden", after.raf === before.raf && after.frames === before.frames && after.clears === before.clears, { before, after });
    const dom = await page.evaluate(() => {
      const root = document.querySelector("[data-ring]");
      const c = root.querySelector("canvas");
      return { visibility: getComputedStyle(root).visibility, w: c.width, h: c.height };
    });
    expect("the wrapper is hidden and its canvas holds no pixels", dom.visibility === "hidden" && dom.w === 0 && dom.h === 0, dom);
    expect("no console warning or error", logs.length === 0, logs);
    await ctx.close();
  }

  if (run("fade")) {
    note("fade");
    const { page, ctx } = await openRing(browser);
    const n = await nums(page);
    const tones = [];
    for (let k = 0; k <= 40; k++) {
      const z = n.fit - (k / 40) * (n.fit - n.min);
      const r = await goto(page, z);
      tones.push({ t: k / 40, level: r.level, alpha: r.zoomAlpha, shown: r.shown });
    }
    let mono = true;
    for (let i = 1; i < tones.length; i++) if (tones[i].level < tones[i - 1].level || tones[i].alpha < tones[i - 1].alpha - 1e-9) mono = false;
    expect("going out from the fit the ring's tone only grows", mono, tones.map((t) => t.level));
    expect("gone at the fit", tones[0].level === 0 && !tones[0].shown, tones[0]);
    expect("... and still gone a tenth of the way out", tones[4].level === 0 || tones[3].level === 0, tones.slice(0, 6));
    expect("full at the floor", tones.at(-1).alpha === 1 && tones.at(-1).shown, tones.at(-1));
    const full = Math.max(...tones.map((t) => t.level));
    const fullAt = tones.findIndex((t) => t.level === full) / 40;
    expect("full strength before the floor (the last stretch is at rest)", fullAt < 0.8, { fullAt });
    // Zoom in again: the ring goes, and its pixels with it.
    const up = await goto(page, n.fit + 0.5);
    const dom = await page.evaluate(() => {
      const root = document.querySelector("[data-ring]");
      const c = root.querySelector("canvas");
      return { visibility: getComputedStyle(root).visibility, w: c.width };
    });
    expect("zoomed in it is gone and releases its canvas", !up.shown && dom.visibility === "hidden" && dom.w === 0, { up, dom });
    // And it is never there while any place's label could be competing: from the fit up there is no ring at all.
    let anywhere = false;
    for (let z = n.fit; z <= 6.5; z += 0.25) if ((await goto(page, z)).shown) anywhere = true;
    expect("no ring from the whole-globe fit to the closest globe view", !anywhere);
    await ctx.close();
  }

  if (run("fit")) {
    note("fit");
    for (const [w, h, name] of [[1440, 900, "1440x900"], [1024, 700, "1024x700"], [390, 844, "390x844"], [844, 390, "844x390"], [1920, 1080, "1920x1080"]]) {
      const ctxOpts = w < 800 ? { ...MOBILE, viewport: { width: w, height: h }, deviceScaleFactor: 2 } : { viewport: { width: w, height: h }, deviceScaleFactor: 2 };
      const { page, ctx } = await openRing(browser, ctxOpts);
      const n = await nums(page);
      const r = await goto(page, n.min);
      const b = r.bounds;
      const em = r.em;
      const ok = b.minX - em >= 0 && b.maxX + em <= w && b.minY - em >= 0 && b.maxY + em <= h;
      expect(`${name}: the whole ring is inside the viewport (glyph size to spare)`, ok, { b, em });
      const margin = Math.min(b.minX, w - b.maxX, b.minY, h - b.maxY);
      note(`${name}: floor ${n.min.toFixed(3)} (${(n.fit - n.min).toFixed(2)} levels below the fit), ring ${Math.round(b.maxX - b.minX)} x ${Math.round(b.maxY - b.minY)} px, margin ${Math.round(margin)} px, em ${em.toFixed(1)} px, ${r.repeats} repeat(s), tone ${r.level}`);
      // The header row (centred, the top 56 px) is clear of the ring unless the viewport is a landscape phone.
      if (h >= 700) expect(`${name}: the ring stays below the header`, b.minY >= 56, b);
      expect(`${name}: the planet's silhouette is inside as well`, r.silhouettePx * 2 <= Math.min(w, h), r);
      // The flat ring: concentric with the disc (the globe is centred on the free area), the letters' bottoms outside the silhouette by the gap,
      // a whole number of turns of the line, every letter the same size.
      const cxr = (b.minX + b.maxX) / 2;
      const cyr = (b.minY + b.maxY) / 2;
      expect(`${name}: concentric with the planet (the centre of the viewport)`, Math.abs(cxr - w / 2) < 1.5 && Math.abs(cyr - h / 2) < 1.5, { cxr, cyr });
      const gap = r.baseline - r.silhouettePx;
      expect(`${name}: the baseline is the silhouette's radius plus the gap (6 %)`, Math.abs(gap - 0.06 * r.silhouettePx) < 0.5, { gap, r: r.silhouettePx });
      expect(`${name}: the line goes round a whole number of times (${r.glyphs} letters = ${r.repeats} x ${r.letters})`, r.letters > 0 && r.glyphs === r.repeats * r.letters && Number.isInteger(r.repeats), r);
      // Even spacing: the advance along the baseline times the number of glyph slots is the circumference.
      const slots = r.repeats * r.length;
      const closes = Math.abs(slots * r.em * (0.6 + r.tracking) - 2 * Math.PI * r.baseline) < 0.5;
      expect(`${name}: the seam closes evenly (tracking ${r.tracking.toFixed(3)} em)`, closes, { slots, em: r.em, tracking: r.tracking, baseline: r.baseline });
      // Asking for less than the floor changes nothing.
      const below = await goto(page, n.min - 2);
      const v = await page.evaluate(() => window.__globeDebug.view());
      expect(`${name}: the floor is a hard limit`, Math.abs(v.zoom - n.min) < 1e-9, { v, n });
      await ctx.close();
    }
  }

  if (run("layers")) {
    note("layers");
    const { page, ctx } = await openRing(browser);
    const n = await nums(page);
    const r = await goto(page, n.min);
    const info = await page.evaluate(() => {
      const root = document.querySelector("[data-ring]");
      const stage = root.parentElement;
      const kids = [...stage.parentElement.children];
      const labels = kids.find((k) => k !== stage && k.getAttribute("aria-hidden") === "true" && getComputedStyle(k).zIndex === "1");
      const gl = stage.querySelector("canvas:not([data-ring] canvas)");
      const pos = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      return {
        ariaHidden: root.getAttribute("aria-hidden"),
        pointerEvents: getComputedStyle(root).pointerEvents,
        canvasPointer: getComputedStyle(root.querySelector("canvas")).pointerEvents,
        afterGl: gl ? pos(gl, root) : null,
        // Both in the stage's stacking context: the labels' wrapper has z-index 1 (above), the ring none, the stage itself none.
        labelsZ: labels ? getComputedStyle(labels).zIndex : null,
        ringZ: getComputedStyle(root).zIndex,
        text: root.textContent,
        bodyHasRingWords: document.body.innerText.includes("DESIGN ENGINEER"),
      };
    });
    expect("aria-hidden", info.ariaHidden === "true", info);
    expect("pointer-events none (the wrapper and the canvas)", info.pointerEvents === "none" && info.canvasPointer === "none", info);
    expect("after the GL canvas, below the labels", info.afterGl === true && info.labelsZ === "1" && info.ringZ === "auto", info);
    expect("no text in the page for the ring (a canvas, not DOM text)", info.text === "" && !info.bodyHasRingWords, info);
    // A point on the ring (its bottom) hits the globe's canvas, not the ring.
    const hit = await page.evaluate((b) => {
      const el = document.elementFromPoint((b.minX + b.maxX) / 2, b.maxY);
      return { tag: el?.tagName, inRing: !!el?.closest("[data-ring]"), inGlobe: !!el?.closest('[data-globe="three"]') };
    }, r.bounds);
    expect("a point on the ring hits the globe's canvas (drag and wheel work through it)", !hit.inRing, hit);
    await ctx.close();
  }

  if (run("spin")) {
    note("spin");
    const { page, ctx } = await openRing(browser);
    const n = await nums(page);
    await goto(page, n.min);
    await sleep(300);
    const s0 = await page.evaluate(() => ({ ring: window.__globeDebug.ring(), frames: window.__globeDebug.frames(), ticks: window.__globeDebug.ticks(), clears: window.__clears ?? 0, raf: window.__raf.calls, t: performance.now(), spin: window.__globeDebug.spin() }));
    await sleep(3000);
    const s1 = await page.evaluate(() => ({ ring: window.__globeDebug.ring(), frames: window.__globeDebug.frames(), ticks: window.__globeDebug.ticks(), clears: window.__clears ?? 0, raf: window.__raf.calls, t: performance.now(), view: window.__globeDebug.view() }));
    const dt = (s1.t - s0.t) / 1000;
    const dphase = s1.ring.phaseDeg - s0.ring.phaseDeg;
    const rate = dphase / dt;
    expect("the ring turns clockwise at RING.degPerSec (3 deg/s)", Math.abs(rate - 3) < 0.3, { rate, dphase, dt });
    note(`ring ${rate.toFixed(2)} deg/s, the globe's idle rotation is ${s0.spin.degPerSec} deg/s (two clocks: the ring is a decoration with its own pace)`);
    expect("it asked for no GL frame and no camera tick", s1.frames === s0.frames && s1.ticks === s0.ticks && s1.clears === s0.clears, { s0, s1 });
    const repaints = s1.ring.frames - s0.ring.frames;
    const hz = repaints / dt;
    // (round 10: the ring is drawn on EVERY display frame while it turns: its letters move 3 degrees a second and a timer's uneven intervals against the vsync are visible judder)
    expect("it repaints on every display frame (the display's rate: 60 here, up to 144), not on a timer", hz > 40 && hz <= 150, { hz, repaints });
    note(`ring repaints ${hz.toFixed(1)}/s, ${(s1.ring.totalMs - s0.ring.totalMs).toFixed(1)} ms of JS in ${dt.toFixed(1)} s (${((s1.ring.totalMs - s0.ring.totalMs) / repaints).toFixed(2)} ms a frame), ${s1.ring.glyphs} glyphs`);
    // The planet's own idle rotation is independent: with the rotation allowed (shortened delay) the ring's rate does not change.
    await ctx.close();
    const o = await openRing(browser, DESKTOP, "/?globe-debug&no-street&ring&rotate&spin-idle=1200");
    await goto(o.page, (await nums(o.page)).min);
    await sleep(2500);
    const a = await o.page.evaluate(() => ({ r: window.__globeDebug.ring(), t: performance.now(), s: window.__globeDebug.spin(), lon: window.__globeDebug.view().lon }));
    await sleep(2000);
    const b = await o.page.evaluate(() => ({ r: window.__globeDebug.ring(), t: performance.now(), s: window.__globeDebug.spin(), lon: window.__globeDebug.view().lon }));
    const rate2 = (b.r.phaseDeg - a.r.phaseDeg) / ((b.t - a.t) / 1000);
    expect("the globe's rotation runs at the floor (the ring's regime is part of the world view)", a.s.spinning === true || b.s.spinning === true, { a: a.s, b: b.s });
    expect("... and the ring's rate is the same with the globe turning", Math.abs(rate2 - 3) < 0.35, { rate2 });
    // (the idle rotation is slow, 0.2 deg/s: 0.4 degree in 2 s; the ring's 3 deg/s is a different clock)
    expect("... while the globe's longitude changed (its own clock)", Math.abs(b.lon - a.lon) > 0.15, { a: a.lon, b: b.lon });
    await o.ctx.close();
  }

  if (run("reduced")) {
    note("reduced");
    const ctxOpts = { ...DESKTOP, reducedMotion: "reduce" };
    const { page, ctx } = await openRing(browser, ctxOpts);
    const n = await nums(page);
    const r = await goto(page, n.min);
    expect("under reduced motion the ring is there", r.shown && r.level > 0, r);
    await sleep(300);
    const a = await page.evaluate(() => ({ r: window.__globeDebug.ring(), raf: window.__raf.calls }));
    await sleep(2500);
    const b = await page.evaluate(() => ({ r: window.__globeDebug.ring(), raf: window.__raf.calls }));
    expect("... static: the same phase, no rAF call, no loop", a.r.phaseDeg === b.r.phaseDeg && a.raf === b.raf && !b.r.looping, { a: a.r.phaseDeg, b: b.r.phaseDeg, raf: [a.raf, b.raf] });
    await ctx.close();
  }

  if (run("panel")) {
    note("panel");
    // A direct load on a place has the detail panel open (the inset is half the viewport): the floor follows the free area.
    const a = await openRing(browser, DESKTOP, "/?globe-debug&no-street&ring");
    const full = await nums(a.page);
    await a.ctx.close();
    const { page, ctx } = await openRing(browser, DESKTOP, "/locations/lisbon?globe-debug&no-street&ring");
    await sleep(800);
    const inset = await page.evaluate(() => window.__globeDebug.inset());
    const n = await nums(page);
    expect("the panel is open: the inset is half the viewport", Math.abs(inset.inset - 720) < 2, inset);
    expect("the floor and the fit follow the free area (the fit is lower, the floor lower still)", n.fit < full.fit - 0.3 && n.min < n.fit - 0.4, { n, full });
    const r = await goto(page, n.min);
    expect("the ring is inside the free half, centred on it", r.bounds.minX - r.em >= 0 && r.bounds.maxX + r.em <= 720 && Math.abs((r.bounds.minX + r.bounds.maxX) / 2 - 360) < 40, r.bounds);
    const mask = await page.evaluate(() => getComputedStyle(document.querySelector("[data-ring]")).maskImage);
    expect("it dissolves at the panel's edge with the labels (the container mask)", mask !== "none" && mask !== "", { mask });
    await ctx.close();
  }

  if (run("wheel")) {
    note("wheel");
    const { page, ctx } = await openRing(browser, DESKTOP, "/?globe-debug&no-street&ring");
    const n = await nums(page);
    await page.mouse.move(720, 450);
    for (let i = 0; i < 30; i++) {
      await page.mouse.wheel(0, 120);
      await sleep(25);
    }
    await sleep(500);
    let v = await page.evaluate(() => ({ view: window.__globeDebug.view(), ring: window.__globeDebug.ring() }));
    expect("wheeling out stops at the floor", Math.abs(v.view.zoom - n.min) < 1e-6 && v.ring.shown, { v: v.view, n });
    for (let i = 0; i < 40; i++) {
      await page.mouse.wheel(0, -120);
      await sleep(25);
    }
    await sleep(500);
    v = await page.evaluate(() => ({ view: window.__globeDebug.view(), ring: window.__globeDebug.ring() }));
    expect("wheeling in again: past the fit, no ring", v.view.zoom > n.fit && !v.ring.shown, { v: v.view, n });
    await ctx.close();
  }

  if (run("cost")) {
    note("cost");
    const { page, ctx } = await openRing(browser);
    const n = await nums(page);
    await goto(page, n.min);
    // Camera frames (a zoom wiggle: each draws the ring in step with the globe) and the idle turn.
    const t = await page.evaluate(
      ({ min, fit }) => {
        const d = window.__globeDebug;
        const out = { camera: [], idle: null };
        for (let k = 0; k < 120; k++) {
          d.setView({ zoom: min + ((fit - min) * 0.5 * (1 + Math.sin(k / 5))) / 1 });
          const t0 = performance.now();
          d.renderNow();
          out.camera.push(performance.now() - t0);
        }
        return out;
      },
      n,
    );
    const sorted = [...t.camera].sort((a, b) => a - b);
    note(`renderNow with the ring (zoom wiggle, ring drawn in step): p50 ${sorted[60].toFixed(2)} ms, p95 ${sorted[114].toFixed(2)} ms`);
    await goto(page, n.min);
    await sleep(3000);
    const r = await ring(page);
    note(`idle turn: ${r.frames} repaints, ${(r.totalMs / r.frames).toFixed(2)} ms mean, last ${r.lastMs.toFixed(2)} ms; canvas ${r.canvas.width}x${r.canvas.height} @${r.canvas.dpr}`);
    expect("a ring frame costs under 2 ms of JS", r.totalMs / r.frames < 2, r);
    await ctx.close();
  }

  if (run("overlay")) {
    note("overlay");
    const URL_SHOW = "/?globe-debug&no-street&ring&showcase";
    {
      const { page, ctx, logs } = await openRing(browser, DESKTOP, URL_SHOW);
      await sleep(800);
      const at = await ring(page);
      expect("at rest in the world view the ring is shown at full strength (main's)", at.shown && at.presence === at.zoomAlpha && at.overlay === 0 && at.presence > 0.99, at);
      // the showcase ends (a gesture): the boxes and labels come back, and the ring leaves with them, in the same frames
      await page.evaluate(() => window.__globeDebug.showcase(false));
      const samples = [];
      for (let i = 0; i < 24; i++) {
        samples.push(await ring(page));
        await sleep(12);
      }
      const hidden = samples.at(-1);
      expect("the ring is gone with the overlay's fade-in (presence 0, not shown)", hidden.presence === 0 && !hidden.shown, hidden);
      expect("its presence is one minus the overlay's own value in every frame (one clock)", samples.every((r) => Math.abs(r.presence - r.zoomAlpha * (1 - r.overlay)) < 1e-9), samples.slice(0, 3));
      let mono = true;
      for (let i = 1; i < samples.length; i++) if (samples[i].presence > samples[i - 1].presence + 1e-9) mono = false;
      expect("it only goes down (never flashes back)", mono, samples.map((r) => +r.presence.toFixed(2)));
      await sleep(400);
      const still = await ring(page);
      expect("and stays away while the boxes and labels are there", !still.shown && still.presence === 0, still);
      // back at rest: the other way
      await page.evaluate(() => window.__globeDebug.showcase(true));
      await sleep(700);
      const back = await ring(page);
      expect("the ring is back when the showcase is", back.shown && back.presence > 0.99, back);
      expect("no console warning or error", logs.length === 0, logs);
      await ctx.close();
    }
    {
      // reduced motion: at once, both ways
      const { page, ctx } = await openRing(browser, { ...DESKTOP, reducedMotion: "reduce" }, URL_SHOW);
      await sleep(600);
      await page.evaluate(() => window.__globeDebug.showcase(false));
      await sleep(80);
      const r = await ring(page);
      expect("reduced motion: the ring is gone at once with the boxes", !r.shown && r.presence === 0, r);
      await ctx.close();
    }
    {
      // no showcase (a debug page): the ring is a function of the zoom alone
      const { page, ctx } = await openRing(browser, DESKTOP);
      const n = await nums(page);
      const r = await goto(page, n.min);
      expect("without the showcase the overlay does not touch the ring", r.presence === r.zoomAlpha && r.shown, r);
      await ctx.close();
    }
  }
  if (run("mobile")) {
    note("mobile");
    const { page, ctx, logs } = await openRing(browser, MOBILE);
    const n = await nums(page);
    const r = await goto(page, n.min);
    expect("the ring is shown on the phone", r.shown, r);
    expect("... inside the screen", r.bounds.minX >= 0 && r.bounds.maxX <= 390 && r.bounds.minY >= 56 && r.bounds.maxY <= 844, r.bounds);
    await sleep(1000);
    expect("no console warning or error", logs.length === 0, logs);
    await ctx.close();
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nall ring checks passed");
