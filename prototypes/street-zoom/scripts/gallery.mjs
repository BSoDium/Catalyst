// Screenshots for docs/street-zoom-spike.md -> docs/street-zoom/*.png (then quantised with pngquant by the caller).
// usage: node scripts/gallery.mjs outdir [base-url]   (needs the preview or dev server on :5190)
import { launch, open } from "./lib.mjs";

const out = process.argv[2];
const base = process.argv[3] ?? "http://localhost:5190/";
const hide = `document.getElementById('panel').style.display='none';document.getElementById('hud').style.display='none';`;

const SHOTS = [
  ["world-dark", "theme=dark&view=106,17,3&bench=1"],
  ["world-light", "theme=light&view=106,17,3&bench=1"],
  ["native-world-dark", "theme=dark&view=106,17,3&bench=1&comp=none&native=1&px=3"],
  ["region-z8", "theme=dark&view=106.7,10.8,8.5&bench=1"],
  ["city-z11", "theme=dark&view=106.7,10.78,11.5&bench=1"],
  ["streets-z14", "theme=dark&view=106.698,10.774,14.5&bench=1"],
  ["streets-z14-light", "theme=light&view=106.698,10.774,14.5&bench=1"],
  ["block-z16", "theme=dark&view=106.6995,10.7765,16.5&bench=1"],
  ["reveal-z15", "theme=dark&view=106.7,10.775,15.2&select=ho-chi-minh-city&reveal=on&bench=1"],
  ["dissolve-40", "theme=dark&view=106.7,10.775,15.2&sharp=0.4&bench=1"],
  ["dissolve-70", "theme=dark&view=106.7,10.775,15.2&sharp=0.7&bench=1"],
  ["ofm-streets-z14", "theme=dark&view=106.698,10.774,14&src=ofm&bench=1"],
];
const { browser, page } = await launch({ w: 900, h: 560, dpr: 2 });
try {
  for (const [name, q] of SHOTS) {
    await open(page, q, base);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log("shot", name);
  }
} finally {
  await browser.close();
}
const m = await launch({ w: 390, h: 844, dpr: 3, mobile: true });
try {
  await open(m.page, "theme=dark&view=106.698,10.774,14.5&bench=1&select=ho-chi-minh-city&reveal=on", base);
  await m.page.waitForTimeout(500);
  await m.page.screenshot({ path: `${out}/mobile-streets.png` });
  console.log("shot mobile");
} finally {
  await m.browser.close();
}
