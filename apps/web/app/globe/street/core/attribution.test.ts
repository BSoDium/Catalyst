import { describe, expect, it } from "vitest";
import { attributionFor, attributionText } from "./attribution";

const OFM = "https://tiles.openfreemap.org/planet";
const text = (i: Parameters<typeof attributionFor>[0]) => attributionText(attributionFor(i));

describe("attribution per active source", () => {
  it("primary on OpenFreeMap credits OSM, OpenFreeMap and OpenMapTiles", () => {
    expect(text({ state: "primary", source: "primary", primaryUrl: OFM, primaryIsPmtiles: false })).toBe("© OpenStreetMap contributors · OpenFreeMap · OpenMapTiles");
  });
  it("the fallback credits OSM and Protomaps", () => {
    expect(text({ state: "fallback", source: "fallback", primaryUrl: OFM, primaryIsPmtiles: false })).toBe("© OpenStreetMap contributors · Protomaps");
  });
  it("a PMTiles primary is Protomaps data; a self-hosted TileJSON primary carries OSM only", () => {
    expect(text({ state: "primary", source: "primary", primaryUrl: "https://t.example/x.pmtiles", primaryIsPmtiles: true })).toBe("© OpenStreetMap contributors · Protomaps");
    expect(text({ state: "primary", source: "primary", primaryUrl: "https://tiles.example.org/planet", primaryIsPmtiles: false })).toBe("© OpenStreetMap contributors");
  });
  it("while connecting or capped only the bundled public-domain lines are drawn", () => {
    expect(text({ state: "capped", source: null, primaryUrl: OFM, primaryIsPmtiles: false })).toBe("Natural Earth");
    expect(text({ state: "connecting", source: null, primaryUrl: OFM, primaryIsPmtiles: false })).toBe("Natural Earth");
  });
  it("links the OSM copyright page", () => {
    const parts = attributionFor({ state: "primary", source: "primary", primaryUrl: OFM, primaryIsPmtiles: false });
    expect(parts[0]!.href).toBe("https://www.openstreetmap.org/copyright");
    expect(parts.every((p) => p.href?.startsWith("https://"))).toBe(true);
  });
});
