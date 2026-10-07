// The globe -> street swap, measured. For a camera (unified zoom) the app is shown once as the Three.js globe (dissolve forced to 0)
// and once as the street map (forced to 1); both screenshots are reduced to palette levels and compared cell by cell:
//   peakGlobe / peakStreet   cells at the `peak` level (coastline and country borders: what the globe draws, 110m coast and 50m borders)
//   globeMatched             share of the globe's peak cells that have a street peak cell within one art cell (the swap does not move them)
//   streetMatched            the reverse (what the street draws as a coast / border that the globe does not have)
//   regionCells              street cells at levels 1..peak-1 (region borders fading in, graticule, ...) per 1000 cells
// Evidence: a contact sheet per view, rows = zoom, left = globe, right = street (docs/street-zoom/cut-<view>-<tag>.png).
//
//   BASE_URL=http://localhost:5481 SOURCE=primary node scripts/street/cut-seam.mjs [--tag=after] [--views=europe,borneo] [--zooms=3,3.4,3.8,4.2,4.6,5.05] [--sheet=1] [--out=DIR] [--theme=light]
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { DESKTOP, launch, openApp, settleApp, setCamera, waitStreetOk } from "../globe/handover-lib.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const t = a.replace(/^--/, ""); const i = t.indexOf("="); return i < 0 ? [t, "1"] : [t.slice(0, i), t.slice(i + 1)]; }));
const tag = args.tag ?? "after";
const out = args.out ?? process.env.OUT_DIR ?? ".";
const theme = args.theme ?? "light";
const VIEWS = {
  europe: { lon: 2, lat: 46 },
  iberia: { lon: -4, lat: 40 },
  borneo: { lon: 112, lat: 2 },
  japan: { lon: 138, lat: 36 },
  canada: { lon: -100, lat: 60 },
  scandinavia: { lon: 15, lat: 62 },
  colombia: { lon: -74, lat: 4.5 },
};
const views = (args.views ?? "europe,borneo,japan,canada").split(",");
const zooms = (args.zooms ?? "3,3.4,3.8,4.2,4.6,5.05").split(",").map(Number);
mkdirSync(out, { recursive: true });

// the palette, as engine/palette.ts builds it (OKLab mix with the eased map ramp), to map screenshot pixels back to levels
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const lab = ([r, g, b]) => { const lr = toLin(r), lg = toLin(g), lb = toLin(b); const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb), m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb), s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb); return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]; };
const rgb = ([L, a, b]) => { const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3; const c = (v) => Math.min(1, Math.max(0, toSrgb(Math.min(1, Math.max(0, v))))); return [c(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), c(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), c(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)]; };
function ramp(theme, n = 12) {
  const bg = theme === "dark" ? [0.039, 0.039, 0.039] : [0.984, 0.984, 0.984], ink = theme === "dark" ? [0.96, 0.96, 0.96] : [0.039, 0.039, 0.039];
  const contrast = theme === "dark" ? 0.58 : 0.55, gamma = theme === "dark" ? 1 : 1.15, top = n - 2;
  const A = lab(bg), B = lab(ink);
  return Array.from({ length: n }, (_, k) => (k === 0 ? bg : k === n - 1 ? ink : rgb(A.map((v, i) => v + (B[i] - v) * contrast * (k / top) ** gamma)))).map((c) => c.map((v) => v * 255));
}
const RAMP = ramp(theme);
const HIDE = "[data-globe=three] > div:nth-child(2), [data-street-overlay], header, nav, [data-attribution] { visibility: hidden !important; }";

