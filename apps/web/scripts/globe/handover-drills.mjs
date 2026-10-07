// Behaviour drills for the globe <-> street handover (Playwright, headless Chrome). Prints a JSON report, exit 1 on a
// failed expectation.
//
//   BASE_URL=http://localhost:5175 node apps/web/scripts/globe/handover-drills.mjs [name ...]
//
// Needs the app served with CATALYST_TILES_FALLBACK_URL=http://127.0.0.1:5240/places.pmtiles (the script starts the
// local PMTiles server on that port) and OpenFreeMap reachable for the `auto` drills (small amounts of tile loading).
// (A direct load frames the whole city: unified zoom about 10.3 for Ho Chi Minh City, hence the 9.5 thresholds.)
// Drills: direct, wheel, click, failover, capped, recover, reduced, keyboard, mobile-slideover.
import { APP, DESKTOP, MOBILE, ensureTiles, launch, openApp, settleApp, state, waitStreetOk } from "./handover-lib.mjs";

const OFM = /tiles\.openfreemap\.org/;
const only = process.argv.slice(2);
const results = [];
const failures = [];
const expect = (name, ok, detail) => {
  results.push({ name, ok, detail });
  if (!ok) failures.push(`${name}: ${JSON.stringify(detail)}`);
};
const noErrors = (name, logs) => expect(`${name}: no page errors`, !logs.some((l) => l.startsWith("pageerror") || /Uncaught/.test(l)), logs.slice(0, 5));
const FAST = { timings: { recoveryBaseMs: 1500, confirmDelayMs: 400, downMemoryMs: 500 } };
/** Activate a place link the way the list does (the list is visually hidden until focused). */
const openPlace = (page, slug) => page.locator(`[data-place-link="${slug}"]`).evaluate((a) => a.click());
const run = (name) => only.length === 0 || only.includes(name);

