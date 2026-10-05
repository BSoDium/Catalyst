// Shared helpers for the browser checks. Needs a Chrome binary: CHROME_PATH=/path/to/chrome (e.g. Playwright's
// "Chrome for Testing"). The production server must be running (BASE_URL, default http://localhost:5174).
import { chromium } from "playwright-core";

export const BASE_URL = process.env.BASE_URL ?? "http://localhost:5174";
export const OUT_DIR = process.env.OUT_DIR ?? ".";

export async function launch() {
  const executablePath = process.env.CHROME_PATH;
  if (!executablePath) throw new Error("Set CHROME_PATH to a Chrome/Chromium executable");
  return chromium.launch({
    executablePath,
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

/**
 * Open a page with instrumentation installed BEFORE any app code runs: rAF call counter, WebGL context
 * created/lost counters, WebGL `clear` counter (Three issues exactly one per frame), console capture.
 */
export async function open(browser, contextOptions, path = "/", { debug = true, noStreet = true } = {}) {
  const ctx = await browser.newContext(contextOptions);
  const page = await ctx.newPage();
  const logs = [];
  page.on("console", (m) => {
    if (["error", "warning"].includes(m.type())) logs.push(`${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
  if (debug) await page.addInitScript(() => sessionStorage.setItem("globe-debug", "1"));
  // The Three.js-only measurements below predate street scale: they run with the street map switched off.
  if (noStreet) await page.addInitScript(() => sessionStorage.setItem("no-street", "1"));
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.__raf = { calls: 0 };
    window.requestAnimationFrame = (cb) => {
      window.__raf.calls++;
      return raf(cb);
    };
    const gl = { created: 0, lost: 0, lastRestored: 0 };
    window.__gl = gl;
    const seen = new WeakSet();
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      const c = orig.call(this, type, ...rest);
      if (c && /webgl/.test(type) && !seen.has(this)) {
        seen.add(this);
        gl.created++;
        this.addEventListener("webglcontextlost", () => gl.lost++);
        this.addEventListener("webglcontextrestored", () => gl.lastRestored++);
      }
      return c;
    };
    const wrapClear = (proto) => {
      const clear = proto.clear;
      proto.clear = function (...a) {
        window.__clears = (window.__clears ?? 0) + 1;
        return clear.apply(this, a);
      };
    };
    wrapClear(WebGL2RenderingContext.prototype);
    wrapClear(WebGLRenderingContext.prototype);
  });
  await page.goto(`${BASE_URL}${path}`);
  return { ctx, page, logs };
}

export const waitGlobe = (page) =>
  page.waitForFunction(() => document.querySelector('[data-globe="three"][data-state="ready"]') && window.__globeDebug, null, {
    timeout: 20000,
  });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
