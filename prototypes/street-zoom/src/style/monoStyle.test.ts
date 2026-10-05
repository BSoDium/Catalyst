import { describe, expect, it } from "vitest";
import { expInterp } from "../core/artLine";
import { CHANNEL, DEFAULT_HANDOFF, SPECS, buildMonoStyle, graticule, layerIds, linePaint, type Schema } from "./monoStyle";

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

/** Evaluate a `line-width` / `line-opacity` paint value (number or zoom interpolate) at a zoom. */
function evalPaint(v: unknown, z: number): number {
  if (typeof v === "number") return v;
  const e = v as unknown[]; // ["interpolate", ["exponential"|"linear", base?], ["zoom"], z0, v0, ...]
  const stops: [number, number][] = [];
  for (let i = 3; i < e.length; i += 2) stops.push([e[i] as number, e[i + 1] as number]);
  const kind = (e[1] as unknown[])[0];
  return expInterp(stops, z, kind === "exponential" ? ((e[1] as unknown[])[1] as number) : 1);
}

describe("line rules: widths in art pixels", () => {
  const CELL = 3;
  const ink = SPECS.filter((s) => s.type === "line" && s.ch === "ink");
  it("no ink line is ever thinner than one art pixel, at any zoom", () => {
    for (const spec of ink) {
      const { paint } = linePaint(spec, "art", CELL);
      for (let z = 0; z <= 18; z += 0.25) expect(evalPaint(paint["line-width"], z), `${spec.id} z${z}`).toBeGreaterThanOrEqual(CELL - 1e-9);
    }
  });
  it("tone lines are floored at one art pixel too and are never tone-dithered: ink dashes (thin class) or a solid muted line", () => {
    for (const spec of SPECS.filter((s) => s.type === "line" && s.tone !== undefined)) {
      const { paint } = linePaint(spec, "art", CELL);
      expect(evalPaint(paint["line-width"], 15)).toBeGreaterThanOrEqual(CELL - 1e-9);
      expect(paint["line-opacity"]).toBe(spec.ch === "muted" ? 1 : 0.75);
      expect(paint["line-color"]).toBe(spec.ch === "muted" ? CHANNEL.muted : CHANNEL.ink);
      if (spec.dash && !spec.solid) {
        const dash = paint["line-dasharray"] as number[];
        // a dash must be long enough to catch a cell centre on a diagonal (cell diagonal = 1.42 art px)
        expect(dash[0]!).toBeGreaterThanOrEqual(1.42);
      }
    }
  });
  it("widths follow the art cell: a 2 px cell (phones) halves the CSS widths, the art widths stay", () => {
    const spec = SPECS.find((s) => s.id === "road-major-case")!;
    const a = evalPaint(linePaint(spec, "art", 3).paint["line-width"], 17) / 3;
    const b = evalPaint(linePaint(spec, "art", 2).paint["line-width"], 17) / 2;
    expect(a).toBeCloseTo(b, 6);
  });
  it("one-pixel lines are painted weaker than wide ones so the pass knows what it may thin", () => {
    const hair = SPECS.find((s) => s.id === "building-outline")!;
    expect(linePaint(hair, "art", CELL).paint["line-opacity"]).toBe(0.75);
    const major = SPECS.find((s) => s.id === "road-major-case")!;
    const op = linePaint(major, "art", CELL).paint["line-opacity"];
    expect(evalPaint(op, 8)).toBe(0.75); // a one-pixel road
    expect(evalPaint(op, 16)).toBe(1); // a wide solid band: never thinned
    expect(evalPaint(op, 18)).toBe(0.75); // two one-pixel outlines of a hollow road
    const water = SPECS.find((s) => s.id === "waterway-major")!;
    expect(evalPaint(linePaint(water, "art", CELL).paint["line-opacity"], 17)).toBe(1); // a 2 px river
  });
  it("hollow roads: the erasing interior is zero until two outlines plus a 2 px interior fit, then casing minus 2 px", () => {
    for (const [fillId, caseId] of [["road-major-fill", "road-major-case"], ["road-medium-fill", "road-medium-case"]] as const) {
      const fill = linePaint(SPECS.find((s) => s.id === fillId)!, "art", CELL).paint["line-width"];
      const cas = linePaint(SPECS.find((s) => s.id === caseId)!, "art", CELL).paint["line-width"];
      for (let z = 12; z <= 18; z += 0.25) {
        const f = evalPaint(fill, z) / CELL;
        const c = evalPaint(cas, z) / CELL;
        if (f > 0) {
          expect(f).toBeGreaterThanOrEqual(2 - 1e-6);
          expect(c - f).toBeGreaterThan(1.8);
          expect(c - f).toBeLessThan(2.3);
        }
      }
      expect(evalPaint(fill, 18) / CELL).toBeGreaterThan(0);
    }
  });
  it("legacy mode keeps the spike's nominal CSS widths (before/after reproducibility)", () => {
    const hair = SPECS.find((s) => s.id === "building-outline")!;
    expect(linePaint(hair, "legacy", CELL).paint["line-width"]).toBe(0.6);
    const dotted = SPECS.find((s) => s.id === "road-minor-dotted")!;
    expect(linePaint(dotted, "legacy", CELL).paint["line-opacity"]).toBe(0.33);
    expect(linePaint(dotted, "legacy", CELL).paint["line-dasharray"]).toBeUndefined();
  });
  it("the art style still paints only the four pass channels", () => {
    const allowed = new Set<string>(Object.values(CHANNEL));
    const st = buildMonoStyle({ schema: "protomaps", tilesUrl: "pmtiles://x", coastlines: { type: "FeatureCollection", features: [] }, borders: { type: "FeatureCollection", features: [] }, graticule: { type: "FeatureCollection", features: [] }, widths: "art", cellCss: 3 });
    for (const l of st.layers) {
      const p = (l.paint ?? {}) as Record<string, unknown>;
      for (const k of ["line-color", "fill-color", "background-color"]) if (typeof p[k] === "string") expect(allowed.has(p[k] as string)).toBe(true);
    }
  });
});
