import { describe, expect, it } from "vitest";
import { attributionFor, attributionText } from "./attribution";

const OFM = "https://tiles.openfreemap.org/planet";
const text = (primaryUrl: string, fallbackPmtilesUrl: string | null = null) => attributionText(attributionFor({ primaryUrl, fallbackPmtilesUrl }));

describe("attribution per tile configuration", () => {
  it("an OpenFreeMap primary credits OSM, OpenFreeMap and OpenMapTiles (the required wording), then Natural Earth", () => {
    expect(text(OFM)).toBe("© OpenStreetMap contributors · OpenFreeMap · OpenMapTiles · Natural Earth");
  });
  it("a fallback archive adds Protomaps", () => {
    expect(text(OFM, "https://t.example/x.pmtiles")).toBe("© OpenStreetMap contributors · OpenFreeMap · OpenMapTiles · Protomaps · Natural Earth");
  });
  it("a PMTiles primary is Protomaps data; a self-hosted TileJSON primary carries OSM only", () => {
    expect(text("https://t.example/x.pmtiles")).toBe("© OpenStreetMap contributors · Protomaps · Natural Earth");
    expect(text("https://tiles.example.org/planet")).toBe("© OpenStreetMap contributors · Natural Earth");
  });
  it("without a street map only the bundled public-domain lines are shown", () => {
    expect(attributionText(attributionFor(null))).toBe("Natural Earth");
  });
  it("every credit links over https, and OSM links its copyright page", () => {
    const parts = attributionFor({ primaryUrl: OFM, fallbackPmtilesUrl: "https://t.example/x.pmtiles" });
    expect(parts[0]!.href).toBe("https://www.openstreetmap.org/copyright");
    expect(parts.map((p) => p.href)).toEqual(expect.arrayContaining(["https://openfreemap.org", "https://openmaptiles.org"]));
    expect(parts.every((p) => p.href.startsWith("https://") && p.note.length > 0)).toBe(true);
  });
  it("a malformed primary URL does not throw", () => {
    expect(text("not a url")).toBe("© OpenStreetMap contributors · Natural Earth");
  });
});
