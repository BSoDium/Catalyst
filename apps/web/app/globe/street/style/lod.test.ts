import { describe, expect, it } from "vitest";
import { expInterp } from "../core/art-line";
import { toneLit } from "../core/art-line";
import { FILL_LOD, LOD, finalAt, quantisedTone, rampStops, toneAt, visibleAt, type LodKey } from "./lod";
import { RAMP_SPECS, SPECS, buildStreetStyle, linePaint, type Schema } from "./street-style";

const KEYS = Object.keys(LOD) as LodKey[];
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
  it("no class is visible below its fromZoom, and every class is at tone 1 from its fullZoom", () => {
    for (const k of KEYS) {
      const e = LOD[k];
      for (let z = 0; z <= e.from; z += 0.1) {
        expect(toneAt(e, z), `${k} z${z}`).toBe(0);
        expect(visibleAt(e, z), `${k} z${z}`).toBe(false);
      }
      for (let z = e.full; z <= 20; z += 0.1) expect(toneAt(e, z), `${k} z${z}`).toBe(1);
      expect(finalAt(e, e.full)).toBe(true);
      expect(finalAt(e, e.full - 0.01)).toBe(false);
    }
  });
  it("the tone is monotonic with zoom (a class never gets lighter as you approach)", () => {
    for (const k of KEYS) {
      let prev = 0;
      for (let z = 0; z <= 20; z += 0.05) {
        const t = toneAt(LOD[k], z);
        expect(t, `${k} z${z}`).toBeGreaterThanOrEqual(prev - 1e-12);
        prev = t;
      }
    }
  });
  it("the opacity stops of the style reproduce the table", () => {
    for (const k of KEYS) {
      const stops = rampStops(LOD[k]);
      for (let z = LOD[k].from; z <= LOD[k].full; z += 0.07) expect(expInterp(stops, z, 1), `${k} z${z}`).toBeCloseTo(toneAt(LOD[k], z), 1);
      for (let i = 1; i < stops.length; i++) expect(stops[i]![0]).toBeGreaterThan(stops[i - 1]![0]);
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
  it("minor classes keep a dashed final pattern whose dashes can catch a cell centre on a diagonal", () => {
    for (const k of ["minor", "link", "service", "path", "rail", "canal", "stream", "regionBorder"] as const) {
      const d = LOD[k].dash;
      expect(d, k).toBeDefined();
      expect(d![0]!, k).toBeGreaterThanOrEqual(1.42);
    }
  });
});

describe("ramp = screen-anchored ordered dither", () => {
  it("coverage only ever grows with the tone: a cell lit at one zoom stays lit as the class gets stronger", () => {
    for (let cy = 0; cy < 16; cy++)
      for (let cx = 0; cx < 16; cx++) {
        let lit = false;
        for (let z = 6; z <= 16; z += 0.02) {
          const now = toneLit(toneAt(LOD.highway, z), cx, cy);
          if (lit) expect(now, `cell ${cx},${cy} z${z.toFixed(2)}`).toBe(true);
          lit ||= now;
        }
      }
  });
  it("consecutive frames at slightly different zoom differ by newly lit cells only", () => {
    for (const k of KEYS) {
      const e = LOD[k];
      for (let z = e.from; z < e.full; z += 0.05) {
        const a = quantisedTone(toneAt(e, z));
        const b = quantisedTone(toneAt(e, z + 0.02));
        for (let cy = 0; cy < 8; cy++) for (let cx = 0; cx < 8; cx++) if (toneLit(a, cx, cy)) expect(toneLit(b, cx, cy)).toBe(true);
      }
    }
  });
  it("the first visible zoom lights something and the last ramp frame lights every cell", () => {
    for (const k of KEYS) {
      const e = LOD[k];
      const lights = (t: number) => { let n = 0; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (toneLit(t, x, y)) n++; return n; };
      expect(lights(quantisedTone(toneAt(e, e.full - 1e-3)))).toBeGreaterThanOrEqual(60);
      expect(lights(quantisedTone(toneAt(e, e.from + 0.9 * (e.full - e.from))))).toBeGreaterThan(lights(quantisedTone(toneAt(e, e.from + 0.1 * (e.full - e.from)))));
    }
  });
});

describe("style wiring of the LOD", () => {
  it("every class has a final spec and a ramp spec: the ramp ends where the final look starts, and both share geometry", () => {
    for (const spec of SPECS.filter((s) => s.lod)) {
      const ramp = RAMP_SPECS.find((r) => r.id === `${spec.id}-ramp`)!;
      expect(ramp, spec.id).toBeDefined();
      expect(ramp.minzoom).toBe(LOD[spec.lod!].from);
      expect(ramp.maxzoom).toBe(LOD[spec.lod!].full);
      expect(ramp.pm).toBe(spec.pm);
      expect(ramp.omt).toBe(spec.omt);
      expect(ramp.ch).toBe("fg");
    }
  });
  for (const schema of ["protomaps", "openmaptiles"] as const) {
    it(`${schema}: no layer of a class exists below its fromZoom, the ink starts at fullZoom, the ramp ends there`, () => {
      const st = make(schema);
      const byId = new Map((st.layers as unknown as L[]).map((l) => [l.id, l]));
      for (const spec of SPECS.filter((s) => s.lod)) {
        const e = LOD[spec.lod!];
        const ramp = byId.get(`${spec.id}-ramp`)!;
        const fin = byId.get(spec.id)!;
        expect(ramp.minzoom, ramp.id).toBe(e.from);
        expect(ramp.maxzoom, ramp.id).toBe(e.full);
        expect(fin.minzoom, fin.id).toBe(e.full);
        expect(ramp.paint["line-color"]).toBe("#00ff00");
      }
    });
  }
  it("the two schemas expose the same layers (identical look), with the same zoom ranges", () => {
    // the world-data layers and the sea outline follow the per-schema hand-over zoom (the one deliberate difference)
    const tiles = (st: L[]) => st.filter((l) => !/^world-|^water-edge$/.test(l.id)).map((l) => [l.id, l.minzoom, l.maxzoom]);
    expect(tiles(make("protomaps").layers as unknown as L[])).toEqual(tiles(make("openmaptiles").layers as unknown as L[]));
  });
  it("ramp layers keep the one-art-pixel floor and never paint below it", () => {
    for (const r of RAMP_SPECS) {
      const { paint } = linePaint(r, 3);
      const w = paint["line-width"];
      const at = (z: number) => (typeof w === "number" ? w : expInterp(((w as unknown[]).slice(3) as number[]).reduce<[number, number][]>((acc, v, i, arr) => (i % 2 === 0 ? [...acc, [v, arr[i + 1]!]] : acc), []), z, 1.5));
      for (let z = r.minzoom!; z < r.maxzoom!; z += 0.25) expect(at(z), `${r.id} z${z}`).toBeGreaterThanOrEqual(3 - 1e-9);
    }
  });
  it("nothing road-like is drawn below country scale", () => {
    const st = make("protomaps").layers as unknown as L[];
    const road = st.filter((l) => /^(road|path|rail)/.test(l.id) && !/fill$/.test(l.id));
    for (const l of road) expect(l.minzoom ?? 0, l.id).toBeGreaterThanOrEqual(5.5);
  });
  it("the sea keeps its outline at every zoom; lakes and small water ramp in", () => {
    const st = make("openmaptiles").layers as unknown as L[];
    const sea = st.find((l) => l.id === "water-edge")!;
    expect(sea.maxzoom).toBeUndefined();
    expect(st.find((l) => l.id === "water-edge-detail-ramp")).toBeDefined();
  });
});
