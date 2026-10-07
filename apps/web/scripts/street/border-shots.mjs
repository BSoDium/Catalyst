// Border evidence: the country-border area of the street map around disputed frontiers, before / after the single-line rule.
//
//   BASE_URL=http://localhost:5471 node scripts/street/border-shots.mjs --tag=before|after [--regions=ws,kashmir] [--out=../../docs/street-zoom]
//        [--compose=1]    (compose=1: stack the before and after PNGs of every region into one before/after image)
//
// Source: OpenFreeMap (OpenMapTiles schema, needs the network), light theme, 900x560 CSS px at DPR 1 (one art cell = 3 px).
// Regions are public geography: Western Sahara / Mauritania / Morocco / Algeria, Kashmir, Crimea, Cyprus, Kosovo / Serbia, Israel / Palestine.
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { ensureTiles, launch, open, dev } from "./_lib.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const t = a.replace(/^--/, ""); const i = t.indexOf("="); return i < 0 ? [t, "1"] : [t.slice(0, i), t.slice(i + 1)]; }));
const tag = args.tag ?? "after";
const out = args.out ?? new URL("../../../../docs/street-zoom", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const REGIONS = {
  ws: { lon: -11, lat: 25, zooms: [4.9, 5.8, 7.2] },
  kashmir: { lon: 77.5, lat: 34, zooms: [5.2, 6.4] },
  crimea: { lon: 34.2, lat: 45.2, zooms: [5.6, 7] },
  cyprus: { lon: 33.3, lat: 35, zooms: [6.4, 8] },
  kosovo: { lon: 20.9, lat: 42.6, zooms: [6.2, 8] },
  israel: { lon: 35.1, lat: 31.7, zooms: [6.4, 8] },
};
const only = args.regions ? args.regions.split(",") : Object.keys(REGIONS);
const quant = (file) => { try { execFileSync("python3", ["-c", "import sys;from PIL import Image;i=Image.open(sys.argv[1]).convert('RGB');i.quantize(16,dither=Image.Dither.NONE).save(sys.argv[1],optimize=True)", file]); } catch {} };

if (args.compose) {
  // stack: one row per zoom, before on the left, after on the right
  for (const name of only) {
    const files = REGIONS[name].zooms.map((z) => [`${out}/border-${name}-before-z${z}.png`, `${out}/border-${name}-after-z${z}.png`]);
    execFileSync("python3", ["-c", `
import sys
from PIL import Image, ImageDraw
rows=[(Image.open(a).convert('RGB'),Image.open(b).convert('RGB')) for a,b in ${JSON.stringify(files)}]
w,h=rows[0][0].size
sheet=Image.new('RGB',(2*w+6,len(rows)*(h+6)),(128,128,128))
d=ImageDraw.Draw(sheet)
for i,(a,b) in enumerate(rows):
    sheet.paste(a,(0,i*(h+6))); sheet.paste(b,(w+6,i*(h+6)))
    d.text((8,i*(h+6)+6),'before',fill=(0,0,0)); d.text((w+14,i*(h+6)+6),'after',fill=(0,0,0))
sheet.quantize(16,dither=Image.Dither.NONE).save(${JSON.stringify(`${out}/border-${name}-before-after.png`)},optimize=True)
`]);
    console.log(`border-${name}-before-after.png ${(statSync(`${out}/border-${name}-before-after.png`).size / 1024).toFixed(0)} KB`);
  }
  process.exit(0);
}

const tiles = await ensureTiles();
const browser = await launch();
try {
  const { page, logs } = await open(browser, { viewport: { width: 900, height: 560 }, deviceScaleFactor: 1 }, { colorScheme: "light" });
  for (const name of only) {
    for (const zoom of REGIONS[name].zooms) {
      await page.goto(dev("/dev/street", { hud: 0, view: `${REGIONS[name].lon},${REGIONS[name].lat},${zoom}`, theme: "light", source: "primary" }));
      await page.waitForFunction(() => window.__streetDebug?.map().loaded() && document.querySelector("[data-dev-street]")?.getAttribute("data-tile-state") === "primary", null, { timeout: 60000 });
      await page.waitForFunction(() => { const m = window.__streetDebug.map(); return !m.isMoving() && m.areTilesLoaded() && !window.__streetDebug.isAnimating(); }, null, { timeout: 60000 });
      await page.waitForFunction(() => { const { codes } = window.__streetDebug.readCodes(); for (let i = 0; i < codes.length; i += 7) if (codes[i]) return true; return false; }, null, { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(900);
      const file = `${out}/border-${name}-${tag}-z${zoom}.png`;
      await page.screenshot({ path: file, clip: { x: 0, y: 60, width: 900, height: 440 } });
      quant(file);
      console.log(`${name} z${zoom} ${(statSync(file).size / 1024).toFixed(0)} KB`, logs.slice(-1));
    }
  }
} finally {
  await browser.close();
  await tiles.stop();
}
