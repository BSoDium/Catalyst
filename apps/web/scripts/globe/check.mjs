// Behaviour checks against the production build. Prints one JSON object; screenshots go to OUT_DIR.
//   CHROME_PATH=... BASE_URL=http://localhost:5174 OUT_DIR=/tmp/shots node apps/web/scripts/globe/check.mjs
import { launch, open, waitGlobe, BASE_URL, DESKTOP, MOBILE, OUT_DIR, sleep } from "./_lib.mjs";

const b = await launch();
const out = {};
const dbg = (page, fn, ...args) => page.evaluate(([src, a]) => new Function("d", "...a", `return (${src})(d, ...a)`)(window.__globeDebug, ...a), [fn.toString(), args]);
const view = (page) => dbg(page, (d) => d.view());
const counters = (page) => page.evaluate(() => ({ raf: window.__raf.calls, clears: window.__clears ?? 0 }));
// The places list is visually hidden until focused, so links are activated like a keyboard user does.
const openPlace = async (page, slug) => {
  await page.focus(`[data-place-link="${slug}"]`);
  await page.keyboard.press("Enter");
};
const round = (v) => ({ lon: +v.lon.toFixed(2), lat: +v.lat.toFixed(2), zoom: +v.zoom.toFixed(2) });

/* 1. render, demo places, labels, console clean, SSR markup */
{
  const { page, logs } = await open(b, DESKTOP);
  await waitGlobe(page);
  await sleep(500);
  out.render = await page.evaluate(() => ({
    root: document.querySelector("[data-globe]")?.getAttribute("data-globe"),
    state: document.querySelector("[data-globe]")?.getAttribute("data-state"),
    canvases: document.querySelectorAll("canvas").length,
    canvasBuffer: [document.querySelector("canvas").width, document.querySelector("canvas").height],
    canvasCss: [document.querySelector("canvas").style.width, document.querySelector("canvas").style.height],
    canvasAriaHidden: document.querySelector("canvas").getAttribute("aria-hidden"),
    labelsRootAriaHidden: document.querySelector("[data-globe] > div:nth-child(2)").getAttribute("aria-hidden"),
    focusableInGlobe: document.querySelectorAll("[data-globe] [tabindex], [data-globe] button, [data-globe] a").length,
  }));
  out.render.labelsShown = await dbg(page, (d) => d.labelsShown());
  out.render.logs = logs;
  await page.screenshot({ path: `${OUT_DIR}/g-overview.png` });
  await page.close();
}

/* 2. click-select, 3. list focus highlight, 4. rotate-to-place */
{
  const { page, logs } = await open(b, DESKTOP);
  await waitGlobe(page);
  await dbg(page, (d) => d.setView({ lon: 2.35, lat: 48.86, zoom: 4 }));
  await sleep(300);
  const xy = await dbg(page, (d) => d.project("paris"));
  await page.mouse.move(xy.x + 1, xy.y + 1);
  out.hoverCursor = await page.evaluate(() => document.querySelector("canvas").style.cursor);
  await page.mouse.click(xy.x + 2, xy.y + 2);
  await page.waitForURL("**/locations/paris", { timeout: 5000 });
  await sleep(900);
  out.clickSelect = {
    url: page.url(),
    panelHeading: await page.evaluate(() => document.querySelector("#panel-heading")?.textContent),
    view: round(await view(page)),
    labelsShown: await dbg(page, (d) => d.labelsShown()),
  };
  await page.screenshot({ path: `${OUT_DIR}/g-selected-paris.png` });

  // focus highlight: hover a low-priority list item, its label must be forced on even at low zoom
  await page.goto(page.url().replace("/locations/paris", "/"));
  await waitGlobe(page);
  const before = await dbg(page, (d) => d.labelsShown());
  await page.focus('[data-place-link="reykjavik"]');
  await sleep(200);
  const during = await dbg(page, (d) => d.labelsShown());
  await page.evaluate(() => document.activeElement.blur());
  await sleep(200);
  out.listFocus = { before, whileFocused: during, after: await dbg(page, (d) => d.labelsShown()) };
  // rotate to place via the list (keyboard)
  await openPlace(page, "kyoto");
  await page.waitForURL("**/locations/kyoto");
  const v0 = round(await view(page));
  await sleep(2200);
  const v1 = round(await view(page));
  out.rotateToPlace = { start: v0, end: v1, target: { lon: 135.77, lat: 35.01 }, frames: await dbg(page, (d) => d.frames()) };
  await page.screenshot({ path: `${OUT_DIR}/g-kyoto.png` });
  // clicking Hanoi in the list: the route animates, then rests
  await openPlace(page, "hanoi");
  await sleep(300);
  out.routeAnim = { animatingDuring: await dbg(page, (d) => d.isAnimating()) };
  await sleep(4500);
  out.routeAnim.animatingAfter = await dbg(page, (d) => d.isAnimating());
  await page.screenshot({ path: `${OUT_DIR}/g-hanoi-route.png` });
  out.logsA = logs;
  await page.close();
}

