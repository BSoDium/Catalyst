import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEGRADED, ErrorWindow, chooseSource, clampedZoom, probe, retryDelayMs, type FetchLike } from "./health";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("probe", () => {
  it("reports ok for 200 and 206", async () => {
    const f200: FetchLike = async () => ({ ok: true, status: 200 });
    const f206: FetchLike = async () => ({ ok: false, status: 206 });
    expect((await probe("u", { fetchFn: f200 })).ok).toBe(true);
    expect((await probe("u", { fetchFn: f206 })).ok).toBe(true);
  });
  it("classifies http errors and network errors", async () => {
    const f500: FetchLike = async () => ({ ok: false, status: 503 });
    const fnet: FetchLike = async () => {
      throw new TypeError("failed");
    };
    expect(await probe("u", { fetchFn: f500 })).toMatchObject({ ok: false, reason: "http" });
    expect(await probe("u", { fetchFn: fnet })).toMatchObject({ ok: false, reason: "network" });
  });
  it("aborts a hung request at the timeout", async () => {
    const hang: FetchLike = (_u, init) => new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(new DOMException("a", "AbortError"))));
    const p = probe("u", { fetchFn: hang, timeoutMs: 3000 });
    await vi.advanceTimersByTimeAsync(3001);
    expect(await p).toMatchObject({ ok: false, reason: "timeout" });
  });
});

describe("chooseSource", () => {
  const chain = ["ofm", "pm"];
  it("prefers a source known up, in chain order", () => {
    expect(chooseSource(chain, { ofm: "up", pm: "up" })).toBe("ofm");
    expect(chooseSource(chain, { ofm: "down", pm: "up" })).toBe("pm");
  });
  it("tries unknown sources before giving up", () => {
    expect(chooseSource(chain, { ofm: "down" })).toBe("pm");
  });
  it("returns null (degraded) when everything is down", () => {
    expect(chooseSource(chain, { ofm: "down", pm: "down" })).toBeNull();
    expect(chooseSource([], {})).toBeNull();
  });
});

describe("ErrorWindow", () => {
  it("fires only for a burst inside the window", () => {
    const w = new ErrorWindow(3, 1000);
    expect(w.record(0)).toBe(false);
    expect(w.record(500)).toBe(false);
    expect(w.record(900)).toBe(true);
    const slow = new ErrorWindow(3, 1000);
    expect(slow.record(0)).toBe(false);
    expect(slow.record(2000)).toBe(false);
    expect(slow.record(4000)).toBe(false);
  });
  it("can be reset after a fail-over", () => {
    const w = new ErrorWindow(2, 1000);
    w.record(0);
    w.reset();
    expect(w.record(10)).toBe(false);
  });
});

describe("retry and degraded policy", () => {
  it("backs off 30 s up to 5 min", () => {
    expect([1, 2, 3, 4, 5, 9].map(retryDelayMs)).toEqual([30000, 60000, 120000, 240000, 300000, 300000]);
  });
  it("caps the zoom at the bundled data's useful range", () => {
    expect(clampedZoom(14.5)).toBe(DEGRADED.maxZoom);
    expect(clampedZoom(3)).toBe(3);
  });
});
