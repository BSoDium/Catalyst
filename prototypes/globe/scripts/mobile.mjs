import { chromium } from "playwright-core";
const kind = process.argv[2] ?? "three";
const exe = process.env.CHROME_PATH; // e.g. a Playwright "Chrome for Testing" binary
if (!exe) throw new Error("Set CHROME_PATH to a Chrome/Chromium executable");
const b = await chromium.launch({ executablePath: exe, headless: true, args: ["--use-angle=metal","--ignore-gpu-blocklist","--enable-gpu"] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1" });
const p = await ctx.newPage();
p.on("console", (m) => { if (["error","warning"].includes(m.type()) && !/404/.test(m.text())) console.log("[console]", m.type(), m.text()); });
await p.goto(`http://localhost:5180/?renderer=${kind}&theme=dark`);
await p.waitForFunction(() => window.__app?.renderer);
await p.waitForTimeout(1000);
await p.screenshot({ path: `${process.env.OUT_DIR ?? "."}/mob-${kind}-overview.png` });
const cdp = await ctx.newCDPSession(p);
const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map((q, i) => ({ x: q[0], y: q[1], id: i })) });
const out = {};
out.init = await p.evaluate(() => ({ view: window.__app.renderer.getView(), min: window.__app.renderer.getMinZoom(), canvas: [document.querySelector("canvas").width, document.querySelector("canvas").height] }));
// one-finger drag
await touch("touchStart", [[200, 500]]);
for (let i = 1; i <= 12; i++) { await touch("touchMove", [[200 - i * 8, 500 + i * 3]]); await p.waitForTimeout(16); }
await touch("touchEnd", []);
await p.waitForTimeout(1200);
out.afterDrag = await p.evaluate(() => window.__app.renderer.getView());
// pinch out (zoom in)
await touch("touchStart", [[170, 450], [220, 450]]);
for (let i = 1; i <= 15; i++) { await touch("touchMove", [[170 - i * 6, 450], [220 + i * 6, 450]]); await p.waitForTimeout(16); }
await touch("touchEnd", []);
await p.waitForTimeout(1000);
out.afterPinchOut = await p.evaluate(() => window.__app.renderer.getView());
// pinch in a lot -> bounded
await touch("touchStart", [[60, 450], [330, 450]]);
for (let i = 1; i <= 25; i++) { await touch("touchMove", [[60 + i * 5, 450], [330 - i * 5, 450]]); await p.waitForTimeout(16); }
await touch("touchEnd", []);
await p.waitForTimeout(800);
out.afterPinchIn = await p.evaluate(() => ({ view: window.__app.renderer.getView(), min: window.__app.renderer.getMinZoom() }));
// tap on Paris marker
const xy = await p.evaluate(async () => { const a = window.__app; a.renderer.setView({ lon: 2.35, lat: 48.86, zoom: 4 }); await new Promise(r => setTimeout(r, 400)); const s = a.renderer.project(2.35, 48.86); return [s.x, s.y]; });
await p.touchscreen.tap(xy[0] + 3, xy[1] + 3);
await p.waitForTimeout(2800);
out.afterTap = await p.evaluate(() => ({ selected: document.querySelector('#places button[aria-pressed="true"]')?.textContent, view: window.__app.renderer.getView(), labels: [...window.__app.labels.shown()] }));
await p.screenshot({ path: `${process.env.OUT_DIR ?? "."}/mob-${kind}-selected.png` });
// unmount/remount like a slide-over
out.restore = await p.evaluate(async () => { const a = window.__app; const v = a.renderer.getView(); a.unmount(); await new Promise(r => setTimeout(r, 200)); const mid = { live: window.__gl.live(), canvases: window.__gl.liveCanvases() }; await a.remount(); await new Promise(r => setTimeout(r, 300)); return { before: v, mid, after: a.renderer.getView(), live: window.__gl.live() }; });
console.log(JSON.stringify(out, null, 1));
await b.close();
