// usage: node scripts/shot.mjs out.png "query" [WxH] [dpr] [prep-js]
import { launch, open } from "./lib.mjs";
const [out, query = "", size = "1440x900", dpr = "2", prep = ""] = process.argv.slice(2);
const [w, h] = size.split("x").map(Number);
const { browser, page } = await launch({ w, h, dpr: Number(dpr), mobile: w < 600 });
try {
  await open(page, query);
  if (prep) {
    await page.evaluate(`(async () => { const s = window.__app.street; ${prep}; await s.whenSettled(90000); })()`);
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: out });
  console.log(await page.evaluate(() => document.getElementById("hud").textContent));
} finally {
  await browser.close();
}
