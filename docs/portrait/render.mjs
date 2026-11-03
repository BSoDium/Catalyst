// Renders a blueprint SVG to a PNG at its own size (940 x 640) in a colour scheme, in headless Chrome: `node render.mjs portrait.svg out.png [light|dark] [scale]` (the site's files are at scale 2: 1880 x 1280).
// (The SVG carries its own `prefers-color-scheme` styles; the webp files of the content repo are made from these PNGs.)
import { createRequire } from "node:module";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const [, , src, out, scheme = "light", scale = "1"] = process.argv;
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const page = await (await browser.newContext({ viewport: { width: 940, height: 640 }, deviceScaleFactor: Number(scale), colorScheme: scheme === "dark" ? "dark" : "light" })).newPage();
await page.goto("file://" + resolve(src));
await page.screenshot({ path: out, omitBackground: true });
await browser.close();
