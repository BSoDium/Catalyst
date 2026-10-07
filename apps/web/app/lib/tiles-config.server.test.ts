import { describe, expect, it, vi } from "vitest";
import { DEFAULT_MAX_FALLBACK_ZOOM, DEFAULT_PRIMARY_URL, resolveTilesConfig, validateTileUrl } from "./tiles-config.server";

const resolve = (env: Record<string, string | undefined>, dev = false) => {
  const warn = vi.fn();
  return { cfg: resolveTilesConfig(env, { dev, warn }), warn };
};

describe("defaults", () => {
  it("is OpenFreeMap with no fallback and zoom 14 when nothing is set", () => {
    const { cfg, warn } = resolve({});
    expect(cfg).toEqual({ primaryUrl: "https://tiles.openfreemap.org/planet", fallbackPmtilesUrl: null, maxFallbackZoom: 14 });
    expect(DEFAULT_PRIMARY_URL).toBe("https://tiles.openfreemap.org/planet");
    expect(DEFAULT_MAX_FALLBACK_ZOOM).toBe(14);
    expect(warn).not.toHaveBeenCalled();
  });
  it("treats empty and blank strings as unset (.env templates and dashboards produce them)", () => {
    const { cfg, warn } = resolve({ CATALYST_TILES_PRIMARY_URL: "", CATALYST_TILES_FALLBACK_URL: "   ", CATALYST_TILES_MAX_FALLBACK_ZOOM: "" });
    expect(cfg.fallbackPmtilesUrl).toBeNull();
    expect(cfg.primaryUrl).toBe(DEFAULT_PRIMARY_URL);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("values", () => {
  it("accepts https URLs and an integer zoom, trimmed", () => {
    const { cfg, warn } = resolve({
      CATALYST_TILES_PRIMARY_URL: " https://tiles.example.org/planet ",
      CATALYST_TILES_FALLBACK_URL: "https://tiles.example.com/places.pmtiles",
      CATALYST_TILES_MAX_FALLBACK_ZOOM: " 13 ",
    });
    expect(cfg).toEqual({ primaryUrl: "https://tiles.example.org/planet", fallbackPmtilesUrl: "https://tiles.example.com/places.pmtiles", maxFallbackZoom: 13 });
    expect(warn).not.toHaveBeenCalled();
  });
  it("accepts the zoom bounds 0 and 15 only", () => {
    expect(resolve({ CATALYST_TILES_MAX_FALLBACK_ZOOM: "0" }).cfg.maxFallbackZoom).toBe(0);
    expect(resolve({ CATALYST_TILES_MAX_FALLBACK_ZOOM: "15" }).cfg.maxFallbackZoom).toBe(15);
    for (const bad of ["16", "-1", "13.5", "abc", "1e1", "0x0e"]) {
      const { cfg, warn } = resolve({ CATALYST_TILES_MAX_FALLBACK_ZOOM: bad });
      expect(cfg.maxFallbackZoom, bad).toBe(14);
      expect(warn, bad).toHaveBeenCalledTimes(1);
    }
  });
});

describe("invalid URLs behave as unset, with one warning each", () => {
  it.each([
    ["relative", "/tiles/places.pmtiles"],
    ["plain http", "http://tiles.example.com/places.pmtiles"],
    ["credentials", "https://user:pw@tiles.example.com/places.pmtiles"],
    ["other scheme", "ftp://tiles.example.com/places.pmtiles"],
    ["javascript", "javascript:alert(1)"],
    ["garbage", "not a url"],
  ])("%s", (_name, value) => {
    const { cfg, warn } = resolve({ CATALYST_TILES_PRIMARY_URL: value, CATALYST_TILES_FALLBACK_URL: value });
    expect(cfg.primaryUrl).toBe(DEFAULT_PRIMARY_URL);
    expect(cfg.fallbackPmtilesUrl).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
  });
  it("never throws", () => {
    expect(() => resolveTilesConfig({ CATALYST_TILES_PRIMARY_URL: "\u0000", CATALYST_TILES_FALLBACK_URL: "https://" })).not.toThrow();
  });
});

describe("localhost", () => {
  it("is allowed over plain http in development only", () => {
    for (const host of ["localhost:8080", "127.0.0.1:8080", "[::1]:8080"]) {
      expect(validateTileUrl(`http://${host}/places.pmtiles`, true).ok, host).toBe(true);
      expect(validateTileUrl(`http://${host}/places.pmtiles`, false).ok, host).toBe(false);
    }
    expect(validateTileUrl("http://192.168.1.10/places.pmtiles", true).ok).toBe(false);
    expect(resolve({ CATALYST_TILES_FALLBACK_URL: "http://localhost:8080/places.pmtiles" }, true).cfg.fallbackPmtilesUrl).toBe("http://localhost:8080/places.pmtiles");
    expect(resolve({ CATALYST_TILES_FALLBACK_URL: "http://localhost:8080/places.pmtiles" }, false).cfg.fallbackPmtilesUrl).toBeNull();
  });
});
