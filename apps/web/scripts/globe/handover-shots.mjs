// Screenshots and seam measurements of the globe <-> street handover.
//
//   BASE_URL=http://localhost:5175 OUT_DIR=/some/dir node apps/web/scripts/globe/handover-shots.mjs [dissolve|flight|seam] [desktop|mobile]
//
// dissolve  the same camera at dissolve 0, .25, .5, .75, 1 (light and dark)           -> handover-<dev>-<scheme>-d<NN>.png
// flight    stills along the Ho Chi Minh City flight, panel closed (programmatic) and open (list)  -> handover-<dev>-flight-*.png
// seam      how well the Three.js lines and the street lines coincide: per zoom, the share of the globe's ink art pixels
//           that have street ink within one art pixel (and the reverse where the street has no extra detail)
import { DESKTOP, MOBILE, OUT_DIR, ensureTiles, launch, openApp, settleApp, setCamera, waitStreetOk } from "./handover-lib.mjs";

const [mode = "all", device = "desktop"] = process.argv.slice(2);
const profile = device === "mobile" ? MOBILE : DESKTOP;
const want = (m) => mode === "all" || mode === m;
const out = (name) => `${OUT_DIR}/handover-${device}-${name}.png`;
const pad2 = (n) => String(Math.round(n * 100)).padStart(2, "0");

// Hide what differs by design between the two renderers (labels, nav) when measuring lines.
const HIDE = "[data-globe=three] > div:nth-child(2), [data-street-overlay], header, nav { visibility: hidden !important; }";

async function inkCompare(page, a, b, cell, dpr) {
  return page.evaluate(
    async ([aB64, bB64, cell, dpr]) => {
      const load = async (b64) => {
        const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bin], { type: "image/png" }));
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const g = c.getContext("2d");
        g.drawImage(bmp, 0, 0);
        return { w: bmp.width, h: bmp.height, d: g.getImageData(0, 0, bmp.width, bmp.height).data };
      };
      const [A, B] = await Promise.all([load(aB64), load(bB64)]);
      const px = Math.round(cell * dpr);
      const cols = Math.floor(A.w / px);
      const rows = Math.floor(A.h / px);
      const mask = (I) => {
        const m = new Uint8Array(cols * rows);
        for (let r = 0; r < rows; r++)
          for (let c = 0; c < cols; c++) {
            let min = 255;
            for (let y = 0; y < px; y += 2) for (let x = 0; x < px; x += 2) min = Math.min(min, I.d[((r * px + y) * I.w + c * px + x) * 4]);
            m[r * cols + c] = min < 110 ? 1 : 0;
          }
        return m;
      };
      const ma = mask(A);
      const mb = mask(B);
      const near = (m, c, r) => {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (m[(r + dy) * cols + c + dx]) return true;
        return false;
      };
      // ignore a margin (borders of the box and the covered strip are not part of the comparison)
      const m0 = 4;
      let aInk = 0, aMatched = 0, bInk = 0, bMatched = 0;
      for (let r = m0; r < rows - m0; r++)
        for (let c = m0; c < cols - m0; c++) {
          if (ma[r * cols + c]) {
            aInk++;
            if (near(mb, c, r)) aMatched++;
          }
          if (mb[r * cols + c]) {
            bInk++;
            if (near(ma, c, r)) bMatched++;
          }
        }
      return { globeInk: aInk, globeMatched: +(aMatched / Math.max(1, aInk)).toFixed(4), streetInk: bInk, streetMatched: +(bMatched / Math.max(1, bInk)).toFixed(4) };
    },
    [a.toString("base64"), b.toString("base64"), cell, dpr],
  );
}

const tiles = await ensureTiles();
const browser = await launch();
try {
  if (want("dissolve")) {
    for (const scheme of ["light", "dark"]) {
      const { page } = await openApp(browser, profile, { path: "/", colorScheme: scheme });
      await setCamera(page, { lon: 106.7, lat: 10.8, zoom: 3.2 });
      await waitStreetOk(page);
      await setCamera(page, { lon: 106.7, lat: 10.8, zoom: 3.75 });
      await settleApp(page);
      for (const b of [0, 0.25, 0.5, 0.75, 1]) {
        await page.evaluate((v) => window.__handoverDebug.forceBlend(v), b);
        await settleApp(page);
        await page.screenshot({ path: out(`${scheme}-d${pad2(b)}`) });
      }
      await page.context().close();
    }
  }

  if (want("seam")) {
    const { page } = await openApp(browser, profile, { path: "/" });
    await page.addStyleTag({ content: HIDE });
    await setCamera(page, { lon: 112, lat: 2, zoom: 4.4 });
    await waitStreetOk(page);
    const cellNow = await page.evaluate(() => window.__handoverDebug.street().debug().cellCss());
    const rows = [];
    for (const [name, view] of [["borneo", { lon: 112, lat: 2 }], ["gulf-of-thailand", { lon: 101, lat: 10 }], ["japan", { lon: 138, lat: 36 }]]) {
      for (const zoom of [4.7, 5.0, 5.3, 5.5, 6.0]) {
        await setCamera(page, { ...view, zoom });
        await page.evaluate(() => window.__handoverDebug.forceBlend(0));
        await settleApp(page);
        const a = await page.screenshot();
        await page.evaluate(() => window.__handoverDebug.forceBlend(1));
        await settleApp(page);
        const b = await page.screenshot();
        const r = await inkCompare(page, a, b, cellNow, profile.deviceScaleFactor);
        rows.push({ view: name, zoom, ...r });
      }
    }
    await page.evaluate(() => window.__handoverDebug.forceBlend(null));
    console.log(JSON.stringify({ cell: cellNow, device, seam: rows }, null, 1));
    await page.context().close();
  }

  if (want("flight")) {
    // On phones the detail slide-over unmounts the globe, so there is no flight with the panel open.
    for (const panel of device === "mobile" ? ["closed"] : ["closed", "open"]) {
      const { page } = await openApp(browser, profile, { path: "/" });
      await setCamera(page, { lon: 106.7, lat: 10.8, zoom: 2.4 });
      await page.waitForTimeout(400);
      if (panel === "open") await page.locator('[data-place-link="ho-chi-minh-city"]').evaluate((a) => a.click());
      else {
        await page.evaluate(() => window.__handoverDebug.fly({ lon: 106.7009, lat: 10.7769, zoom: 14.5259 }));
      }
      let i = 0;
      const t0 = Date.now();
      while (Date.now() - t0 < 9000) {
        const z = await page.evaluate(() => window.__handoverDebug.zoom());
        await page.screenshot({ path: out(`flight-${panel}-${String(i++).padStart(2, "0")}-z${z.toFixed(1)}`), type: "png" });
        if (z > 14.5 && !(await page.evaluate(() => window.__handoverDebug.globe.isAnimating()))) break;
      }
      await settleApp(page);
      await page.screenshot({ path: out(`flight-${panel}-end`) });
      await page.context().close();
    }
  }
} finally {
  await browser.close();
  await tiles.stop();
}
