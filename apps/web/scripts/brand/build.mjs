// Renders the brand files into public/ from hand-written data, with headless Chrome, so nothing is downloaded and no image library is
// needed. Deterministic: same inputs, same bytes.
//
//   favicon.svg                          the blue-screen frown (`faceSvg` in scripts/brand/mark.mjs) on its rounded blue tile, the same in both schemes
//   favicon.ico                          the same at 16, 32 and 48 px (PNG entries, transparent corners)
//   apple-touch-icon.png (180)           the face on a full blue square (iOS rounds it itself: no transparency)
//   icon-192.png, icon-512.png           the manifest's icons
//   icon-maskable-512.png                the same with a safe zone: the face stays inside the central circle a launcher may crop to
//   og-default.png (1200x630)            the share image, from scripts/brand/og.svg (the owner's name and who they are, in the display face) over og-planet.png,
//                                        a capture of the app's own globe (scripts/brand/og-planet.mjs; committed, so this build needs no running app)
//
//   CHROME_PATH=/path/to/chrome node scripts/brand/build.mjs            all of them
//   CHROME_PATH=... node scripts/brand/build.mjs --only=icons|og         only the icons (and favicon files), or only the share image
//
// The face is a vector in a 32-unit box, so every size is drawn, not scaled. If `pngquant` is on the PATH the PNGs are palette-quantized
// afterwards (a few colours: under a kilobyte); without it they are kept as Chrome wrote them.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { DEFAULT_CHROME } from "../perf/lib.mjs";
import { FACE_SIZE, faceMarkup, faceSvg } from "./mark.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const publicPath = (name) => here(`../../public/${name}`);

const only = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);
if (only && only !== "icons" && only !== "og") throw new Error("--only takes icons or og");

const PAGE = "#0a0a0a"; // --background, dark: behind the share image and the icons that have no transparency

/** The icon: the face on its blue tile in a `size` square. `rx` rounds the tile's corners, in units of its 32-unit box (0 for iOS and launchers, which crop and round the icon themselves). */
const iconSvg = (size, rx) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${FACE_SIZE} ${FACE_SIZE}">${faceMarkup({ rx })}</svg>`;

const ICON_JOBS = [
  // The iOS icon and the maskable one are full squares (the system rounds or crops them: no transparency, no corners of our own).
  { file: "apple-touch-icon.png", width: 180, height: 180, svg: iconSvg(180, 0) },
  // The manifest's "any" icons and the ICO's entries are the favicon itself: the rounded tile, transparent corners.
  { file: "icon-192.png", width: 192, height: 192, svg: iconSvg(192, 7.5), transparent: true },
  { file: "icon-512.png", width: 512, height: 512, svg: iconSvg(512, 7.5), transparent: true },
  // Maskable: launchers crop to a circle of 80 % of the side (r = 205 px); the face reaches 9 units of 32 from the centre, 144 px of 512.
  { file: "icon-maskable-512.png", width: 512, height: 512, svg: iconSvg(512, 0) },
  // The ICO's three entries (removed once wrapped).
  { file: "favicon-16.png", width: 16, height: 16, svg: iconSvg(16, 7.5), transparent: true, temp: true },
  { file: "favicon-32.png", width: 32, height: 32, svg: iconSvg(32, 7.5), transparent: true, temp: true },
  { file: "favicon-48.png", width: 48, height: 48, svg: iconSvg(48, 7.5), transparent: true, temp: true },
];
const OG_PLANET = readFileSync(here("./og-planet.png")).toString("base64");
const OG_JOB = { file: "og-default.png", width: 1200, height: 630, svg: readFileSync(here("./og.svg"), "utf8").replace("__OG_PLANET__", `data:image/png;base64,${OG_PLANET}`) };
// The share image is set in the site's display face. The page below has no network and no file access, so the font file travels inside
// it as a data URI (the variable font: weights 200 to 800, the optical size by the browser's default).
const DISPLAY_FONT = readFileSync(publicPath("fonts/bricolage-grotesque-5.3.0-latin-wght-opsz.woff2")).toString("base64");
const FONT_FACE = `@font-face{font-family:"Bricolage Grotesque";font-weight:200 800;font-style:normal;src:url(data:font/woff2;base64,${DISPLAY_FONT}) format("woff2")}`;

