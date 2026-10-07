// Quick screenshot of the dev route: node shot.mjs <name> [key=value ...]   (dpr=2 w=1440 h=900 scheme=dark are options)
import { ensureTiles, launch, open, dev, waitReady, settle, DESKTOP, OUT_DIR, FALLBACK_URL } from "./_lib.mjs";

const [name, ...rest] = process.argv.slice(2);
const params = Object.fromEntries(rest.map((a) => a.split("=")));
const scheme = params.scheme ?? "light";
const w = Number(params.w ?? 1440), h = Number(params.h ?? 900), dpr = Number(params.dpr ?? 2);
for (const k of ["scheme", "w", "h", "dpr"]) delete params[k];
const tiles = await ensureTiles();
const browser = await launch();
try {
  const { page, logs } = await open(browser, { viewport: { width: w, height: h }, deviceScaleFactor: dpr }, { colorScheme: scheme });
  await page.goto(dev("/dev/street", { fallbackUrl: FALLBACK_URL, hud: 0, ...params }));
  try {
    await waitReady(page);
    await settle(page);
  } catch (e) {
    console.error("not ready:", e.message.split("\n")[0], logs, await page.evaluate(() => ({ street: !!window.__street, state: document.querySelector("[data-dev-street]")?.getAttribute("data-tile-state") })));
    throw e;
  }
  await page.screenshot({ path: `${OUT_DIR}/${name}.png` });
  console.log(JSON.stringify({ tile: await page.evaluate(() => window.__streetDebug.tile().status), logs }, null, 1));
} finally {
  await browser.close();
  await tiles.stop();
}
