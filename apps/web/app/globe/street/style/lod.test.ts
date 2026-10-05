import { describe, expect, it } from "vitest";
import { expInterp } from "../core/art-line";
import { roleLevel } from "../../engine/palette";
import { FILL_LOD, LOD, finalAt, levelAt, progressAt, stepZoom, visibleAt, type LodKey } from "./lod";
import { decodeLevel, levelOfPaint } from "./probe";
import { SPECS, buildStreetStyle, linePaint, type Schema } from "./street-style";

const KEYS = Object.keys(LOD) as LodKey[];
const LEVEL_COUNTS = [3, 4, 6, 8, 10, 12];
const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const TILES = { tiles: ["cat-p1://https://tiles.example/{z}/{x}/{y}.pbf"], minzoom: 0, maxzoom: 14, bounds: null };
const make = (schema: Schema) => buildStreetStyle({ schema, tiles: TILES, coastlines: empty, borders: empty, graticule: empty, routes: empty });
type L = { id: string; minzoom?: number; maxzoom?: number; paint: Record<string, unknown> };

describe("LOD table", () => {
  it("every class has from < full, in a sane range", () => {
    for (const k of KEYS) {
      const e = LOD[k];
      expect(e.from, k).toBeGreaterThanOrEqual(3);
      expect(e.full, k).toBeGreaterThan(e.from + 0.5);
      expect(e.full, k).toBeLessThanOrEqual(17.5 + 1e-9); // the street map stops at z17.5
    }
  });
  it("roads appear by rank: motorways first, then primary, secondary, tertiary, residential, service, paths", () => {
    const order: LodKey[] = ["highway", "major", "secondary", "medium", "minor", "service", "path"];
    for (let i = 1; i < order.length; i++) {
      expect(LOD[order[i]!].from, order[i]).toBeGreaterThan(LOD[order[i - 1]!].from);
      expect(LOD[order[i]!].full, order[i]).toBeGreaterThan(LOD[order[i - 1]!].full);
    }
    expect(LOD.highway.from).toBeGreaterThanOrEqual(5); // nothing road-like from space or below country scale
    expect(LOD.medium.from).toBeGreaterThanOrEqual(12.5);
    expect(LOD.minor.from).toBeGreaterThanOrEqual(14);
    expect(LOD.path.from).toBeGreaterThanOrEqual(15.5);
    expect(LOD.buildingOutline.from).toBeGreaterThanOrEqual(16);
    expect(FILL_LOD.building.from).toBeGreaterThanOrEqual(15.5);
  });
  it("tone follows the hierarchy: major roads at least as strong as minor roads, rail and paths softer, borders stronger than washes", () => {
    for (const n of LEVEL_COUNTS) {
      const lv = (k: LodKey) => roleLevel(LOD[k].role, n);
      expect(lv("highway"), `n=${n}`).toBeGreaterThanOrEqual(lv("medium"));
      expect(lv("medium"), `n=${n}`).toBeGreaterThanOrEqual(lv("service"));
      expect(lv("service"), `n=${n}`).toBeGreaterThanOrEqual(roleLevel(FILL_LOD.water.role, n));
      expect(lv("rail"), `n=${n}`).toBeLessThanOrEqual(lv("minor"));
      expect(lv("river"), `n=${n}`).toBeGreaterThanOrEqual(lv("minor"));
    }
  });
  it("minor classes keep a dashed final pattern whose dashes can catch a cell centre on a diagonal", () => {
    for (const k of ["minor", "link", "service", "path", "rail", "canal", "stream", "regionBorder"] as const) {
      const d = LOD[k].dash;
      expect(d, k).toBeDefined();
      expect(d![0]!, k).toBeGreaterThanOrEqual(1.42);
    }
  });
});

describe("tone ramp (the fade-in goes through the grey levels, never through a dither)", () => {
  for (const n of LEVEL_COUNTS) {
    it(`n=${n}: not drawn below from, the faintest level just above it, the role's level from full`, () => {
      for (const k of KEYS) {
        const e = LOD[k];
        const final = roleLevel(e.role, n);
        for (let z = 0; z <= e.from; z += 0.1) expect(levelAt(e, z, n), `${k} z${z}`).toBe(0);
        expect(levelAt(e, e.from + 1e-3, n), k).toBe(1);
        for (let z = e.full; z <= 20; z += 0.1) expect(levelAt(e, z, n), `${k} z${z}`).toBe(final);
        expect(finalAt(e, e.full)).toBe(true);
        expect(finalAt(e, e.full - 0.01)).toBe(false);
        expect(visibleAt(e, e.from)).toBe(false);
      }
    });
    it(`n=${n}: the level only goes up with zoom, one level at a time, in steps of equal zoom length`, () => {
      for (const k of KEYS) {
        const e = LOD[k];
        let prev = 0;
        for (let z = e.from - 0.2; z <= e.full + 0.2; z += 0.01) {
          const lv = levelAt(e, z, n);
          expect(lv - prev, `${k} z${z.toFixed(2)}`).toBeGreaterThanOrEqual(0);
          expect(lv - prev, `${k} z${z.toFixed(2)}`).toBeLessThanOrEqual(1);
          prev = lv;
        }
        const final = roleLevel(e.role, n);
        for (let l = 2; l <= final; l++) {
          expect(stepZoom(e, l, n) - stepZoom(e, l - 1, n), k).toBeCloseTo((e.full - e.from) / final, 9);
          expect(levelAt(e, stepZoom(e, l, n) + 1e-6, n), k).toBe(l);
          expect(levelAt(e, stepZoom(e, l, n) - 1e-6, n), k).toBe(l - 1);
        }
      }
    });
  }
  it("progress is 0 at from, 1 at full", () => {
    expect(progressAt(LOD.major, LOD.major.from)).toBe(0);
    expect(progressAt(LOD.major, LOD.major.full)).toBe(1);
  });
});

