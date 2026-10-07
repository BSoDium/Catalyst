// Shared helpers for the street browser checks. Needs a Chrome binary: CHROME_PATH (default: Playwright's "Chrome for
// Testing" in the local cache). The dev route is served by `react-router dev` (or a production build made with
// CATALYST_DEV_ROUTES=1): BASE_URL, default http://localhost:5231. The local fallback archive is served by
// serve-tiles.mjs (TILES_FILE, TILES_PORT; default prototypes/street-zoom/public/hcmc.pmtiles on 5240).
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serveTiles } from "./serve-tiles.mjs";

export const BASE_URL = process.env.BASE_URL ?? "http://localhost:5231";
export const OUT_DIR = process.env.OUT_DIR ?? ".";
export const TILES_PORT = Number(process.env.TILES_PORT ?? 5240);
export const TILES_FILE = process.env.TILES_FILE ?? fileURLToPath(new URL("../../../../prototypes/street-zoom/public/hcmc.pmtiles", import.meta.url));
export const FALLBACK_URL = `http://127.0.0.1:${TILES_PORT}/places.pmtiles`;

const DEFAULT_CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
export const CHROME = process.env.CHROME_PATH ?? DEFAULT_CHROME;

export async function launch() {
  if (!existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}; set CHROME_PATH`);
  return chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu", "--enable-precise-memory-info"],
  });
}

export const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
export const MOBILE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1",
};

/** Start the local fallback tile server unless something already answers on its port. Returns a stop function. */
export async function ensureTiles() {
  try {
    const r = await fetch(`http://127.0.0.1:${TILES_PORT}/__stats`);
    if (r.ok) return { stop: async () => {}, url: FALLBACK_URL, external: true };
  } catch {
    // not running: start it
  }
  if (!existsSync(TILES_FILE)) throw new Error(`No PMTiles file at ${TILES_FILE}; set TILES_FILE`);
  const s = await serveTiles(TILES_FILE, TILES_PORT);
  return { stop: () => new Promise((res) => s.server.close(() => res())), url: s.url, external: false };
}

/**
 * New page with instrumentation installed BEFORE any app code runs: rAF call counter, WebGL context created / lost /
 * restored counters, console + page error capture, optional fake of `visibilityState`.
 */
export async function open(browser, contextOptions, { colorScheme = "light", reducedMotion = "no-preference" } = {}) {
  const ctx = await browser.newContext({ ...contextOptions, colorScheme, reducedMotion });
  const page = await ctx.newPage();
  const logs = [];
  page.on("console", (m) => {
    if (["error", "warning"].includes(m.type())) logs.push(`${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.__raf = { calls: 0 };
    window.requestAnimationFrame = (cb) => {
      window.__raf.calls++;
      return raf(cb);
    };
    const gl = { created: 0, lost: 0, restored: 0, live: new Set() };
    window.__gl = gl;
    const seen = new WeakSet();
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      const c = orig.call(this, type, ...rest);
      if (c && /webgl/.test(type) && !seen.has(this)) {
        seen.add(this);
        gl.created++;
        gl.live.add(this);
        this.addEventListener("webglcontextlost", () => {
          gl.lost++;
          gl.live.delete(this);
        });
        this.addEventListener("webglcontextrestored", () => {
          gl.restored++;
          gl.live.add(this);
        });
      }
      return c;
    };
  });
  return { ctx, page, logs };
}

/** Wait until the dev page has a street map handle (window.__street) and reached a settled tile state. */
export async function waitReady(page, { states = ["primary", "fallback", "capped"], timeout = 45000 } = {}) {
  await page.waitForFunction((s) => window.__street && s.includes(document.querySelector("[data-dev-street]")?.getAttribute("data-tile-state") ?? ""), states, { timeout });
}

/** Wait until the map is idle: not moving, tiles loaded, then two frames. */
export async function settle(page, timeout = 60000) {
  await page.waitForFunction(
    () => {
      const m = window.__streetDebug?.map();
      return !!m && !m.isMoving() && m.loaded() && m.areTilesLoaded() && !window.__streetDebug.isAnimating();
    },
    null,
    { timeout },
  );
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(150);
}

export const liveContexts = (page) => page.evaluate(() => window.__gl.live.size);

export function dev(path, params = {}) {
  const u = new URL(path, BASE_URL);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  return u.toString();
}
