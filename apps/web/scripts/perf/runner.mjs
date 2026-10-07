// The scenario runner shared by run.mjs and budget.mjs (library; no CLI).
//
import { mkdirSync, writeFileSync } from "node:fs";
import { DESKTOP, MOBILE, launch, measure, openPage } from "./lib.mjs";
import { SCENARIOS } from "./scenarios.mjs";

/**
 * Run scenarios against a running server; returns the report object (see run.mjs for the options).
 * `browser` may be passed to reuse one; otherwise one is launched and closed.
 */
export async function runScenarios({ base, scenarios, device = "desktop", scheme = "light", headed = false, uncapped = false, trace = true, out = null, label = "run", repeat = 1, streetOpts = null, throttle = null, browser: given = null }) {
  const profile = device === "mobile" ? MOBILE : DESKTOP;
  const want = scenarios ?? SCENARIOS.map((s) => s.id);
  const browser = given ?? (await launch({ headed, uncapped }));
  const results = { throttle, label, base, version: browser.version(), device, scheme, headed, uncapped, scenarios: {} };
  for (const id of want) {
    const sc = SCENARIOS.find((s) => s.id === id);
    if (!sc) throw new Error(`unknown scenario ${id}`);
    for (let rep = 0; rep < repeat; rep++) {
      const flags = { "globe-debug": "1" };
      const extra = streetOpts ?? {};
      if (!sc.primary || streetOpts) flags["street-opts"] = JSON.stringify({ ...(sc.primary ? {} : { forceSource: "fallback" }), ...extra });
      const { ctx, page, logs } = await openPage(browser, profile, new URL(sc.path ?? "/", base).toString(), { colorScheme: scheme, flags });
      try {
        await page.waitForFunction(() => document.querySelector('[data-globe="three"][data-state="ready"]'), null, { timeout: 30000 });
        const hasDebug = await page.evaluate(() => !!(window.__handoverDebug || window.__globeDebug));
        if (sc.needs === "debug" && !(await page.evaluate(() => !!window.__handoverDebug))) {
          results.scenarios[id] = { skipped: "needs the handover debug hooks (not in this commit)" };
          continue;
        }
        if (throttle) {
          // A slow device: the main thread runs `throttle` times slower (the GPU does not; the frame governor sees the main thread).
          const cdp = await ctx.newCDPSession(page);
          await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(throttle) });
        }
        await sc.setup(page, { hasDebug });
        const tracePath = out ? `${out}/${label}-${id}${repeat > 1 ? "-" + rep : ""}.trace.json` : null;
        const rep_ = await measure(browser, page, ctx, () => sc.run(page, {}), { trace, tracePath: trace ? tracePath : null });
        rep_.logs = logs.slice(0, 5);
        rep_.quality = await page.evaluate(() => window.__handoverDebug?.quality?.() ?? null);
        const prev = results.scenarios[id];
        results.scenarios[id] = Array.isArray(prev) ? [...prev, rep_] : [rep_];
      } catch (e) {
        results.scenarios[id] = { error: String(e).slice(0, 300) };
      } finally {
        await ctx.close();
      }
    }
  }
  if (!given) await browser.close();
  if (out) {
    mkdirSync(out, { recursive: true });
    writeFileSync(`${out}/${label}.json`, JSON.stringify(results, null, 1));
  }
  return results;
}
