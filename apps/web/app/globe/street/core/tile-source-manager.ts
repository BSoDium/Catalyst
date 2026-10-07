/**
 * Tile source manager: the explicit state machine behind "tiles are an enhancement, the globe is the floor".
 * Pure logic with injected IO (clock, timers, probe), unit tested; `engine.ts` wires it to MapLibre.
 *
 *                      probe ok                       health fails / style error / source died
 *   connecting ─────────────────────► primary ─────────────────────────────────────────────┐
 *        │ probe fails                  ▲   ▲                                              ▼
 *        │                              │   └──── recovery: 2 confirmed primary probes ── fallback ──┐
 *        ▼                              │                                                   │        │ fails
 *   (fallback probe) ──ok──► fallback   │                                                   │        ▼
 *        │ fails                        └──────── recovery: 2 confirmed primary probes ─────┴─── capped
 *        ▼                                         (or 1 fallback probe, from capped)             (globe floor)
 *     capped ◄─────────────────────────────────────────────────────────────────────────────────────┘
 *
 *  - `primary` is the preferred source (OpenFreeMap or whatever `CATALYST_TILES_PRIMARY_URL` says), `fallback` the
 *    PMTiles archive (optional), `capped` means no tile source works: the bundled coastline and borders remain, the
 *    engine reports `maxZoom = cappedMaxZoom` and never shows a half-loaded map.
 *  - Failure triggers (see tile-health.ts): request error rate, request timeouts, rolling p95 latency, stalled
 *    requests, plus style/TileJSON load failures and a dead source (the engine reports those).
 *  - Hysteresis: every transition resets the health window; promotion needs `recoverySuccesses` consecutive probes
 *    spaced `confirmDelayMs` apart, retried with exponential backoff (30 s, 60 s, ... 5 min); a source that fails
 *    again within `flapWindowMs` of its promotion keeps its (growing) backoff instead of starting over.
 *  - The fallback is probed only when it is needed (never at start, never while the primary is healthy): it runs on a
 *    home uplink and must not be hit by every session.
 */
import { DEFAULT_THRESHOLDS, TileHealth, type FailureReason, type HealthThresholds, type RequestOutcome } from "./tile-health";

export type SourceId = "primary" | "fallback";
export type TileState = "connecting" | "primary" | "fallback" | "capped";
export type TileReason = "start" | "forced" | FailureReason | "probe-failed" | "style-error" | "source-died" | "recovered" | "fallback-unavailable";

export interface TileStatus {
  state: TileState;
  /** The source tiles come from, null when connecting or capped. */
  source: SourceId | null;
  reason: TileReason;
  detail: string;
  /** Highest zoom the experience should offer now (`cappedMaxZoom` when capped). */
  maxZoom: number;
  /** Time of the transition (the injected clock). */
  at: number;
}

export interface ProbeResult {
  ok: boolean;
  ms: number;
  reason: "ok" | "timeout" | "http" | "network" | "invalid";
}

export interface ManagerIo {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  /** One small request with its own timeout. Must never reject. */
  probe(source: SourceId): Promise<ProbeResult>;
}

export interface ManagerTimings {
  /** First recovery probe after a demotion; doubles per failure up to `recoveryMaxMs`. */
  recoveryBaseMs: number;
  recoveryMaxMs: number;
  /** Spacing of the confirmation probes of a recovering source. */
  confirmDelayMs: number;
  /** Consecutive good probes needed to promote a source. */
  recoverySuccesses: number;
  /** A promoted source that fails again inside this window keeps its backoff. */
  flapWindowMs: number;
  /** A source probed down is not tried again as a failover target for this long. */
  downMemoryMs: number;
}

export const DEFAULT_TIMINGS: ManagerTimings = {
  recoveryBaseMs: 30_000,
  recoveryMaxMs: 300_000,
  confirmDelayMs: 4000,
  recoverySuccesses: 2,
  flapWindowMs: 60_000,
  downMemoryMs: 10_000,
};

export interface ManagerOptions {
  io: ManagerIo;
  /** The PMTiles fallback is configured. */
  hasFallback: boolean;
  /** Zoom cap while capped. */
  cappedMaxZoom: number;
  /** Zoom limit of the experience while a source works. */
  fullMaxZoom: number;
  /** Pin a source (dev and visual tests): no probing, no failover, no recovery. */
  force?: SourceId | null;
  timings?: Partial<ManagerTimings>;
  thresholds?: Partial<HealthThresholds>;
  onStatus(status: TileStatus, previous: TileStatus | null): void;
}