const jobs = [...(only === "og" ? [] : ICON_JOBS), ...(only === "icons" ? [] : [OG_JOB])];

const executablePath = process.env.CHROME_PATH ?? DEFAULT_CHROME;
if (!existsSync(executablePath)) throw new Error("Set CHROME_PATH to a Chrome/Chromium executable");
const browser = await chromium.launch({ executablePath, headless: true });
for (const job of jobs) {
  const page = await browser.newPage({ viewport: { width: job.width, height: job.height }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>${FONT_FACE}html,body{margin:0;background:${job.transparent ? "transparent" : PAGE}}svg{display:block}</style>${job.svg}`);
  await page.evaluate(() => document.fonts.load('800 104px "Bricolage Grotesque"').then(() => document.fonts.load('200 104px "Bricolage Grotesque"')).then(() => document.fonts.load('300 30px "Bricolage Grotesque"')));
  // (an embedded picture in the SVG: decoded before the shot, or the shot has the page without it)
  await page.evaluate(() => Promise.all([...document.querySelectorAll("image")].map((el) => { const img = new Image(); img.src = el.getAttribute("href"); return img.decode(); })));
  await page.waitForTimeout(100);
  await page.screenshot({ path: publicPath(job.file), type: "png", clip: { x: 0, y: 0, width: job.width, height: job.height }, omitBackground: !!job.transparent });
  await page.close();
}
await browser.close();

let quant = true;
try {
  execFileSync("pngquant", ["--version"], { stdio: "ignore" });
} catch {
  quant = false;
}
for (const job of jobs) {
  if (!quant) continue;
  const path = publicPath(job.file);
  try {
    execFileSync("pngquant", ["--force", "--skip-if-larger", `--quality=${job === OG_JOB ? "70-95" : "70-100"}`, "--strip", "--output", path, path]);
  } catch {
    // exit 98 (not smaller) or 99 (quality too low): the file stays as Chrome wrote it
  }
}

if (only !== "og") {
  // favicon.svg: the same mark, ink follows the scheme.
  writeFileSync(publicPath("favicon.svg"), faceSvg({ px: 32 }));
  console.log(`favicon.svg  ${(statSync(publicPath("favicon.svg")).size / 1024).toFixed(1)} kB`);

  // favicon.ico: ICONDIR + one ICONDIRENTRY per size + the PNGs. Browsers and crawlers ask for /favicon.ico by default.
  const entries = ICON_JOBS.filter((j) => j.temp).map((j) => ({ size: j.width, png: readFileSync(publicPath(j.file)) }));
  const head = Buffer.alloc(6 + 16 * entries.length);
  head.writeUInt16LE(0, 0); // reserved
  head.writeUInt16LE(1, 2); // type: icon
  head.writeUInt16LE(entries.length, 4);
  let offset = head.length;
  entries.forEach((e, i) => {
    const at = 6 + 16 * i;
    head.writeUInt8(e.size, at); // width
    head.writeUInt8(e.size, at + 1); // height
    head.writeUInt16LE(1, at + 4); // colour planes
    head.writeUInt16LE(32, at + 6); // bits per pixel
    head.writeUInt32LE(e.png.length, at + 8); // image size
    head.writeUInt32LE(offset, at + 12); // image offset
    offset += e.png.length;
  });
  writeFileSync(publicPath("favicon.ico"), Buffer.concat([head, ...entries.map((e) => e.png)]));
  for (const j of ICON_JOBS.filter((j) => j.temp)) unlinkSync(publicPath(j.file));
  console.log(`favicon.ico  ${entries.map((e) => e.size).join(", ")} px  ${(statSync(publicPath("favicon.ico")).size / 1024).toFixed(1)} kB`);
}

for (const job of jobs.filter((j) => !j.temp)) {
  const path = publicPath(job.file);
  console.log(`${job.file}  ${job.width}x${job.height}  ${(statSync(path).size / 1024).toFixed(1)} kB${quant ? " (pngquant)" : ""}`);
}
