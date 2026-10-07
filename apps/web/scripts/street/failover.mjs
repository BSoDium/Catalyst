// Tile source failover drills against the dev route, with Playwright network routing (real OpenFreeMap, local PMTiles
// archive as fallback). Prints a JSON report; exit 1 when an expectation fails.
//
//   node apps/web/scripts/street/failover.mjs
//
// Scenarios: A primary blocked at start; B primary SLOW (tiles take 8 s, TileJSON fine: slow but not failing);
// C primary dies at runtime; D both blocked (capped, zoom capped); E recovery from capped back up; F missing fallback
// tiles (pan outside the archive: no errors); G the dev route's own ?chaos= switches.
import { ensureTiles, launch, open, dev, FALLBACK_URL, DESKTOP, waitReady } from "./_lib.mjs";

const OFM = /tiles\.openfreemap\.org/;
const FALLBACK = /127\.0\.0\.1:\d+\/places\.pmtiles/;
const results = [];
const failures = [];
const expect = (name, ok, detail) => {
  results.push({ name, ok, detail });
  if (!ok) failures.push(`${name}: ${JSON.stringify(detail)}`);
};

const statuses = (page) => page.evaluate(() => window.__streetDev.status.map((s) => ({ state: s.state, reason: s.reason, at: Math.round(s.at), maxZoom: s.maxZoom, detail: s.detail })));
const waitState = (page, state, timeout = 30000) => page.waitForFunction((s) => document.querySelector("[data-dev-street]")?.getAttribute("data-tile-state") === s, state, { timeout });
const fast = "recoveryBaseMs:2000,confirmDelayMs:500,downMemoryMs:1000";

