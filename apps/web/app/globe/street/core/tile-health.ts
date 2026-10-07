/**
 * Tile health scoring (pure, unit tested). The tile source manager feeds it one record per finished tile request
 * and asks for a verdict. Four independent signals, each with a threshold, because "the source is down" has four
 * faces and the spike only caught the first:
 *
 *   error-rate   requests fail outright: N in a row, or at least half of the recent window
 *   timeout      requests are aborted by the request timeout (a hung connection)
 *   slow         requests finish, but the p95 latency of the window is over the limit
 *   stalled      requests have been pending longer than `stallMs` and nothing else is getting through
 *
 * "Slow but not failing" was the spike's documented gap: MapLibre has no tile timeout and no error fires. Here the
 * request layer (net/tile-protocols.ts) times every request, so slow and stalled sources are scored like dead ones.
 */

export type RequestOutcome = "ok" | "empty" | "http-error" | "network-error" | "timeout";

export interface HealthThresholds {
  /** Only requests that finished inside this window count. */
  windowMs: number;
  /** Fewer finished requests than this never trigger the rate rule. */
  minSamples: number;
  /** Failure share (0..1) of the window that fails the source. */
  errorRate: number;
  /** This many failures in a row fail the source at once (a hard outage: the first seconds decide). */
  consecutiveFailures: number;
  /** p95 latency (ms) over successful requests of the window that fails the source. */
  slowP95Ms: number;
  /** Fewer successful samples than this never trigger the latency rule. */
  slowMinSamples: number;
  /** A request pending for longer than this is stalled. */
  stallMs: number;
  /** This many stalled requests fail the source (one is enough when nothing succeeded recently). */
  stallCount: number;
  /** A request still pending after this long is aborted and recorded as a timeout. */
  requestTimeoutMs: number;
}

export const DEFAULT_THRESHOLDS: HealthThresholds = {
  windowMs: 20_000,
  minSamples: 4,
  errorRate: 0.5,
  consecutiveFailures: 4,
  slowP95Ms: 4500,
  slowMinSamples: 5,
  stallMs: 5000,
  stallCount: 2,
  requestTimeoutMs: 10_000,
};

export type FailureReason = "error-rate" | "timeout" | "slow" | "stalled";

export type Verdict = { ok: true } | { ok: false; reason: FailureReason; detail: string };

interface Sample {
  /** Time the request finished. */
  at: number;
  ms: number;
  outcome: RequestOutcome;
}

const isFailure = (o: RequestOutcome) => o === "http-error" || o === "network-error" || o === "timeout";

/** Nearest-rank percentile of a list (p in 0..1). NaN for an empty list. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]!;
}

export class TileHealth {
  private samples: Sample[] = [];
  private pending = new Map<number, number>();
  private consecutive = 0;
  private lastSuccessAt: number;

  constructor(
    private t: HealthThresholds = DEFAULT_THRESHOLDS,
    now = 0,
  ) {
    this.lastSuccessAt = now;
  }

  /** Forget everything (a new source became active). */
  reset(now: number): void {
    this.samples = [];
    this.pending.clear();
    this.consecutive = 0;
    this.lastSuccessAt = now;
  }

  start(id: number, now: number): void {
    this.pending.set(id, now);
  }

  /** The request was cancelled by the map (the tile is no longer needed): it says nothing about the source. */
  cancel(id: number): void {
    this.pending.delete(id);
  }

  finish(id: number, outcome: RequestOutcome, ms: number, now: number): void {
    this.pending.delete(id);
    this.samples.push({ at: now, ms, outcome });
    if (isFailure(outcome)) this.consecutive++;
    else {
      this.consecutive = 0;
      this.lastSuccessAt = now;
    }
    this.prune(now);
  }

  /** The page was hidden for `ms`: pending requests did not stall, the clock did. */
  shiftPending(ms: number): void {
    for (const [id, t0] of this.pending) this.pending.set(id, t0 + ms);
    this.lastSuccessAt += ms;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  private prune(now: number): void {
    const from = now - this.t.windowMs;
    if (this.samples.length && this.samples[0]!.at < from) this.samples = this.samples.filter((s) => s.at >= from);
  }

  /** Counters for debugging and the dev overlay. */
  snapshot(now: number) {
    this.prune(now);
    const ok = this.samples.filter((s) => !isFailure(s.outcome));
    return {
      samples: this.samples.length,
      failures: this.samples.length - ok.length,
      consecutiveFailures: this.consecutive,
      p95Ms: percentile(ok.filter((s) => s.outcome === "ok").map((s) => s.ms), 0.95),
      pending: this.pending.size,
      stalled: this.stalledCount(now),
    };
  }

  private stalledCount(now: number): number {
    let n = 0;
    for (const t0 of this.pending.values()) if (now - t0 >= this.t.stallMs) n++;
    return n;
  }

  verdict(now: number): Verdict {
    this.prune(now);
    const t = this.t;
    const failures = this.samples.filter((s) => isFailure(s.outcome));

    if (this.consecutive >= t.consecutiveFailures) {
      const timeouts = this.samples.slice(-this.consecutive).filter((s) => s.outcome === "timeout").length;
      return timeouts * 2 >= this.consecutive
        ? { ok: false, reason: "timeout", detail: `${this.consecutive} requests in a row timed out or failed` }
        : { ok: false, reason: "error-rate", detail: `${this.consecutive} requests failed in a row` };
    }
    if (this.samples.length >= t.minSamples && failures.length / this.samples.length >= t.errorRate) {
      const timeouts = failures.filter((s) => s.outcome === "timeout").length;
      return timeouts * 2 >= failures.length
        ? { ok: false, reason: "timeout", detail: `${timeouts} of ${this.samples.length} requests timed out` }
        : { ok: false, reason: "error-rate", detail: `${failures.length} of ${this.samples.length} requests failed` };
    }
    const stalled = this.stalledCount(now);
    if (stalled >= t.stallCount || (stalled >= 1 && now - this.lastSuccessAt >= t.stallMs * 2)) {
      return { ok: false, reason: "stalled", detail: `${stalled} requests pending for over ${t.stallMs} ms` };
    }
    const lat = this.samples.filter((s) => s.outcome === "ok").map((s) => s.ms);
    if (lat.length >= t.slowMinSamples) {
      const p95 = percentile(lat, 0.95);
      if (p95 > t.slowP95Ms) return { ok: false, reason: "slow", detail: `p95 tile latency ${Math.round(p95)} ms` };
    }
    return { ok: true };
  }
}
