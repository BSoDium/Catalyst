// usage: node scripts/shot-base.mjs out.png fullUrl [WxH] [dpr]
import { launch } from "./lib.mjs";
const [out, url, size = "1440x900", dpr = "2"] = process.argv.slice(2);
const [w, h] = size.split("x").map(Number);
const { browser, page } = await launch({ w, h, dpr: Number(dpr) });
try {
  await page.goto(url);
  await page.waitForTimeout(3500);
  await page.addStyleTag({ content: '#panel,#hud,#bench-out{display:none !important}' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: out });
} finally { await browser.close(); }
