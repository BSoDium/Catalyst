// The home screen and the globe as a Pixel 7 would run them, as far as a Mac can say (docs/performance.md, "A phone's CPU").
//
//   node apps/web/scripts/perf/phone.mjs [--throttle 1,4,6] [--scenarios a,b] [--repeat 3] [--out DIR] [--port 5311] [--skip-build] [--headed]
//
// Builds the app (`react-router build`, a production bundle: a dev server's numbers say nothing), serves it, and runs the scenarios with the
// Pixel 7's viewport and pixel density (`PIXEL7` in lib.mjs) at each CPU throttle rate, then prints one comparison row per scenario and rate
// (`summary.mjs`). 1 is the Mac as it is (the baseline); 4 is a good stand-in for the Pixel 7's main thread (Tensor G2, about 3 to 4 times slower
// single-threaded than an M-series core), 6 a pessimistic one. The throttle slows the MAIN THREAD only: the GPU is the Mac's, which is several times
// stronger than the phone's Mali, so a hitch that lives in the GPU (a shader compile, a buffer upload, fill rate at 2.6x density) will not show here.
// For that, record a trace on the phone itself (chrome://inspect over USB, Performance panel).
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runScenarios } from "./runner.mjs";
import { launch } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, "..", "..");
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
    return acc;
  }, []),
);
const rates = String(args.throttle ?? "1,4,6").split(",").map(Number);
// The home screen's own scenarios (the ring, the caption), a drag on the world view, and the panel opening on a place (the paths light up then).
const scenarios = String(args.scenarios ?? "caption-enter,ring-wheel,s1,s5-panel-anim").split(",");
const repeat = Number(args.repeat ?? 3);
const port = Number(args.port ?? 5311);
const out = args.out ? String(args.out) : join(webDir, "perf-out", `phone-${new Date().toISOString().replace(/[:.]/g, "-")}`);
mkdirSync(out, { recursive: true });

if (!args["skip-build"]) {
  console.log("building (production)...");
  const b = spawnSync("pnpm", ["build"], { cwd: webDir, stdio: "inherit" });
  if (b.status !== 0) process.exit(b.status ?? 1);
}

const server = spawn(join(webDir, "node_modules", ".bin", "react-router-serve"), ["./build/server/index.js"], { cwd: webDir, env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const stop = () => server.kill();
process.on("exit", stop);
process.on("SIGINT", () => process.exit(130));
const base = `http://localhost:${port}`;
for (let i = 0; ; i++) {
  try {
    if ((await fetch(base)).ok) break;
  } catch {}
  if (i > 60) throw new Error(`the server did not come up on ${base}`);
  await new Promise((r) => setTimeout(r, 500));
}

const browser = await launch({ headed: !!args.headed });
const files = [];
for (const rate of rates) {
  const label = `pixel7-x${rate}`;
  console.log(`\n${label}: ${scenarios.join(", ")} (x${repeat})`);
  await runScenarios({ base, scenarios, device: "pixel7", scheme: "dark", throttle: rate === 1 ? null : rate, repeat, out, label, browser });
  files.push(join(out, `${label}.json`));
}
await browser.close();
console.log(`\nreports in ${out}\n`);
spawnSync("node", [join(here, "summary.mjs"), ...files], { stdio: "inherit" });
stop();
