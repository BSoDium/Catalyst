// Shared helpers for the handover checks (globe <-> street). Build on the street helpers: Chrome for Testing,
// the local fallback tile server, instrumentation installed before app code.
//   BASE_URL      the app (default http://localhost:5175: a dev server started with
//                 CATALYST_TILES_FALLBACK_URL=http://127.0.0.1:5240/places.pmtiles, or a production build)
//   SOURCE        pin the street tile source: fallback (default, local PMTiles, deterministic) | primary | auto (real failover)
import { ensureTiles, launch, open as openStreet, DESKTOP, MOBILE, OUT_DIR, FALLBACK_URL } from "../street/_lib.mjs";

export { ensureTiles, launch, DESKTOP, MOBILE, OUT_DIR, FALLBACK_URL };
export const APP = process.env.BASE_URL ?? "http://localhost:5175";
export const SOURCE = process.env.SOURCE ?? "fallback";

export const HCMC = { lon: 106.7009, lat: 10.7769 };

/** Open the app with the debug hooks on. `opts.street` is passed to the street engine (JSON), e.g. { forceSource: "fallback" }. */
export async function openApp(browser, contextOptions, { path = "/", colorScheme = "light", reducedMotion = "no-preference", street, wait = true, levels = null } = {}) {
  const { ctx, page, logs } = await openStreet(browser, contextOptions, { colorScheme, reducedMotion });
  const opts = street ?? (SOURCE === "auto" ? undefined : { forceSource: SOURCE });
  await page.addInitScript((n) => {
    if (n) sessionStorage.setItem("palette-levels", String(n));
    else sessionStorage.removeItem("palette-levels");
  }, levels);
  await page.addInitScript((o) => {
    sessionStorage.setItem("globe-debug", "1");
    if (o) sessionStorage.setItem("street-opts", JSON.stringify(o));
    else sessionStorage.removeItem("street-opts");
  }, opts ?? null);
  await page.goto(new URL(path, APP).toString());
  if (wait) await waitHandover(page);
  return { ctx, page, logs };
}

export const waitHandover = (page, timeout = 30000) =>
  page.waitForFunction(() => window.__handoverDebug && document.querySelector('[data-globe="three"][data-state="ready"]'), null, { timeout });

/** Resolve when the street map exists and has a working tile source. */
export const waitStreetOk = (page, timeout = 45000) =>
  page.waitForFunction(() => {
    const d = window.__handoverDebug;
    const t = d?.tile();
    return d?.streetState() === "ready" && (t?.state === "primary" || t?.state === "fallback");
  }, null, { timeout });

/** Resolve when no camera animation, dissolve slew or tile load is pending. */
export async function settleApp(page, timeout = 60000) {
  await page.waitForFunction(
    () => {
      const d = window.__handoverDebug;
      if (!d) return false;
      const b = d.blend();
      if (Math.abs(b.shown - b.target) > 1e-6 || d.globe.isAnimating()) return false;
      const s = d.street();
      if (!s) return true;
      const m = s.debug().map();
      return !m.isMoving() && m.loaded() && m.areTilesLoaded() && !s.debug().isAnimating();
    },
    null,
    { timeout },
  );
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(150);
}

/** Put the unified camera somewhere (internal zoom) and let everything follow. */
export const setCamera = (page, view) => page.evaluate((v) => window.__handoverDebug.globe.setView(v), view);
export const state = (page) =>
  page.evaluate(() => {
    const d = window.__handoverDebug;
    return { zoom: d.zoom(), mapZoom: d.mapZoom(), blend: d.blend(), owner: d.owner(), street: d.streetState(), tile: d.tile()?.state ?? null, limit: d.limit(), suspended: d.suspended() };
  });
