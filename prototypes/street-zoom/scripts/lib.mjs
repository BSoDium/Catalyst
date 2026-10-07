import { chromium } from "playwright-core";

export const CHROME =
  process.env.CHROME_PATH ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

export async function launch({ w = 1440, h = 900, dpr = 2, throttle = 1, mobile = false } = {}) {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu", "--enable-precise-memory-info"],
  });
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: dpr,
    ...(mobile ? { isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" } : {}),
  });
  const page = await ctx.newPage();
  if (throttle > 1) {
    const c = await ctx.newCDPSession(page);
    await c.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  }
  page.on("pageerror", (e) => console.error("[pageerror]", e.message));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") console.error(`[console.${m.type()}]`, m.text().slice(0, 300));
  });
  return { browser, page };
}

export async function open(page, query, base = "http://localhost:5190/") {
  await page.addInitScript(() => {});
  await page.goto(`${base}?${query}`);
  await page.waitForFunction(() => document.body.dataset.ready === "1" || document.body.dataset.error, null, { timeout: 60000 });
  const err = await page.evaluate(() => document.body.dataset.error);
  if (err) throw new Error(`app error: ${err}`);
  await page.evaluate(() => window.__app.street.whenSettled(90000));
}
