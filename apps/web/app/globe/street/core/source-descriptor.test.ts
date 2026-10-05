import { describe, expect, it } from "vitest";
import { descriptorFromPmtiles, descriptorFromTileJson, isPmtilesUrl, isValidTileTemplate } from "./source-descriptor";

const OFM_JSON = {
  tilejson: "3.0.0",
  tiles: ["https://tiles.openfreemap.org/planet/20260930_001001_pt/{z}/{x}/{y}.pbf"],
  minzoom: 0,
  maxzoom: 14,
  attribution: "OpenFreeMap",
  bounds: [-180, -85.0511, 180, 85.0511],
};

describe("tile templates", () => {
  it("must be absolute https (or localhost http) with z, x, y", () => {
    expect(isValidTileTemplate("https://t.example/{z}/{x}/{y}.pbf")).toBe(true);
    expect(isValidTileTemplate("http://localhost:8080/{z}/{x}/{y}.pbf")).toBe(true);
    expect(isValidTileTemplate("http://t.example/{z}/{x}/{y}.pbf")).toBe(false);
    expect(isValidTileTemplate("/tiles/{z}/{x}/{y}.pbf")).toBe(false);
    expect(isValidTileTemplate("https://t.example/{z}/{x}.pbf")).toBe(false);
    expect(isValidTileTemplate("https://user:pw@t.example/{z}/{x}/{y}.pbf")).toBe(false);
    expect(isValidTileTemplate("javascript:{z}{x}{y}")).toBe(false);
    expect(isValidTileTemplate(42)).toBe(false);
  });
});

describe("descriptorFromTileJson", () => {
  it("accepts OpenFreeMap's TileJSON", () => {
    expect(descriptorFromTileJson("primary", OFM_JSON)).toMatchObject({
      role: "primary",
      schema: "openmaptiles",
      minzoom: 0,
      maxzoom: 14,
      archiveUrl: null,
      bounds: [-180, -85.0511, 180, 85.0511],
    });
  });
  it("rejects documents without usable tile URLs, never throws", () => {
    for (const bad of [null, 3, "x", {}, { tiles: [] }, { tiles: ["http://evil.example/{z}/{x}/{y}"] }, { tiles: [1, 2] }]) {
      expect(descriptorFromTileJson("primary", bad)).toBeNull();
    }
  });
  it("clamps zooms and drops broken bounds", () => {
    const d = descriptorFromTileJson("primary", { ...OFM_JSON, minzoom: -4, maxzoom: 99, bounds: [10, 10, 5, 5] })!;
    expect(d.minzoom).toBe(0);
    expect(d.maxzoom).toBe(22);
    expect(d.bounds).toBeNull();
  });
});

describe("descriptorFromPmtiles", () => {
  const header = { minZoom: 0, maxZoom: 15, minLon: 106.5, minLat: 10.55, maxLon: 106.95, maxLat: 11 };
  it("clamps the zoom tiles are requested at to the configured maximum (the archive's --maxzoom)", () => {
    const d = descriptorFromPmtiles("fallback", "https://t.example/places.pmtiles", header, 14);
    expect(d).toMatchObject({ schema: "protomaps", maxzoom: 14, tiles: [], archiveUrl: "https://t.example/places.pmtiles", bounds: [106.5, 10.55, 106.95, 11] });
    expect(descriptorFromPmtiles("fallback", "u", header, 16).maxzoom).toBe(15);
    expect(descriptorFromPmtiles("primary", "u", header, null).maxzoom).toBe(15);
  });
  it("ignores invalid header bounds", () => {
    expect(descriptorFromPmtiles("fallback", "u", { ...header, minLon: 5, maxLon: 5 }, 14).bounds).toBeNull();
  });
});

describe("isPmtilesUrl", () => {
  it("looks at the path only", () => {
    expect(isPmtilesUrl("https://t.example/a/places.pmtiles")).toBe(true);
    expect(isPmtilesUrl("https://t.example/places.pmtiles?x=1")).toBe(true);
    expect(isPmtilesUrl("https://tiles.openfreemap.org/planet")).toBe(false);
    expect(isPmtilesUrl("not a url")).toBe(false);
  });
});
