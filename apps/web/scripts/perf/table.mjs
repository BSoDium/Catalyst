// Print one compact row per scenario from report JSON files: node table.mjs a.json [b.json ...]
import { readFileSync } from "node:fs";

const rows = [];
for (const f of process.argv.slice(2)) {
  const r = JSON.parse(readFileSync(f, "utf8"));
  for (const [id, runs] of Object.entries(r.scenarios)) {
    if (!Array.isArray(runs)) {
      rows.push([r.label, id, runs.skipped ? "skipped" : runs.error ?? "?"]);
      continue;
    }
    runs.forEach((x, i) => {
      const t = x.trace;
      const f = x.frameMs;
      rows.push([
        r.label + (runs.length > 1 ? `#${i}` : ""),
        id,
        `n=${f.n}`,
        `p50 ${f.p50}`,
        `p95 ${f.p95}`,
        `p99 ${f.p99}`,
        `max ${f.max}`,
        `>16.7:${f.over16_7}`,
        `missed ${f.missed}@${f.period}`,
        `>25:${f.over25}`,
        t?.perFrame ? `main ${t.perFrame.mainBusyMs} raf ${t.perFrame.rafMs} gpu ${t.perFrame.gpuTaskMs}` : "",
        x.gpuMs ? `GPUq mean ${x.gpuMs.mean} p95 ${x.gpuMs.p95} max ${x.gpuMs.max} ${JSON.stringify(x.gpuMs.meanBy)}` : "",
        t ? `drop ${t.frames.dropped}/${t.frames.presented + t.frames.partial + t.frames.dropped}` : "",
        t?.longMainTasks ? `longMT ${t.longMainTasks.n}` : "",
        `heap ${x.heapMB.after}`,
        x.quality !== null && x.quality !== undefined ? `quality L${x.quality}` : "",
        x.extra && x.extra.draws !== undefined ? `IDLE draws ${x.extra.draws} raf ${x.extra.appRafCalls}` : "",
      ].filter(Boolean));
    });
  }
}
for (const r of rows) console.log(r.join(" | "));
