// Mobile (390x844 @3x, touch; Chrome emulation, NOT a phone GPU): touch gestures, unmount while the slide-over is
// open, restore with the identical view, WebGL context accounting over 20 open/close cycles.
import { launch, open, waitGlobe, MOBILE, OUT_DIR, sleep } from "./_lib.mjs";

const b = await launch();
const out = {};
const dbg = (page, fn, ...args) => page.evaluate(([src, a]) => new Function("d", "...a", `return (${src})(d, ...a)`)(window.__globeDebug, ...a), [fn.toString(), args]);
const round = (v) => ({ lon: +v.lon.toFixed(3), lat: +v.lat.toFixed(3), zoom: +v.zoom.toFixed(3) });
const state = (page) => page.evaluate(() => ({ canvases: document.querySelectorAll("canvas").length, gl: { ...window.__gl }, hasGlobe: !!document.querySelector("[data-globe=three]") }));

const { page, ctx, logs } = await open(b, MOBILE);
await waitGlobe(page);
await sleep(500);
out.init = { ...(await state(page)), view: round(await dbg(page, (d) => d.view())), minZoom: await dbg(page, (d) => d.minZoom()), canvas: await page.evaluate(() => [document.querySelector("canvas").width, document.querySelector("canvas").height]) };
await page.screenshot({ path: `${OUT_DIR}/m-overview.png` });

const cdp = await ctx.newCDPSession(page);
const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map((q, i) => ({ x: q[0], y: q[1], id: i })) });
// one-finger drag
const v0 = round(await dbg(page, (d) => d.view()));
await touch("touchStart", [[200, 400]]);
for (let i = 1; i <= 12; i++) { await touch("touchMove", [[200 - i * 8, 400 + i * 3]]); await sleep(16); }
await touch("touchEnd", []);
await sleep(1500);
out.drag = { from: v0, to: round(await dbg(page, (d) => d.view())) };
// pinch out / in
await touch("touchStart", [[170, 400], [220, 400]]);
for (let i = 1; i <= 15; i++) { await touch("touchMove", [[170 - i * 6, 400], [220 + i * 6, 400]]); await sleep(16); }
await touch("touchEnd", []);
await sleep(500);
const zIn = (await dbg(page, (d) => d.view())).zoom;
await touch("touchStart", [[40, 400], [350, 400]]);
for (let i = 1; i <= 30; i++) { await touch("touchMove", [[40 + i * 5, 400], [350 - i * 5, 400]]); await sleep(16); }
await touch("touchEnd", []);
await sleep(500);
out.pinch = { zoomAfterPinchOut: +zIn.toFixed(3), zoomAfterPinchIn: +(await dbg(page, (d) => d.view())).zoom.toFixed(3), minZoom: await dbg(page, (d) => d.minZoom()) };
// touch-action is set on the canvas only (the places list and the panel keep default touch behaviour)
out.touchAction = await page.evaluate(() => ({ canvas: document.querySelector("canvas").style.touchAction, root: getComputedStyle(document.querySelector("[data-globe]")).touchAction, nav: getComputedStyle(document.querySelector("nav[aria-label=Places]")).touchAction }));

// tap a marker: opens the slide-over, globe unmounted
await dbg(page, (d) => d.setView({ lon: 2.35, lat: 48.86, zoom: 4 }));
await sleep(300);
const viewBefore = round(await dbg(page, (d) => d.view()));
const xy = await dbg(page, (d) => d.project("paris"));
await page.touchscreen.tap(xy.x + 2, xy.y + 2);
await page.waitForURL("**/locations/paris");
await sleep(800);
out.afterTap = { url: new URL(page.url()).pathname, ...(await state(page)), dialog: await page.evaluate(() => !!document.querySelector('[role="dialog"]')) };
await page.screenshot({ path: `${OUT_DIR}/m-slideover.png` });
// close: globe is back with the identical view
await page.getByRole("button", { name: "Close" }).click();
await page.waitForFunction(() => window.__globeDebug && document.querySelector('[data-globe][data-state="ready"]'));
await sleep(500);
const viewAfter = round(await dbg(page, (d) => d.view()));
out.restore = { viewBefore, viewAfter, identical: JSON.stringify(viewBefore) === JSON.stringify(viewAfter), ...(await state(page)) };

// 20 open/close cycles via the (visually hidden) places list, driven like a keyboard user
const cyc = [];
for (let i = 0; i < 20; i++) {
  await page.focus('[data-place-link="kyoto"]');
  await page.keyboard.press("Enter");
  await page.waitForURL("**/locations/kyoto");
  await page.waitForFunction(() => !document.querySelector("[data-globe=three]"));
  const mid = await state(page);
  await page.getByRole("button", { name: "Close" }).click();
  await page.waitForFunction(() => window.__globeDebug && document.querySelector('[data-globe][data-state="ready"]'));
  if (i === 0 || i === 19) cyc.push({ i, whileOpen: { canvases: mid.canvases, gl: mid.gl }, afterClose: await state(page) });
}
await sleep(300);
const end = await state(page);
out.cycles = { n: 20, samples: cyc, final: { ...end, live: end.gl.created - end.gl.lost } };
out.viewAfterCycles = round(await dbg(page, (d) => d.view()));
out.logs = logs;
console.log(JSON.stringify(out, null, 1));
await b.close();
