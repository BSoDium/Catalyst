import { describe, expect, it } from "vitest";
import { CHANNEL, DEFAULT_HANDOFF, buildMonoStyle, graticule, layerIds, type Schema } from "./monoStyle";

const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const make = (schema: Schema) =>
  buildMonoStyle({ schema, tilesUrl: schema === "protomaps" ? "pmtiles://x/hcmc.pmtiles" : "https://tiles.example/planet", coastlines: empty, borders: empty, graticule: empty });

describe("buildMonoStyle", () => {
  for (const schema of ["protomaps", "openmaptiles"] as const) {
    describe(schema, () => {
      const s = make(schema);
      it("has unique layer ids and a black background first", () => {
        const ids = layerIds(s);
        expect(new Set(ids).size).toBe(ids.length);
        expect(s.layers[0]).toMatchObject({ id: "background", type: "background" });
      });
      it("paints only the four pass channels (no other colours)", () => {
        const allowed = new Set<string>(Object.values(CHANNEL));
        for (const l of s.layers) {
          const p = (l.paint ?? {}) as Record<string, unknown>;
          for (const k of ["line-color", "fill-color", "background-color"]) if (typeof p[k] === "string") expect(allowed.has(p[k] as string)).toBe(true);
        }
      });
      it("has no text layers (labels are HTML) and no glyphs/sprite", () => {
        expect(s.layers.some((l) => l.type === "symbol")).toBe(false);
        expect(s.glyphs).toBeUndefined();
        expect(s.sprite).toBeUndefined();
      });
      it("draws roads casing before interiors, and the interiors erase", () => {
        const ids = layerIds(s);
        expect(ids.indexOf("road-major-case")).toBeLessThan(ids.indexOf("road-major-fill"));
        const fill = s.layers.find((l) => l.id === "road-major-fill") as { paint: Record<string, unknown> };
        expect(fill.paint["line-color"]).toBe(CHANNEL.erase);
      });
      it("hands the world coastline over to tile water at the schema's hand-over zoom", () => {
        const h = DEFAULT_HANDOFF[schema];
        const world = s.layers.find((l) => l.id === "world-coast") as { maxzoom: number };
        const edge = s.layers.find((l) => l.id === "water-edge") as { minzoom: number };
        expect(world.maxzoom).toBeLessThan(edge.minzoom);
        expect(edge.minzoom).toBe(h);
      });
      it("is a globe with a single tile source", () => {
        expect(s.projection).toEqual({ type: "globe" });
        expect(Object.keys(s.sources).filter((k) => (s.sources[k] as { type: string }).type === "vector")).toEqual(["tiles"]);
      });
    });
  }
  it("builds a tile-less style for degraded mode: world data only, coastline at every zoom", () => {
    const s = buildMonoStyle({ schema: "protomaps", tilesUrl: null, coastlines: empty, borders: empty, graticule: empty });
    expect(Object.keys(s.sources)).toEqual(["coast", "borders", "grid"]);
    expect(s.layers.every((l) => !("source" in l) || l.source !== "tiles")).toBe(true);
    const coast = s.layers.find((l) => l.id === "world-coast") as { maxzoom: number };
    expect(coast.maxzoom).toBe(24);
  });
  it("both schemas expose the same visual layer set apart from schema-only layers", () => {
    const a = layerIds(make("protomaps"));
    const b = layerIds(make("openmaptiles"));
    for (const id of ["road-major-case", "road-minor", "water-edge", "building-fill", "graticule", "world-coast"]) {
      expect(a).toContain(id);
      expect(b).toContain(id);
    }
  });
});

describe("graticule", () => {
  it("covers meridians and parallels every 15 degrees", () => {
    const g = graticule(15, 3);
    const lines = (g.features[0]!.geometry as GeoJSON.MultiLineString).coordinates;
    expect(lines.length).toBe(25 + 11 - 0); // 25 meridians, parallels at -75..75 = 11
  });
});
