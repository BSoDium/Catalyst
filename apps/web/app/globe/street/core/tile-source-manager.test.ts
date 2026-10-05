import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TIMINGS,
  TileSourceManager,
  retryDelayMs,
  type ManagerOptions,
  type ProbeResult,
  type SourceId,
  type TileStatus,
} from "./tile-source-manager";

beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
afterEach(() => vi.useRealTimers());

interface Rig {
  m: TileSourceManager;
  log: TileStatus[];
  /** What each probe answers; `hang` never resolves until the timeout the real probe would apply. */
  up: Record<SourceId, boolean>;
  probes: SourceId[];
  advance(ms: number): Promise<void>;
  fail(source: SourceId, n: number, outcome?: "http-error" | "network-error" | "timeout"): void;
}

function rig(opts: Partial<Pick<ManagerOptions, "hasFallback" | "force" | "timings" | "thresholds">> = {}, up: Partial<Record<SourceId, boolean>> = {}): Rig {
  const state: Record<SourceId, boolean> = { primary: true, fallback: true, ...up };
  const log: TileStatus[] = [];
  const probes: SourceId[] = [];
  const m = new TileSourceManager({
    hasFallback: opts.hasFallback ?? true,
    cappedMaxZoom: 6,
    fullMaxZoom: 17.5,
    force: opts.force,
    timings: opts.timings,
    thresholds: opts.thresholds,
    io: {
      now: () => Date.now(),
      setTimeout: (f, ms) => setTimeout(f, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      probe: async (s): Promise<ProbeResult> => {
        probes.push(s);
        return state[s] ? { ok: true, ms: 40, reason: "ok" } : { ok: false, ms: 40, reason: "network" };
      },
    },
    onStatus: (s) => log.push(s),
  });
  return {
    m,
    log,
    up: state,
    probes,
    advance: async (ms) => {
      await vi.advanceTimersByTimeAsync(ms);
    },
    fail(source, n, outcome = "network-error") {
      for (let i = 0; i < n; i++) {
        const id = m.requestStarted(source);
        m.requestFinished(id, outcome, 20);
      }
    },
  };
}

const states = (r: Rig) => r.log.map((s) => s.state);

describe("start", () => {
  it("probes the primary only and serves from it", async () => {
    const r = rig();
    r.m.start();
    expect(r.m.status.state).toBe("connecting");
    await r.advance(0);
    expect(states(r)).toEqual(["connecting", "primary"]);
    expect(r.probes).toEqual(["primary"]); // the fallback (a home uplink) is not touched while the primary works
    expect(r.m.status).toMatchObject({ source: "primary", reason: "start", maxZoom: 17.5 });
  });

  it("goes to the fallback when the primary probe fails", async () => {
    const r = rig({}, { primary: false });
    r.m.start();
    await r.advance(0);
    expect(r.m.status).toMatchObject({ state: "fallback", source: "fallback", reason: "probe-failed", maxZoom: 17.5 });
    expect(r.probes).toEqual(["primary", "fallback"]);
  });

  it("is capped when both fail, and says so with the zoom cap", async () => {
    const r = rig({}, { primary: false, fallback: false });
    r.m.start();
    await r.advance(0);
    expect(r.m.status).toMatchObject({ state: "capped", source: null, reason: "probe-failed", maxZoom: 6 });
  });

  it("is capped when the primary fails and no fallback is configured", async () => {
    const r = rig({ hasFallback: false }, { primary: false });
    r.m.start();
    await r.advance(0);
    expect(r.m.status).toMatchObject({ state: "capped", maxZoom: 6 });
    expect(r.m.status.detail).toMatch(/no fallback/);
    expect(r.probes).toEqual(["primary"]);
  });

  it("a pinned source does no probing, failover or recovery", async () => {
    const r = rig({ force: "fallback" });
    r.m.start();
    r.fail("fallback", 10);
    await r.advance(600_000);
    expect(r.probes).toEqual([]);
    expect(r.m.status).toMatchObject({ state: "fallback", reason: "forced" });
  });
});

describe("failover triggers", () => {
  async function onPrimary(opts: Parameters<typeof rig>[0] = {}) {
    const r = rig(opts);
    r.m.start();
    await r.advance(0);
    return r;
  }

  it("error rate: four failed requests in a row move to the fallback within the same tick", async () => {
    const r = await onPrimary();
    r.fail("primary", 4);
    await r.advance(0);
    expect(r.m.status).toMatchObject({ state: "fallback", reason: "error-rate" });
  });

  it("timeouts are reported as such", async () => {
    const r = await onPrimary();
    r.fail("primary", 4, "timeout");
    await r.advance(0);
    expect(r.m.status).toMatchObject({ state: "fallback", reason: "timeout" });
  });

  it("slow but not failing: a high p95 of completed requests fails over", async () => {
    const r = await onPrimary();
    for (let i = 0; i < 5; i++) {
      const id = r.m.requestStarted("primary");
      await r.advance(100);
      r.m.requestFinished(id, "ok", 6000);
    }
    await r.advance(0);
    expect(r.m.status).toMatchObject({ state: "fallback", reason: "slow" });
  });

  it("stalled requests are caught by the watchdog although nothing ever finishes or errors", async () => {
    const r = await onPrimary();
    const t0 = Date.now();
    r.m.requestStarted("primary");
    r.m.requestStarted("primary");
    r.m.requestStarted("primary");
    await r.advance(4900);
    expect(r.m.status.state).toBe("primary");
    await r.advance(1200);
    expect(r.m.status).toMatchObject({ state: "fallback", reason: "stalled" });
    expect(Date.now() - t0).toBeLessThan(7000);
  });

  it("empty tiles and cancelled requests never count against the source", async () => {
    const r = await onPrimary();
    for (let i = 0; i < 30; i++) {
      const id = r.m.requestStarted("primary");
      r.m.requestFinished(id, "empty", 10);
    }
    for (let i = 0; i < 30; i++) r.m.requestCancelled(r.m.requestStarted("primary"));
    await r.advance(30_000);
    expect(r.m.status.state).toBe("primary");
  });

  it("a style error is confirmed with a probe: a healthy source stays, a dead one fails over", async () => {
    const r = await onPrimary();
    r.m.reportStyleError("primary", "tilejson 500");
    await r.advance(0);
    expect(r.m.status.state).toBe("primary");
    r.up.primary = false;
    r.m.reportStyleError("primary", "tilejson 500");
    await r.advance(0);
    expect(r.m.status).toMatchObject({ state: "fallback", reason: "style-error" });
  });

  it("a dead source fails over at once", async () => {
    const r = await onPrimary();
    r.m.reportSourceDied("primary", "worker crashed");
    await r.advance(0);
    expect(r.m.status).toMatchObject({ state: "fallback", reason: "source-died" });
  });

  it("goes to the cap when the fallback does not answer either", async () => {
    const r = await onPrimary();
    r.up.fallback = false;
    r.fail("primary", 4);
    await r.advance(0);
    expect(r.m.status).toMatchObject({ state: "capped", maxZoom: 6, reason: "error-rate" });
    expect(r.m.status.detail).toMatch(/fallback probe failed/);
  });

  it("when the fallback fails, the primary is re-probed at once (it may have come back)", async () => {
    const r = rig({}, { primary: false });
    r.m.start();
    await r.advance(0);
    expect(r.m.status.state).toBe("fallback");
    r.up.primary = true;
    await r.advance(11_000); // past the memory of the primary being down
    r.fail("fallback", 4);
    await r.advance(0);
    expect(r.m.status).toMatchObject({ state: "primary", reason: "recovered" });
  });

  it("ignores requests of a source that is no longer active", async () => {
    const r = await onPrimary();
    const late = r.m.requestStarted("primary");
    r.fail("primary", 4);
    await r.advance(0);
    expect(r.m.status.state).toBe("fallback");
    const before = r.log.length;
    for (let i = 0; i < 10; i++) r.m.requestFinished(late, "network-error", 10);
    await r.advance(0);
    expect(r.log.length).toBe(before);
  });

  it("does not count the time the tab was hidden as a stall", async () => {
    const r = await onPrimary();
    r.m.requestStarted("primary");
    r.m.requestStarted("primary");
    await r.advance(4000);
    r.m.pausedFor(60_000);
    await r.advance(4000);
    expect(r.m.status.state).toBe("primary");
  });
});

describe("recovery", () => {
  it("backs off 30 s, 60 s, 120 s, 240 s, then 5 min", () => {
    expect([1, 2, 3, 4, 5, 9].map((n) => retryDelayMs(n))).toEqual([30_000, 60_000, 120_000, 240_000, 300_000, 300_000]);
  });

  it("promotes the primary after two confirmed probes, 30 s + 4 s after the demotion", async () => {
    const r = rig({}, { primary: false });
    r.m.start();
    await r.advance(0);
    expect(r.m.status.state).toBe("fallback");
    r.up.primary = true;
    const t0 = Date.now();
    await r.advance(29_000);
    expect(r.m.status.state).toBe("fallback");
    await r.advance(2000); // first probe at 30 s
    expect(r.m.status.state).toBe("fallback"); // needs the confirmation
    await r.advance(DEFAULT_TIMINGS.confirmDelayMs + 100);
    expect(r.m.status).toMatchObject({ state: "primary", reason: "recovered" });
    expect(Date.now() - t0).toBeLessThan(40_000);
  });

  it("a recovery that fails its confirmation stays down and waits twice as long", async () => {
    const r = rig({}, { primary: false });
    r.m.start();
    await r.advance(0);
    r.up.primary = true;
    await r.advance(30_050); // first good probe
    r.up.primary = false; // flaps before the confirmation
    await r.advance(DEFAULT_TIMINGS.confirmDelayMs + 100);
    expect(r.m.status.state).toBe("fallback");
    r.up.primary = true;
    const n = r.probes.length;
    await r.advance(40_000);
    expect(r.probes.length).toBe(n); // next attempt is at +60 s, not +30 s
    await r.advance(30_000);
    expect(r.m.status.state).toBe("primary");
  });

  it("from the cap it also tries the fallback when the primary is still down", async () => {
    const r = rig({}, { primary: false, fallback: false });
    r.m.start();
    await r.advance(0);
    expect(r.m.status.state).toBe("capped");
    r.up.fallback = true;
    await r.advance(31_000);
    expect(r.m.status).toMatchObject({ state: "fallback", reason: "recovered" });
  });

  it("recovers all the way: capped, then primary, and a primary that flaps keeps a longer backoff", async () => {
    const r = rig({ timings: { flapWindowMs: 60_000 } }, { primary: false, fallback: false });
    r.m.start();
    await r.advance(0);
    r.up.primary = true;
    await r.advance(35_000);
    expect(r.m.status.state).toBe("primary");
    // fails again right after promotion: the failure count was not forgotten, so the next probe is later than 30 s
    r.up.primary = false;
    r.up.fallback = false;
    r.fail("primary", 4);
    await r.advance(0);
    expect(r.m.status.state).toBe("capped");
    r.up.primary = true;
    const n = r.probes.length;
    await r.advance(31_000);
    expect(r.probes.length).toBe(n); // not yet: backoff is 60 s now
    await r.advance(40_000);
    expect(r.m.status.state).toBe("primary");
  });

  it("dispose stops everything", async () => {
    const r = rig({}, { primary: false, fallback: false });
    r.m.start();
    await r.advance(0);
    const n = r.probes.length;
    r.m.dispose();
    await r.advance(600_000);
    expect(r.probes.length).toBe(n);
  });
});
