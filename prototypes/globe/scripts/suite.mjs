import { chromium } from "playwright-core";
const kind = process.argv[2] ?? "three";
const exe = process.env.CHROME_PATH; // e.g. a Playwright "Chrome for Testing" binary
if (!exe) throw new Error("Set CHROME_PATH to a Chrome/Chromium executable");
const b = await chromium.launch({ executablePath: exe, headless: true, args: ["--use-angle=metal","--ignore-gpu-blocklist","--enable-gpu"] });
async function page(opts = {}) {
  const ctx = await b.newContext({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 2, ...opts });
  const p = await ctx.newPage();
  p.on("console", (m) => { if (["error","warning"].includes(m.type()) && !/404/.test(m.text())) console.log("[console]", m.type(), m.text()); });
  p.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await p.goto(`http://localhost:5180/?renderer=${kind}&theme=dark`);
  await p.waitForFunction(() => window.__app?.renderer);
  await p.waitForTimeout(800);
  return p;
}
const out = {};
const sleep = (p, ms) => p.waitForTimeout(ms);

/* 1. select -> rotate to place */
{
  const p = await page();
  const r = await p.evaluate(async () => {
    const a = window.__app; a.select("kyoto", { fly: true });
    const t0 = performance.now(); const samples = [];
    while (performance.now() - t0 < 2500) { samples.push(a.renderer.getView()); await new Promise(r => setTimeout(r, 250)); }
    const v = a.renderer.getView();
    return { final: v, labelsShown: [...a.labels.shown()], samples: samples.map(s => [+s.lon.toFixed(1), +s.lat.toFixed(1), +s.zoom.toFixed(2)]) };
  });
  out.selectFly = { expect: "kyoto 135.77,35.01 zoom>=3.2", ...r };
  await p.screenshot({ path: `${process.env.OUT_DIR ?? "."}/sel-${kind}.png` });
  await p.close();
}

/* 2. drag, click-pick, empty click */
{
  const p = await page();
  const r = await p.evaluate(() => { const a = window.__app; a.renderer.setView({ lon: 0, lat: 20, zoom: 3 }); return a.renderer.getView(); });
  await sleep(p, 400);
  const before = await p.evaluate(() => window.__app.renderer.getView());
  await p.mouse.move(600, 400); await p.mouse.down(); for (let i = 1; i <= 10; i++) await p.mouse.move(600 - i * 20, 400 + i * 5); await p.mouse.up();
  await sleep(p, 1200);
  const after = await p.evaluate(() => window.__app.renderer.getView());
  // click on Paris marker
  const xy = await p.evaluate(() => { const a = window.__app; a.renderer.setView({ lon: 2.35, lat: 48.86, zoom: 4 }); const s = a.renderer.project(2.35, 48.86); return [s.x, s.y]; });
  await sleep(p, 500);
  const xy2 = await p.evaluate(() => { const s = window.__app.renderer.project(2.35, 48.86); return [s.x, s.y]; });
  await p.mouse.click(xy2[0], xy2[1]);
  await sleep(p, 2500);
  const sel = await p.evaluate(() => ({ pressed: document.querySelector('#places button[aria-pressed="true"]')?.textContent, view: window.__app.renderer.getView() }));
  await p.mouse.click(40, 700);  // empty (below panel, on globe? may hit ocean/space)
  await sleep(p, 300);
  out.dragClick = { before, after, markerClickAt: xy2, afterClick: sel, afterEmptyClickPressed: await p.evaluate(() => document.querySelector('#places button[aria-pressed="true"]')?.textContent ?? null) };
  await p.close();
}

/* 3. bounds: wheel zoom out/in */
{
  const p = await page();
  const r = {};
  r.minZoom = await p.evaluate(() => window.__app.renderer.getMinZoom());
  for (let i = 0; i < 30; i++) await p.mouse.wheel(0, 300);
  await sleep(p, 1200);
  r.afterZoomOut = await p.evaluate(() => window.__app.renderer.getView().zoom);
  await p.mouse.move(512, 384);
  for (let i = 0; i < 80; i++) await p.mouse.wheel(0, -300);
  await sleep(p, 1500);
  r.afterZoomIn = await p.evaluate(() => window.__app.renderer.getView().zoom);
  // lat clamp via drag
  await p.mouse.move(512, 200); await p.mouse.down(); for (let i = 1; i <= 30; i++) await p.mouse.move(512, 200 + i * 20); await p.mouse.up();
  await sleep(p, 1500);
  r.afterDragToPole = await p.evaluate(() => window.__app.renderer.getView());
  out.bounds = r;
  await p.close();
}

