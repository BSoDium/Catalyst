// Evidence for the tile fade: consecutive PRESENTED frames while delayed tiles arrive at a resting camera, with the fade on and
// off, as a contact sheet (docs/palette/tile-fade.png). Levels are drawn as greys (page colour to ink); needs python3 + Pillow.
//   BASE_URL=... OUT_DIR=docs/palette node apps/web/scripts/street/tile-fade-shots.mjs
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { FALLBACK_URL, OUT_DIR, dev, ensureTiles, launch, open } from "./_lib.mjs";

const tiles = await ensureTiles();
const browser = await launch();
const runs = {};
try {
  for (const fade of [true, false]) {
    const { page, ctx } = await open(browser, { viewport: { width: 800, height: 560 }, deviceScaleFactor: 1 });
    let delay = 0;
    await page.route("**/places.pmtiles", async (route) => {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      await route.continue();
    });
    await page.goto(dev("/dev/street", { source: "fallback", fallbackUrl: FALLBACK_URL, hud: 0, view: "106.698,10.774,13", theme: "light", ...(fade ? {} : { tileFade: 0 }) }));
    await page.waitForFunction(() => window.__streetDebug?.map().loaded() && document.querySelector("[data-dev-street]")?.getAttribute("data-tile-state") === "fallback", null, { timeout: 60000 });
    await page.waitForTimeout(800);
    delay = 450;
    await page.evaluate(() => window.__streetDebug.map().jumpTo({ center: [106.7125, 10.7905], zoom: 15.3 }));
    const frames = await page.evaluate(async () => {
      const d = window.__streetDebug;
      const out = [];
      const t0 = performance.now();
      let last = null;
      while (performance.now() - t0 < 1800) {
        await new Promise((r) => requestAnimationFrame(r));
        const lv = d.readPresentedLevels();
        const key = lv.reduce((a, v, i) => (a + v * ((i % 97) + 1)) | 0, 0);
        if (key !== last) {
          last = key;
          // crop the middle 120 x 80 cells
          const { cols } = d.readCodes();
          const rows = lv.length / cols;
          const x0 = Math.floor((cols - 120) / 2), y0 = Math.floor((rows - 80) / 2);
          const crop = [];
          for (let y = 0; y < 80; y++) for (let x = 0; x < 120; x++) crop.push(lv[(y0 + y) * cols + x0 + x]);
          out.push({ t: Math.round(performance.now() - t0), crop });
        }
      }
      return out;
    });
    runs[fade ? "fade" : "off"] = frames;
    await ctx.close();
  }
} finally {
  await browser.close();
  await tiles.stop();
}
const json = `${OUT_DIR}/.tile-fade.json`;
writeFileSync(json, JSON.stringify(runs));
execFileSync("python3", ["-c", `
import json, sys
from PIL import Image, ImageDraw
runs = json.load(open(sys.argv[1]))
out = sys.argv[2]
def img(crop, n=8):
    im = Image.new("L", (120, 80))
    im.putdata([int(251 - (251 - 10) * (v / (n - 1)) ** 0.9) for v in crop])
    return im.resize((240, 160), Image.NEAREST)
rows = []
for name in ("fade", "off"):
    fr = runs[name]
    # the frames in which something changes: from the first to the last, at most 10 evenly picked
    pick = [fr[round(i * (len(fr) - 1) / 9)] for i in range(10)] if len(fr) > 10 else fr
    rows.append((name, pick))
W = 10 * 244 + 70
S = Image.new("RGB", (W, 2 * 180 + 4), (120, 120, 120))
d = ImageDraw.Draw(S)
for r, (name, pick) in enumerate(rows):
    d.text((4, r * 180 + 80), "fade on" if name == "fade" else "fade off", fill=(255, 255, 0))
    for i, f in enumerate(pick):
        S.paste(img(f["crop"]).convert("RGB"), (66 + i * 244, r * 180 + 18))
        d.text((66 + i * 244, r * 180 + 4), f"{f['t']} ms", fill=(255, 255, 0))
S.save(out, optimize=True)
print(out, S.size)
`, json, `${OUT_DIR}/tile-fade.png`], { stdio: "inherit" });