/** Backoff for re-probing a source that is down: base, 2x base, ... capped. */
export function retryDelayMs(failures: number, t: Pick<ManagerTimings, "recoveryBaseMs" | "recoveryMaxMs"> = DEFAULT_TIMINGS): number {
  return Math.min(t.recoveryMaxMs, t.recoveryBaseMs * 2 ** Math.max(0, failures - 1));
}

export class TileSourceManager {
  private t: ManagerTimings;
  private th: HealthThresholds;
  private health: TileHealth;
  private current: TileStatus | null = null;
  private generation = 0;
  private transitioning = false;
  private disposed = false;
  private recoveryTimer: unknown;
  private stallTimer: unknown;
  private stableTimer: unknown;
  private failures: Record<SourceId, number> = { primary: 0, fallback: 0 };
  private downAt: Record<SourceId, number> = { primary: -Infinity, fallback: -Infinity };
  private nextId = 1;
  /** request id -> source, for the pending ones (health only counts the active source). */
  private inflight = new Map<number, SourceId>();

  constructor(private o: ManagerOptions) {
    this.t = { ...DEFAULT_TIMINGS, ...o.timings };
    this.th = { ...DEFAULT_THRESHOLDS, ...o.thresholds };
    this.health = new TileHealth(this.th, o.io.now());
  }

  get status(): TileStatus {
    return this.current ?? { state: "connecting", source: null, reason: "start", detail: "", maxZoom: this.o.fullMaxZoom, at: this.o.io.now() };
  }

  get thresholds(): HealthThresholds {
    return this.th;
  }

  debug() {
    return { status: this.status, failures: { ...this.failures }, health: this.health.snapshot(this.o.io.now()) };
  }

  /** Begin: pinned, or probe the primary (the globe renders meanwhile). */
  start(): void {
    if (this.o.force) {
      this.enter(this.o.force, "forced", "pinned by the caller");
      return;
    }
    this.emit({ state: "connecting", source: null, reason: "start", detail: "probing the primary source" });
    void this.initialProbe();
  }

  private async initialProbe(): Promise<void> {
    const g = this.generation;
    const r = await this.o.io.probe("primary");
    if (this.stale(g)) return;
    if (r.ok) {
      this.enter("primary", "start", `primary answered in ${Math.round(r.ms)} ms`);
      return;
    }
    this.markDown("primary");
    this.failures.primary = 1;
    await this.failover("probe-failed", `primary probe failed (${r.reason})`);
  }

  // ---- request feed (net/tile-protocols.ts) ----------------------------------------------------------------------

  /** A tile request of `source` begins. Returns the id to finish or cancel it with. */
  requestStarted(source: SourceId): number {
    const id = this.nextId++;
    this.inflight.set(id, source);
    if (source === this.current?.source) {
      this.health.start(id, this.o.io.now());
      this.armStallTimer();
    }
    return id;
  }

  requestFinished(id: number, outcome: RequestOutcome, ms: number): void {
    const source = this.inflight.get(id);
    this.inflight.delete(id);
    if (source === undefined || source !== this.current?.source || this.disposed) return;
    this.health.finish(id, outcome, ms, this.o.io.now());
    this.evaluate();
  }

  requestCancelled(id: number): void {
    this.inflight.delete(id);
    this.health.cancel(id);
  }

  /** The tab was hidden for `ms`: do not count that time as stalls. */
  pausedFor(ms: number): void {
    this.health.shiftPending(ms);
  }

  /** The map reported a style / TileJSON / source error for `source`. Confirmed with a probe before failing over. */
  reportStyleError(source: SourceId, detail: string): void {
    if (this.disposed || source !== this.current?.source || this.o.force || this.transitioning) return;
    const g = this.generation;
    void this.o.io.probe(source).then((r) => {
      if (this.stale(g) || r.ok) return;
      void this.failover("style-error", detail);
    });
  }

  /** The source is dead for certain (the map's worker or context died, an unrecoverable source error). */
  reportSourceDied(source: SourceId, detail: string): void {
    if (this.disposed || source !== this.current?.source || this.o.force) return;
    void this.failover("source-died", detail);
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.o.io.clearTimeout(this.recoveryTimer);
    this.o.io.clearTimeout(this.stallTimer);
    this.o.io.clearTimeout(this.stableTimer);
  }

  // ---- decisions -------------------------------------------------------------------------------------------------

  private stale(g: number): boolean {
    return this.disposed || g !== this.generation;
  }

  private evaluate(): void {
    if (this.o.force || this.transitioning || !this.current?.source) return;
    const v = this.health.verdict(this.o.io.now());
    if (!v.ok) void this.failover(v.reason, v.detail);
  }