async function levelsOf(page, png, cell, dpr) {
  return page.evaluate(async ([b64, cell, dpr, RAMP]) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bin], { type: "image/png" }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
    const px = Math.round(cell * dpr);
    const cols = Math.floor(bmp.width / px), rows = Math.floor(bmp.height / px);
    const lv = new Uint8Array(cols * rows);
    const lum = (r, gg, b) => 0.2126 * r + 0.7152 * gg + 0.0722 * b;
    const L = RAMP.map((x) => lum(...x));
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      const i = ((r * px + (px >> 1)) * bmp.width + q * px + (px >> 1)) * 4;
      const v = lum(d[i], d[i + 1], d[i + 2]);
      let best = 0, bd = 1e9;
      for (let k = 0; k < L.length; k++) { const e = Math.abs(L[k] - v); if (e < bd) { bd = e; best = k; } }
      lv[r * cols + q] = best;
    }
    return { cols, rows, lv: Array.from(lv) };
  }, [png.toString("base64"), cell, dpr, RAMP]);
}
function compare(A, B, peak) {
  const { cols, rows } = A;
  const near = (m, c, r) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = c + dx, y = r + dy; if (x >= 0 && y >= 0 && x < cols && y < rows && m[y * cols + x]) return true; } return false; };
  const pk = (a) => a.map((v) => (v >= peak ? 1 : 0));
  const pa = pk(A.lv), pb = pk(B.lv);
  const m0 = 4;
  let an = 0, am = 0, bn = 0, bm = 0, soft = 0, tot = 0;
  for (let r = m0; r < rows - m0; r++) for (let c = m0; c < cols - m0; c++) {
    tot++;
    if (pa[r * cols + c]) { an++; if (near(pb, c, r)) am++; }
    if (pb[r * cols + c]) { bn++; if (near(pa, c, r)) bm++; }
    const v = B.lv[r * cols + c];
    if (v > 0 && v < peak) soft++;
  }
  return { peakGlobe: an, peakStreet: bn, globeMatched: +(am / Math.max(1, an)).toFixed(3), streetMatched: +(bm / Math.max(1, bn)).toFixed(3), softPer1000: +((1000 * soft) / tot).toFixed(1) };
}

const browser = await launch();
const rows = [];
try {
  const { page, logs } = await openApp(browser, { ...DESKTOP, deviceScaleFactor: 1 }, { path: "/", colorScheme: theme, street: { forceSource: "primary" } });
  await page.addStyleTag({ content: HIDE });
  await setCamera(page, { lon: 2, lat: 46, zoom: 4.4 });
  await waitStreetOk(page);
  const cell = await page.evaluate(() => window.__handoverDebug.street().debug().cellCss());
  const peak = 10;
  for (const name of views) {
    const files = [];
    for (const zoom of zooms) {
      await setCamera(page, { ...VIEWS[name], zoom });
      await page.evaluate(() => window.__handoverDebug.forceBlend(0));
      await settleApp(page);
      const a = await page.screenshot();
      await page.evaluate(() => window.__handoverDebug.forceBlend(1));
      await settleApp(page);
      await page.waitForTimeout(500);
      const b = await page.screenshot();
      const m = compare(await levelsOf(page, a, cell, 1), await levelsOf(page, b, cell, 1), peak);
      const row = { view: name, zoom, theme, tag, ...m };
      rows.push(row);
      console.log(JSON.stringify(row));
      if (args.sheet) {
        const fa = `${out}/_seam-${name}-${zoom}-g.png`, fb = `${out}/_seam-${name}-${zoom}-s.png`;
        writeFileSync(fa, a); writeFileSync(fb, b);
        files.push([zoom, fa, fb]);
      }
    }
    if (args.sheet) {
      const py = `import sys\nfrom PIL import Image, ImageDraw\nrows=[a.split('|') for a in sys.argv[2:]]\nW,H=720,450\nim=Image.new('RGB',(W*2+4,(H+4)*len(rows)),(255,0,255))\nd=ImageDraw.Draw(im)\nfor i,(z,a,b) in enumerate(rows):\n  for j,p in enumerate((a,b)):\n    t=Image.open(p).convert('RGB'); w,h=t.size; t=t.crop((w//2-W//2,h//2-H//2+40,w//2+W//2,h//2+H//2+40)); im.paste(t,(j*(W+4),i*(H+4)))\n  d.text((8,i*(H+4)+6),'zoom '+z+'  globe | street',fill=(200,0,0))\nim=im.resize((im.width*2//3,im.height*2//3),Image.LANCZOS)\nim.quantize(32,dither=Image.Dither.NONE).save(sys.argv[1],optimize=True)\n`;
      writeFileSync(`${out}/_sheet.py`, py);
      execFileSync("python3", [`${out}/_sheet.py`, `${out}/cut-${name}-${tag}.png`, ...files.map(([z, a, b]) => `${z}|${a}|${b}`)]);
      for (const [, a, b] of files) execFileSync("rm", ["-f", a, b]);
      execFileSync("rm", ["-f", `${out}/_sheet.py`]);
    }
  }
  await page.evaluate(() => window.__handoverDebug.forceBlend(null));
  if (logs.length) console.error(logs.slice(-5).join("\n"));
} finally {
  await browser.close();
}
if (args.json) writeFileSync(args.json, JSON.stringify(rows, null, 1));
