// How close is the native art-resolution render (default) to the device-resolution render (hires=1) on the real map?
// Same view, same cell grid; compares the finished art images cell by cell: agreement of ink cells (IoU) and of all classes.
//   BASE_URL=http://localhost:5174 node apps/web/scripts/street/native-compare.mjs [scale=3]
import { ensureTiles, launch, open, dev, waitReady, settle, DESKTOP, FALLBACK_URL } from "./_lib.mjs";

const extra = Object.fromEntries(new URLSearchParams(process.argv[2] ?? ""));
const tiles = await ensureTiles();
const browser = await launch();
const views = ["106.7009,10.7769,14.5", "106.7009,10.7769,16.5", "106.7009,10.7769,12.5"];
const grab = async (view, mode) => {
  const { page } = await open(browser, DESKTOP);
  await page.goto(dev("/dev/street", { source: "fallback", fallbackUrl: FALLBACK_URL, hud: 0, view, theme: "light", ...(mode === "hires" ? { hires: 1 } : extra) }));
  await waitReady(page);
  await settle(page);
  const r = await page.evaluate(() => {
    const c = window.__streetDebug.readCodes();
    return { cols: c.cols, rows: c.rows, codes: Array.from(c.codes) };
  });
  await page.context().close();
  return r;
};
const out = [];
for (const v of views) {
  const a = await grab(v, "native");
  const b = await grab(v, "hires");
  if (a.cols !== b.cols || a.rows !== b.rows) {
    out.push({ view: v, error: `grid differs ${a.cols}x${a.rows} vs ${b.cols}x${b.rows}` });
    continue;
  }
  const ink = (c) => c === 1 || c === 2;
  let both = 0, either = 0, same = 0, inkA = 0, inkB = 0;
  for (let i = 0; i < a.codes.length; i++) {
    const x = a.codes[i], y = b.codes[i];
    if (x === y) same++;
    if (ink(x)) inkA++;
    if (ink(y)) inkB++;
    if (ink(x) && ink(y)) both++;
    if (ink(x) || ink(y)) either++;
  }
  out.push({ view: v, inkNative: inkA, inkHires: inkB, inkIoU: +(both / Math.max(1, either)).toFixed(3), cellAgreement: +(same / a.codes.length).toFixed(4) });
}
await browser.close();
await tiles.stop();
console.log(JSON.stringify(out, null, 1));
