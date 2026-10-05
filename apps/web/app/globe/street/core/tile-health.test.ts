import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, TileHealth, percentile } from "./tile-health";

const T = DEFAULT_THRESHOLDS;

/** Run `n` requests that each take `ms` and end at `end + i * 100`. */
function feed(h: TileHealth, n: number, outcome: Parameters<TileHealth["finish"]>[1], ms: number, end = 1000) {
  for (let i = 0; i < n; i++) h.finish(i + 1000 + end, outcome, ms, end + i * 100);
}

describe("percentile", () => {
  it("is nearest rank", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5)).toBe(5);
    expect(percentile([7], 0.95)).toBe(7);
    expect(percentile([], 0.5)).toBeNaN();
  });
});

describe("TileHealth verdicts", () => {
  it("is healthy with no data and with normal traffic", () => {
    const h = new TileHealth(T, 0);
    expect(h.verdict(0).ok).toBe(true);
    feed(h, 12, "ok", 200);
    expect(h.verdict(3000).ok).toBe(true);
  });

  it("fails on consecutive failures, quickly (a hard outage)", () => {
    const h = new TileHealth(T, 0);
    feed(h, 3, "network-error", 5);
    expect(h.verdict(1500).ok).toBe(true);
    feed(h, 1, "network-error", 5, 1300);
    expect(h.verdict(1500)).toMatchObject({ ok: false, reason: "error-rate" });
  });

  it("calls consecutive timeouts 'timeout'", () => {
    const h = new TileHealth(T, 0);
    feed(h, 4, "timeout", 10_000, 12_000);
    expect(h.verdict(12_500)).toMatchObject({ ok: false, reason: "timeout" });
  });

  it("fails on a failure share of the window even with successes in between", () => {
    const h = new TileHealth(T, 0);
    for (let i = 0; i < 8; i++) h.finish(i, i % 2 ? "ok" : "http-error", 100, 1000 + i * 100);
    expect(h.verdict(2000)).toMatchObject({ ok: false, reason: "error-rate" });
  });

  it("does not fail on a few failures among many successes", () => {
    const h = new TileHealth(T, 0);
    for (let i = 0; i < 20; i++) h.finish(i, i % 7 === 3 ? "http-error" : "ok", 100, 1000 + i * 100);
    expect(h.verdict(3500).ok).toBe(true);
  });

  it("treats empty tiles (404 / 204 / missing in the archive) as success", () => {
    const h = new TileHealth(T, 0);
    feed(h, 30, "empty", 30);
    expect(h.verdict(5000).ok).toBe(true);
    expect(h.snapshot(5000).failures).toBe(0);
  });

  it("fails on a slow p95 although nothing errors (slow but not failing)", () => {
    const h = new TileHealth(T, 0);
    for (let i = 0; i < 6; i++) h.finish(i, "ok", 5200, 6000 + i * 100);
    expect(h.verdict(7000)).toMatchObject({ ok: false, reason: "slow" });
  });

  it("does not fail a slow request or two among fast ones", () => {
    const h = new TileHealth(T, 0);
    for (let i = 0; i < 40; i++) h.finish(i, "ok", i < 38 ? 150 : 6000, 1000 + i * 50);
    expect(h.verdict(4000).ok).toBe(true); // p95 of 40 samples is the 38th value
  });

  it("fails on stalled requests: two over the limit, or one when nothing has got through", () => {
    const h = new TileHealth(T, 0);
    h.start(1, 0);
    h.start(2, 0);
    h.start(3, 3000);
    expect(h.verdict(4000).ok).toBe(true);
    expect(h.verdict(5100)).toMatchObject({ ok: false, reason: "stalled" });

    const one = new TileHealth(T, 0);
    one.start(1, 0);
    expect(one.verdict(6000).ok).toBe(true); // one stalled request, but the source answered recently (start counts as alive)
    expect(one.verdict(10_100)).toMatchObject({ ok: false, reason: "stalled" });
  });

  it("a request that finishes is no longer stalled; a cancelled one never counts", () => {
    const h = new TileHealth(T, 0);
    h.start(1, 0);
    h.start(2, 0);
    h.cancel(1);
    h.finish(2, "ok", 5200, 5200);
    expect(h.verdict(5300).ok).toBe(true);
    expect(h.pendingCount).toBe(0);
  });

  it("forgets samples outside the window", () => {
    const h = new TileHealth(T, 0);
    feed(h, 4, "http-error", 5, 1000);
    expect(h.verdict(1400).ok).toBe(false);
    // a good request resets the run; the old failures age out of the window
    h.finish(99, "ok", 50, 30_000);
    expect(h.verdict(30_100).ok).toBe(true);
    expect(h.snapshot(30_100).samples).toBe(1);
  });

  it("hidden time is not stall time", () => {
    const h = new TileHealth(T, 0);
    h.start(1, 0);
    h.start(2, 0);
    h.shiftPending(20_000);
    expect(h.verdict(20_500).ok).toBe(true);
  });

  it("reset clears the window for a new source", () => {
    const h = new TileHealth(T, 0);
    feed(h, 5, "network-error", 5);
    h.reset(2000);
    expect(h.verdict(2000).ok).toBe(true);
  });
});
