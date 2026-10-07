// Run scenarios against a running production server and print the JSON report.
//
//   node apps/web/scripts/perf/run.mjs --base http://localhost:5304 [--scenarios s1,s2-hcmc] [--device desktop|mobile]
//        [--scheme light|dark] [--headed] [--uncapped] [--no-trace] [--out DIR] [--label NAME] [--repeat N]
//        [--street-opts '{"highResolution":true}'] [--throttle 4] [--quiet]
//
// Tiles: a server started with NODE_ENV=development and CATALYST_TILES_FALLBACK_URL=http://127.0.0.1:5240/places.pmtiles
// (node apps/web/scripts/street/serve-tiles.mjs prototypes/street-zoom/public/hcmc.pmtiles 5240) lets scenarios pin
// the local archive (deterministic, no network). `s2-lisbon` uses the real OpenFreeMap primary.
import { runScenarios } from "./runner.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
    return acc;
  }, []),
);
const results = await runScenarios({
  base: args.base ?? "http://localhost:5304",
  scenarios: args.scenarios ? String(args.scenarios).split(",") : null,
  device: args.device,
  scheme: args.scheme,
  headed: !!args.headed,
  uncapped: !!args.uncapped,
  trace: !args["no-trace"],
  out: args.out ?? null,
  label: args.label ?? "run",
  repeat: Number(args.repeat ?? 1),
  streetOpts: args["street-opts"] ? JSON.parse(args["street-opts"]) : null,
  throttle: args.throttle ?? null,
});
if (!args.quiet) console.log(JSON.stringify(results, null, 1));