/* 5. far side markers: not visible, not pickable */
{
  const { page } = await open(b, DESKTOP);
  await waitGlobe(page);
  await dbg(page, (d) => d.setView({ lon: 100, lat: 10, zoom: 2.5 }));
  await sleep(300);
  const rows = await page.evaluate(() => {
    const d = window.__globeDebug;
    return ["lisbon", "reykjavik", "kyoto", "cusco", "cape-town", "vancouver", "wellington", "hanoi", "ho-chi-minh-city", "hue", "paris"].map((s) => ({ s, ...d.project(s) }));
  });
  const far = rows.filter((r) => !r.visible);
  const picks = [];
  for (const r of far) {
    await page.mouse.click(r.x, r.y);
    await sleep(150);
    picks.push({ slug: r.s, urlAfterClick: new URL(page.url()).pathname });
  }
  out.farSide = { visible: rows.filter((r) => r.visible).map((r) => r.s), hidden: far.map((r) => r.s), picks, labelsShown: await dbg(page, (d) => d.labelsShown()) };
  await page.close();
}

/* 6. borders zoom, 7. label collision */
{
  const { page } = await open(b, DESKTOP);
  await waitGlobe(page);
  await dbg(page, (d) => d.setView({ lon: 10, lat: 48, zoom: 2.6 }));
  await sleep(300);
  await page.screenshot({ path: `${OUT_DIR}/g-europe-z26.png` });
  await dbg(page, (d) => d.setView({ lon: 10, lat: 48, zoom: 3.6 }));
  await sleep(300);
  await page.screenshot({ path: `${OUT_DIR}/g-europe-z36.png` });
  await dbg(page, (d) => d.setView({ lon: 107, lat: 16, zoom: 3.0 }));
  await sleep(300);
  out.vietnamZ3 = await dbg(page, (d) => d.labelsShown());
  await page.screenshot({ path: `${OUT_DIR}/g-vietnam-z3.png` });
  await dbg(page, (d) => d.setView({ lon: 107, lat: 16, zoom: 2.2 }));
  await sleep(300);
  out.vietnamZ22 = await dbg(page, (d) => d.labelsShown());
  await dbg(page, (d) => d.setView({ lon: 107, lat: 16, zoom: 5 }));
  await sleep(300);
  out.vietnamZ5 = await dbg(page, (d) => d.labelsShown());
  await page.screenshot({ path: `${OUT_DIR}/g-vietnam-z5.png` });
  await page.close();
}

/* 8. wheel and drag: bounded zoom, view reporting, inertia stops */
{
  const { page } = await open(b, DESKTOP);
  await waitGlobe(page);
  const minZ = await dbg(page, (d) => d.minZoom());
  await page.mouse.move(900, 450);
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, 300);
  await sleep(300);
  const zOut = (await view(page)).zoom;
  for (let i = 0; i < 100; i++) await page.mouse.wheel(0, -300);
  await sleep(300);
  const zIn = (await view(page)).zoom;
  // drag with fling then verify it comes to rest (no rAF afterwards)
  await dbg(page, (d) => d.setView({ lon: 0, lat: 20, zoom: 3 }));
  await sleep(200);
  const v0 = await view(page);
  await page.mouse.move(900, 450);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(900 + i * 25, 450 + i * 4); await sleep(12); }
  await page.mouse.up();
  const animatingAfterFling = await dbg(page, (d) => d.isAnimating());
  await sleep(2500);
  const v1 = await view(page);
  const c0 = await counters(page);
  await sleep(1500);
  const c1 = await counters(page);
  out.zoomDrag = { minZoom: minZ, afterWheelOut: zOut, afterWheelIn: zIn, maxZoom: await dbg(page, (d) => d.maxZoom()), dragFrom: round(v0), dragTo: round(v1), animatingAfterFling, restedRaf: c1.raf - c0.raf, restedClears: c1.clears - c0.clears };
  await page.close();
}

/* 9. idle = zero frames */
{
  const { page } = await open(b, DESKTOP);
  await waitGlobe(page);
  await sleep(1500);
  const c0 = await counters(page);
  const f0 = await dbg(page, (d) => d.frames());
  await sleep(4000);
  const c1 = await counters(page);
  const f1 = await dbg(page, (d) => d.frames());
  out.idle = { ms: 4000, rafCalls: c1.raf - c0.raf, glClears: c1.clears - c0.clears, framesRendered: f1 - f0, isAnimating: await dbg(page, (d) => d.isAnimating()) };
  // idle while a label-hover moves the cursor over the page: still zero
  await page.mouse.move(1000, 500);
  await page.mouse.move(1010, 510);
  await sleep(500);
  const c2 = await counters(page);
  out.idle.afterPointerMoveRaf = c2.raf - c1.raf;
  await page.close();
}