/* 4. idle + route animation then idle */
{
  const p = await page();
  const r = await p.evaluate(async () => {
    const a = window.__app; const rafOrig = window.requestAnimationFrame.bind(window); let calls = 0;
    window.requestAnimationFrame = (cb) => { calls++; return rafOrig(cb); };
    const f0 = a.renderer.stats.frames;
    await new Promise(r => setTimeout(r, 2000));
    const idle = { rafCalls: calls, frames: a.renderer.stats.frames - f0 };
    calls = 0; const f1 = a.renderer.stats.frames;
    a.select("hanoi", { fly: true });
    await new Promise(r => setTimeout(r, 1000));
    const midAnim = { rafCalls: calls, frames: a.renderer.stats.frames - f1, animating: a.renderer.isAnimating() };
    await new Promise(r => setTimeout(r, 5000));
    calls = 0; const f2 = a.renderer.stats.frames;
    await new Promise(r => setTimeout(r, 2000));
    const idleAfter = { rafCalls: calls, frames: a.renderer.stats.frames - f2, animating: a.renderer.isAnimating() };
    window.requestAnimationFrame = rafOrig;
    return { idle, midAnim, idleAfterRouteSettled: idleAfter };
  });
  out.idleAndRoute = r;
  await p.screenshot({ path: `${process.env.OUT_DIR ?? "."}/route-${kind}.png` });
  await p.close();
}

/* 5. reduced motion */
{
  const p = await page({ reducedMotion: "reduce" });
  const r = await p.evaluate(async () => {
    const a = window.__app; const t0 = performance.now(); a.select("hanoi", { fly: true });
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const v = a.renderer.getView();
    const dt = performance.now() - t0;
    await new Promise(r => setTimeout(r, 600));
    return { viewAfter2Frames: v, ms: Math.round(dt), animatingAfter: a.renderer.isAnimating(), rm: document.documentElement.dataset.rm };
  });
  out.reducedMotion = { target: "hanoi 105.85,21.03", ...r };
  await p.screenshot({ path: `${process.env.OUT_DIR ?? "."}/rm-${kind}.png` });
  await p.close();
}

/* 6. unmount/remount x20, leak check */
{
  const p = await page();
  const r = await p.evaluate(async () => {
    const a = window.__app; const log = [];
    a.renderer.setView({ lon: 77.7, lat: -12.3, zoom: 3.7 });
    await new Promise(r => setTimeout(r, 300));
    const v0 = a.renderer.getView();
    for (let i = 0; i < 20; i++) {
      a.unmount();
      await new Promise(r => setTimeout(r, 120));
      const mid = { live: window.__gl.live(), canvases: window.__gl.liveCanvases() };
      await a.remount();
      await new Promise(r => setTimeout(r, 150));
      if (i < 2 || i === 19) log.push({ i, afterUnmount: mid, afterRemount: { live: window.__gl.live(), canvases: window.__gl.liveCanvases(), view: a.renderer.getView() } });
    }
    return { before: v0, log, created: window.__gl.created, lost: window.__gl.lost, live: window.__gl.live(), labelEls: document.querySelectorAll(".label").length };
  });
  out.unmountRemount = r;
  await p.close();
}

/* 7. far-side: pick and visibility */
{
  const p = await page();
  const r = await p.evaluate(async () => {
    const a = window.__app; a.renderer.setView({ lon: 100, lat: 10, zoom: 2.5 });
    await new Promise(r => setTimeout(r, 600));
    const res = {};
    for (const pl of a.data.places) { const s = a.renderer.project(pl.coordinates.lon, pl.coordinates.lat); res[pl.slug] = { visible: s.visible, pick: a.renderer.pick(s.x, s.y, 12) === pl.slug }; }
    return { res, labelsShown: [...a.labels.shown()] };
  });
  out.farSide = r;
  await p.screenshot({ path: `${process.env.OUT_DIR ?? "."}/far-${kind}.png` });
  await p.close();
}
console.log(JSON.stringify(out));
await b.close();
