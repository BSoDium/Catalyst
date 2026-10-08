// Checks for the idle rotation of the world view (engine/idle-spin.ts, docs/web-architecture.md "Idle rotation"), Playwright + headless Chrome.
//
//   CHROME_PATH=... BASE_URL=http://localhost:5174 node apps/web/scripts/globe/idle-spin.mjs [start|cadence|input|coast|blocked|reduced|hidden|flags|mobile]
//
// Any content works (your preview included: no screenshot is taken). The pages run with `?globe-debug&rotate&spin-idle=1500`: debug pages have
// the rotation OFF by default (the zero-frame idle checks run for longer than the 8 s delay), `spin-idle` shortens the delay to 1.5 s.
//
// start    zero frames and zero rAF before the delay; after it the globe EASES IN from rest (speed per 500 ms bin follows the smoothstep, monotonic, no jump),
//          then turns EASTWARD at the configured speed, redrawn on every display refresh (one rAF per frame, none in between before the delay), the street map
//          is not involved, the frame governor stays at level 0
// cadence  steady turning, picture read back after every drawn frame: the gap between frames that change the picture has no step longer than 80 ms
//          (before: a redraw every 227 ms), with the histogram and the size of the steps in art pixels
// input    a pointer move, a key, a wheel notch, a held pointer and a click each stop it in the same task (the view does not move afterwards, no frame follows
//          but at most the one already queued) and restart the delay; a held pointer keeps it from starting
// coast    a stop that is not an input (a place focused, a place selected) coasts to rest over `stopMs` with inertia instead of freezing: the speed only goes
//          down, the view keeps turning by about stopAngle and no more; a selection flight lands exactly where it does without the rotation
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
const SPIN_STOP = 1000; // SPIN.stopMs
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

/**
 * Frame probe: after every rAF callback the app runs, if the globe drew a frame, read the drawing buffer back (the buffer is still valid in the same task:
 * it is cleared when the frame is presented) and record when it was, how many pixels differ from the previous drawn frame, and the view's longitude.
 * Measurement only: the readback costs a few ms a frame, so the cost numbers come from the uninstrumented section.
 */
const installProbe = (page) =>
  page.evaluate(() => {
    const d = window.__globeDebug;
    const canvas = [...document.querySelectorAll("canvas")].find((c) => c.style.imageRendering === "pixelated");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const u8 = new Uint8Array(w * h * 4);
    const cur = new Uint32Array(u8.buffer);
    let prev = null;
    let lastFrames = d.frames();
    const rec = (window.__cad = { on: false, frames: [] });
    const raf0 = window.requestAnimationFrame;
    window.requestAnimationFrame = (cb) =>
      raf0((t) => {
        cb(t);
        const f = d.frames();
        if (f === lastFrames) return;
        lastFrames = f;
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, u8);
        let changed = 0;
        if (prev) for (let i = 0; i < cur.length; i++) if (cur[i] !== prev[i]) changed++;
        if (!prev) prev = new Uint32Array(cur.length);
        prev.set(cur);
        if (rec.on) rec.frames.push({ t: performance.now(), changed, lon: d.view().lon, speed: d.spin().speed ?? null });
      });
  });
const probeOn = (page, on) => page.evaluate((on) => { window.__cad.on = on; if (on) window.__cad.frames = []; }, on);
const probeFrames = (page) => page.evaluate(() => window.__cad.frames);
const quantile = (a, q) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(q * a.length))] : NaN);
/** Frames that changed the picture, the gaps between them (ms), and how far (art pixels at the disc centre) each step moved the globe. */
const analyse = (frames, artPx, zoom) => {
  const R = (512 * 2 ** zoom) / (2 * Math.PI);
  const shown = frames.filter((f) => f.changed > 0);
  const gaps = shown.slice(1).map((f, i) => f.t - shown[i].t);
  const frameGaps = frames.slice(1).map((f, i) => f.t - frames[i].t);
  const steps = shown.slice(1).map((f, i) => (Math.abs(shortDelta(shown[i].lon, f.lon)) * Math.PI / 180 * R) / artPx);
  return { frames, shown, gaps, frameGaps, steps, R };
};
const bucketOf = (gaps, edges) => edges.map((e, i) => `${i ? edges[i - 1] : 0}-${e}ms:${gaps.filter((g) => g > (i ? edges[i - 1] : 0) && g <= e).length}`).concat(`>${edges.at(-1)}ms:${gaps.filter((g) => g > edges.at(-1)).length}`).join("  ");
const report = (label, a, secs) => {
  const g = a.gaps;
  console.log(
    `     ${label}: ${a.frames.length} frames drawn in ${secs} s (${(a.frames.length / secs).toFixed(1)}/s), ${a.shown.length} changed the picture (${(a.shown.length / secs).toFixed(1)}/s)\n` +
      `       gap between picture changes (ms): p50 ${quantile(g, 0.5).toFixed(0)}  p95 ${quantile(g, 0.95).toFixed(0)}  max ${Math.max(...g).toFixed(0)}\n` +
      `       histogram ${bucketOf(g, [20, 40, 80, 120, 250])}\n` +
      `       changed pixels per drawn frame: p50 ${quantile(a.frames.map((f) => f.changed), 0.5)}  p95 ${quantile(a.frames.map((f) => f.changed), 0.95)}\n` +
      `       step at the disc centre between picture changes (art px): p50 ${quantile(a.steps, 0.5).toFixed(2)}  max ${Math.max(...a.steps).toFixed(2)}; the limb moves less (x cos of the angle off the centre)`,
  );
};

