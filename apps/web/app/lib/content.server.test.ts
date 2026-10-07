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
  it("is demo or preview only when explicitly requested; everything else is published", () => {
    expect(contentModeFromEnv({ CATALYST_CONTENT: "demo" })).toBe("demo");
    expect(contentModeFromEnv({ CATALYST_CONTENT: "preview" })).toBe("preview");
    expect(contentModeFromEnv({ CATALYST_CONTENT: "published" })).toBe("published");
    expect(contentModeFromEnv({})).toBe("published");
    expect(contentModeFromEnv({ CATALYST_CONTENT: "" })).toBe("published");
    expect(contentModeFromEnv({ CATALYST_CONTENT: "Demo" })).toBe("published");
    expect(contentModeFromEnv({ CATALYST_CONTENT: "auto" })).toBe("published");
  });
});

describe("preview mode", () => {
  it("serves the local preview projection, never calls the API even when one is configured, and re-reads on every call", async () => {
    const fetchMock = vi.fn();
    const load = vi.fn((_mode: string) => demo);
    const source = createContentSource({ mode: "preview", apiUrl: "https://api.test", fetch: fetchMock as unknown as typeof fetch, load });
    expect(await source.getProjection()).toEqual(demo);
    await source.getProjection();
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenCalledWith("preview");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the empty projection and logs the reason once when the file is missing or refused", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const load = () => {
        throw new Error("preview projection not found: run `pnpm export:preview --out <this repo>` in the private content repo");
      };
      const source = createContentSource({ mode: "preview", load });
      const first = await source.getProjection();
      expect(first.places).toEqual([]);
      await source.getProjection();
      expect(error).toHaveBeenCalledTimes(1);
      expect(String(error.mock.calls[0]?.[0])).toContain("pnpm export:preview");
    } finally {
      error.mockRestore();
    }
  });

  it("is refused in production with the real loader (no file is ever served)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const prev = { node: process.env.NODE_ENV, allow: process.env.CATALYST_ALLOW_PREVIEW };
    try {
      process.env.NODE_ENV = "production";
      delete process.env.CATALYST_ALLOW_PREVIEW;
      const result = await createContentSource({ mode: "preview" }).getProjection();
      expect(result.places).toEqual([]);
      expect(String(error.mock.calls[0]?.[0])).toContain("refused in production");
    } finally {
      process.env.NODE_ENV = prev.node;
      if (prev.allow !== undefined) process.env.CATALYST_ALLOW_PREVIEW = prev.allow;
      error.mockRestore();
    }
  });

  it("the default mode of the source stays published", async () => {
    const load = vi.fn((_mode: string) => demo);
    await createContentSource({ load }).getProjection();
    expect(load).toHaveBeenCalledWith("published");
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
