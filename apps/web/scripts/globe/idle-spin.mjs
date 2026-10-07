// Checks for the idle rotation of the world view (engine/idle-spin.ts, docs/web-architecture.md "Idle rotation"), Playwright + headless Chrome.
//
//   CHROME_PATH=... BASE_URL=http://localhost:5174 node apps/web/scripts/globe/idle-spin.mjs [start|input|blocked|reduced|hidden|flags|mobile]
//
// Any content works (your preview included: no screenshot is taken). The pages run with `?globe-debug&rotate&spin-idle=1500`: debug pages have
// the rotation OFF by default (the zero-frame idle checks run for longer than the 8 s delay), `spin-idle` shortens the delay to 1.5 s.
//
// start    zero frames and zero rAF before the delay; after it the globe turns EASTWARD at the configured speed, in slow redraws (a few frames a second, rAF
//          calls only for the frames, none in between), the street map is not involved, the frame governor stays at level 0
// input    a pointer move, a key, a wheel notch, a held pointer and a click each stop it in the same task (the view does not move afterwards, no frame follows
//          but at most the one already queued) and restart the delay; a held pointer keeps it from starting; a place picked from the list stops it for good
// blocked  never with a place selected, a place focused in the list, the panel open (direct load of /locations/x), or zoomed past the unzoomed view; at the
//          threshold (slack) it still turns just inside, and not just outside; each of those pages draws zero frames for twice the delay
// reduced  `prefers-reduced-motion: reduce`: never turns, zero frames
// hidden   a hidden tab does not turn and draws nothing; shown again it waits the whole delay before turning
// flags    `?no-rotate` beats `?rotate`; a debug page without `?rotate` never turns
// mobile   390x844@3 touch: it turns, a tap stops it
import { launch, open, waitGlobe, DESKTOP, MOBILE, sleep } from "./_lib.mjs";

