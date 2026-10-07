// Evidence for the temporal ease at city framing (docs/street-architecture.md, "Temporal ease"): consecutive PRESENTED frames of Paris
// (OpenFreeMap, the 12 km framing of a 1440x900 viewport, map zoom 10.6), light and dark, as a contact sheet per scenario.
//   first   slow first load: the tile requests are held back, the world placeholder is drawn, then the real tiles arrive and every line fades in
//   pan     a continuous pan (1.5 cells per frame) while every tile request takes 700 ms: lines slide, new ones fade in while sliding, no trail
//   leave   the road layers are hidden at a resting camera (as when their tiles are evicted): the roads fade out instead of vanishing
// Each tile of the sheet is the middle 150 x 100 cells of one frame in which something changed (levels drawn as greys, the theme's own ramp).
//   BASE_URL=http://localhost:5182 node scripts/street/fade-sheet.mjs [--out=docs/street-zoom] [--only=first,pan,leave] [--themes=light,dark]
// Needs python3 + Pillow for the sheets; the JSON of the frames is written next to them too (the intermediate JSON is deleted).
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { launch, open, dev } from "./_lib.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const t = a.replace(/^--/, ""); const i = t.indexOf("="); return i < 0 ? [t, "1"] : [t.slice(0, i), t.slice(i + 1)]; }));
const out = args.out ?? new URL("../../../../docs/street-zoom", import.meta.url).pathname;
const only = (args.only ?? "first,pan,leave").split(",");
const themes = (args.themes ?? "light,dark").split(",");
mkdirSync(out, { recursive: true });
const PARIS = "2.3522,48.8566,10.6";
const OFM = /tiles\.openfreemap\.org/;

const RECORD = `
window.__rec = async (ms, step) => {
  const d = window.__streetDebug;
  const frames = [];
  const t0 = performance.now();
  let last = null;
  while (performance.now() - t0 < ms) {
    if (step) step();
    await new Promise((r) => requestAnimationFrame(r));
    const lv = d.readPresentedLevels();
    const art = d.readCodes();
    if (!lv || !art) continue;
    let key = 0;
    for (let i = 0; i < lv.length; i += 7) key = (key * 31 + lv[i] + i) | 0;
    if (key === last) continue;
    last = key;
    const { cols } = art;
    const rows = lv.length / cols;
    const x0 = Math.floor((cols - 150) / 2), y0 = Math.floor((rows - 100) / 2);
    const crop = [];
    for (let y = 0; y < 100; y++) for (let x = 0; x < 150; x++) crop.push(lv[(y0 + y) * cols + x0 + x]);
    let mid = 0, lit = 0;
    for (let i = 0; i < lv.length; i++) if (lv[i]) { lit++; if (lv[i] !== art.levels[i]) mid++; }
    frames.push({ t: Math.round(performance.now() - t0), crop, mid, lit });
  }
  return frames;
};
`;

const browser = await launch();
const sheets = [];
try {
  for (const theme of themes) {
    for (const scenario of only) {
      const { page, ctx } = await open(browser, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }, { colorScheme: theme });
      let delay = 0;
      await page.route(OFM, async (route) => {
        if (delay) await new Promise((r) => setTimeout(r, delay));
        await route.continue().catch(() => {});
      });
      await page.addInitScript(RECORD);
      let frames;
      if (scenario === "first") {
        delay = 1500;
        await page.goto(dev("/dev/street", { source: "primary", hud: 0, view: PARIS, theme }));
        await page.waitForFunction(() => window.__streetDebug?.map(), null, { timeout: 60000 });
        frames = await page.evaluate(() => window.__rec(5000));
      } else {
        await page.goto(dev("/dev/street", { source: "primary", hud: 0, view: PARIS, theme }));
        await page.waitForFunction(() => window.__streetDebug?.map().loaded() && document.querySelector("[data-dev-street]")?.getAttribute("data-tile-state") === "primary", null, { timeout: 60000 });
        await page.waitForFunction(() => { const m = window.__streetDebug.map(); return !m.isMoving() && m.areTilesLoaded(); }, null, { timeout: 90000 });
        await page.waitForTimeout(800);
        if (scenario === "pan") {
          delay = 700;
          frames = await page.evaluate(() => {
            const d = window.__streetDebug, m = d.map();
            const cell = d.cellCss(), z = m.getZoom(), c0 = m.getCenter();
            const dLon = (px) => (px / (512 * 2 ** z)) * 360;
            let i = 0;
            return window.__rec(3200, () => { i++; if (i < 150) m.jumpTo({ center: [c0.lng + dLon(i * cell * 1.5), c0.lat], zoom: z }); });
          });
        } else {
          delay = 0;
          frames = await page.evaluate(() => {
            const m = window.__streetDebug.map();
            let n = 0;
            return window.__rec(1500, () => { if (n++ === 2) for (const l of m.getStyle().layers) if (l.id.startsWith("road-")) m.setLayoutProperty(l.id, "visibility", "none"); });
          });
        }
      }
      const json = `${out}/.fade-sheet-${scenario}-${theme}.json`;
      writeFileSync(json, JSON.stringify({ scenario, theme, frames }));
      sheets.push({ scenario, theme, json, n: frames.length, maxMid: Math.max(0, ...frames.map((f) => f.mid)) });
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
for (const s of sheets) {
  const png = `${out}/fade-paris-${s.scenario}-${s.theme}.png`;
  execFileSync("python3", ["-c", `
import json, sys
from PIL import Image, ImageDraw
d = json.load(open(sys.argv[1])); png = sys.argv[2]; dark = d["theme"] == "dark"
fr = d["frames"]
# frames in which something is in transition (a cell is not at its target), at most 8 evenly picked, else the changing frames
mid = [f for f in fr if f["mid"] > 0]
base = mid if len(mid) >= 2 else fr
pick = [base[round(i * (len(base) - 1) / 7)] for i in range(8)] if len(base) > 8 else base
def img(crop, n=12):
    im = Image.new("L", (150, 100))
    # level 0 = page colour, level n-1 = ink; the same curve the palette uses (map levels stop at about 55 % contrast)
    def g(v):
        k = (v / (n - 1)) ** 1.0
        return int(12 + (232 - 12) * k) if dark else int(250 - (250 - 14) * k)
    im.putdata([g(v) for v in crop])
    return im.resize((300, 200), Image.NEAREST)
cols = 4
rows = (len(pick) + cols - 1) // cols
S = Image.new("RGB", (cols * 304, rows * 222), (120, 120, 120))
dr = ImageDraw.Draw(S)
for i, f in enumerate(pick):
    x, y = (i % cols) * 304, (i // cols) * 222
    S.paste(img(f["crop"]).convert("RGB"), (x, y + 18))
    dr.text((x + 4, y + 3), f"{f['t']} ms   {f['mid']} cells mid-fade", fill=(255, 255, 0))
S.save(png, optimize=True)
print(png, S.size, len(fr), "frames changed")
`, s.json, png], { stdio: "inherit" });
  rmSync(s.json);
}
console.log(sheets.map((s) => `${s.scenario} ${s.theme}: ${s.n} changed frames, at most ${s.maxMid} cells off their target at once`).join("\n"));
