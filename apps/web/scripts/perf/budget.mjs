// Performance regression check: runs the scenarios against a production build and exits 1 when a budget (budgets.mjs) is
// exceeded.
//
//   pnpm --filter @catalyst/web perf [-- --headed] [--base URL] [--quick] [--repeat 3] [--out DIR]
//
// Without --base it serves the production build itself (`pnpm --filter @catalyst/web build` first): NODE_ENV=development
// at RUN time (a production runtime refuses the local http PMTiles fallback) with the local fallback archive on :5240
// (prototypes/street-zoom/public/hcmc.pmtiles; TILES_FILE / TILES_PORT override). Needs Chrome for Testing (CHROME_PATH).
// Headless = a 60 Hz compositor; --headed uses the real display (120 Hz on a MacBook Pro) and is the number to trust for
// "does it feel fluid". --quick: one repeat of s1, s4 and idle.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import { launch } from "./lib.mjs";
import { runScenarios } from "./runner.mjs";
import { BUDGETS, CRAWL_BUDGET, IDLE_BUDGET, MOBILE_BUDGETS } from "./budgets.mjs";
import { ensureTiles } from "../street/_lib.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
    return acc;
  }, []),
);
const headed = !!args.headed;
const quick = !!args.quick;
const repeat = Number(args.repeat ?? (quick ? 1 : 3));
const out = args.out ?? null;
const webDir = fileURLToPath(new URL("../../", import.meta.url));

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });

const tiles = await ensureTiles();
let server = null;
let base = args.base;
if (!base) {
  const port = await freePort();
  server = spawn(process.execPath, ["node_modules/@react-router/serve/bin.js", "./build/server/index.js"], {
    cwd: webDir,
    env: { ...process.env, PORT: String(port), NODE_ENV: "development", CATALYST_CONTENT: "demo", CATALYST_TILES_FALLBACK_URL: tiles.url },
    stdio: "ignore",
  });
  base = `http://localhost:${port}`;
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {}
    if (i > 100) throw new Error("the server did not start (run `pnpm --filter @catalyst/web build` first)");
    await new Promise((r) => setTimeout(r, 200));
  }
}

const median = (a) => {
  const v = a.filter((x) => typeof x === "number" && !Number.isNaN(x)).sort((x, y) => x - y);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};
const failures = [];
const rows = [];
const check = (group, id, metric, value, limit) => {
  if (value === null || value === undefined) {
    rows.push(`  skip  ${group} ${id} ${metric} (not measured)`);
    return;
  }
  const ok = value <= limit;
  rows.push(`  ${ok ? "ok  " : "FAIL"}  ${group} ${id} ${metric} ${(+value).toFixed(2)} (<= ${limit})`);
  if (!ok) failures.push(`${group} ${id} ${metric}: ${(+value).toFixed(2)} > ${limit}`);
};

function evaluate(group, results, budgets) {
  for (const [id, b] of Object.entries(budgets)) {
    const runs = results.scenarios[id];
    if (!Array.isArray(runs)) {
      failures.push(`${group} ${id}: ${runs?.error ?? runs?.skipped ?? "no result"}`);
      continue;
    }
    const m = (fn) => median(runs.map(fn));
    const period = m((x) => x.frameMs.period) ?? 16.7;
    const val = {
      missed: m((x) => x.frameMs.missed),
      maxRatio: m((x) => x.frameMs.max) / period,
      maxMs: m((x) => x.frameMs.max),
      mainMs: m((x) => x.trace?.perFrame?.mainBusyMs),
      rafMs: m((x) => x.trace?.perFrame?.rafMs),
      gpuMean: m((x) => x.gpuMs?.mean),
      gpuP95: m((x) => x.gpuMs?.p95),
      dropPct: m((x) => (x.trace ? (100 * x.trace.frames.dropped) / Math.max(1, x.trace.frames.presented + x.trace.frames.partial + x.trace.frames.dropped) : null)),
      heapMB: m((x) => x.heapMB.after),
    };
    for (const [metric, limit] of Object.entries(b)) check(group, id, metric, val[metric], limit);
  }
}

const browser = await launch({ headed });
let exit = 0;
try {
  const desktopIds = quick ? ["s1", "s4"] : Object.keys(BUDGETS);
  const desktop = await runScenarios({ base, scenarios: ["idle", ...desktopIds], headed, repeat, out, label: "perf-desktop", browser });
  const idle = desktop.scenarios.idle?.[0]?.extra;
  if (!idle) failures.push("idle: no result");
  else for (const [k, limit] of Object.entries(IDLE_BUDGET)) check("desktop", "idle", k, idle[k], limit);
  evaluate("desktop", desktop, Object.fromEntries(desktopIds.map((id) => [id, BUDGETS[id]])));

  if (!quick) {
    const mobile = await runScenarios({ base, scenarios: Object.keys(MOBILE_BUDGETS), device: "mobile", repeat: Math.min(repeat, 2), out, label: "perf-mobile", browser });
    evaluate("mobile", mobile, MOBILE_BUDGETS);
  }

  // Pan stability: snapped panning must be a rigid translation (crawl.mjs).
  const crawl = await new Promise((resolve) => {
    const c = spawn(process.execPath, [fileURLToPath(new URL("./crawl.mjs", import.meta.url)), "--base", base], { env: process.env, stdio: ["ignore", "pipe", "inherit"] });
    let buf = "";
    c.stdout.on("data", (d) => (buf += d));
    c.on("close", () => {
      try {
        resolve(JSON.parse(buf));
      } catch {
        resolve(null);
      }
    });
  });
  if (!crawl) failures.push("crawl: no result");
  else {
    const on = crawl.find((x) => x.snap === "on");
    const off = crawl.find((x) => x.snap === "off");
    check("desktop", "crawl(snapped)", "residualMean", on.residualMean, CRAWL_BUDGET.snapResidualMean);
    check("desktop", "crawl(snapped)", "changedShare", on.changedShare, CRAWL_BUDGET.snapChangedShare);
    rows.push(`  info  unsnapped reference: residualMean ${off.residualMean}, changedShare ${off.changedShare} (the snap is worth ${(off.residualMean - on.residualMean).toFixed(3)})`);
    if (!(off.residualMean >= CRAWL_BUDGET.unsnappedMustExceed)) failures.push("crawl: the unsnapped control shows no crawl, the metric is not measuring what it should");
  }
  if (out) {
    mkdirSync(out, { recursive: true });
    writeFileSync(`${out}/budget.json`, JSON.stringify({ base, headed, repeat, failures }, null, 1));
  }
} finally {
  await browser.close();
  server?.kill();
  await tiles.stop();
}
console.log(rows.join("\n"));
if (failures.length) {
  console.error(`\n${failures.length} budget(s) exceeded:\n  ${failures.join("\n  ")}`);
  exit = 1;
} else console.log(`\nall budgets met (${headed ? "headed" : "headless"}, ${repeat} repeat${repeat > 1 ? "s" : ""})`);
process.exit(exit);