const only = process.argv.slice(2);
const run = (n) => only.length === 0 || only.includes(n);
const failures = [];
const expect = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : " " + JSON.stringify(detail)}`);
  if (!ok) failures.push(name);
};

const IDLE = 1500;
const URL_ROTATE = `/?globe-debug&no-street&rotate&spin-idle=${IDLE}`;
const state = (page) =>
  page.evaluate(() => {
    const d = window.__globeDebug;
    return { lon: d.view().lon, lat: d.view().lat, zoom: d.view().zoom, frames: d.frames(), raf: window.__raf.calls, spin: d.spin(), minZoom: d.minZoom() };
  });
const openSpin = async (browser, ctxOpts = DESKTOP, path = URL_ROTATE) => {
  const o = await open(browser, ctxOpts, path, { noGroups: false });
  await waitGlobe(o.page);
  return o;
};
/** Resolve (in the page) when the globe is turning, or null after `timeoutMs`; returns the ms it took. */
const untilSpinning = (page, timeoutMs) =>
  page.evaluate(
    (timeoutMs) =>
      new Promise((resolve) => {
        const t0 = performance.now();
        const poll = () => {
          if (window.__globeDebug.spin().spinning) return resolve(performance.now() - t0);
          if (performance.now() - t0 > timeoutMs) return resolve(null);
          setTimeout(poll, 20);
        };
        poll();
      }),
    timeoutMs,
  );
/** Resolve when no frame was drawn for 500 ms. */
const quiet = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        let last = window.__globeDebug.frames();
        let since = performance.now();
        const poll = () => {
          const f = window.__globeDebug.frames();
          if (f !== last) (last = f), (since = performance.now());
          if (performance.now() - since >= 500) return resolve(true);
          setTimeout(poll, 25);
        };
        poll();
      }),
  );
const shortDelta = (a, b) => ((((b - a + 180) % 360) + 360) % 360) - 180;

const browser = await launch();
try {
  /* ---------------------------------------------------------------------------------------------------- start */
  if (run("start")) {
    const { page, logs } = await openSpin(browser);
    const s0 = await state(page);
    expect("the page starts at the unzoomed world view with the rotation enabled and allowed", s0.spin.enabled && s0.spin.blockedBy === null && Math.abs(s0.zoom - s0.minZoom) < 1e-6 && s0.spin.idleMs === IDLE, s0);
    // the start-up frames (reveal, first box transitions) are over; restart the clock with an input, then count over most of the delay: nothing may draw
    await quiet(page);
    await page.mouse.move(700, 400);
    await page.mouse.move(710, 410);
    const a = await state(page);
    await sleep(IDLE - 500);
    const b = await state(page);
    expect("before the idle delay: zero frames and zero rAF calls, not turning", b.frames === a.frames && b.raf === a.raf && !b.spin.spinning, { a, b });
    const took = await untilSpinning(page, IDLE + 2000);
    expect(`it starts after the delay (${took === null ? "never" : Math.round(took + IDLE - 500)} ms after the last input, delay ${IDLE})`, took !== null && took + IDLE - 500 >= IDLE - 50 && took + IDLE - 500 <= IDLE + 900, took);
    // turning: eastward (the view longitude decreases), the configured speed, in slow redraws
    const t0 = await state(page);
    await sleep(4000);
    const t1 = await state(page);
    const dLon = shortDelta(t0.lon, t1.lon);
    const perSec = dLon / 4;
    expect(`it turns eastward (longitude decreases) at ${t1.spin.degPerSec} deg/s: ${perSec.toFixed(2)} deg/s`, perSec < 0 && Math.abs(Math.abs(perSec) - t1.spin.degPerSec) < 0.25 * t1.spin.degPerSec, { t0, t1 });
    expect("latitude and zoom are untouched", t1.lat === t0.lat && t1.zoom === t0.zoom, { t0, t1 });
    const cadence = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const d = window.__globeDebug;
          const stamps = [];
          let last = d.frames();
          const t0 = performance.now();
          const poll = () => {
            const f = d.frames();
            if (f !== last) (last = f), stamps.push(performance.now());
            if (performance.now() - t0 > 10000) return resolve(stamps);
            setTimeout(poll, 4);
          };
          poll();
        }),
    );
    const gaps = cadence.slice(1).map((t, i) => t - cadence[i]);
    const slow = gaps.filter((g) => g > 100);
    const chained = gaps.filter((g) => g <= 100);
    console.log(`     10 s turning: ${cadence.length} frames; ${slow.length} timer frames (gaps ${slow.length ? Math.round(Math.min(...slow)) + " to " + Math.round(Math.max(...slow)) : "-"} ms), ${chained.length} frames inside a box transition (200 ms chains)`);
    const fps = (t1.frames - t0.frames) / 4;
    const rafPerSec = (t1.raf - t0.raf) / 4;
    console.log(`     redraws: ${fps.toFixed(1)} frames/s, ${rafPerSec.toFixed(1)} rAF calls/s while turning (a running animation is 60)`);
    expect("redraws are capped well below an animation's 60 a second (about one per art pixel moved)", fps > 0.5 && fps <= 8 && rafPerSec <= 12, { fps, rafPerSec });
    // the cost of one frame, the same JS the loop runs
    const cost = await page.evaluate(() => {
      const d = window.__globeDebug;
      const ms = [];
      for (let i = 0; i < 30; i++) ms.push(d.renderNow());
      ms.sort((x, y) => x - y);
      return { p50: ms[15], max: ms[29] };
    });
    console.log(`     render() JS per frame: p50 ${cost.p50.toFixed(2)} ms, max ${cost.max.toFixed(2)} ms (GPU not measured)`);
    const q = await page.evaluate(() => (window.__handoverDebug ? window.__handoverDebug.quality() : 0));
    expect("the resolution governor is untouched (level 0) and nothing was logged as an error or warning", q === 0 && logs.length === 0, { q, logs });
    await page.context().close();
  }

  /* ---------------------------------------------------------------------------------------------------- input */
  if (run("input")) {
    const { page } = await openSpin(browser);
    const stopsOn = async (label, act) => {
      const took = await untilSpinning(page, IDLE + 3000);
      if (took === null) return expect(`${label}: it was turning before the input`, false, null);
      await sleep(400);
      const before = await state(page);
      // the input and the reads happen in one task: nothing can move the view in between
      const during = await act(page);
      const after = await state(page);
      expect(`${label}: stops in the same task${during ? " (the view is where it was when the input arrived)" : ""}`, !after.spin.spinning && (!during || Math.abs(shortDelta(during.lon, after.lon)) < 1e-9), { before, during, after });
      await sleep(900);
      const rest = await state(page);
      expect(`${label}: the view does not move afterwards and at most the frame already queued is drawn`, rest.lon === after.lon && rest.frames - after.frames <= 1, { after, rest });
      const again = await untilSpinning(page, IDLE + 2500);
      expect(`${label}: the delay starts over (it turns again ${again === null ? "never" : Math.round(again + 900)} ms later, delay ${IDLE})`, again !== null && again + 900 >= IDLE - 100, again);
    };
    await stopsOn("a pointer move", (p) => p.evaluate(() => { const l = window.__globeDebug.view().lon; window.dispatchEvent(new PointerEvent("pointermove", { pointerType: "mouse", clientX: 5, clientY: 5 })); return { lon: l }; }));
    await stopsOn("a key press", async (p) => { await p.keyboard.press("Shift"); return null; });
    await stopsOn("a wheel notch (even where the zoom cannot change)", async (p) => { await p.mouse.move(700, 400); await p.mouse.wheel(0, 40); return null; });
    // a click on the empty page (a pointerdown and a pointerup)
    await stopsOn("a click", async (p) => { await p.mouse.click(30, 870); return null; });
    // a held pointer: no start while it is down, and the delay counts from its release
    await page.mouse.move(700, 400);
    await page.mouse.down();
    await sleep(IDLE + 1200);
    const held = await state(page);
    expect("a pointer held down keeps it from starting", !held.spin.spinning && held.spin.blockedBy === "camera-busy", held);
    await page.mouse.up();
    const rel = await untilSpinning(page, IDLE + 2500);
    expect(`...and it turns ${rel === null ? "never" : Math.round(rel)} ms after the release`, rel !== null && rel >= IDLE - 300, rel);
    // a place picked from the list while turning: it stops and does not come back (a place is selected)
    const slug = await page.evaluate(() => window.__globeDebug.tree().find((n) => n.kind === "place")?.slug);
    await page.evaluate((s) => window.__handoverDebug.select(s), slug);
    await sleep(100);
    const sel = await state(page);
    expect(`selecting ${slug ? "a place" : "(no place in this content)"} stops it at once`, !sel.spin.spinning && sel.spin.blockedBy === "place-selected", sel);
    await page.context().close();
  }

  /* ---------------------------------------------------------------------------------------------------- blocked */
  if (run("blocked")) {
    const { page } = await openSpin(browser);
    const slug = await page.evaluate(() => window.__globeDebug.tree().find((n) => n.kind === "place")?.slug);
    const mustStayOff = async (label, expectedBlock) => {
      await sleep(2 * IDLE + 800);
      const a = await state(page);
      await sleep(IDLE);
      const b = await state(page);
      expect(`${label}: never turns (${b.spin.blockedBy}) and draws zero frames over ${IDLE} ms`, !a.spin.spinning && !b.spin.spinning && b.spin.blockedBy === expectedBlock && b.frames === a.frames && b.raf === a.raf && b.lon === a.lon, { a, b });
    };
    // zoomed past the unzoomed view
    const ms = await page.evaluate(() => window.__globeDebug.minZoom());
    await page.evaluate((z) => window.__globeDebug.setView({ zoom: z }), ms + 0.5);
    await mustStayOff("zoomed in half a level", "zoomed-in");
    // the threshold: just outside no, just inside yes
    await page.evaluate((z) => window.__globeDebug.setView({ zoom: z }), ms + 0.2);
    await mustStayOff("0.2 levels above the fit (past the slack)", "zoomed-in");
    await page.evaluate((z) => window.__globeDebug.setView({ zoom: z }), ms + 0.1);
    const near = await untilSpinning(page, IDLE + 2500);
    expect("0.1 levels above the fit (inside the slack): it turns", near !== null, near);
    await page.evaluate((z) => window.__globeDebug.setView({ zoom: z }), ms);
    // a place selected
    if (slug) {
      await page.evaluate((s) => window.__handoverDebug.select(s), slug);
      await sleep(7000); // the flight
      await mustStayOff("a place selected", "place-selected");
      await page.evaluate(() => window.__handoverDebug.select(null));
      await mustStayOff("the place deselected but the camera still at the place", "zoomed-in");
      await page.evaluate((z) => window.__globeDebug.setView({ zoom: z }), ms);
      const back = await untilSpinning(page, IDLE + 2500);
      expect("deselected and zoomed out again: it turns again", back !== null, back);
    } else console.log("     (no place in this content: the selected cases are skipped)");
    await page.context().close();

    // a place focused in the list (hover or keyboard focus on a link)
    {
      const { page } = await openSpin(browser);
      const has = await page.evaluate(() => !!document.querySelector("[data-place-link]"));
      if (has) {
        await page.focus("[data-place-link]");
        await mustStayOffOn(page, "a place focused in the list", "place-focused");
      } else console.log("     (no place link: the focus case is skipped)");
      await page.context().close();
    }
    // the panel open: direct load of a place page
    if (slug) {
      const { page } = await openSpin(browser, DESKTOP, `/locations/${slug}?globe-debug&no-street&rotate&spin-idle=${IDLE}`);
      await sleep(2 * IDLE + 800);
      const a = await state(page);
      await sleep(IDLE);
      const b = await state(page);
      expect(`direct load of /locations/${slug === undefined ? "" : "<slug>"}: never turns (${b.spin.blockedBy}), zero frames over ${IDLE} ms`, !b.spin.spinning && b.spin.blockedBy !== null && b.frames === a.frames && b.raf === a.raf, { a, b });
      await page.context().close();
    }
  }

  /* ---------------------------------------------------------------------------------------------------- reduced */
  if (run("reduced")) {
    const { page } = await openSpin(browser, { ...DESKTOP, reducedMotion: "reduce" });
    await sleep(2 * IDLE + 800);
    const a = await state(page);
    await sleep(IDLE);
    const b = await state(page);
    expect("prefers-reduced-motion: reduce: never turns and draws zero frames", !b.spin.spinning && b.spin.blockedBy === "reduced-motion" && b.frames === a.frames && b.raf === a.raf && b.lon === a.lon, { a, b });
    await page.context().close();
  }

  /* ---------------------------------------------------------------------------------------------------- hidden */
  if (run("hidden")) {
    const { page } = await openSpin(browser);
    const took = await untilSpinning(page, IDLE + 3000);
    expect("it was turning", took !== null, took);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await sleep(100);
    const a = await state(page);
    await sleep(2 * IDLE + 500);
    const b = await state(page);
    expect("hidden: stops, draws nothing, no timer left running", !b.spin.spinning && b.frames === a.frames && b.raf === a.raf && b.lon === a.lon && b.spin.blockedBy === "hidden", { a, b });
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await sleep(300);
    const c = await state(page);
    expect("shown again: one repaint, not turning yet", !c.spin.spinning && c.frames - b.frames <= 2 && c.lon === b.lon, { b, c });
    const again = await untilSpinning(page, IDLE + 2500);
    expect(`...then the whole delay again (${again === null ? "never" : Math.round(again + 300)} ms)`, again !== null && again + 300 >= IDLE - 100, again);
    await page.context().close();
  }

  /* ---------------------------------------------------------------------------------------------------- flags */
  if (run("flags")) {
    for (const [label, path, shouldTurn] of [
      ["?no-rotate beats ?rotate", `/?globe-debug&no-street&rotate&no-rotate&spin-idle=${IDLE}`, false],
      ["a debug page without ?rotate (what every other browser check runs on)", "/?globe-debug&no-street", false],
    ]) {
      const { page } = await openSpin(browser, DESKTOP, path);
      await sleep(2 * IDLE + 800);
      const a = await state(page);
      await sleep(IDLE);
      const b = await state(page);
      expect(`${label}: never turns, zero frames (enabled ${b.spin.enabled})`, !b.spin.spinning && !b.spin.enabled === !shouldTurn && b.frames === a.frames && b.raf === a.raf, { a, b });
      await page.context().close();
    }
  }

  /* ---------------------------------------------------------------------------------------------------- mobile */
  if (run("mobile")) {
    const { page } = await openSpin(browser, MOBILE);
    const took = await untilSpinning(page, IDLE + 3000);
    expect("mobile: it turns after the delay", took !== null, took);
    const before = await state(page);
    await page.touchscreen.tap(12, 700);
    const after = await state(page);
    expect("mobile: a tap stops it at once", !after.spin.spinning, { before, after });
    await sleep(600);
    const rest = await state(page);
    expect("mobile: the view does not move after the tap", rest.lon === after.lon, { after, rest });
    await page.context().close();
  }
} finally {
  await browser.close();
}

/** (blocked, focus case) The page stays off for twice the delay. */
async function mustStayOffOn(page, label, block) {
  await sleep(2 * IDLE + 800);
  const a = await state(page);
  await sleep(IDLE);
  const b = await state(page);
  expect(`${label}: never turns (${b.spin.blockedBy}) and draws zero frames over ${IDLE} ms`, !b.spin.spinning && b.spin.blockedBy === block && b.frames === a.frames && b.raf === a.raf, { a, b });
}

if (failures.length) {
  console.log(`\n${failures.length} FAILED`);
  process.exit(1);
}
console.log("\nall idle rotation checks passed");