/* 10. reduced motion */
{
  const { page, logs } = await open(b, { ...DESKTOP, reducedMotion: "reduce" });
  await waitGlobe(page);
  const t0 = Date.now();
  await openPlace(page, "hanoi");
  await page.waitForURL("**/locations/hanoi");
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const v = round(await view(page));
  out.reducedMotion = { viewAfter2Frames: v, target: { lon: 105.85, lat: 21.03 }, animating: await dbg(page, (d) => d.isAnimating()), msToSettle: Date.now() - t0 };
  await sleep(400);
  const c0 = await counters(page);
  await sleep(2500);
  const c1 = await counters(page);
  out.reducedMotion.rafOver2_5s = c1.raf - c0.raf;
  await page.screenshot({ path: `${OUT_DIR}/g-reduced-route.png` });
  out.reducedMotion.logs = logs;
  await page.close();
}

/* 11. context loss and restore */
{
  const { page, logs } = await open(b, DESKTOP);
  await waitGlobe(page);
  await dbg(page, (d) => d.setView({ lon: 30, lat: 25, zoom: 3.4 }));
  await sleep(300);
  await dbg(page, (d) => d.loseContext(true));
  await sleep(500);
  const lost = await page.evaluate(() => ({ state: document.querySelector("[data-globe]").dataset.state, status: document.querySelector('[role="status"]')?.textContent?.slice(0, 40) }));
  const c0 = await counters(page);
  await dbg(page, (d) => d.setView({ lon: 40, lat: 25, zoom: 3.4 }));
  await sleep(300);
  const c1 = await counters(page);
  await dbg(page, (d) => d.loseContext(false));
  await sleep(800);
  const restored = await page.evaluate(() => ({ state: document.querySelector("[data-globe]").dataset.state, status: document.querySelector('[role="status"]')?.textContent ?? null, restoredEvents: window.__gl.lastRestored }));
  await page.screenshot({ path: `${OUT_DIR}/g-after-restore.png` });
  out.contextLoss = { lost, rafWhileLost: c1.raf - c0.raf, restored, view: round(await view(page)), logs };
  await page.close();
}

/* 12. visibilitychange: nothing scheduled while hidden, repaint when shown */
{
  const { page } = await open(b, DESKTOP);
  await waitGlobe(page);
  await sleep(300);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const c0 = await counters(page);
  const f0 = await dbg(page, (d) => d.frames());
  await dbg(page, (d) => d.setView({ lon: 50, lat: 10, zoom: 3 }));
  await sleep(600);
  const c1 = await counters(page);
  const hiddenFrames = (await dbg(page, (d) => d.frames())) - f0;
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await sleep(300);
  out.visibility = { rafWhileHidden: c1.raf - c0.raf, framesWhileHidden: hiddenFrames, framesAfterShown: (await dbg(page, (d) => d.frames())) - f0 };
  await page.close();
}

/* 13. devicePixelRatio change */
{
  const { page, ctx } = await open(b, DESKTOP);
  await waitGlobe(page);
  const read = () => page.evaluate(() => ({ dpr: devicePixelRatio, buf: [document.querySelector("canvas").width, document.querySelector("canvas").height], css: document.querySelector("canvas").style.width, pixel: +(parseFloat(document.querySelector("canvas").style.width) / document.querySelector("canvas").width).toFixed(3) }));
  const a = await read();
  const cdp = await ctx.newCDPSession(page);
  // The emulation does not raise the `resolution` media-query event (covered by a unit test with a fake
  // matchMedia), so change the CSS size too: the ResizeObserver path then reads the new devicePixelRatio.
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1.25, mobile: false });
  await sleep(700);
  out.dprChange = { before: a, after: await read(), frames: await dbg(page, (d) => d.frames()) };
  await page.close();
}