describe("style wiring of the LOD", () => {
  it("every class is ONE layer that exists from `from`: no ramp layers, no tone-channel layers", () => {
    for (const schema of ["protomaps", "openmaptiles"] as const) {
      const st = make(schema).layers as unknown as L[];
      expect(st.some((l) => /-ramp$/.test(l.id))).toBe(false);
      const byId = new Map(st.map((l) => [l.id, l]));
      for (const spec of SPECS.filter((s) => s.lod)) {
        const e = LOD[spec.lod!];
        expect(byId.get(spec.id)!.minzoom, `${schema} ${spec.id}`).toBe(e.from);
      }
    }
  });
  it("the colour of a class at a zoom is the level the table says (every N)", () => {
    for (const spec of SPECS.filter((s) => s.lod && s.type === "line")) {
      const e = LOD[spec.lod!];
      const color = linePaint(spec, 3).paint["line-color"];
      for (let z = e.from + 1e-3; z <= e.full + 1; z += 0.05) expect(levelOfPaint(color, z), `${spec.id} z${z.toFixed(2)}`).toBe(levelAt(e, z));
    }
  });
  it("fills fade in through the levels up to their wash", () => {
    for (const spec of SPECS.filter((s) => s.type === "fill")) {
      const st = (make("openmaptiles").layers as unknown as L[]).find((l) => l.id === spec.id)!;
      const f = spec.fade!;
      expect(st.minzoom).toBe(f.from);
      expect(levelOfPaint(st.paint["fill-color"], f.from + 1e-3), spec.id).toBe(1);
      expect(levelOfPaint(st.paint["fill-color"], f.full + 1), spec.id).toBe(roleLevel(f.role));
      expect(st.paint["fill-opacity"]).toBe(1);
    }
  });
  it("the two schemas expose the same layers (identical look), with the same zoom ranges", () => {
    // the world-data layers and the sea outline follow the per-schema hand-over zoom (the one deliberate difference)
    const tiles = (st: L[]) => st.filter((l) => !/^world-|^water-edge$/.test(l.id)).map((l) => [l.id, l.minzoom, l.maxzoom]);
    expect(tiles(make("protomaps").layers as unknown as L[])).toEqual(tiles(make("openmaptiles").layers as unknown as L[]));
  });
  it("lines keep the one-art-pixel floor through their whole fade-in", () => {
    for (const spec of SPECS.filter((s) => s.lod && s.type === "line")) {
      const w = linePaint(spec, 3).paint["line-width"];
      const at = (z: number) => (typeof w === "number" ? w : expInterp(((w as unknown[]).slice(3) as number[]).reduce<[number, number][]>((acc, v, i, arr) => (i % 2 === 0 ? [...acc, [v, arr[i + 1]!]] : acc), []), z, 1.5));
      for (let z = LOD[spec.lod!].from; z < LOD[spec.lod!].full; z += 0.25) expect(at(z), `${spec.id} z${z}`).toBeGreaterThanOrEqual(3 - 1e-9);
    }
  });
  it("nothing road-like is drawn below country scale", () => {
    const st = make("protomaps").layers as unknown as L[];
    const road = st.filter((l) => /^(road|path|rail)/.test(l.id) && !/fill$/.test(l.id));
    for (const l of road) expect(l.minzoom ?? 0, l.id).toBeGreaterThanOrEqual(5.5);
  });
  it("the sea keeps its outline at every zoom; lakes and small water fade in", () => {
    const st = make("openmaptiles").layers as unknown as L[];
    const sea = st.find((l) => l.id === "water-edge")!;
    expect(sea.maxzoom).toBeUndefined();
    expect(st.find((l) => l.id === "water-edge-detail")!.minzoom).toBe(LOD.waterDetail.from);
  });
});

describe("regression: the coast is never dashed (owner report: coasts dotted around zoom 5 at northern latitudes)", () => {
  // Cause: a dashed [2,2] "band" layer between the world coastline and the tile coast, which the cut to the street map
  // exposes at latitudes where map zoom = globe zoom + log2(cos lat) falls in the band. It is gone: the world coastline
  // runs solid up to the tile coast's first zoom, and nothing dashes a coast or a country border.
  for (const schema of ["protomaps", "openmaptiles"] as const) {
    it(`${schema}: world coast, sea outline and borders are solid ink, and the coast has no gap or band`, () => {
      const st = make(schema).layers as unknown as L[];
      for (const id of ["world-coast", "water-edge", "world-borders", "boundary-country"]) {
        const l = st.find((x) => x.id === id)!;
        expect(l, id).toBeDefined();
        expect(l.paint["line-dasharray"], id).toBeUndefined();
        expect(levelOfPaint(l.paint["line-color"], 0), id).toBe(roleLevel("ink"));
      }
      expect(st.some((l) => /band/.test(l.id))).toBe(false);
      const world = st.find((l) => l.id === "world-coast")!;
      const edge = st.find((l) => l.id === "water-edge")!;
      expect(world.maxzoom).toBe(edge.minzoom);
    });
  }
  it("the only dashed world layer is the graticule", () => {
    const st = make("openmaptiles").layers as unknown as L[];
    const dashed = st.filter((l) => /^(world-|graticule|routes-)/.test(l.id) && l.paint["line-dasharray"]).map((l) => l.id);
    expect(dashed.sort()).toEqual(["graticule", "routes-line"]);
  });
});
