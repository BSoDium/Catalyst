// usage: node scripts/summarize.mjs result.json [more.json ...]  -> markdown tables
import { readFileSync } from "node:fs";
for (const f of process.argv.slice(2)) {
  const d = JSON.parse(readFileSync(f, "utf8"));
  console.log(`\n### ${f.split("/").pop()}  (src ${d.src}, ${d.size} @${d.dpr}x, CPU throttle ${d.throttle}x, ${d.durMs / 1000}s per view)\n`);
  console.log("| view | pass | map scale | fps | rAF p50/p95/max | JS ms p50/p95 | JS+GPU sync ms p50/p95/max | composite JS ms p50 | heap MB | idle renders/rAF | canvas copy ms | pool+present ms | proj |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  const views = [...new Set(d.rows.flatMap((r) => Object.keys(r.views ?? {})))];
  for (const v of views) {
    for (const r of d.rows) {
      if (r.error) { console.log(`| ${v} | ${r.comp} | ${r.scale} | error: ${r.error} |`); continue; }
      const x = r.views[v];
      if (!x) continue;
      const i = x.isolated;
      console.log(`| ${v} | ${r.comp} | ${r.scale}x | ${x.fps} | ${x.rafIntervalMs.p50}/${x.rafIntervalMs.p95}/${x.rafIntervalMs.max} | ${x.jsMs.p50}/${x.jsMs.p95} | ${x.syncedMs.p50}/${x.syncedMs.p95}/${x.syncedMs.max} | ${x.compositeJsMs.p50} | ${x.heapMB} | ${x.idle.renders}/${x.idle.rafCalls} | ${i ? i.uploadMs : "-"} | ${i ? i.passMs : "-"} | ${x.projection} |`);
    }
  }
}