  /** While requests are pending, look for stalls once a second (nothing else would notice a silent source). */
  private armStallTimer(): void {
    if (this.stallTimer !== undefined || this.o.force) return;
    this.stallTimer = this.o.io.setTimeout(() => {
      this.stallTimer = undefined;
      if (this.disposed) return;
      this.evaluate();
      if (this.health.pendingCount > 0) this.armStallTimer();
    }, 1000);
  }

  private recentlyDown(source: SourceId): boolean {
    return this.o.io.now() - this.downAt[source] < this.t.downMemoryMs;
  }

  private markDown(source: SourceId): void {
    this.downAt[source] = this.o.io.now();
  }

  /** Leave the active source: to the fallback if it answers, else to the cap. */
  private async failover(reason: TileReason, detail: string): Promise<void> {
    if (this.transitioning || this.disposed) return;
    this.transitioning = true;
    const g = this.generation;
    try {
      const from = this.current?.state ?? "connecting";
      if (from === "primary") {
        // `failures.primary` is only cleared after the primary has been stable for `flapWindowMs` (see `enter`),
        // so a source that flaps keeps a growing backoff.
        this.failures.primary++;
        this.markDown("primary");
      }
      if (from !== "fallback") {
        if (this.o.hasFallback && !this.recentlyDown("fallback")) {
          const r = await this.o.io.probe("fallback");
          if (this.stale(g)) return;
          if (r.ok) {
            this.enter("fallback", reason, detail);
            return;
          }
          this.markDown("fallback");
          this.failures.fallback++;
          detail = `${detail}; fallback probe failed (${r.reason})`;
        } else if (!this.o.hasFallback) {
          detail = `${detail}; no fallback configured`;
        }
      } else {
        this.markDown("fallback");
        this.failures.fallback++;
        // The fallback died; the primary may have come back since it was demoted.
        if (!this.recentlyDown("primary")) {
          const r = await this.o.io.probe("primary");
          if (this.stale(g)) return;
          if (r.ok) {
            this.enter("primary", "recovered", "primary answered after the fallback failed");
            return;
          }
          this.markDown("primary");
        }
      }
      this.enter("capped", reason, detail);
    } finally {
      this.transitioning = false;
    }
  }

  private enter(state: "primary" | "fallback" | "capped", reason: TileReason, detail: string): void {
    this.generation++;
    this.health.reset(this.o.io.now());
    this.inflight.clear();
    this.o.io.clearTimeout(this.stableTimer);
    this.stableTimer = undefined;
    if (state === "primary") {
      if (this.failures.primary > 0) {
        const g = this.generation;
        this.stableTimer = this.o.io.setTimeout(() => {
          if (!this.stale(g)) this.failures.primary = 0;
        }, this.t.flapWindowMs);
      }
    }
    this.emit({ state, source: state === "capped" ? null : state, reason, detail });
    this.scheduleRecovery();
  }

  private emit(s: Omit<TileStatus, "maxZoom" | "at">): void {
    const prev = this.current;
    this.current = { ...s, maxZoom: s.state === "capped" ? this.o.cappedMaxZoom : this.o.fullMaxZoom, at: this.o.io.now() };
    this.o.onStatus(this.current, prev);
  }

  // ---- recovery --------------------------------------------------------------------------------------------------

  private scheduleRecovery(): void {
    this.o.io.clearTimeout(this.recoveryTimer);
    this.recoveryTimer = undefined;
    if (this.o.force || this.disposed || this.current?.state === "primary") return;
    const failures = Math.max(1, this.failures.primary);
    const g = this.generation;
    this.recoveryTimer = this.o.io.setTimeout(() => void this.recover(g), retryDelayMs(failures, this.t));
  }

  /** Probe upwards: the primary first (confirmed), then, from the cap, the fallback. */
  private async recover(g: number): Promise<void> {
    if (this.stale(g) || this.transitioning) return;
    const state = this.current?.state;
    if (state === "primary" || !state) return;
    let ok = true;
    for (let i = 0; i < this.t.recoverySuccesses && ok; i++) {
      if (i > 0) {
        await new Promise<void>((res) => this.o.io.setTimeout(res, this.t.confirmDelayMs));
        if (this.stale(g)) return;
      }
      const r = await this.o.io.probe("primary");
      if (this.stale(g)) return;
      ok = r.ok;
    }
    if (ok) {
      this.enter("primary", "recovered", "primary answered the confirmation probes");
      return;
    }
    this.failures.primary++;
    if (state === "capped" && this.o.hasFallback) {
      const r = await this.o.io.probe("fallback");
      if (this.stale(g)) return;
      if (r.ok) {
        this.enter("fallback", "recovered", "fallback answered while the primary is still down");
        return;
      }
      this.failures.fallback++;
    }
    this.scheduleRecovery();
  }
}