const browser = await launch();
try {
  /* ---------------------------------------------------------------------------------------------------- start */
  if (run("start")) {
    const { page, logs } = await openSpin(browser);
    const s0 = await state(page);
    expect("the page starts at the unzoomed world view with the rotation enabled and allowed", s0.spin.enabled && s0.spin.blockedBy === null && Math.abs(s0.zoom - s0.minZoom) < 1e-6 && s0.spin.idleMs === IDLE, s0);
    // the start-up frames (reveal, first box transitions) are over; restart the clock with an input, then count over most of the delay: nothing may draw
    await quiet(page);
    await installProbe(page);
    await page.mouse.move(700, 400);
    await page.mouse.move(710, 410);
    await probeOn(page, true);
    const a = await state(page);
    await sleep(IDLE - 500);
    const b = await state(page);
    expect("before the idle delay: zero frames and zero rAF calls, not turning", b.frames === a.frames && b.raf === a.raf && !b.spin.spinning, { a, b });
    const took = await untilSpinning(page, IDLE + 2000);
    const t1spin = (await state(page)).spin;
    expect(`it starts after the delay (${took === null ? "never" : Math.round(took + IDLE - 500)} ms after the last input, delay ${IDLE})`, took !== null && took + IDLE - 500 >= IDLE - 50 && took + IDLE - 500 <= IDLE + 900, took);
    // ease-in: the speed per 500 ms bin from the first frame of the turn follows the smoothstep (the probe reads every drawn frame)
    const easeMs = t1spin.easeInMs;
    const V = t1spin.degPerSec;
    await sleep(easeMs + 1500);
    const rec = await probeFrames(page);
    await probeOn(page, false);
    const T0 = rec[0].t;
    const bins = [];
    for (let k = 0; k * 500 < easeMs + 1000; k++) {
      const fr = rec.filter((f) => f.t >= T0 + k * 500 && f.t <= T0 + (k + 1) * 500);
      if (fr.length < 2) continue;
      const dt = (fr.at(-1).t - fr[0].t) / 1000;
      bins.push({ k, speed: -shortDelta(fr[0].lon, fr.at(-1).lon) / dt, from: fr[0].t - T0, to: fr.at(-1).t - T0 });
    }
    const smooth = (u) => { u = Math.min(1, Math.max(0, u)); return u * u * (3 - 2 * u); };
    const meanExpected = (b) => { let sum = 0; const n = 50; for (let i = 0; i < n; i++) sum += V * smooth((b.from + ((b.to - b.from) * (i + 0.5)) / n) / easeMs); return sum / n; };
    console.log(`     ease-in over ${easeMs} ms to ${V} deg/s, speed per 500 ms: ${bins.map((b) => b.speed.toFixed(2)).join(" ")}`);
    expect("ease-in: starts from rest (the first half second is below a tenth of the cruise speed, no jump)", bins[0].speed >= 0 && bins[0].speed < 0.1 * V, bins[0]);
    expect("ease-in: the speed follows the smoothstep (each 500 ms bin within 8% of the cruise speed of the profile)", bins.every((b) => Math.abs(b.speed - meanExpected(b)) <= 0.08 * V), bins.map((b) => [b.speed, meanExpected(b)]));
    expect("ease-in: monotonic (never slows down on the way up)", bins.every((b, i) => i === 0 || b.speed >= bins[i - 1].speed - 0.05 * V), bins);
    const after = bins.filter((b) => b.from >= easeMs);
    expect(`it cruises at ${V} deg/s once eased in (${after.map((b) => b.speed.toFixed(2)).join(" ")})`, after.length > 0 && after.every((b) => Math.abs(b.speed - V) <= 0.06 * V), after);
    expect("eastward: the view longitude decreases", bins.every((b) => b.speed >= 0), bins);
    const t0 = await state(page);
    await sleep(4000);
    const t1 = await state(page);
    const perSec = shortDelta(t0.lon, t1.lon) / 4;
    expect(`steady turning: ${perSec.toFixed(2)} deg/s eastward (configured ${t1.spin.degPerSec})`, perSec < 0 && Math.abs(Math.abs(perSec) - t1.spin.degPerSec) < 0.05 * t1.spin.degPerSec, { t0, t1 });
    expect("latitude and zoom are untouched", t1.lat === t0.lat && t1.zoom === t0.zoom, { t0, t1 });
    const fps = (t1.frames - t0.frames) / 4;
    const rafPerSec = (t1.raf - t0.raf) / 4;
    console.log(`     redraws: ${fps.toFixed(1)} frames/s, ${rafPerSec.toFixed(1)} rAF calls/s while turning (the display's refresh: 60 here)`);
    expect("redrawn on every display refresh (one frame and one rAF call per refresh, not a timer's few a second)", fps >= 40 && fps <= 125 && rafPerSec >= 40 && rafPerSec <= 125, { fps, rafPerSec });
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


  /* ---------------------------------------------------------------------------------------------------- cadence */
  if (run("cadence")) {
    const { page } = await openSpin(browser);
    await quiet(page);
    await installProbe(page);
    await probeOn(page, true);
    await page.mouse.move(700, 400);
    await page.mouse.move(710, 410);
    const took = await untilSpinning(page, IDLE + 3000);
    expect("it starts", took !== null, took);
    const info = await page.evaluate(() => ({ spin: window.__globeDebug.spin(), inset: window.__globeDebug.inset(), view: window.__globeDebug.view() }));
    const easeMs = info.spin.easeInMs ?? 0;
    await sleep(easeMs + 800);
    await probeOn(page, true); // clear: the steady state only
    await sleep(8000);
    const frames = await probeFrames(page);
    const a = analyse(frames, info.inset.pixel, info.view.zoom);
    console.log(`     art pixel ${info.inset.pixel} css px, radius ${a.R.toFixed(0)} css px, speed ${info.spin.degPerSec} deg/s = ${((info.spin.degPerSec * Math.PI / 180 * a.R) / info.inset.pixel).toFixed(1)} art px/s at the centre`);
    report("steady turning", a, 8);
    // Before: a redraw every 227 ms (one art pixel at 1.2 deg/s), the globe advancing in whole-pixel steps about 4 a second.
    const longest = Math.max(...a.gaps);
    expect(`no step longer than 80 ms between two pictures (longest ${longest.toFixed(0)} ms)`, a.gaps.length > 100 && longest <= 80, { longest, n: a.gaps.length });
    expect(`the picture changes at least 25 times a second (${(a.shown.length / 8).toFixed(1)}/s)`, a.shown.length / 8 >= 25, a.shown.length);
    expect(`every drawn frame changes the picture (the redraws are not wasted: ${a.shown.length} of ${a.frames.length})`, a.shown.length >= 0.95 * a.frames.length, { shown: a.shown.length, frames: a.frames.length });
    expect("the disc's centre moves at least one art pixel per 70 ms", (1000 * info.inset.pixel) / (info.spin.degPerSec * (Math.PI / 180) * a.R) <= 70, info);
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
    // a place picked while turning: it coasts to rest and does not come back (a place is selected)
    const slug = await page.evaluate(() => window.__globeDebug.tree().find((n) => n.kind === "place")?.slug);
    if (!slug) console.log("     (no place in this content: the selection case is skipped)");
    else {
      await sleep(1500); // eased in a little: the stop starts from a speed above zero
      await page.evaluate((s) => window.__handoverDebug.select(s), slug);
      await sleep(100);
      const sel = await state(page);
      expect("selecting a place is not an input: it coasts (phase stopping) and the reason is shown", sel.spin.phase === "stopping" && sel.spin.blockedBy === "place-selected", sel);
      await sleep(SPIN_STOP + 600);
      const done = await state(page);
      expect("...and it has stopped for good", !done.spin.spinning && done.spin.blockedBy === "place-selected", done);
    }
    await page.context().close();
  }

  /* ---------------------------------------------------------------------------------------------------- coast */
  if (run("coast")) {
    // a place focused in the list is not an input: the turning globe coasts to rest (inertia) instead of freezing
    for (const easedFor of [1800, 5000]) {
      const { page } = await openSpin(browser);
      const has = await page.evaluate(() => !!document.querySelector("[data-place-link]"));
      if (!has) console.log("     (no place link: the coasting case is skipped)");
      else {
        await installProbe(page);
        await probeOn(page, true);
        const took = await untilSpinning(page, IDLE + 3000);
        if (took === null) expect("it was turning", false, null);
        await sleep(easedFor); // 1800 ms: in the middle of the ease-in; 5000: cruising
        const before = await state(page);
        await probeOn(page, true);
        await page.focus("[data-place-link]");
        await sleep(SPIN_STOP + 600);
        const rec = await probeFrames(page);
        const end = await state(page);
        // the stop begins at the frame with the highest speed (the focus arrives somewhere in the middle of the ease-in at 1800 ms)
        const all = rec.filter((f) => f.speed !== null);
        const peak = all.reduce((best, f, i) => (f.speed >= all[best].speed ? i : best), 0);
        const coast = all.slice(peak);
        const speeds = coast.map((f) => f.speed);
        const v0 = speeds[0];
        const moved = -shortDelta(coast[0].lon, end.lon);
        const bound = (v0 * SPIN_STOP) / 3000;
        const zero = coast.findIndex((f) => f.speed === 0);
        console.log(`     (${easedFor} ms in) coasting from ${v0.toFixed(2)} deg/s: ${coast.length} frames, turned ${moved.toFixed(3)} deg afterwards (the profile's integral is ${bound.toFixed(3)}), stopped after ${zero >= 0 ? Math.round(coast[zero].t - coast[0].t) : "?"} ms`);
        expect(`(${easedFor} ms in) a focus change makes it coast: the speed only goes down from the first frame, to exactly zero`, speeds.length > 20 && speeds.every((v, i) => i === 0 || v <= speeds[i - 1]) && speeds[1] < speeds[0] && speeds.at(-1) === 0, { v0, speeds: speeds.slice(0, 5), end: speeds.slice(-3) });
        expect(`(${easedFor} ms in) ...it keeps turning by about the profile's integral (inertia, no freeze) and not more`, Math.abs(moved - bound) <= 0.1 * bound + 0.05, { moved, bound, v0 });
        expect(`(${easedFor} ms in) ...it has stopped within the coasting time, blocked by the focus, drawing nothing more`, !end.spin.spinning && end.spin.blockedBy === "place-focused", end);
        const f0 = end.frames;
        await sleep(1500);
        const rest = await state(page);
        expect(`(${easedFor} ms in) ...and then zero frames`, rest.frames === f0 && rest.lon === end.lon, { end, rest });
      }
      await page.context().close();
    }
    // a place selected while turning: the flight lands exactly where it lands without the rotation
    {
      const control = await openSpin(browser, DESKTOP, "/?globe-debug&no-street&no-rotate");
      const slug = await control.page.evaluate(() => window.__globeDebug.tree().find((n) => n.kind === "place")?.slug);
      if (!slug) console.log("     (no place in this content: the flight case is skipped)");
      else {
        await control.page.evaluate((s) => window.__handoverDebug.select(s), slug);
        await sleep(7000);
        const target = await state(control.page);
        const { page } = await openSpin(browser);
        const took = await untilSpinning(page, IDLE + 3000);
        if (took === null) expect("it was turning", false, null);
        await sleep(5000);
        await page.evaluate((s) => window.__handoverDebug.select(s), slug);
        await sleep(7000);
        const landed = await state(page);
        expect(`a selection flight started while turning lands on the same view as without the rotation (lon ${landed.lon.toFixed(6)} / ${target.lon.toFixed(6)}, lat ${landed.lat.toFixed(6)} / ${target.lat.toFixed(6)})`, Math.abs(shortDelta(landed.lon, target.lon)) < 1e-6 && Math.abs(landed.lat - target.lat) < 1e-6 && Math.abs(landed.zoom - target.zoom) < 1e-6, { landed, target });
        expect("...and it stays off", !landed.spin.spinning && landed.spin.blockedBy === "place-selected", landed);
        await page.context().close();
      }
      await control.page.context().close();
    }
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
