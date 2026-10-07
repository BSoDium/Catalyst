// Reload fade (docs/web-architecture.md, "Reload fade"): a direct load of /locations/:slug paints the page colour only, then
// the stage fades in once the final framed view is drawn. Samples every animation frame from navigation on and fails on:
//   - any frame where the stage is visible (opacity > 0.02) while the camera is not at the final framing,
//   - a fade that starts before the street map is shown (unless the wait ran out),
//   - a fade longer or shorter than 400-650 ms (instant under reduced motion),
//   - any camera motion during the load.
//
//   BASE_URL=http://localhost:5175 [OUT_DIR=dir] node apps/web/scripts/globe/reload-fade.mjs [slug] [scheme]
// Shots: <OUT_DIR>/reload-<scheme>-<k>.png at 0 / 150 / 450 ms ... after the first reveal frame, when OUT_DIR is set.
import { DESKTOP, OUT_DIR, ensureTiles, launch, openApp, waitHandover } from "./handover-lib.mjs";

const slug = process.argv[2] ?? "ho-chi-minh-city";
const scheme = process.argv[3] ?? "dark";
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name} ${detail}`);
  if (!ok) failures.push(name);
};

async function run(browser, profile, tag, { reduced = false, street } = {}) {
  const { ctx, page, logs } = await openApp(browser, profile, { path: "/", colorScheme: scheme, reducedMotion: reduced ? "reduce" : "no-preference", wait: false, street });
  await page.addInitScript(() => {
    window.__rev = [];
    const t0 = performance.now();
    const loop = () => {
      const el = document.querySelector("[data-globe=three]");
      const d = window.__handoverDebug;
      window.__rev.push({
        t: Math.round(performance.now() - t0),
        op: el ? +getComputedStyle(el).opacity : null,
        revealed: !!el?.hasAttribute("data-revealed"),
        z: d ? +d.zoom().toFixed(3) : null,
        owner: d ? d.owner() : null,
        shown: d ? d.blend().shown : null,
      });
      if (performance.now() - t0 < 6000) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  await page.goto(new URL(`/locations/${slug}`, process.env.BASE_URL ?? "http://localhost:5175").toString());
  const shots = [];
  const t0 = Date.now();
  await waitHandover(page);
  // screenshots while it runs
  while (Date.now() - t0 < 3500) {
    const op = await page.evaluate(() => +getComputedStyle(document.querySelector("[data-globe=three]") ?? document.body).opacity);
    shots.push({ t: Date.now() - t0, op });
    if (OUT_DIR !== "." && shots.length % 2 === 0 && shots.length < 24) await page.screenshot({ path: `${OUT_DIR}/reload-${tag}-${String(shots.length).padStart(2, "0")}.png` });
    await page.waitForTimeout(60);
  }
  const rev = await page.evaluate(() => window.__rev);
  const finalZoom = rev.at(-1).z;
  const first = rev.find((r) => r.op !== null);
  const reveal = rev.find((r) => r.revealed);
  const visible = rev.filter((r) => r.op !== null && r.op > 0.02);
  check(`${tag}: first paint of the stage is transparent`, first && first.op === 0, `(opacity ${first?.op})`);
  check(`${tag}: it is revealed`, !!reveal);
  const wrong = visible.filter((r) => r.z !== null && Math.abs(r.z - finalZoom) > 0.05);
  check(`${tag}: never visible away from the final framing`, wrong.length === 0, `(${wrong.length} frames, zoom ${finalZoom})`);
  const zooms = new Set(rev.filter((r) => r.z !== null).map((r) => r.z));
  check(`${tag}: no camera motion during the load`, zooms.size === 1, `(${[...zooms].join(", ")})`);
  const streetFirst = visible[0]?.owner === "street";
  console.log(`  first visible frame: t=${visible[0]?.t} ms owner=${visible[0]?.owner} shown=${visible[0]?.shown} op=${visible[0]?.op}`);
  const full = rev.find((r) => r.op !== null && r.op >= 0.999 && r.revealed);
  const dur = full && visible[0] ? full.t - visible[0].t : null;
  if (reduced) check(`${tag}: reduced motion = instant`, dur !== null && dur <= 40, `(${dur} ms)`);
  else check(`${tag}: fade lasts 400-650 ms`, dur !== null && dur >= 380 && dur <= 700, `(${dur} ms)`);
  check(`${tag}: the final frame is the street map`, visible.length > 0 && rev.at(-1).owner === "street", `(owner ${rev.at(-1).owner}${streetFirst ? "" : ", revealed on the globe frame"})`);
  if (logs.length) console.log(logs);
  await ctx.close();
  return rev;
}

const tiles = await ensureTiles();
const browser = await launch();
try {
  await run(browser, DESKTOP, "desktop");
  await run(browser, DESKTOP, "desktop-reduced", { reduced: true });
  // (no phone run: on a phone a direct load of a place shows the detail slide-over and no globe at all)
  // the street map is late (its chunk takes 4 s): after the wait the globe's frame is shown, not before
  {
    const { ctx, page } = await openApp(browser, DESKTOP, { path: "/", colorScheme: scheme, wait: false });
    await page.route("**/assets/street-style-*.js", async (r) => {
      await new Promise((res) => setTimeout(res, 4000));
      await r.continue();
    });
    await page.addInitScript(() => {
      window.__rev = [];
      const t0 = performance.now();
      const loop = () => {
        const el = document.querySelector("[data-globe=three]");
        window.__rev.push({ t: Math.round(performance.now() - t0), op: el ? +getComputedStyle(el).opacity : null });
        if (performance.now() - t0 < 4500) requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    await page.goto(new URL(`/locations/${slug}`, process.env.BASE_URL ?? "http://localhost:5175").toString());
    await page.waitForTimeout(4600);
    const rev = await page.evaluate(() => window.__rev);
    const vis = rev.find((r) => r.op !== null && r.op > 0.02);
    check("late street map: the globe frame is revealed after the wait, not before", !!vis && vis.t >= 1400 && vis.t <= 2600, `(first visible at ${vis?.t} ms)`);
    await ctx.close();
  }
} finally {
  await browser.close();
  await tiles.stop();
}
if (failures.length) {
  console.error(`\n${failures.length} FAILED: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("\nreload fade ok");
