import { describe, expect, it } from "vitest";
import { expInterp } from "../core/art-line";
import { roleLevel } from "../../engine/palette";
import { ERASE, MAX_LEVELS } from "../core/palette";
import { BORDER_TILE_MINZOOM, DEFAULT_HANDOFF, SPECS, WORLD_PLACEHOLDER_BELOW, borderHandoff, hasPlaceholder, buildStreetStyle, graticule, layerIds, linePaint, type Schema } from "./street-style";
import { decodeLevel, evalFilter, levelOfPaint } from "./probe";

const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const TILES = { tiles: ["cat-p1://https://tiles.example/{z}/{x}/{y}.pbf"], minzoom: 0, maxzoom: 14, bounds: null };
const make = (schema: Schema) => buildStreetStyle({ schema, tiles: TILES, coastlines: empty, borders: empty, graticule: empty, routes: empty });

describe("buildStreetStyle", () => {
  for (const schema of ["protomaps", "openmaptiles"] as const) {
    describe(schema, () => {
      const s = make(schema);
      it("has unique layer ids and a black background first", () => {
        const ids = layerIds(s);
        expect(new Set(ids).size).toBe(ids.length);
        expect(s.layers[0]).toMatchObject({ id: "background", type: "background" });
      });
      it("paints only level-encoded colours (no other colours), every level inside the palette", () => {
        for (const l of s.layers) {
          const p = (l.paint ?? {}) as Record<string, unknown>;
          for (const k of ["line-color", "fill-color", "background-color"]) {
            if (p[k] === undefined) continue;
            const colors = typeof p[k] === "string" ? [p[k] as string] : (p[k] as unknown[]).filter((v) => typeof v === "string" && v.startsWith("rgb")) as string[];
            for (const c of colors) {
              if (c === ERASE) continue;
              expect(c, l.id).toMatch(/^rgb\((255,\d+,0|0,0,\d+)\)$/);
              expect(decodeLevel(c), l.id).toBeGreaterThanOrEqual(1);
              expect(decodeLevel(c), l.id).toBeLessThan(MAX_LEVELS);
            }
          }
        }
        void levelOfPaint;
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
        expect(fill.paint["line-color"]).toBe(ERASE);
      });
      it("hands the world coastline over to tile water at the schema's hand-over zoom", () => {
        const h = DEFAULT_HANDOFF[schema];
        const world = s.layers.find((l) => l.id === "world-coast") as { maxzoom: number; layout?: { visibility?: string } };
        const edge = s.layers.find((l) => l.id === "water-edge") as { minzoom: number };
        expect(edge.minzoom).toBe(h);
        if (hasPlaceholder(h, true)) {
          // global tiles: the tile coast is drawn from the first zoom; the world coast is a placeholder under it (hidden until tiles are loading)
          expect(world.maxzoom).toBe(WORLD_PLACEHOLDER_BELOW);
          expect(world.layout?.visibility).toBe("none");
        } else {
          expect(world.maxzoom).toBe(edge.minzoom);
          expect(world.layout).toBeUndefined();
        }
      });
      it("is a globe with a single tile source whose tile URLs carry the instance's protocol", () => {
        expect(s.projection).toEqual({ type: "globe" });
        expect(Object.keys(s.sources).filter((k) => (s.sources[k] as { type: string }).type === "vector")).toEqual(["tiles"]);
        expect((s.sources.tiles as { tiles: string[] }).tiles[0]).toMatch(/^cat-p1:\/\//);
      });
      it("draws routes over the roads with an erasing halo underneath, and under the world lines", () => {
        const ids = layerIds(s);
        expect(ids.indexOf("routes-halo")).toBeLessThan(ids.indexOf("routes-line"));
        expect(ids.indexOf("routes-line")).toBeGreaterThan(ids.indexOf("building-outline"));
        expect(ids.indexOf("routes-line")).toBeLessThan(ids.indexOf("world-coast"));
        const halo = s.layers.find((l) => l.id === "routes-halo") as { paint: Record<string, unknown> };
        expect(halo.paint["line-color"]).toBe(ERASE);
        const line = s.layers.find((l) => l.id === "routes-line") as { paint: Record<string, unknown> };
        expect((line.paint["line-dasharray"] as number[])[0]).toBeGreaterThanOrEqual(1.42);
      });
      it("never references glyphs or sprites and uses no symbol layers", () => {
        expect(JSON.stringify(s)).not.toMatch(/glyphs|sprite|text-field|icon-image/);
      });
    });
  }
  it("builds a tile-less style for the capped state: world data and routes only, coastline at every zoom", () => {
    const s = buildStreetStyle({ schema: "protomaps", tiles: null, coastlines: empty, borders: empty, graticule: empty, routes: empty });
    expect(Object.keys(s.sources)).toEqual(["coast", "borders", "grid", "routes"]);
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
      const { paint } = linePaint(spec, CELL);
      for (let z = 0; z <= 18; z += 0.25) expect(evalPaint(paint["line-width"], z), `${spec.id} z${z}`).toBeGreaterThanOrEqual(CELL - 1e-9);
    }
  });
  it("dashed lines are one-pixel ink dashes (thin class), never dithered: they keep the one-pixel floor and long-enough dashes", () => {
    for (const spec of SPECS.filter((s) => s.type === "line" && s.dash)) {
      const { paint } = linePaint(spec, CELL);
      expect(evalPaint(paint["line-width"], 15)).toBeGreaterThanOrEqual(CELL - 1e-9);
      expect(paint["line-opacity"]).toBe(0.75);
      // a dash must be long enough to catch a cell centre on a diagonal (cell diagonal = 1.42 art px)
      expect((paint["line-dasharray"] as number[])[0]!).toBeGreaterThanOrEqual(1.42);
    }
  });
  it("the graticule is one constant faint-level line (no zoom ramp, no maxzoom): the layer switch turns it on and off with the flatness of the view", () => {
    const g = make("openmaptiles").layers.find((l) => l.id === "graticule") as unknown as { maxzoom?: number; paint: Record<string, unknown> };
    expect(g.maxzoom).toBeUndefined();
    expect(typeof g.paint["line-color"]).toBe("string");
    expect(levelOfPaint(g.paint["line-color"], 0)).toBe(roleLevel("faint"));
  });
  it("widths follow the art cell: a 2 px cell (phones) halves the CSS widths, the art widths stay", () => {
    const spec = SPECS.find((s) => s.id === "road-major-case")!;
    const a = evalPaint(linePaint(spec, 3).paint["line-width"], 17) / 3;
    const b = evalPaint(linePaint(spec, 2).paint["line-width"], 17) / 2;
    expect(a).toBeCloseTo(b, 6);
  });
  it("one-pixel lines are painted weaker than wide ones so the pass knows what it may thin", () => {
    const hair = SPECS.find((s) => s.id === "building-outline")!;
    expect(linePaint(hair, CELL).paint["line-opacity"]).toBe(0.75);
    const major = SPECS.find((s) => s.id === "road-major-case")!;
    const op = linePaint(major, CELL).paint["line-opacity"];
    expect(evalPaint(op, 8)).toBe(0.75); // a one-pixel road
    expect(evalPaint(op, 16)).toBe(1); // a wide solid band: never thinned
    expect(evalPaint(op, 18)).toBe(0.75); // two one-pixel outlines of a hollow road
    const water = SPECS.find((s) => s.id === "waterway-major")!;
    expect(evalPaint(linePaint(water, CELL).paint["line-opacity"], 17)).toBe(1); // a 2 px river
  });
  it("hollow roads: the erasing interior is zero until two outlines plus a 2 px interior fit, then casing minus 2 px", () => {
    for (const [fillId, caseId] of [["road-major-fill", "road-major-case"], ["road-medium-fill", "road-medium-case"]] as const) {
      const fill = linePaint(SPECS.find((s) => s.id === fillId)!, CELL).paint["line-width"];
      const cas = linePaint(SPECS.find((s) => s.id === caseId)!, CELL).paint["line-width"];
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
});

describe("borders: one line per frontier (owner report: a wavy second line beside the Mauritania / Western Sahara / Morocco / Algeria border)", () => {
  // Real attributes of OpenFreeMap (OpenMapTiles) boundary features, read from its tiles (scripts/street/border-probe.mjs).
  const OMT = {
    deFactoLand: { admin_level: 2, disputed: 0, maritime: 0, adm0_l: "DZA", adm0_r: "MAR" }, // Morocco / Algeria
    kosovoSerbia: { admin_level: 2, maritime: 0, adm0_l: "XKK", adm0_r: "SRB" }, // no `disputed` at all
    moroccanWall: { admin_level: 2, disputed: 1, maritime: 0, disputed_name: "Murdesecuritemarocain" }, // the berm beside the Mauritania / Western Sahara border
    kashmirLoc: { admin_level: 2, disputed: 1, maritime: 0, disputed_name: "LineofControl" },
    crimeaClaim: { admin_level: 2, disputed: 1, maritime: 1, claimed_by: "RU" },
    territorialSea: { admin_level: 2, disputed: 0, maritime: 1, adm0_r: "ESP" },
    disputedSea: { admin_level: 2, disputed: 1, maritime: 1 },
    region: { admin_level: 4, disputed: 0, maritime: 0 },
    regionAtSea: { admin_level: 4, disputed: 0, maritime: 1 },
    disputedRegion: { admin_level: 4, disputed: 1, maritime: 0 },
  };
  const PM = {
    deFactoLand: { kind: "country", kind_detail: 2, disputed: false },
    noFlag: { kind: "country", kind_detail: 2 },
    disputed: { kind: "country", kind_detail: 2, disputed: true, brk_a3: "B07" },
    region: { kind: "region", kind_detail: 4 },
    disputedRegion: { kind: "region", kind_detail: 4, disputed: true },
    county: { kind: "county", kind_detail: 6 },
  };
  const filterOf = (id: string, schema: Schema) => {
    const spec = SPECS.find((x) => x.id === id)!;
    return (schema === "protomaps" ? spec.pm : spec.omt)!.filter;
  };
  const drawn = (id: string, schema: Schema, props: Record<string, unknown>) => evalFilter(filterOf(id, schema), props) === true;

  it("OpenMapTiles: the de-facto land border is the one solid country line; disputed, claimed and maritime lines are never drawn", () => {
    expect(drawn("boundary-country", "openmaptiles", OMT.deFactoLand)).toBe(true);
    expect(drawn("boundary-country", "openmaptiles", OMT.kosovoSerbia)).toBe(true);
    for (const k of ["moroccanWall", "kashmirLoc", "crimeaClaim", "territorialSea", "disputedSea", "region"] as const) expect(drawn("boundary-country", "openmaptiles", OMT[k]), k).toBe(false);
  });
  it("Protomaps: the same rule (disputed is a boolean there, and a missing flag is not disputed)", () => {
    expect(drawn("boundary-country", "protomaps", PM.deFactoLand)).toBe(true);
    expect(drawn("boundary-country", "protomaps", PM.noFlag)).toBe(true);
    for (const k of ["disputed", "region", "county"] as const) expect(drawn("boundary-country", "protomaps", PM[k]), k).toBe(false);
  });
  it("region borders follow the same rule in both schemas: no maritime, no disputed duplicates, and never a country line", () => {
    expect(drawn("boundary-region", "openmaptiles", OMT.region)).toBe(true);
    for (const k of ["regionAtSea", "disputedRegion", "deFactoLand", "moroccanWall"] as const) expect(drawn("boundary-region", "openmaptiles", OMT[k]), k).toBe(false);
    expect(drawn("boundary-region", "protomaps", PM.region)).toBe(true);
    for (const k of ["disputedRegion", "deFactoLand", "disputed"] as const) expect(drawn("boundary-region", "protomaps", PM[k]), k).toBe(false);
  });
  it("a feature is never drawn twice: no OpenMapTiles boundary passes both the country and the region filter", () => {
    for (const [k, props] of Object.entries(OMT)) {
      expect(drawn("boundary-country", "openmaptiles", props) && drawn("boundary-region", "openmaptiles", props), k).toBe(false);
    }
    for (const level of [0, 1, 2, 3, 4, 5, 6, 7, 8, 10]) for (const disputed of [0, 1, undefined]) for (const maritime of [0, 1, undefined]) {
      const props = { admin_level: level, disputed, maritime };
      expect(drawn("boundary-country", "openmaptiles", props) && drawn("boundary-region", "openmaptiles", props)).toBe(false);
    }
  });
  it("the bundled Natural Earth borders and the tile boundary never overlap in zoom: one source per zoom, both schemas, any hand-over", () => {
    for (const schema of ["protomaps", "openmaptiles"] as const) {
      const st = make(schema).layers as unknown as { id: string; minzoom?: number; maxzoom?: number }[];
      const world = st.find((l) => l.id === "world-borders")!;
      const tile = st.find((l) => l.id === "boundary-country")!;
      expect(tile.minzoom, schema).toBe(borderHandoff(DEFAULT_HANDOFF[schema]));
      // a source with global tiles keeps the world borders only as a placeholder (hidden, switched on while tiles load: see WORLD_PLACEHOLDER_BELOW)
      expect(world.maxzoom, schema).toBe(hasPlaceholder(DEFAULT_HANDOFF[schema], true) ? WORLD_PLACEHOLDER_BELOW : tile.minzoom);
      expect(tile.maxzoom).toBeUndefined();
    }
    for (const handoff of [3, 4.5, 5, 6, 8.5]) {
      const st = buildStreetStyle({ schema: "openmaptiles", tiles: TILES, coastlines: empty, borders: empty, graticule: empty, routes: empty, handoffZoom: handoff }).layers as unknown as { id: string; minzoom?: number; maxzoom?: number }[];
      expect(st.find((l) => l.id === "world-borders")!.maxzoom, `handoff ${handoff}`).toBe(hasPlaceholder(handoff, true) ? WORLD_PLACEHOLDER_BELOW : st.find((l) => l.id === "boundary-country")!.minzoom);
      expect(st.find((l) => l.id === "boundary-country")!.minzoom).toBeGreaterThanOrEqual(BORDER_TILE_MINZOOM);
    }
  });
  it("without a tile source the world borders run at every zoom (nothing to hand over to)", () => {
    const s = buildStreetStyle({ schema: "openmaptiles", tiles: null, coastlines: empty, borders: empty, graticule: empty, routes: empty });
    expect((s.layers.find((l) => l.id === "world-borders") as { maxzoom: number }).maxzoom).toBe(24);
  });
  it("the country line is solid at the loudest map tone from its first zoom (no dotted claim line, no fade): same look in both schemas", () => {
    for (const schema of ["protomaps", "openmaptiles"] as const) {
      const l = (make(schema).layers as unknown as L[]).find((x) => x.id === "boundary-country")!;
      expect(l.paint["line-dasharray"]).toBeUndefined();
      expect(levelOfPaint(l.paint["line-color"], 5.01)).toBe(roleLevel("coast"));
    }
  });
});

type L = { id: string; minzoom?: number; maxzoom?: number; paint: Record<string, unknown> };
