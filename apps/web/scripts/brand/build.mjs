// Renders the brand images (public/og-default.png, apple-touch-icon.png, icon-192.png, icon-512.png, icon-maskable-512.png) from
// hand-written SVG with headless Chrome, so nothing is downloaded and no image library is needed. The sources: scripts/brand/og.svg and
// the icon below (the navbar's Orbit glyph, lucide, ISC). public/favicon.svg is hand-written too (same glyph, adapts to the scheme).
//
//   CHROME_PATH=/path/to/chrome node scripts/brand/build.mjs
//
// If `pngquant` is on the PATH the PNGs are palette-quantized afterwards (the share image stays small); without it they are kept as
// Chrome wrote them.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { DEFAULT_CHROME } from "../perf/lib.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const publicPath = (name) => here(`../../public/${name}`);

const ORBIT = `<path d="M20.341 6.484A10 10 0 0 1 10.266 21.85"/><path d="M3.659 17.516A10 10 0 0 1 13.74 2.152"/><circle cx="12" cy="12" r="3"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/>`;

/** The app icon: the Orbit glyph (light) on the near-black page, the satellites in the signal cyan. `scale` < 1 leaves room for a maskable crop. */
const iconSvg = (size, scale) => {
  const s = (size * scale) / 24;
  const o = (size - 24 * s) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#0a0a0a"/>
  <g transform="translate(${o} ${o}) scale(${s})" fill="none" stroke="#f5f5f5" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
    ${ORBIT.replace(/<circle cx="(19|5)" cy="(5|19)" r="2"\/>/g, '<circle cx="$1" cy="$2" r="2" stroke="#38d4f5" fill="#38d4f5"/>')}
  </g>
</svg>`;
};

const JOBS = [
  { file: "og-default.png", width: 1200, height: 630, svg: readFileSync(here("./og.svg"), "utf8") },
  { file: "apple-touch-icon.png", width: 180, height: 180, svg: iconSvg(180, 0.62) },
  { file: "icon-192.png", width: 192, height: 192, svg: iconSvg(192, 0.62) },
  { file: "icon-512.png", width: 512, height: 512, svg: iconSvg(512, 0.62) },
  { file: "icon-maskable-512.png", width: 512, height: 512, svg: iconSvg(512, 0.5) },
  // Wrapped into favicon.ico below (a PNG inside an ICO container), then removed.
  { file: "favicon-48.png", width: 48, height: 48, svg: iconSvg(48, 0.7) },
];

const executablePath = process.env.CHROME_PATH ?? DEFAULT_CHROME;
if (!existsSync(executablePath)) throw new Error("Set CHROME_PATH to a Chrome/Chromium executable");
const browser = await chromium.launch({ executablePath, headless: true });
for (const job of JOBS) {
  const page = await browser.newPage({ viewport: { width: job.width, height: job.height }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#0a0a0a}svg{display:block}</style>${job.svg}`);
  await page.screenshot({ path: publicPath(job.file), type: "png", clip: { x: 0, y: 0, width: job.width, height: job.height } });
  await page.close();
}
await browser.close();

let quant = true;
try {
  execFileSync("pngquant", ["--version"], { stdio: "ignore" });
} catch {
  quant = false;
}

// favicon.ico: ICONDIR + one ICONDIRENTRY + the PNG. Browsers and crawlers ask for /favicon.ico by default.
{
  const png = readFileSync(publicPath("favicon-48.png"));
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0); // reserved
  head.writeUInt16LE(1, 2); // type: icon
  head.writeUInt16LE(1, 4); // image count
  head.writeUInt8(48, 6); // width
  head.writeUInt8(48, 7); // height
  head.writeUInt16LE(1, 10); // colour planes
  head.writeUInt16LE(32, 12); // bits per pixel
  head.writeUInt32LE(png.length, 14); // image size
  head.writeUInt32LE(22, 18); // image offset
  writeFileSync(publicPath("favicon.ico"), Buffer.concat([head, png]));
  unlinkSync(publicPath("favicon-48.png"));
  JOBS.pop();
  console.log(`favicon.ico  48x48  ${(statSync(publicPath("favicon.ico")).size / 1024).toFixed(1)} kB`);
}

for (const job of JOBS) {
  const path = publicPath(job.file);
  if (quant) execFileSync("pngquant", ["--force", "--skip-if-larger", "--quality=70-95", "--strip", "--output", path, path]);
  console.log(`${job.file}  ${job.width}x${job.height}  ${(statSync(path).size / 1024).toFixed(1)} kB${quant ? " (pngquant)" : ""}`);
}
