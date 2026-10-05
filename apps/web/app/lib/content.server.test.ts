import { describe, expect, it, vi } from "vitest";
import { loadDemoProjection, loadPublishedProjection } from "@catalyst/published";
import { contentModeFromEnv, createContentSource } from "./content.server";

const demo = loadDemoProjection();
const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init);

function setup(fetchImpl: typeof fetch, overrides: Parameters<typeof createContentSource>[0] = {}) {
  let t = 1_000;
  const warn = vi.fn();
  const source = createContentSource({
    mode: "published",
    apiUrl: "https://api.test/",
    fetch: fetchImpl,
    now: () => t,
    warn,
    ...overrides,
  });
  return { source, warn, advance: (ms: number) => (t += ms) };
}

describe("contentModeFromEnv", () => {
  it("is demo only when explicitly requested", () => {
    expect(contentModeFromEnv({ CATALYST_CONTENT: "demo" })).toBe("demo");
    expect(contentModeFromEnv({ CATALYST_CONTENT: "published" })).toBe("published");
    expect(contentModeFromEnv({})).toBe("published");
  });
});

describe("bundled source", () => {
  it("serves the bundled projection for the chosen mode without any fetch", async () => {
    const fetchMock = vi.fn();
    const demoSource = createContentSource({ mode: "demo", fetch: fetchMock as unknown as typeof fetch });
    expect((await demoSource.getProjection()).places.length).toBe(demo.places.length);
    const published = createContentSource({ mode: "published" });
    expect(await published.getProjection()).toEqual(loadPublishedProjection());
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("API source", () => {
  it("fetches ${url}/v1/projection, validates and caches", async () => {
    const fetchMock = vi.fn(async (_url: string) => json(demo));
    const { source, advance } = setup(fetchMock as unknown as typeof fetch);
    expect(await source.getProjection()).toEqual(demo);
    await source.getProjection();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.test/v1/projection");
    advance(60_001);
    await source.getProjection();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight request between concurrent callers", async () => {
    const fetchMock = vi.fn(async () => json(demo));
    const { source } = setup(fetchMock as unknown as typeof fetch);
    await Promise.all([source.getProjection(), source.getProjection(), source.getProjection()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the bundled snapshot on a network error, with one warning", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const { source, warn } = setup(fetchMock as unknown as typeof fetch);
    expect(await source.getProjection()).toEqual(loadPublishedProjection());
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("fetch failed");
  });

  it("falls back on non-2xx responses", async () => {
    const { source, warn } = setup((async () => json({}, { status: 503 })) as typeof fetch);
    expect(await source.getProjection()).toEqual(loadPublishedProjection());
    expect(warn.mock.calls[0]?.[0]).toContain("HTTP 503");
  });

  it("falls back on a payload that fails validation", async () => {
    const invalid = { ...demo, places: [{ ...demo.places[0], coordinates: { lat: 999, lon: 0 } }] };
    const { source, warn } = setup((async () => json(invalid)) as typeof fetch);
    expect(await source.getProjection()).toEqual(loadPublishedProjection());
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).not.toContain("\n");
  });

  it("falls back on malformed JSON", async () => {
    const { source } = setup((async () => new Response("<html>")) as typeof fetch);
    expect(await source.getProjection()).toEqual(loadPublishedProjection());
  });

  it("aborts after the timeout and falls back", async () => {
    vi.useFakeTimers();
    try {
      const hanging = ((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        })) as unknown as typeof fetch;
      const { source, warn } = setup(hanging, { timeoutMs: 2000 });
      const pending = source.getProjection();
      await vi.advanceTimersByTimeAsync(2000);
      expect(await pending).toEqual(loadPublishedProjection());
      expect(warn.mock.calls[0]?.[0]).toContain("timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not hammer a failing API: the fallback is cached briefly, then retried", async () => {
    const fetchMock = vi.fn(async () => json({}, { status: 500 }));
    const { source, advance } = setup(fetchMock as unknown as typeof fetch);
    await source.getProjection();
    await source.getProjection();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    advance(15_001);
    await source.getProjection();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
