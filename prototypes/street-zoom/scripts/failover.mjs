// Failure-path prototype checks: block / slow the tile hosts with Playwright routing and watch the app degrade.
// usage: node scripts/failover.mjs [outdir-for-screenshots]
import { launch } from "./lib.mjs";
const outDir = process.argv[2];

const OFM = "**/tiles.openfreemap.org/**";
const PM = "**/hcmc.pmtiles";
const results = {};

async function scenario(name, query, setup, after) {
  const { browser, page } = await launch({ w: 1100, h: 700, dpr: 2 });
  const ctl = { blocked: new Set(), delayMs: 0 };
  await page.route(OFM, async (route) => {
    if (ctl.blocked.has("ofm")) return route.abort("connectionrefused");
    if (ctl.delayMs) await new Promise((r) => setTimeout(r, ctl.delayMs));
    return route.continue();
  });
  await page.route(PM, async (route) => {
    if (ctl.blocked.has("pm")) return route.abort("connectionrefused");
    return route.continue();
  });
  setup?.(ctl);
  const t0 = Date.now();
  try {
    await page.goto(`http://localhost:5190/?theme=dark&${query}`);
    await page.waitForFunction(() => document.body.dataset.ready === "1" || document.body.dataset.error, null, { timeout: 60000 });
    await page.evaluate(() => window.__app.street.whenSettled(60000));
    if (after) await after(page, ctl);
    await page.waitForTimeout(600);
    const state = await page.evaluate(() => ({
      tile: window.__app.street.tileState(),
      zoom: Number(window.__app.street.map.getZoom().toFixed(2)),
      maxZoom: window.__app.street.map.getMaxZoom(),
      bodyTiles: document.body.dataset.tiles,
      notice: document.getElementById("notice").hidden ? null : document.getElementById("notice").textContent,
      renders: window.__app.street.counters.renders,
    }));
    results[name] = { ...state, totalMs: Date.now() - t0 };
    if (outDir) await page.screenshot({ path: `${outDir}/failover-${name}.png` });
  } catch (e) {
    results[name] = { error: String(e.message ?? e) };
  } finally {
    await browser.close();
  }
}

const VIEW = "view=106.698,10.774,14.5";
// A: primary down at start -> fail over to the local PMTiles file
await scenario("A-primary-blocked", `chain=ofm,pm&${VIEW}`, (c) => c.blocked.add("ofm"));
// B: everything down -> degraded, zoom capped, notice
await scenario("B-all-down", `chain=ofm,pm&${VIEW}`, (c) => { c.blocked.add("ofm"); c.blocked.add("pm"); });
// C: primary slow (6 s) with a 1.5 s probe timeout -> timeout, fail over
await scenario("C-primary-slow", `chain=ofm,pm&ptimeout=1500&${VIEW}`, (c) => { c.delayMs = 6000; });
// D: primary healthy at start, dies at runtime -> error burst, re-probe, fail over
await scenario("D-dies-at-runtime", `chain=ofm,pm&${VIEW}`, null, async (page, ctl) => {
  ctl.blocked.add("ofm");
  await page.evaluate(() => window.__app.street.map.jumpTo({ center: [106.80, 10.90], zoom: 14.2 }));
  await page.waitForFunction(() => window.__app.street.tileState().active !== "ofm", null, { timeout: 30000 });
  await page.evaluate(() => window.__app.street.whenSettled(60000));
});
// E: all down at start, then they come back -> promoted again by the re-probe
await scenario("E-recovery", `chain=ofm,pm&recheck=1500&${VIEW}`, (c) => { c.blocked.add("ofm"); c.blocked.add("pm"); }, async (page, ctl) => {
  ctl.blocked.clear();
  await page.waitForFunction(() => window.__app.street.tileState().active !== null, null, { timeout: 30000 });
  await page.evaluate(() => window.__app.street.whenSettled(60000));
});
// F: control, healthy primary
await scenario("F-healthy", `chain=ofm,pm&${VIEW}`);
console.log(JSON.stringify(results, null, 1));
