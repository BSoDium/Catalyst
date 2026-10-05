// Scripted scenarios. Each is { id, title, needs, setup(page, env), run(page, env) }: `setup` is not measured, `run` is.
// Input is REAL (trusted mouse / wheel events through CDP), so event handling, inertia and the on-demand frame loop
// are all in the measurement. `needs: "debug"` scenarios use window.__handoverDebug (absent before the handover commit).
import { sleep, waitQuiet } from "./lib.mjs";

const HCMC = { lon: 106.7009, lat: 10.7769 };

/** Mouse drag along `pathAt(i/n)` for `ms`, one event per ~16 ms. */
async function drag(page, start, pathAt, ms, { release = true } = {}) {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const t0 = Date.now();
  let i = 0;
  for (;;) {
    const el = Date.now() - t0;
    if (el >= ms) break;
    const p = pathAt(el / ms);
    await page.mouse.move(p.x, p.y);
    i++;
    await sleep(Math.max(0, i * 16 - (Date.now() - t0)));
  }
  if (release) await page.mouse.up();
}

/** Wheel events at ~60 Hz with `deltaY` each for `ms`. */
async function wheel(page, deltaY, ms, at) {
  await page.mouse.move(at.x, at.y);
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < ms) {
    await page.mouse.wheel(0, deltaY);
    i++;
    await sleep(Math.max(0, i * 16 - (Date.now() - t0)));
  }
}

/**
 * World view at rest. The street chunk is fetched and evaluated in an idle period ~2.5 s after load (handover/controller.ts,
 * "chunk warm-up"); a user needs longer than that to reach for a place. PERF_COLD=1 skips the wait to measure the cold case.
 */
async function settleWorld(page) {
  await waitQuiet(page, { quietMs: 1000, minMs: 1500 });
  if (!process.env.PERF_COLD) await sleep(4500);
}

const centre = (page) => {
  const v = page.viewportSize();
  return { x: v.width / 2, y: v.height / 2 };
};
const setView = (page, v) => page.evaluate((v) => (window.__handoverDebug ?? window.__globeDebug).setView?.(v) ?? window.__handoverDebug.globe.setView(v), v);
const zoomNow = (page) => page.evaluate(() => (window.__handoverDebug?.zoom() ?? window.__globeDebug?.view().zoom));

async function flyTo(page, slug) {
  await page.locator(`[data-place-link="${slug}"]`).evaluate((a) => a.click());
  // The flight ends when the camera stopped and nothing is drawn any more.
  await sleep(600);
  await waitQuiet(page, { quietMs: 1500, minMs: 500, maxMs: 60000 });
}

async function streetReady(page, timeout = 45000) {
  await page.waitForFunction(
    () => {
      const d = window.__handoverDebug;
      const t = d?.tile();
      return d?.streetState() === "ready" && (t?.state === "primary" || t?.state === "fallback");
    },
    null,
    { timeout },
  );
}

/** Zoom the camera to street scale at HCMC and let tiles load (not measured). */
async function goStreet(page, zoom = 14.5) {
  await page.evaluate((v) => window.__handoverDebug.fly(v), { ...HCMC, zoom });
  await sleep(500);
  await waitQuiet(page, { quietMs: 1500, minMs: 500, maxMs: 60000 });
}