const tiles = await ensureTiles();
const browser = await launch();
try {
  // --- direct load on a place: globe at the place first, then street scale ---------------------------------------------
  if (run("direct")) {
    const { page, logs } = await openApp(browser, DESKTOP, { path: "/locations/ho-chi-minh-city" });
    const first = await state(page);
    expect("direct: starts framed on the city, drawn by the globe until the street map has its tiles", first.zoom > 9.5 && first.blend.shown === 0, first);
    await page.waitForFunction(() => window.__handoverDebug.zoom() > 9.5, null, { timeout: 30000 });
    await settleApp(page);
    const end = await state(page);
    expect("direct: ends at street scale, street drawn alone", end.blend.shown === 1 && end.suspended && end.owner === "street" && end.mapZoom > 9.5, end);
    expect("direct: place is selected and panel open", await page.evaluate(() => !!document.querySelector('[data-place-link][aria-current="page"]')), null);
    noErrors("direct", logs);
    await page.context().close();
  }

  // --- wheel through the threshold, then back out ---------------------------------------------------------------------
  if (run("wheel")) {
    const { page, logs } = await openApp(browser, DESKTOP, { path: "/" });
    await page.evaluate(() => window.__handoverDebug.globe.setView({ lon: 106.7, lat: 10.8, zoom: 3.8 }));
    await page.mouse.move(720, 450);
    const zooms = [];
    for (let i = 0; i < 90; i++) {
      await page.mouse.wheel(0, -50);
      await page.waitForTimeout(16);
      zooms.push(await page.evaluate(() => window.__handoverDebug.zoom()));
    }
    await waitStreetOk(page);
    for (let i = 0; i < 60; i++) {
      await page.mouse.wheel(0, -50);
      await page.waitForTimeout(16);
    }
    await settleApp(page);
    const up = await state(page);
    expect("wheel: continuous zoom past the threshold into street scale", up.blend.shown === 1 && up.zoom > 7, up);
    let maxStep = 0;
    for (let i = 1; i < zooms.length; i++) maxStep = Math.max(maxStep, Math.abs(zooms[i] - zooms[i - 1]));
    expect("wheel: no zoom jump", maxStep < 0.2, { maxStep });
    for (let i = 0; i < 160; i++) {
      await page.mouse.wheel(0, 60);
      await page.waitForTimeout(16);
    }
    await settleApp(page);
    const down = await state(page);
    expect("wheel: back out to the world, street hidden, three drawing", down.blend.shown === 0 && !down.suspended && down.owner === "globe", down);
    noErrors("wheel", logs);
    await page.context().close();
  }

  // --- click a marker / label at street scale selects it -------------------------------------------------------------------
  if (run("click")) {
    const { page, logs } = await openApp(browser, DESKTOP, { path: "/" });
    await page.evaluate(() => window.__handoverDebug.globe.setView({ lon: 105.85, lat: 21.03, zoom: 6.3 }));
    await waitStreetOk(page);
    await page.evaluate(() => window.__handoverDebug.globe.setView({ lon: 105.85, lat: 21.03, zoom: 8 }));
    await settleApp(page);
    const at = await page.evaluate(() => window.__handoverDebug.street().debug().project("hanoi"));
    expect("click: the street overlay shows Hanoi", !!at, at);
    // a place is a detection box: it is picked by its border band (or its label), never its interior (the boxes inside stay clickable)
    const box = await page.evaluate(() => window.__handoverDebug.street().debug().lod().find((n) => n.slug === "hanoi" && n.shown)?.box ?? null);
    if (at && box) {
      await page.mouse.click(box.x0, (box.y0 + box.y1) / 2);
      await page.waitForURL(/\/locations\/hanoi$/, { timeout: 5000 }).catch(() => {});
      expect("click: selects the place from the street overlay", new URL(page.url()).pathname === "/locations/hanoi", page.url());
    }
    noErrors("click", logs);
    await page.context().close();
  }

  // --- failover while the handover is running ----------------------------------------------------------------------------------
  if (run("failover")) {
    const { page, logs } = await openApp(browser, DESKTOP, { path: "/", street: FAST });
    let primaryDead = false;
    await page.route(OFM, (r) => (primaryDead ? r.abort("failed") : r.continue()));
    await page.evaluate(() => window.__handoverDebug.globe.setView({ lon: 106.7, lat: 10.8, zoom: 4.2 }));
    await waitStreetOk(page);
    // fly down into the city and kill the primary half way through the dissolve
    await openPlace(page, "ho-chi-minh-city");
    await page.waitForFunction(() => window.__handoverDebug.zoom() > 5, null, { timeout: 30000 });
    primaryDead = true;
    await page.waitForFunction(() => window.__handoverDebug.zoom() > 9.5, null, { timeout: 30000 });
    await page.waitForFunction(() => window.__handoverDebug.tile()?.state === "fallback", null, { timeout: 30000 });
    await settleApp(page);
    const s = await state(page);
    expect("failover: the fallback serves the street view after the primary died mid-flight", s.tile === "fallback" && s.blend.shown === 1 && s.mapZoom > 9.5 && s.owner === "street", s);
    noErrors("failover", logs);
    await page.context().close();
  }

  // --- every source dies while the camera is at street scale: ease back to the regional scale, no jump ------------------------------
  if (run("retreat")) {
    const { page, logs } = await openApp(browser, DESKTOP, { path: "/", street: FAST });
    let blocked = false;
    const FALLBACK = /127\.0\.0\.1:\d+\/places\.pmtiles/;
    await page.route(OFM, (r) => (blocked ? r.abort("failed") : r.continue()));
    await page.route(FALLBACK, (r) => (blocked ? r.abort("failed") : r.continue()));
    await page.evaluate(() => window.__handoverDebug.globe.setView({ lon: 106.7, lat: 10.8, zoom: 4.5 }));
    await waitStreetOk(page);
    await page.evaluate(() => window.__handoverDebug.globe.setView({ lon: 106.7, lat: 10.8, zoom: 12 }));
    await settleApp(page);
    await page.evaluate(() => {
      window.__zt = [];
      const f = () => {
        window.__zt.push(window.__handoverDebug.zoom());
        window.__zraf = requestAnimationFrame(f);
      };
      f();
    });
    blocked = true;
    // new tiles are needed to notice: pan
    await page.evaluate(() => window.__handoverDebug.globe.setView({ lon: 106.9, lat: 10.95, zoom: 12.3 }));
    await page.waitForFunction(() => window.__handoverDebug.tile()?.state === "capped", null, { timeout: 40000 });
    await page.waitForFunction(() => window.__handoverDebug.limit() === 6.5 && !window.__handoverDebug.globe.isAnimating(), null, { timeout: 20000 });
    const zt = await page.evaluate(() => window.__zt);
    let maxJump = 0;
    for (let i = 1; i < zt.length; i++) maxJump = Math.max(maxJump, Math.abs(zt[i] - zt[i - 1]));
    const s = await state(page);
    expect("retreat: camera eased back to the regional scale", s.zoom <= 6.5 + 1e-6, s);
    expect("retreat: no zoom jump (largest per-frame step)", maxJump < 0.35, { maxJump });
    expect("retreat: three draws again, street hidden", !s.suspended && s.blend.shown === 0, s);
    noErrors("retreat", logs);
    await page.context().close();
  }

  // --- capped from the start: the world globe is the floor, a notice says so; then recovery -----------------------------------
  if (run("capped") || run("recover")) {
    const { page, logs } = await openApp(browser, DESKTOP, { path: "/", street: { ...FAST } });
    let blocked = true;
    const FALLBACK = /127\.0\.0\.1:\d+\/places\.pmtiles/;
    await page.route(OFM, (r) => (blocked ? r.abort("failed") : r.continue()));
    await page.route(FALLBACK, (r) => (blocked ? r.abort("failed") : r.continue()));
    // the debug option pins nothing here: the real chain runs, both sources blocked
    await page.reload();
    await page.waitForFunction(() => window.__handoverDebug);
    await page.evaluate(() => window.__handoverDebug.globe.setView({ lon: 106.7, lat: 10.8, zoom: 4.5 }));
    await page.waitForFunction(() => window.__handoverDebug.tile()?.state === "capped", null, { timeout: 30000 });
    await page.mouse.move(720, 450);
    for (let i = 0; i < 120; i++) {
      await page.mouse.wheel(0, -60);
      await page.waitForTimeout(16);
    }
    await settleApp(page);
    const s = await state(page);
    expect("capped: zoom stops at the globe's regional maximum", s.zoom <= 6.5 + 1e-6 && s.limit === 6.5, s);
    expect("capped: three still draws, street hidden", s.blend.shown === 0 && !s.suspended, s);
    const note = await page.evaluate(() => document.querySelector('[data-globe="three"] p[role="status"]')?.textContent ?? "");
    expect("capped: unobtrusive notice shown", /unavailable/i.test(note), note);
    noErrors("capped", logs);
    if (run("recover")) {
      blocked = false;
      await page.waitForFunction(() => ["primary", "fallback"].includes(window.__handoverDebug.tile()?.state ?? ""), null, { timeout: 40000 });
      const r = await state(page);
      expect("recover: limit lifted when tiles come back", r.limit === Infinity, r);
      const note2 = await page.evaluate(() => document.querySelector('[data-globe="three"] p[role="status"]')?.textContent ?? "");
      expect("recover: notice gone", note2 === "", note2);
    }
    await page.context().close();
  }

  // --- reduced motion: jump, no dissolve animation, static ------------------------------------------------------------------
  if (run("reduced")) {
    const { page, logs } = await openApp(browser, DESKTOP, { path: "/locations/ho-chi-minh-city", reducedMotion: "reduce" });
    await page.waitForFunction(() => window.__handoverDebug.zoom() > 9.5, null, { timeout: 30000 });
    await settleApp(page);
    const s = await state(page);
    expect("reduced: arrives at street scale, street alone", s.blend.shown === 1 && s.mapZoom > 9.5, s);
    const ticks0 = await page.evaluate(() => window.__handoverDebug.ticks());
    await page.waitForTimeout(1500);
    expect("reduced: idle, no ticks", (await page.evaluate(() => window.__handoverDebug.ticks())) === ticks0, null);
    expect("reduced: no focus circle", !(await page.evaluate(() => window.__handoverDebug.revealOpen())), null);
    noErrors("reduced", logs);
    await page.context().close();
  }

  // --- keyboard: the list reaches the street view; focus is never lost -------------------------------------------------------
  if (run("keyboard")) {
    const { page, logs } = await openApp(browser, DESKTOP, { path: "/" });
    await page.keyboard.press("Tab");
    const links = await page.evaluate(() => [...document.querySelectorAll("[data-place-link]")].map((a) => a.getAttribute("data-place-link")));
    await page.focus('[data-place-link="ho-chi-minh-city"]');
    await page.keyboard.press("Enter");
    await page.waitForURL(/ho-chi-minh-city$/);
    const focusedAt = [];
    for (let i = 0; i < 40; i++) {
      focusedAt.push(await page.evaluate(() => document.activeElement?.tagName + "." + (document.activeElement?.id || document.activeElement?.getAttribute("data-place-link") || "")));
      await page.waitForTimeout(150);
    }
    expect("keyboard: focus stays on a real element through the flight", !focusedAt.some((f) => f.startsWith("BODY")), [...new Set(focusedAt)]);
    await page.waitForFunction(() => window.__handoverDebug.zoom() > 9.5, null, { timeout: 30000 });
    expect("keyboard: the list opens the street view", links.includes("ho-chi-minh-city"), links);
    noErrors("keyboard", logs);
    await page.context().close();
  }

  // --- phones: the detail slide-over unmounts everything and the view comes back identical ---------------------------------------
  if (run("mobile-slideover")) {
    const { page, logs } = await openApp(browser, MOBILE, { path: "/" });
    await page.evaluate(() => window.__handoverDebug.globe.setView({ lon: 106.7, lat: 10.8, zoom: 7 }));
    await waitStreetOk(page);
    await page.evaluate(() => window.__handoverDebug.globe.setView({ lon: 106.7, lat: 10.8, zoom: 9 }));
    await settleApp(page);
    const before = await page.evaluate(() => window.__handoverDebug.globe.view());
    const live0 = await page.evaluate(() => window.__gl.live.size);
    await openPlace(page, "hanoi");
    await page.waitForURL(/hanoi$/);
    await page.waitForFunction(() => !window.__handoverDebug, null, { timeout: 10000 });
    await page.waitForTimeout(600);
    expect("mobile: slide-over releases every WebGL context", (await page.evaluate(() => window.__gl.live.size)) === 0, await page.evaluate(() => window.__gl.live.size));
    await page.goBack();
    await page.waitForFunction(() => window.__handoverDebug, null, { timeout: 20000 });
    await page.waitForFunction(() => window.__handoverDebug.streetState() === "ready", null, { timeout: 30000 });
    await settleApp(page);
    const after = await page.evaluate(() => window.__handoverDebug.globe.view());
    expect("mobile: view restored identically at street scale", Math.abs(after.lon - before.lon) < 1e-6 && Math.abs(after.zoom - before.zoom) < 1e-6, { before, after });
    noErrors("mobile", logs);
    await page.context().close();
  }
} finally {
  await browser.close();
  await tiles.stop();
}
console.log(`app ${APP}`);
for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name}${r.ok ? "" : " " + JSON.stringify(r.detail)}`);
if (failures.length) {
  console.error("FAILED:\n" + failures.join("\n"));
  process.exit(1);
}
