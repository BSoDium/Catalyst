// Before/after crops for docs/pixel-line-rules.md -> docs/street-zoom/line-*.png (quantise with pngquant afterwards).
// usage: node scripts/line-gallery.mjs outdir [--scenes=a,b]    (needs a server on :5190)
import { launch, open } from "./lib.mjs";

const out = process.argv[2];
const args = Object.fromEntries(process.argv.slice(3).map((a) => { const t = a.replace(/^--/, ""); const i = t.indexOf("="); return i < 0 ? [t, "1"] : [t.slice(0, i), t.slice(i + 1)]; }));

const VARIANTS = {
  before: "rule=legacy&widths=legacy&pattern=bayer8",
  after: "",
};
// [name, view, dpr, crop {x,y,width,height} in CSS px of an 900x560 viewport]
const SCENES = [
  ["grid-z14.5", "106.698,10.774,14.5", 2, { x: 40, y: 60, width: 380, height: 240 }],
  ["dotted-z15.6", "106.698,10.774,15.6", 2, { x: 40, y: 100, width: 380, height: 240 }],
  ["hollow-z17.2", "106.6995,10.7765,17.2", 2, { x: 430, y: 40, width: 380, height: 240 }],
  ["water-z12.8", "106.70,10.78,12.8", 2, { x: 300, y: 120, width: 380, height: 240 }],
  ["outlines-z17.5-dpr1", "106.6995,10.7765,17.5", 1, { x: 100, y: 100, width: 380, height: 240 }],
];
const only = args.scenes ? args.scenes.split(",") : null;
for (const [name, view, dpr, clip] of SCENES) {
  if (only && !only.includes(name)) continue;
  const { browser, page } = await launch({ w: 900, h: 560, dpr });
  try {
    for (const [vn, q] of Object.entries(VARIANTS)) {
      await open(page, `theme=light&bench=1&reveal=off&view=${view}&${q}`);
      await page.evaluate(() => { document.getElementById("labels").style.display = "none"; document.getElementById("attribution").style.display = "none"; });
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/line-${name}-${vn}.png`, clip });
      console.log("shot", name, vn);
    }
  } finally {
    await browser.close();
  }
}
