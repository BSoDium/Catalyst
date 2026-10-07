// Regression checks for two owner reports (docs/palette/):
//   A. With the detail panel open at street scale, the soft edge on the right showed an image that did not move with the zoom
//      (the suspended Three.js canvas under the street map's dissolving edge kept its last frame). The suspended canvas is now
//      hidden, and the edge shows live content only.
//   B. Coasts looked dotted around zoom 5 at northern latitudes (a dashed "band" layer between the world coastline and the tile
//      coast). No coast or border layer of the live map may be dashed, and no layer may be a band.
//
//   BASE_URL=http://localhost:5175 node apps/web/scripts/globe/stale-check.mjs
import { DESKTOP, ensureTiles, launch, openApp, settleApp, setCamera, waitStreetOk } from "./handover-lib.mjs";

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name} ${detail}`);
  if (!ok) failures.push(name);
};

const tiles = await ensureTiles();
const browser = await launch();
try {
  // ---- A ----
  {
    const { page } = await openApp(browser, DESKTOP, { path: "/locations/ho-chi-minh-city" });
    await waitStreetOk(page);
    await settleApp(page);
    const st = await page.evaluate(() => {
      const c = document.querySelector('[data-globe="three"] > div canvas');
      return { suspended: window.__handoverDebug.suspended(), vis: c ? getComputedStyle(c).opacity : null, inset: window.__globeDebug.inset().inset };
    });
    check("A: street shown, panel open: the Three.js canvas is suspended and transparent (still the pointer target)", st.suspended && st.vis === "0", JSON.stringify(st));
    // The transparent canvas must stay the pointer target at street scale (a `visibility: hidden` one gets no events): a drag pans.
    const before = await page.evaluate(() => window.__handoverDebug.globe.view());
    await page.mouse.move(400, 450);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(400 + i * 12, 450 + i * 4);
    await page.mouse.up();
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => window.__handoverDebug.globe.view());
    check("A: a mouse drag pans the map at street scale (the suspended canvas is still the pointer target)", Math.abs(after.lon - before.lon) > 1e-5 || Math.abs(after.lat - before.lat) > 1e-5, `(lon ${before.lon.toFixed(5)} -> ${after.lon.toFixed(5)})`);
    // The soft edge on the left of the panel: with the Three.js canvas forced out of the page the pixels must not change (it
    // contributes nothing), and the edge must move with the map (it differs between two zooms).
    const strip = { x: 1440 - st.inset - 100, y: 100, width: 190, height: 640 };
    const grab = async (zoom, hideGlobe) => {
      await setCamera(page, { lon: 106.69, lat: 10.775, zoom });
      await settleApp(page);
      await page.evaluate((h) => {
        const c = document.querySelector('[data-globe="three"] > div canvas');
        c.style.display = h ? "none" : "";
      }, hideGlobe);
      const png = await page.screenshot({ clip: strip, type: "png" });
      await page.evaluate(() => (document.querySelector('[data-globe="three"] > div canvas').style.display = ""));
      return png;
    };
    const px = (a, b) =>
      page.evaluate(async ([ab, bb]) => {
        const dec = async (b64) => {
          const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const bmp = await createImageBitmap(new Blob([bin], { type: "image/png" }));
          const cv = new OffscreenCanvas(bmp.width, bmp.height);
          const g = cv.getContext("2d");
          g.drawImage(bmp, 0, 0);
          return g.getImageData(0, 0, bmp.width, bmp.height).data;
        };
        const [A, B] = await Promise.all([dec(ab), dec(bb)]);
        let diff = 0;
        for (let i = 0; i < A.length; i += 4) if (Math.abs(A[i] - B[i]) > 1) diff++;
        return diff;
      }, [a.toString("base64"), b.toString("base64")]);
    for (const z of [13.2, 15.5]) {
      const withGlobe = await grab(z, false);
      const without = await grab(z, true);
      const d = await px(withGlobe, without);
      check(`A: z${z}, panel open: the Three.js canvas shows through nowhere in the soft edge`, d === 0, `(${d} pixels change when it is removed)`);
    }
    const moved = await px(await grab(13.2, false), await grab(15.5, false));
    check("A: the soft edge shows live map content (it changes with the zoom)", moved > 500, `(${moved} pixels differ between z13.2 and z15.5)`);
    // back to the globe: the canvas is shown again, drawn for this camera
    await setCamera(page, { lon: 106.69, lat: 10.775, zoom: 3.5 });
    await settleApp(page);
    const back = await page.evaluate(() => {
      const c = document.querySelector('[data-globe="three"] > div canvas');
      return { suspended: window.__handoverDebug.suspended(), vis: getComputedStyle(c).opacity, owner: window.__handoverDebug.owner() };
    });
    check("A: zoomed out to the globe: the canvas is visible again", !back.suspended && back.vis === "1" && back.owner === "globe", JSON.stringify(back));
    await page.context().close();
  }
  // ---- B ----
  {
    const { page } = await openApp(browser, DESKTOP, { path: "/", street: { forceSource: "primary" } });
    await setCamera(page, { lon: -3, lat: 53, zoom: 5.15 });
    await waitStreetOk(page);
    await page.waitForTimeout(3000);
    const r = await page.evaluate(() => {
      const map = window.__handoverDebug.street().debug().map();
      const layers = map.getStyle().layers;
      const dashed = (id) => map.getLayer(id) && map.getPaintProperty(id, "line-dasharray") !== undefined;
      return {
        band: layers.filter((l) => /band/.test(l.id)).map((l) => l.id),
        dashedCoastOrBorder: ["world-coast", "water-edge", "world-borders", "boundary-country"].filter(dashed),
        owner: window.__handoverDebug.owner(),
        mapZoom: map.getZoom(),
      };
    });
    check("B: no band layer, no dashed coast or border on the live map (UK at the cut)", r.band.length === 0 && r.dashedCoastOrBorder.length === 0, JSON.stringify(r));
    await page.context().close();
  }
} finally {
  await browser.close();
  await tiles.stop();
}
if (failures.length) {
  console.error(`\n${failures.length} FAILED: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("\nstale / dashed-coast checks ok");
