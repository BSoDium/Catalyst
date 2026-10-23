// The scenario runner shared by run.mjs and budget.mjs (library; no CLI).
//
import { mkdirSync, writeFileSync } from "node:fs";
import { DESKTOP, PROFILES, launch, measure, openPage } from "./lib.mjs";
import { SCENARIOS } from "./scenarios.mjs";

/**
 * Run scenarios against a running server; returns the report object (see run.mjs for the options).
 * `browser` may be passed to reuse one; otherwise one is launched and closed.
 */
export async function runScenarios({ base, scenarios, device = "desktop", scheme = "light", headed = false, uncapped = false, trace = true, out = null, label = "run", repeat = 1, streetOpts = null, throttle = null, browser: given = null }) {
  const profile = PROFILES[device] ?? DESKTOP;
  const want = scenarios ?? SCENARIOS.map((s) => s.id);
  const browser = given ?? (await launch({ headed, uncapped }));
  const results = { throttle, label, base, version: browser.version(), device, scheme, headed, uncapped, scenarios: {} };
  for (const id of want) {
    const sc = SCENARIOS.find((s) => s.id === id);
    if (!sc) throw new Error(`unknown scenario ${id}`);
    for (let rep = 0; rep < repeat; rep++) {
      // The scenarios emulate a mouse wheel with `page.mouse.wheel` (no device signature at a scale factor of 2: engine/wheel-debug.ts `inputKindOverride`).
      const flags = { "globe-debug": "1", "input-kind": "wheel" };
      // Debug pages have the ring OFF by default (engine/ring.ts `applyRingFlags`): its own scenarios turn it on, and RING=1 runs any scenario with it.
      if (sc.ring || process.env.RING === "1") flags.ring = "1";
      if (sc.flags) Object.assign(flags, sc.flags);
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
          // A slow device: the main thread runs `throttle` times slower (the GPU does not). The pixel density does not react to it (no frame governor).
          const cdp = await ctx.newCDPSession(page);
          await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(throttle) });
        }
        await sc.setup(page, { hasDebug });
        const tracePath = out ? `${out}/${label}-${id}${repeat > 1 ? "-" + rep : ""}.trace.json` : null;
        const rep_ = await measure(browser, page, ctx, () => sc.run(page, {}), { trace, tracePath: trace ? tracePath : null });
        rep_.logs = logs.slice(0, 5);
        // The art cell at the end of the scenario: constant by design (scripts/globe/handover-perf.mjs `density` asserts it), recorded so a report shows it.
        rep_.cell = await page.evaluate(() => window.__globeDebug?.cell?.() ?? null);
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
