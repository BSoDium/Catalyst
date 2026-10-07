/**
 * Opt-in phase timers for the performance scripts (apps/web/scripts/perf, docs/performance.md). Off (one boolean test per
 * call) unless the page runs with the globe debug hooks: then `window.__perf` accumulates, per named phase, the number of
 * calls and the CPU milliseconds spent in them on the main thread. GPU time is not measured here (the scripts use
 * EXT_disjoint_timer_query for that).
 */
interface Phase {
  n: number;
  ms: number;
  max: number;
}
let on = false;
const phases = new Map<string, Phase>();

export function enablePerf(): void {
  if (on || typeof window === "undefined") return;
  on = true;
  (window as unknown as { __perf: unknown }).__perf = {
    reset: () => phases.clear(),
    snapshot: () => Object.fromEntries([...phases].map(([k, v]) => [k, { n: v.n, ms: +v.ms.toFixed(2), max: +v.max.toFixed(2) }])),
  };
}

/** Start a phase; pass the result to `perfEnd`. 0 when timers are off. */
export function perfStart(): number {
  return on ? performance.now() : 0;
}

export function perfEnd(name: string, t0: number): void {
  if (!on) return;
  const d = performance.now() - t0;
  const p = phases.get(name);
  if (p) {
    p.n++;
    p.ms += d;
    if (d > p.max) p.max = d;
  } else phases.set(name, { n: 1, ms: d, max: d });
}