/* 14. no WebGL: calm fallback, list still works */
{
  const ctx = await b.newContext(DESKTOP);
  const page = await ctx.newPage();
  const logs = [];
  page.on("console", (m) => ["error", "warning"].includes(m.type()) && logs.push(`${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...r) {
      return /webgl/.test(type) ? null : orig.call(this, type, ...r);
    };
  });
  await page.goto(`${(await import("./_lib.mjs")).BASE_URL}/`);
  await page.waitForFunction(() => document.querySelector('[data-globe="three"][data-state="unavailable"]'));
  out.noWebGL = {
    message: await page.evaluate(() => document.querySelector('[data-globe] [role="status"]')?.textContent),
    canvases: await page.evaluate(() => document.querySelectorAll("canvas").length),
    listLinks: await page.evaluate(() => document.querySelectorAll("[data-place-link]").length),
    logs,
  };
  out.noWebGL.listVisible = await page.evaluate(() => document.querySelector("nav[aria-label=Places]").getBoundingClientRect().width);
  await openPlace(page, "lisbon");
  await page.waitForURL("**/locations/lisbon");
  out.noWebGL.listNavigates = true;
  await page.screenshot({ path: `${OUT_DIR}/g-no-webgl.png` });
  await page.close();
}

/* 15. panel inset: centre shift, picking, labels, fit, animation, direct load, reduced motion */
{
  const { page, logs } = await open(b, DESKTOP, "/locations/kyoto");
  await waitGlobe(page);
  await sleep(900);
  const info = await dbg(page, (d) => ({ inset: d.inset(), minZoom: d.minZoom(), kyoto: d.project("kyoto"), view: d.view() }));
  // free area = left half (720 css px): the selected place sits at its centre, vertically centred
  out.panelDirectLoad = { inset: info.inset, kyotoXY: [Math.round(info.kyoto.x), Math.round(info.kyoto.y)], expectedX: 360, expectedY: 450, minZoom: +info.minZoom.toFixed(3) };
  // click the marker where it is drawn (picking uses the shifted centre)
  await page.goto(`${BASE_URL}/`);
  await waitGlobe(page);
  const fullMin = await dbg(page, (d) => d.minZoom());
  out.panelDirectLoad.minZoomNoPanel = +fullMin.toFixed(3);
  // open via list: inset animates 0 -> 720 over ~360 ms, in step with the panel; sample mid-way
  await openPlace(page, "kyoto");
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 700) {
    samples.push({ t: Date.now() - t0, inset: Math.round((await dbg(page, (d) => d.inset())).inset), panelLeft: await page.evaluate(() => Math.round(document.querySelector("[data-panel]")?.getBoundingClientRect().left ?? -1)) });
    await sleep(40);
  }
  out.panelAnim = { samples: samples.filter((_, i) => i % 2 === 0), final: samples.at(-1) };
  await sleep(2200);
  const opened = await dbg(page, (d) => ({ k: d.project("kyoto"), minZoom: d.minZoom(), inset: d.inset() }));
  out.panelOpenAfterFlight = { kyotoXY: [Math.round(opened.k.x), Math.round(opened.k.y)], minZoom: +opened.minZoom.toFixed(3), bufW: opened.inset.bufW };
  // picking at the shifted position
  await page.mouse.click(opened.k.x, opened.k.y);
  out.panelPick = { url: new URL(page.url()).pathname };
  // idle with the panel open: no frames
  const c0 = await counters(page);
  await sleep(2500);
  out.panelIdleRaf = (await counters(page)).raf - c0.raf;
  // close: inset back to 0 and the place returns to the middle
  await page.keyboard.press("Escape");
  await sleep(900);
  const closed = await dbg(page, (d) => ({ k: d.project("kyoto"), inset: d.inset() }));
  out.panelClosed = { kyotoXY: [Math.round(closed.k.x), Math.round(closed.k.y)], inset: closed.inset.inset };
  out.panelLogs = logs;
  await page.close();
}
{
  const { page } = await open(b, { ...DESKTOP, reducedMotion: "reduce" }, "/");
  await waitGlobe(page);
  await openPlace(page, "kyoto");
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const d = await dbg(page, (d) => ({ inset: d.inset(), k: d.project("kyoto") }));
  out.panelReducedMotion = { insetTwoFramesAfterOpen: d.inset.inset, kyotoXY: [Math.round(d.k.x), Math.round(d.k.y)], panelLeft: await page.evaluate(() => Math.round(document.querySelector("[data-panel]").getBoundingClientRect().left)) };
  await page.close();
}

/* 16. ocean = page colour in both schemes: sample the screenshot at the globe centre's ocean and at a corner */
for (const scheme of ["light", "dark"]) {
  const { page } = await open(b, { ...DESKTOP, colorScheme: scheme }, "/");
  await waitGlobe(page);
  await dbg(page, (d) => d.setView({ lon: -30, lat: 10, zoom: 2.6 })); // mid-Atlantic: open ocean in the middle
  await sleep(300);
  const shot = await page.screenshot();
  out[`ocean_${scheme}`] = await page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext("2d");
    ctx.drawImage(bmp, 0, 0);
    const px = (x, y) => [...ctx.getImageData(x * 2, y * 2, 1, 1).data].slice(0, 3);
    const bg = getComputedStyle(document.documentElement).backgroundColor;
    return { cssBackground: bg, pageCorner: px(5, 450), oceanCentre: px(720, 450), oceanInDisc: px(700, 300) };
  }, shot.toString("base64"));
  await page.close();
}

console.log(JSON.stringify(out, null, 1));
await b.close();
