/**
 * Tile source health: tiles are an enhancement, never a dependency of the site. Pure logic (injectable fetch and
 * clock), unit-tested; `street.ts` wires it to MapLibre.
 *
 * Policy:
 *  1. At start, probe the sources of the chain in parallel with a hard timeout (default 3 s). The first source that
 *     answers in time wins. The pixel globe (bundled coastlines, borders, graticule) never waits for this.
 *  2. At runtime, N tile errors inside a time window trigger one re-probe of the active source. If it fails, mark it
 *     down and fail over to the next healthy source of the chain (a style swap: the camera does not move).
 *  3. If every source is down: degraded mode. Max zoom is capped at regional scale, the bundled coastline stays on at
 *     every zoom that is left, a polite notice replaces street detail. Never an empty or half-loaded map.
 *  4. A down source is re-probed with back-off (30 s, 60 s, 120 s, capped at 5 min) and promoted again when it answers.
 */

export type SourceStatus = "unknown" | "up" | "down";

export interface ProbeResult {
  ok: boolean;
  ms: number;
  reason: "ok" | "timeout" | "http" | "network";
}

export type FetchLike = (url: string, init: { signal: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number }>;

/** One small request with a hard timeout. For PMTiles use a `Range: bytes=0-15` request (a header read). */
export async function probe(
  url: string,
  opts: { timeoutMs?: number; fetchFn?: FetchLike; headers?: Record<string, string>; now?: () => number } = {},
): Promise<ProbeResult> {
  const timeoutMs = opts.timeoutMs ?? 3000;
  const now = opts.now ?? (() => performance.now());
  const doFetch: FetchLike = opts.fetchFn ?? ((u, init) => fetch(u, init));
  const ctl = new AbortController();
  const t0 = now();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, timeoutMs);
  try {
    const res = await doFetch(url, { signal: ctl.signal, headers: opts.headers });
    const ms = now() - t0;
    if (res.ok || res.status === 206) return { ok: true, ms, reason: "ok" };
    return { ok: false, ms, reason: "http" };
  } catch {
    return { ok: false, ms: now() - t0, reason: timedOut ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

/** First source of the chain that is not down, preferring ones known up. null = degraded mode. */
export function chooseSource(chain: readonly string[], status: Readonly<Record<string, SourceStatus>>): string | null {
  const up = chain.find((id) => status[id] === "up");
  if (up) return up;
  return chain.find((id) => (status[id] ?? "unknown") === "unknown") ?? null;
}

/** Sliding window error counter. `record()` returns true when the threshold is reached inside the window. */
export class ErrorWindow {
  private times: number[] = [];
  constructor(
    private threshold = 6,
    private windowMs = 8000,
  ) {}
  record(t: number): boolean {
    this.times.push(t);
    this.times = this.times.filter((x) => t - x <= this.windowMs);
    return this.times.length >= this.threshold;
  }
  reset(): void {
    this.times = [];
  }
}

/** Back-off for re-probing a source that is down: 30 s, 60 s, 120 s, 240 s, then 5 min. */
export function retryDelayMs(failures: number): number {
  return Math.min(300_000, 30_000 * 2 ** Math.max(0, failures - 1));
}

export interface Degraded {
  /** highest zoom the map may reach without tiles */
  maxZoom: number;
  notice: string;
}

/** Without tiles only the bundled data exists: 110 m coastlines and 50 m borders. They read fine up to regional scale. */
export const DEGRADED: Degraded = {
  maxZoom: 6,
  notice: "Street detail is unavailable right now. The globe still works.",
};

/** The zoom to settle on when entering degraded mode while the camera is deeper than the cap. */
export function clampedZoom(current: number, d: Degraded = DEGRADED): number {
  return Math.min(current, d.maxZoom);
}