export const SCENARIOS = [
  {
    id: "idle",
    title: "idle at world view (no input): frames must be 0",
    async setup(page) {
      await settleWorld(page);
    },
    async run(page) {
      const c0 = await page.evaluate(() => ({ raf: window.__pf.rafCalls, draws: window.__pf.drawsTotal }));
      await sleep(3000);
      const c1 = await page.evaluate(() => ({ raf: window.__pf.rafCalls, draws: window.__pf.drawsTotal }));
      return { draws: c1.draws - c0.draws, appRafCalls: c1.raf - c0.raf };
    },
  },
  {
    id: "s1",
    title: "S1 world view, slow rotation by drag (street not mounted)",
    async setup(page) {
      await settleWorld(page);
    },
    async run(page) {
      const c = centre(page);
      // 5 s drag with a slow sweep, 0.5 s of inertia
      await drag(page, { x: c.x - 150, y: c.y }, (u) => ({ x: c.x - 150 + 300 * u, y: c.y + 40 * Math.sin(u * 6) }), 5000);
      await waitQuiet(page, { quietMs: 400, minMs: 200, maxMs: 4000 });
      return { zoom: await zoomNow(page) };
    },
  },
  {
    id: "s2-hcmc",
    title: "S2 world to Ho Chi Minh City flight (place link, as a click)",
    async setup(page) {
      await settleWorld(page);
    },
    async run(page) {
      await flyTo(page, "ho-chi-minh-city");
      return { zoom: await zoomNow(page) };
    },
  },
  {
    id: "s2-lisbon",
    title: "S2 world to Lisbon flight (primary tiles over the network)",
    primary: true,
    async setup(page) {
      await settleWorld(page);
    },
    async run(page) {
      await flyTo(page, "lisbon");
      return { zoom: await zoomNow(page) };
    },
  },
  {
    id: "s3-in",
    title: "S3 wheel zoom in through the handover (3.4 to street), street map created during the gesture",
    needs: "debug",
    async setup(page) {
      await settleWorld(page);
      await setView(page, { ...HCMC, zoom: 3.4 });
      await waitQuiet(page, { quietMs: 800, minMs: 800 });
    },
    async run(page) {
      await wheel(page, -16, 6000, centre(page));
      await waitQuiet(page, { quietMs: 600, minMs: 200, maxMs: 6000 });
      return { zoom: await zoomNow(page) };
    },
  },
  {
    id: "s3-out",
    title: "S3 wheel zoom out through the handover (street to 3.4), warm",
    needs: "debug",
    async setup(page) {
      await goStreet(page, 9);
    },
    async run(page) {
      await wheel(page, 16, 6000, centre(page));
      await waitQuiet(page, { quietMs: 600, minMs: 200, maxMs: 6000 });
      return { zoom: await zoomNow(page) };
    },
  },
  {
    id: "s4",
    title: "S4 pan at street zoom (circular drag, panel closed)",
    needs: "debug",
    async setup(page) {
      await goStreet(page, 14.5);
    },
    async run(page) {
      const c = centre(page);
      const R = 140;
      await drag(page, { x: c.x + R, y: c.y }, (u) => ({ x: c.x + R * Math.cos(u * 2 * Math.PI * 1.5), y: c.y + R * Math.sin(u * 2 * Math.PI * 1.5) }), 5000);
      await waitQuiet(page, { quietMs: 400, minMs: 200, maxMs: 4000 });
      return { zoom: await zoomNow(page) };
    },
  },
  {
    id: "s5-open",
    title: "S5 pan at street zoom with the detail panel open (direct load on the place)",
    needs: "debug",
    path: "/locations/ho-chi-minh-city",
    async setup(page) {
      await page.waitForFunction(() => window.__handoverDebug?.streetState() === "ready" || true);
      await streetReady(page).catch(() => {});
      await sleep(500);
      await waitQuiet(page, { quietMs: 1500, minMs: 1000, maxMs: 60000 });
    },
    async run(page) {
      const v = page.viewportSize();
      const c = { x: v.width * (v.width > 800 ? 0.3 : 0.5), y: v.height / 2 };
      const R = 100;
      await drag(page, { x: c.x + R, y: c.y }, (u) => ({ x: c.x + R * Math.cos(u * 2 * Math.PI * 1.5), y: c.y + R * Math.sin(u * 2 * Math.PI * 1.5) }), 5000);
      await waitQuiet(page, { quietMs: 400, minMs: 200, maxMs: 4000 });
      return { zoom: await zoomNow(page) };
    },
  },
  {
    id: "s5-panel-anim",
    title: "S5 panel open and close animation at world view (inset animation)",
    async setup(page) {
      await settleWorld(page);
    },
    async run(page) {
      await page.locator('[data-place-link="lisbon"]').evaluate((a) => a.click());
      await sleep(400);
      await waitQuiet(page, { quietMs: 1200, minMs: 500, maxMs: 30000 });
      await page.keyboard.press("Escape");
      await sleep(400);
      await waitQuiet(page, { quietMs: 1200, minMs: 500, maxMs: 30000 });
      return {};
    },
  },
];