const tiles = await ensureTiles();
const browser = await launch();
try {
  // A ----------------------------------------------------------------------------------------------------
  {
    const { page, logs } = await open(browser, DESKTOP);
    await page.route(OFM, (r) => r.abort("failed"));
    const t0 = Date.now();
    await page.goto(dev("/dev/street", { fallbackUrl: FALLBACK_URL, hud: 0 }));
    await waitState(page, "fallback");
    const dt = Date.now() - t0;
    const s = await statuses(page);
    expect("A primary blocked -> fallback", s.at(-1).state === "fallback" && s.at(-1).reason === "probe-failed", { ms_from_navigation: dt, s });
    await page.waitForFunction(() => window.__streetDebug.map().areTilesLoaded());
    await page.click("[data-attribution] button");
    const credits = await page.locator("dialog[open]").innerText();
    expect("A the credits line's See more button opens the credits (OpenStreetMap, Protomaps)", credits.includes("OpenStreetMap contributors") && credits.includes("Protomaps"), credits);
    await page.keyboard.press("Escape");
    await page.waitForSelector("dialog[open]", { state: "detached" });
    expect("A no page errors", !logs.some((l) => l.startsWith("pageerror")), logs.slice(0, 5));
    await page.context().close();
  }
  // B ----------------------------------------------------------------------------------------------------
  {
    const { page, logs } = await open(browser, DESKTOP);
    await page.route(OFM, async (r) => {
      if (/\.pbf/.test(r.request().url())) await new Promise((res) => setTimeout(res, 8000));
      await r.continue().catch(() => {});
    });
    await page.goto(dev("/dev/street", { fallbackUrl: FALLBACK_URL, hud: 0 }));
    await waitState(page, "primary");
    const tPrimary = await page.evaluate(() => performance.now());
    await waitState(page, "fallback", 30000);
    const s = await statuses(page);
    const primaryAt = s.find((x) => x.state === "primary").at;
    const fbAt = s.find((x) => x.state === "fallback");
    expect("B slow-but-not-failing primary -> fallback", fbAt && ["stalled", "slow", "timeout"].includes(fbAt.reason), { reason: fbAt?.reason, seconds_after_primary_start: fbAt ? (fbAt.at - primaryAt) / 1000 : null, tPrimary });
    expect("B within 8 s of the first slow tile", fbAt && fbAt.at - primaryAt < 8000, { ms: fbAt && fbAt.at - primaryAt });
    expect("B no page errors", !logs.some((l) => l.startsWith("pageerror")), logs.slice(0, 5));
    await page.context().close();
  }
  // C ----------------------------------------------------------------------------------------------------
  {
    const { page, logs } = await open(browser, DESKTOP);
    let dead = false;
    await page.route(OFM, (r) => (dead ? r.abort("failed") : r.continue()));
    await page.goto(dev("/dev/street", { fallbackUrl: FALLBACK_URL, hud: 0, view: "106.698,10.774,13" }));
    await waitState(page, "primary");
    await page.waitForFunction(() => window.__streetDebug.map().areTilesLoaded());
    dead = true;
    const t0 = await page.evaluate(() => performance.now());
    // panning requests new tiles, which now fail
    await page.evaluate(() => window.__street.jumpTo({ lon: 106.9, lat: 10.95, zoom: 14.2 }));
    await waitState(page, "fallback");
    const s = await statuses(page);
    expect("C primary dies at runtime -> fallback", s.at(-1).state === "fallback", { ms_after_failure: Math.round(s.at(-1).at - t0), reason: s.at(-1).reason });
    expect("C within 3 s", s.at(-1).at - t0 < 3000, { ms: Math.round(s.at(-1).at - t0) });
    expect("C no page errors", !logs.some((l) => l.startsWith("pageerror")), logs.slice(0, 5));
    await page.context().close();
  }
  // D + E -----------------------------------------------------------------------------------------------
  {
    const { page, logs } = await open(browser, DESKTOP);
    let blocked = true;
    await page.route(OFM, (r) => (blocked ? r.abort("failed") : r.continue()));
    await page.route(FALLBACK, (r) => (blocked ? r.abort("failed") : r.continue()));
    await page.goto(dev("/dev/street", { fallbackUrl: FALLBACK_URL, hud: 0, timings: fast }));
    await waitState(page, "capped");
    await page.waitForTimeout(1500);
    const st = await page.evaluate(() => ({ max: window.__street.getMaxZoom(), zoom: window.__street.getView().zoom, status: window.__street.getTileStatus() }));
    expect("D both blocked -> capped, zoom capped", st.status.state === "capped" && st.max === 6 && st.zoom <= 6.01, st);
    const t0 = await page.evaluate(() => performance.now());
    blocked = false;
    await waitState(page, "primary", 30000);
    const s = await statuses(page);
    expect("E recovery capped -> primary", s.at(-1).state === "primary" && s.at(-1).reason === "recovered", { ms_after_unblock: Math.round(s.at(-1).at - t0), s });
    expect("E zoom limit restored", (await page.evaluate(() => window.__street.getMaxZoom())) === 17.5, null);
    expect("D/E no page errors", !logs.some((l) => l.startsWith("pageerror")), logs.slice(0, 5));
    await page.context().close();
  }
  // F ----------------------------------------------------------------------------------------------------
  {
    const { page, logs } = await open(browser, DESKTOP);
    await page.goto(dev("/dev/street", { source: "fallback", fallbackUrl: FALLBACK_URL, hud: 0, view: "105.85,21.03,13" }));
    await waitState(page, "fallback");
    await page.waitForFunction(() => window.__streetDebug.map().areTilesLoaded());
    await page.waitForTimeout(1500);
    const bad = logs.filter((l) => !/Download the React DevTools|\[vite\]/.test(l));
    expect("F missing fallback tiles (Hanoi, outside the archive): no errors", bad.length === 0, bad.slice(0, 5));
    expect("F stays on the fallback", (await page.evaluate(() => window.__street.getTileStatus().state)) === "fallback", null);
    await page.context().close();
  }
  // G ----------------------------------------------------------------------------------------------------
  for (const chaos of ["block-primary", "slow-primary", "block-all"]) {
    const { page } = await open(browser, DESKTOP);
    await page.goto(dev("/dev/street", { fallbackUrl: FALLBACK_URL, hud: 0, chaos, "chaos-slow": 8000 }));
    const want = chaos === "block-all" ? "capped" : "fallback";
    await waitState(page, want, 30000).catch(() => {});
    const state = await page.evaluate(() => document.querySelector("[data-dev-street]").getAttribute("data-tile-state"));
    expect(`G ?chaos=${chaos} -> ${want}`, state === want, { state });
    await page.context().close();
  }
} finally {
  await browser.close();
  await tiles.stop();
}
console.log(JSON.stringify(results, null, 1));
if (failures.length) {
  console.error(`\n${failures.length} FAILED:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`\n${results.length}/${results.length} expectations met`);
