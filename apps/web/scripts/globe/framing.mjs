// Checks for the direct-load framing, the view radius and the cut between the renderers (Playwright, headless Chrome).
//
//   BASE_URL=http://localhost:5173 [SHOTS=1] node apps/web/scripts/globe/framing.mjs [reload|flight|cut|panel|reduced|mobile]
//
// reload   /locations/<slug> reloaded: the camera is constant from the first frame, the cut happens without a flight (+ screenshots with SHOTS=1)
// flight   a list selection from / ends at the same view as the reload
// cut      per animation frame, renderer / markers / labels never disagree (no half state) through a flight in and out
// panel    the same place is framed wider with the panel open than closed (by log2 of the free-side ratio)
// reduced  reduced motion: reload starts framed, selection jumps there
// mobile   390x844: the whole circle fits the width, the places screenshot
// Uses the real primary tile source (OpenFreeMap) since Lisbon and Paris are outside the local archive.
import { APP as _APP, DESKTOP, MOBILE, launch, openApp, settleApp, waitStreetOk } from "./handover-lib.mjs";

const APP = process.env.BASE_URL ?? "http://localhost:5173";
process.env.BASE_URL = APP;
const SHOTS = process.env.SHOTS === "1";
const SHOT_DIR = new URL("../../../../docs/screenshots/", import.meta.url).pathname;
const SLUGS = ["lisbon", "paris", "ho-chi-minh-city"];
const only = process.argv.slice(2);
const run = (n) => only.length === 0 || only.includes(n);
const failures = [];
const expect = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : " " + JSON.stringify(detail)}`);
  if (!ok) failures.push(name);
};
const OPEN = { street: { forceSource: "primary" } };
const openPlace = (page, slug) => page.locator(`[data-place-link="${slug}"]`).evaluate((a) => a.click());
const view = (page) => page.evaluate(() => window.__handoverDebug.globe.view());
const near = (a, b, tol = 1e-6) => Math.abs(a.lon - b.lon) < tol && Math.abs(a.lat - b.lat) < tol && Math.abs(a.zoom - b.zoom) < tol;

/** Open a path and record the camera on every animation frame from the first one the debug hook exists. */
async function loadSampling(browser, ctxOpts, path, extra = {}) {
  const o = await openApp(browser, ctxOpts, { path, wait: false, ...OPEN, ...extra });
  await o.page.evaluate(() => {
    window.__samples = [];
    const tick = () => {
      const d = window.__handoverDebug;
      if (d) window.__samples.push({ t: performance.now(), ...d.globe.view(), shown: d.blend().shown, flying: d.globe.isAnimating() });
      if (window.__samples.length < 600) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return o;
}

const browser = await launch();
try {
  if (run("reload")) {
    for (const slug of SLUGS) {
      for (const scheme of ["light", "dark"]) {
        const { page, logs } = await loadSampling(browser, DESKTOP, `/locations/${slug}`, { colorScheme: scheme });
        await page.waitForFunction(() => window.__handoverDebug?.owner() === "street", null, { timeout: 45000 });
        await settleApp(page);
        const s = await page.evaluate(() => window.__samples);
        const first = s[0];
        const constant = s.every((v) => near(v, first, 1e-9));
        expect(`reload ${slug} ${scheme}: camera constant over ${s.length} frames from the first`, constant && s.length > 5, { first, last: s.at(-1) });
        expect(`reload ${slug} ${scheme}: first frame is already at street scale framing (zoom > 9)`, first.zoom > 9, first);
        const c = await page.evaluate(() => window.__handoverDebug.cuts());
        expect(`reload ${slug} ${scheme}: exactly one cut, no back-and-forth`, c.toStreet === 1 && c.toGlobe === 0, c);
        expect(`reload ${slug} ${scheme}: no page errors`, !logs.some((l) => l.startsWith("pageerror")), logs.slice(0, 3));
        if (SHOTS && scheme === "light") await page.screenshot({ path: `${SHOT_DIR}framing-${slug}-light.png` });
        if (SHOTS && scheme === "dark") await page.screenshot({ path: `${SHOT_DIR}framing-${slug}-dark.png` });
        await page.context().close();
      }
    }
  }

  if (run("flight")) {
    for (const slug of SLUGS) {
      const a = await openApp(browser, DESKTOP, { path: `/locations/${slug}`, ...OPEN });
      await waitStreetOk(a.page);
      await settleApp(a.page);
      const reloaded = await view(a.page);
      await a.page.context().close();
      const b = await openApp(browser, DESKTOP, { path: "/", ...OPEN });
      await openPlace(b.page, slug);
      await b.page.waitForFunction(() => window.__handoverDebug.globe.isAnimating(), null, { timeout: 5000 }).catch(() => {});
      await b.page.waitForFunction(() => !window.__handoverDebug.globe.isAnimating(), null, { timeout: 30000 });
      await waitStreetOk(b.page);
      await settleApp(b.page);
      const flown = await view(b.page);
      expect(`flight ${slug}: selection ends at the reload framing`, near(flown, reloaded, 1e-3), { flown, reloaded });
      await b.page.context().close();
    }
  }

  if (run("cut")) {
    for (const slug of ["lisbon", "ho-chi-minh-city"]) {
      const { page, logs } = await openApp(browser, DESKTOP, { path: "/", ...OPEN });
      await page.evaluate(() => {
        window.__states = [];
        const q = (s) => document.querySelector(s);
        const tick = () => {
          const d = window.__handoverDebug;
          const st = q('[data-globe="three"] > div:nth-child(3)');
          const labels = q('[data-globe="three"] > div:nth-child(2)');
          const ov = q("[data-street-overlay]");
          window.__states.push({
            zoom: d.zoom(), owner: d.owner(), susp: d.suspended(),
            street: st ? +getComputedStyle(st).opacity : null,
            labels: labels ? +getComputedStyle(labels).opacity : null,
            overlay: ov ? +getComputedStyle(ov).opacity : null,
          });
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      await openPlace(page, slug);
      await page.waitForFunction(() => window.__handoverDebug.owner() === "street", null, { timeout: 45000 });
      await settleApp(page);
      await page.evaluate(() => window.__handoverDebug.fly({ ...window.__handoverDebug.globe.view(), zoom: 3 }));
      await page.waitForFunction(() => window.__handoverDebug.owner() === "globe", null, { timeout: 30000 });
      await settleApp(page);
      const st = await page.evaluate(() => window.__states);
      const binary = st.every((s) => [s.street, s.labels].every((v) => v === null || v === 0 || v === 1));
      expect(`cut ${slug}: street and labels opacity only ever 0 or 1 (${st.length} frames)`, binary, st.find((s) => ![0, 1, null].includes(s.street) || ![0, 1, null].includes(s.labels)));
      const mixed = st.filter((s) => s.street === 1 && s.labels === 1);
      const empty = st.filter((s) => s.street === 0 && s.labels === 0);
      expect(`cut ${slug}: markers/labels never double (street shown with globe labels)`, mixed.length === 0, mixed.slice(0, 2));
      expect(`cut ${slug}: never neither (street hidden with globe labels hidden)`, empty.length === 0, empty.slice(0, 2));
      const sus = st.filter((s) => s.street === 1 && !s.susp);
      expect(`cut ${slug}: globe suspended whenever the street map is shown`, sus.length <= 1, sus.slice(0, 2));
      const c = await page.evaluate(() => window.__handoverDebug.cuts());
      expect(`cut ${slug}: one swap each way`, c.toStreet === 1 && c.toGlobe === 1, c);
      noErr(logs, `cut ${slug}`);
      await page.context().close();
    }
  }

  if (run("panel")) {
    const { page } = await openApp(browser, DESKTOP, { path: "/", ...OPEN });
    const closed = await page.evaluate(() => window.__handoverDebug.framingZoom("lisbon"));
    await openPlace(page, "lisbon");
    await page.waitForTimeout(600);
    const open = await page.evaluate(() => window.__handoverDebug.framingZoom("lisbon"));
    expect(`panel: open framing is wider by log2(900/720)`, Math.abs(closed - open - Math.log2(900 / 720)) < 1e-6, { closed, open });
    await page.context().close();
  }

  if (run("reduced")) {
    const { page } = await loadSampling(browser, DESKTOP, "/locations/lisbon", { reducedMotion: "reduce" });
    await page.waitForFunction(() => window.__handoverDebug?.owner() === "street", null, { timeout: 45000 });
    await settleApp(page);
    const s = await page.evaluate(() => window.__samples);
    expect("reduced: reload camera constant", s.every((v) => near(v, s[0], 1e-9)), s[0]);
    const reloaded = s.at(-1);
    await page.context().close();
    const b = await openApp(browser, { ...DESKTOP }, { path: "/", reducedMotion: "reduce", ...OPEN });
    await openPlace(b.page, "lisbon");
    await waitStreetOk(b.page);
    await settleApp(b.page);
    expect("reduced: selection lands on the reload framing", near(await view(b.page), reloaded, 1e-3), null);
    await b.page.context().close();
  }

  if (run("mobile")) {
    for (const slug of SLUGS) {
      const { page } = await openApp(browser, MOBILE, { path: "/", ...OPEN });
      await page.evaluate((s) => window.__handoverDebug.select(s), slug);
      await page.waitForFunction(() => window.__handoverDebug.globe.isAnimating(), null, { timeout: 5000 }).catch(() => {});
      await page.waitForFunction(() => window.__handoverDebug.owner() === "street", null, { timeout: 45000 });
      await settleApp(page);
      const z = await page.evaluate(() => window.__handoverDebug.zoom());
      const want = await page.evaluate((s) => window.__handoverDebug.framingZoom(s), slug);
      expect(`mobile ${slug}: ends at the framing`, Math.abs(z - want) < 1e-3, { z, want });
      if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}framing-${slug}-mobile.png` });
      await page.context().close();
    }
  }
} finally {
  await browser.close();
}
function noErr(logs, name) {
  expect(`${name}: no page errors`, !logs.some((l) => l.startsWith("pageerror")), logs.slice(0, 3));
}
if (failures.length) {
  console.error(`\n${failures.length} failed`);
  process.exit(1);
}
