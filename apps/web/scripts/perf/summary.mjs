// Compact comparison of report JSON files, medians over repeats: node summary.mjs a.json b.json ...
// One row per (file, scenario): frames, p50/p95/max, missed vsyncs, main-thread busy, rAF callback, GPU timer mean/p95, dropped frames, heap.
import { readFileSync } from "node:fs";

const med = (a) => {
  const v = a.filter((x) => x !== null && x !== undefined && !Number.isNaN(x)).sort((x, y) => x - y);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};
const f = (x) => (x === null || x === undefined ? "-" : (+x).toFixed(1));
const rows = [["build", "scenario", "frames", "p50", "p95", "max", "missed", "main/f", "raf/f", "gpuq", "gpuq p95", "dropped", "heap"]];
for (const file of process.argv.slice(2)) {
  const r = JSON.parse(readFileSync(file, "utf8"));
  for (const [id, runs] of Object.entries(r.scenarios)) {
    if (!Array.isArray(runs)) continue;
    const pick = (fn) => med(runs.map(fn));
    const drop = pick((x) => (x.trace ? (100 * x.trace.frames.dropped) / Math.max(1, x.trace.frames.presented + x.trace.frames.partial + x.trace.frames.dropped) : null));
    rows.push([
      r.label,
      id,
      pick((x) => x.frameMs.n),
      f(pick((x) => x.frameMs.p50)),
      f(pick((x) => x.frameMs.p95)),
      f(pick((x) => x.frameMs.max)),
      f(pick((x) => x.frameMs.missed)),
      f(pick((x) => x.trace?.perFrame?.mainBusyMs)),
      f(pick((x) => x.trace?.perFrame?.rafMs)),
      f(pick((x) => x.gpuMs?.mean)),
      f(pick((x) => x.gpuMs?.p95)),
      drop === null ? "-" : f(drop) + "%",
      f(pick((x) => x.heapMB.after)),
    ].map(String));
  }
}
const w = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
for (const r of rows) console.log(r.map((c, i) => c.padEnd(w[i])).join("  "));
