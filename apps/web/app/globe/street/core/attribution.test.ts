import { describe, expect, it } from "vitest";
import { attributionFor, attributionLine, attributionText } from "./attribution";

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
  it("the one-line summary abbreviates the main contributors in priority order and leaves the schema to the dialog", () => {
    const line = (primaryUrl: string, fallbackPmtilesUrl: string | null = null) => attributionLine(attributionFor({ primaryUrl, fallbackPmtilesUrl }));
    expect(line(OFM)).toEqual(["© OpenStreetMap", "OpenFreeMap", "Natural Earth"]);
    expect(line(OFM, "https://t.example/x.pmtiles")).toEqual(["© OpenStreetMap", "OpenFreeMap", "Protomaps", "Natural Earth"]);
    expect(line("https://t.example/x.pmtiles")).toEqual(["© OpenStreetMap", "Protomaps", "Natural Earth"]);
    expect(line("https://tiles.example.org/planet")).toEqual(["© OpenStreetMap", "Natural Earth"]);
    expect(attributionLine(attributionFor(null))).toEqual(["Natural Earth"]);
  });
  it("every credit of the dialog is still there, and the courtesy credit is always the last one of the line", () => {
    const parts = attributionFor({ primaryUrl: OFM, fallbackPmtilesUrl: "https://t.example/x.pmtiles" });
    expect(parts.map((p) => p.text)).toContain("OpenMapTiles");
    expect(attributionLine(parts).at(-1)).toBe("Natural Earth");
    expect(attributionLine(parts).length).toBeLessThan(parts.length);
  });
});
