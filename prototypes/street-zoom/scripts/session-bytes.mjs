// Bytes on the wire for one typical street session: load, fly from the world view to Ho Chi Minh City street scale, pan around.
// usage: node scripts/session-bytes.mjs pm|ofm
import { launch } from "./lib.mjs";

const src = process.argv[2] ?? "pm";
const { browser, page } = await launch({ w: 1440, h: 900, dpr: 2 });
const reqs = [];
page.on("response", async (r) => {
  const u = r.url();
  if (!(u.includes("hcmc.pmtiles") || u.includes("tiles.openfreemap.org"))) return;
  const h = r.headers();
  const len = Number(h["content-length"] ?? 0);
  reqs.push({ url: u.replace(/^https?:\/\/[^/]+/, ""), status: r.status(), len, range: h["content-range"] ?? null, enc: h["content-encoding"] ?? null });
});
try {
  await page.goto(`http://localhost:5190/?theme=dark&bench=1&src=${src}&comp=copy-device&view=100,14,2.4`);
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 60000 });
  await page.evaluate(() => window.__app.street.whenSettled(60000));
  const mark = (label) => ({ label, n: reqs.length, bytes: reqs.reduce((a, r) => a + r.len, 0) });
  const marks = [mark("world view loaded")];
  await page.evaluate(() => { window.__app.street.select("ho-chi-minh-city"); window.__app.street.flyTo(106.7009, 10.7769, 14.5); });
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__app.street.whenSettled(90000));
  marks.push(mark("flown to z14.5"));
  for (const [dx, dy] of [[300, 0], [0, 300], [-600, 0], [0, -600], [300, 300]]) {
    await page.evaluate(([x, y]) => window.__app.street.map.panBy([x, y], { duration: 0 }), [dx, dy]);
    await page.evaluate(() => window.__app.street.whenSettled(60000));
  }
  marks.push(mark("after 5 pans of 300-600 css px"));
  await page.evaluate(() => window.__app.street.map.easeTo({ zoom: 16.5, duration: 0 }));
  await page.evaluate(() => window.__app.street.whenSettled(60000));
  marks.push(mark("zoomed to z16.5"));
  console.log(JSON.stringify({ src, marks: marks.map((m) => ({ ...m, KB: Math.round(m.bytes / 1024) })), requests: reqs.length, statuses: [...new Set(reqs.map((r) => r.status))], encodings: [...new Set(reqs.map((r) => r.enc))] }, null, 1));
} finally {
  await browser.close();
}
