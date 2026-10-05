// Screenshots of 48 one-pixel lines (24 angles x 2 sub-pixel offsets) for docs/pixel-line-rules.md.
// usage: node scripts/line-fan.mjs outdir      (needs a server on :5190)
import { launch } from "./lib.mjs";
const out = process.argv[2];
for (const [name, q, dpr] of [["before-dpr1", "rule=legacy&widths=legacy&pattern=bayer8", 1], ["after-dpr1", "", 1], ["before-dpr2", "rule=legacy&widths=legacy&pattern=bayer8", 2], ["after-dpr2", "", 2]]) {
  const { browser, page } = await launch({ w: 900, h: 580, dpr });
  try {
    await page.goto(`http://localhost:5190/synthetic.html?theme=light&${q}`);
    await page.waitForFunction(() => document.body.dataset.ready === "1");
    await page.evaluate(async () => { await window.__synthetic.ready(); await window.__synthetic.fan("building-outline", 15); });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/line-fan-${name}.png`, clip: { x: 0, y: 0, width: 900, height: 360 } });
    console.log("shot", name);
  } finally {
    await browser.close();
  }
}
