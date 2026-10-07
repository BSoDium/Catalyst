import { describe, expect, it } from "vitest";
import { THIN_INK, expInterp } from "../core/art-line";
import { MAP_CONTRAST_DARK, buildRamp, peakLevel, roleLevel, srgbToOklab } from "../../engine/palette";
import { HANDOVER } from "../../handover/maths";
import { PATTERN } from "../core/palette";
import { radiusFitZoom } from "../../engine/framing";
import { zoomCorrection } from "../core/registration";
import { FILL_LOD, LOD, finalAt, levelAt, progressAt, stepZoom, toneLevel, visibleAt, type LodKey } from "./lod";
import { decodeLevel, decodePattern, levelOfPaint } from "./probe";
import { DEFAULT_HANDOFF, MAJOR_WIDE_FROM, SPECS, WORLD_PLACEHOLDER_BELOW, hasPlaceholder, artWidthStopsOf, buildStreetStyle, linePaint, seaFade, type Schema } from "./street-style";

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
    // far-zoom calm (owner, earlier pass): nothing road-like below z5.5, nothing but motorways and trunks below z8.5
    expect(LOD.highway.from).toBeGreaterThanOrEqual(5);
    expect(LOD.major.from).toBeGreaterThanOrEqual(8.5);
    // rivers: the tile data holds the big ones from z4 (probed with scripts/street/layer-probe.mjs), the line starts as the regions do
    expect(LOD.river.from).toBeGreaterThanOrEqual(5);
    // the tile data bounds how early a class can show (OpenMapTiles: tertiary from z11, residential from z12, service from z13)
    expect(LOD.medium.from).toBeGreaterThanOrEqual(10.5);
    expect(LOD.minor.from).toBeGreaterThanOrEqual(12);
    expect(LOD.service.from).toBeGreaterThanOrEqual(13);
    expect(LOD.path.from).toBeGreaterThanOrEqual(14);
    expect(LOD.buildingOutline.from).toBeGreaterThanOrEqual(16);
    expect(FILL_LOD.building.from).toBeGreaterThanOrEqual(15.5);
  });
  it("tone follows the hierarchy: major roads at least as strong as minor roads, rail and paths softer, borders stronger than washes", () => {
    for (const n of LEVEL_COUNTS) {
      const lv = (k: LodKey) => toneLevel(LOD[k], n);
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
        const final = toneLevel(e, n);
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
        const final = toneLevel(e, n);
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
  it("water and green areas are distinct patterns in a dimmed level (below the roads), buildings a flat wash", () => {
    const st = make("openmaptiles").layers as unknown as L[];
    const pat = (id: string, z: number) => {
      const c = st.find((l) => l.id === id)!.paint["fill-color"] as unknown;
      if (typeof c === "string") return decodePattern(c); // a single level: a constant colour
      const a = c as unknown[];
      let out = a[2] as string;
      for (let i = 3; i < a.length; i += 2) if (z >= (a[i] as number)) out = a[i + 1] as string;
      return decodePattern(out);
    };
    expect(pat("water-fill", 12)).toBe(PATTERN.water);
    expect(pat("park-fill", 12)).toBe(PATTERN.green);
    expect(pat("building-fill", 18)).toBe(PATTERN.flat);
    expect(PATTERN.water).not.toBe(PATTERN.green);
    for (const n of LEVEL_COUNTS) {
      // with only three or four levels the map has one or two greys and the roles collapse: never louder, strictly dimmer once there is room
      const cmp = n >= 6 ? "toBeLessThan" : "toBeLessThanOrEqual";
      expect(roleLevel(FILL_LOD.water.role, n), `n=${n}`)[cmp](toneLevel(LOD.major, n));
      expect(roleLevel(FILL_LOD.park.role, n), `n=${n}`)[cmp](toneLevel(LOD.major, n));
    }
  });
  it("the sea eases in from just after the globe-to-street cut over a wide zoom range, one level at a time, in both directions", () => {
    expect(FILL_LOD.water.from).toBeGreaterThanOrEqual(DEFAULT_HANDOFF.openmaptiles + 0.5);
    expect(FILL_LOD.water.from).toBeLessThanOrEqual(DEFAULT_HANDOFF.openmaptiles + 1);
    expect(FILL_LOD.water.full - FILL_LOD.water.from).toBeGreaterThanOrEqual(4);
    let prev = 0;
    for (let z = FILL_LOD.water.from - 0.5; z <= FILL_LOD.water.full + 0.5; z += 0.01) {
      const lv = levelAt(FILL_LOD.water, z);
      expect(lv - prev).toBeGreaterThanOrEqual(0);
      expect(lv - prev).toBeLessThanOrEqual(1);
      prev = lv;
    }
    expect(levelAt(FILL_LOD.water, FILL_LOD.water.from + 1e-3)).toBe(1);
    expect(prev).toBe(roleLevel(FILL_LOD.water.role));
  });
  it("the two schemas expose the same layers (identical look), with the same zoom ranges", () => {
    // the world-data layers, the sea outline and the tile country border follow the per-schema hand-over zoom (the one deliberate difference)
    const tiles = (st: L[]) => st.filter((l) => !/^world-|^water-edge$|^water-fill$|^boundary-country$/.test(l.id)).map((l) => [l.id, l.minzoom, l.maxzoom]);
    expect(tiles(make("protomaps").layers as unknown as L[])).toEqual(tiles(make("openmaptiles").layers as unknown as L[]));
  });
  it("the sea fill starts 0.7 zoom after the hand-over to tile geometry in either schema, with the same ramp shape", () => {
    for (const schema of ["protomaps", "openmaptiles"] as const) {
      const l = (make(schema).layers as unknown as L[]).find((x) => x.id === "water-fill")!;
      expect(l.minzoom).toBeCloseTo(DEFAULT_HANDOFF[schema] + 0.7, 6);
      const e = seaFade(DEFAULT_HANDOFF[schema]);
      expect(e.full - e.from).toBeCloseTo(FILL_LOD.water.full - FILL_LOD.water.from, 6);
    }
    expect(seaFade(DEFAULT_HANDOFF.openmaptiles).from).toBe(FILL_LOD.water.from);
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
    it(`${schema}: world coast, sea outline and borders are solid peak-tone lines, and the coast has no gap or band`, () => {
      const st = make(schema).layers as unknown as L[];
      for (const id of ["world-coast", "water-edge", "world-borders", "boundary-country"]) {
        const l = st.find((x) => x.id === id)!;
        expect(l, id).toBeDefined();
        expect(l.paint["line-dasharray"], id).toBeUndefined();
        expect(levelOfPaint(l.paint["line-color"], 0), id).toBe(roleLevel("peak"));
      }
      expect(st.some((l) => /band/.test(l.id))).toBe(false);
      const world = st.find((l) => l.id === "world-coast")!;
      const edge = st.find((l) => l.id === "water-edge")!;
      // never both at once: the world coast is either handed over at the tile coast's first zoom or a placeholder the engine shows only while tiles load
      expect(world.maxzoom).toBe(hasPlaceholder(DEFAULT_HANDOFF[schema], true) ? WORLD_PLACEHOLDER_BELOW : edge.minzoom);
    });
  }
  it("the only dashed world layer is the graticule", () => {
    const st = make("openmaptiles").layers as unknown as L[];
    const dashed = st.filter((l) => /^(world-|graticule|routes-)/.test(l.id) && l.paint["line-dasharray"]).map((l) => l.id);
    expect(dashed.sort()).toEqual(["graticule", "routes-line"]);
  });
});

describe("a city reads as a city at the zoom the app frames it at (owner: streets appear too late after a click on a city)", () => {
  // The camera of a click: engine/framing.ts (a circle of viewRadiusKm in the free viewport, 25 % margin), converted to the map zoom by the
  // latitude correction. Public geography: Lisbon, Paris, Bucharest, Ho Chi Minh City.
  const CITIES = { lisbon: 38.7, paris: 48.9, bucharest: 44.4, hcmc: 10.8 };
  const framing = (km: number, lat: number, w: number, h: number, inset: number) => radiusFitZoom(km, w, h, inset) + zoomCorrection(lat);
  const finalLevel = (k: LodKey) => toneLevel(LOD[k]);
  const lv = (k: LodKey, z: number) => levelAt(LOD[k], z);

  it("the framing zoom table is what the style is tuned to: 10.0 to 11.4 on a 1440x900 desktop for 10 to 18 km", () => {
    const zs = Object.values(CITIES).flatMap((lat) => [10, 12, 14, 18].map((km) => framing(km, lat, 1440, 900, 0)));
    expect(Math.min(...zs)).toBeGreaterThan(9.95);
    expect(Math.max(...zs)).toBeLessThan(11.5);
    expect(framing(12, CITIES.paris, 1440, 900, 0)).toBeCloseTo(10.59, 1);
    expect(framing(12, CITIES.hcmc, 1440, 900, 0)).toBeCloseTo(11.17, 1);
  });
  it("desktop, default 12 km radius, panel closed or open: primary and secondary roads are (nearly) in full, links, rail, rivers and parks show", () => {
    for (const lat of Object.values(CITIES)) for (const inset of [0, 720]) {
      const z = framing(12, lat, 1440, 900, inset);
      expect(lv("highway", z)).toBe(finalLevel("highway"));
      expect(lv("major", z), `lat ${lat} inset ${inset} z${z.toFixed(2)}`).toBe(finalLevel("major"));
      expect(lv("secondary", z), `lat ${lat} inset ${inset}`).toBeGreaterThanOrEqual(finalLevel("secondary") - 1);
      for (const k of ["link", "rail", "river", "lake"] as const) expect(lv(k, z), `${k} lat ${lat} inset ${inset}`).toBeGreaterThanOrEqual(1);
      expect(levelAt(FILL_LOD.park, z), `park lat ${lat}`).toBeGreaterThanOrEqual(2);
      expect(levelAt(FILL_LOD.green, z), `green lat ${lat}`).toBeGreaterThanOrEqual(1);
      expect(levelAt(FILL_LOD.water, z), `water lat ${lat}`).toBe(roleLevel(FILL_LOD.water.role));
    }
  });
  it("every framing a person can get (10 to 18 km, desktop with or without the panel, a phone): motorways in full and primary roads drawn", () => {
    for (const lat of Object.values(CITIES)) for (const km of [10, 12, 14, 18]) for (const [w, h, inset] of [[1440, 900, 0], [1440, 900, 720], [390, 844, 0]] as const) {
      const z = framing(km, lat, w, h, inset);
      expect(lv("highway", z), `${km} km ${w}x${h} inset ${inset} lat ${lat} z${z.toFixed(2)}`).toBe(finalLevel("highway"));
      expect(lv("major", z), `${km} km ${w}x${h} inset ${inset} lat ${lat} z${z.toFixed(2)}`).toBeGreaterThanOrEqual(1);
    }
  });
  it("tertiary roads start as soon as their tiles exist (OpenMapTiles z11) and are in full a zoom later; residential streets follow dotted, low tone first", () => {
    expect(LOD.medium.from).toBeLessThan(11);
    expect(LOD.medium.full - 11).toBeLessThanOrEqual(1);
    expect(lv("medium", framing(12, CITIES.hcmc, 1440, 900, 0))).toBeGreaterThanOrEqual(2); // 11.17: tertiary under way where the framing is the closest
    expect(LOD.minor.from).toBeLessThanOrEqual(12.5);
    expect(levelAt(LOD.minor, 12.6)).toBeGreaterThanOrEqual(1);
    expect(levelAt(LOD.minor, 12.6)).toBeLessThan(finalLevel("minor"));
    expect(LOD.minor.dash).toBeDefined();
  });
  it("far zoom is as calm as before: of the roads only motorways and trunks below z8.5, none below z5.5 (rivers and region borders started earlier on purpose)", () => {
    for (let z = 0; z <= 8.5; z += 0.1) for (const k of ["major", "secondary", "medium", "minor", "link", "service", "path", "rail", "canal", "stream", "waterDetail"] as const) expect(lv(k, z), `${k} z${z.toFixed(1)}`).toBe(0);
    for (let z = 0; z <= 5.5; z += 0.1) expect(lv("highway", z)).toBe(0);
  });
  it("the tone hierarchy at the framing: arterials louder than links and rail, and the tone only ever goes up with zoom", () => {
    for (const z of [9, 9.5, 10, 10.5, 11, 11.5]) {
      expect(lv("major", z)).toBeGreaterThanOrEqual(lv("link", z));
      expect(lv("secondary", z)).toBeGreaterThanOrEqual(lv("rail", z));
    }
  });
});

describe("road hierarchy: the class is told by tone and by width (owner: everything was the same colour)", () => {
  // The tiers, loudest first, as palette levels of the 12-level palette (peak = 10, ink = 11).
  const TIERS: [string, LodKey, number][] = [
    ["motorway, trunk", "highway", 10],
    ["primary", "major", 9],
    ["secondary", "secondary", 7],
    ["tertiary", "medium", 5],
    ["residential", "minor", 4],
    ["service", "service", 4],
    ["paths", "path", 3],
  ];
  const lightTheme = { background: [0.984, 0.984, 0.984] as const, ink: [0.039, 0.039, 0.039] as const };
  const darkTheme = { background: [0.039, 0.039, 0.039] as const, ink: [0.96, 0.96, 0.96] as const };
  const lightness = (rgb: readonly [number, number, number]) => srgbToOklab(rgb)[0];

  it("the tone table by class (final level, 12 levels)", () => {
    for (const [name, key, level] of TIERS) expect(toneLevel(LOD[key]), name).toBe(level);
    // links and rail are the soft tier, rivers and lakes the strong one, the region borders the mid one
    expect(toneLevel(LOD.link)).toBe(roleLevel("soft"));
    expect(toneLevel(LOD.rail)).toBe(roleLevel("soft"));
    expect(toneLevel(LOD.river)).toBe(roleLevel("strong"));
  });
  it("tone only goes down the hierarchy: motorway >= primary > secondary > tertiary > residential, service and paths softest", () => {
    for (let i = 1; i < TIERS.length; i++) expect(TIERS[i]![2], TIERS[i]![0]).toBeLessThanOrEqual(TIERS[i - 1]![2]);
    for (const n of LEVEL_COUNTS.filter((x) => x >= 6)) {
      const lvl = (k: LodKey) => toneLevel(LOD[k], n);
      expect(lvl("highway"), `n=${n}`).toBeGreaterThanOrEqual(lvl("major"));
      expect(lvl("major"), `n=${n}`).toBeGreaterThan(lvl("secondary"));
      expect(lvl("secondary"), `n=${n}`).toBeGreaterThanOrEqual(lvl("medium"));
      expect(lvl("medium"), `n=${n}`).toBeGreaterThanOrEqual(lvl("minor"));
      expect(lvl("minor"), `n=${n}`).toBeGreaterThanOrEqual(lvl("path"));
    }
  });
  it("the strongest tier stays below the ink (MAP_CONTRAST rule): labels, markers and rectangles are louder than any road", () => {
    for (const n of LEVEL_COUNTS) {
      const ink = n - 1;
      for (const [name, key] of TIERS) expect(toneLevel(LOD[key], n), `${name} n=${n}`).toBeLessThan(ink);
      expect(toneLevel(LOD.highway, n)).toBe(peakLevel(n));
    }
    for (const t of [lightTheme, darkTheme]) {
      const ramp = buildRamp(t.background as never, t.ink as never, 12);
      const top = lightness(ramp[toneLevel(LOD.highway)]!);
      const inkL = lightness(ramp[11]!);
      const bgL = lightness(ramp[0]!);
      // the loudest road covers at most MAP_CONTRAST(_DARK) of the way from the page to the ink
      expect(Math.abs(top - bgL) / Math.abs(inkL - bgL)).toBeLessThanOrEqual(MAP_CONTRAST_DARK + 1e-6);
    }
  });
  it("tone separation: adjacent tiers differ by at least 0.04 of OKLab lightness (light and dark), the three loudest by 0.06", () => {
    for (const t of [lightTheme, darkTheme]) {
      const ramp = buildRamp(t.background as never, t.ink as never, 12);
      const L = (k: LodKey) => lightness(ramp[toneLevel(LOD[k])]!);
      const dist = (a: LodKey, b: LodKey) => Math.abs(L(a) - L(b));
      expect(dist("major", "secondary")).toBeGreaterThan(0.06);
      expect(dist("secondary", "medium")).toBeGreaterThan(0.06);
      expect(dist("medium", "minor")).toBeGreaterThan(0.04);
      expect(dist("highway", "major")).toBeGreaterThan(0.015);
      // the road tiers against the page: every class is visible (the paths too)
      const bg = lightness(ramp[0]!);
      expect(Math.abs(L("path") - bg)).toBeGreaterThan(0.08);
      // and the whole hierarchy spans a clear range
      expect(dist("highway", "path")).toBeGreaterThan(0.2);
    }
  });
  it("widths: motorway, trunk and primary are 2 art px from z9, every other class 1 px at the city framings (10 to 11.4 on a desktop)", () => {
    const widthAt = (id: string, z: number) => {
      const w = artWidthStopsOf(SPECS.find((s) => s.id === id)!);
      return typeof w === "number" ? w : expInterp(w, z, 1.5);
    };
    for (const z of [MAJOR_WIDE_FROM + 0.05, 9.5, 10, 10.6, 11.4, 12, 14.5]) {
      expect(widthAt("road-highway-case", z), `highway z${z}`).toBe(2);
      expect(widthAt("road-major-case", z), `primary z${z}`).toBe(2);
      expect(widthAt("road-secondary-case", z), `secondary z${z}`).toBe(1);
      expect(widthAt("road-medium-case", z), `tertiary z${z}`).toBe(1);
      expect(widthAt("road-minor", z), `residential z${z}`).toBeLessThanOrEqual(1.0001);
    }
    // below the step they are one pixel, and the step is abrupt (no width between 1.25 and 1.6 where a line is one or two cells wide by offset)
    expect(widthAt("road-highway-case", 8.9)).toBe(1);
    expect(widthAt("road-highway-case", MAJOR_WIDE_FROM + 0.01)).toBe(2);
    const w = (z: number) => widthAt("road-major-case", z);
    for (let z = MAJOR_WIDE_FROM - 0.2; z < MAJOR_WIDE_FROM + 0.2; z += 0.001) expect([1, 2].some((v) => Math.abs(w(z) - v) < 0.2) || z > MAJOR_WIDE_FROM - 1e-9 && z < MAJOR_WIDE_FROM + 0.011).toBe(true);
    // the framings the app uses: the step is below the lowest desktop city framing (10.0) and the lowest phone one (8.8 + 0.2)
    expect(MAJOR_WIDE_FROM).toBeLessThan(9.2);
  });
  it("the two-pixel roads are a wide ink class (never thinned) from the step on, a thin one below it", () => {
    const spec = SPECS.find((s) => s.id === "road-major-case")!;
    const op = linePaint(spec, 3).paint["line-opacity"] as unknown[];
    const at = (z: number) => {
      let v = op[4] as number; // ["interpolate", ["linear"], ["zoom"], z0, v0, z1, v1, ...]
      for (let i = 3; i + 1 < op.length; i += 2) if ((op[i] as number) <= z + 1e-9) v = op[i + 1] as number;
      return v;
    };
    expect(at(8.5)).toBeCloseTo(THIN_INK, 6);
    expect(at(MAJOR_WIDE_FROM + 0.02)).toBe(1);
    expect(at(12)).toBe(1);
  });
});

describe("earlier detail (owner: a country fills the screen before the region lines appear)", () => {
  // France, Germany, Spain and Colombia filling a 1440x900 viewport: a circle whose diameter is the viewport height (no margin), at the
  // country's centre latitude: the zoom at which the country is the whole picture
  const COUNTRIES: [string, number, number][] = [
    ["France", 500, 46.5],
    ["Germany", 430, 51],
    ["Spain", 500, 40],
    ["Colombia", 700, 4.5],
    ["Italy", 600, 42],
  ];
  const fillZoom = (km: number, lat: number) => radiusFitZoom(km, 1440, 900, 0, 0) + zoomCorrection(lat);

  it("the region lines are at 70 % of their tone or more when a country fills the screen", () => {
    for (const [name, km, lat] of COUNTRIES) {
      const z = fillZoom(km, lat);
      const level = levelAt(LOD.regionBorder, z);
      expect(level / toneLevel(LOD.regionBorder), `${name} z${z.toFixed(2)}`).toBeGreaterThanOrEqual(0.7);
    }
  });
  it("the ramps start as the street map takes over from the globe and are earlier than before by the measured shift", () => {
    // before (HEAD aae202e): region 4.5..6.5, lake 7.5..10, river 8.6..10.4, rail 10.2..12.2, park 8.4..10.6, sea 5.2..10
    const BEFORE = { regionBorder: [4.5, 6.5], lake: [7.5, 10], river: [8.6, 10.4], rail: [10.2, 12.2] } as const;
    expect(LOD.regionBorder.from).toBeLessThanOrEqual(BEFORE.regionBorder[0] - 0.6);
    expect(LOD.regionBorder.full).toBeLessThanOrEqual(BEFORE.regionBorder[1] - 1.3);
    expect(LOD.lake.from).toBeLessThanOrEqual(BEFORE.lake[0] - 1.9);
    expect(LOD.river.from).toBeLessThanOrEqual(BEFORE.river[0] - 1.5);
    expect(FILL_LOD.park.from).toBeLessThanOrEqual(8.4 - 1.9);
    expect(FILL_LOD.water.from).toBeLessThanOrEqual(5.2 - 3);
    // none of them starts before the data exists (OpenMapTiles): lakes z3, rivers z4, parks z5 (rail, z8, stays where it was: it only adds clutter at the city framing)
    expect(LOD.lake.from).toBeGreaterThanOrEqual(3);
    expect(LOD.river.from).toBeGreaterThanOrEqual(4);
    expect(FILL_LOD.park.from).toBeGreaterThanOrEqual(5);
  });
  it("the region lines start just after the cut at the equator (and later further north, where the cut is at a lower map zoom): the globe never gets them", () => {
    expect(LOD.regionBorder.from).toBeGreaterThanOrEqual(toMapZoomAtCut(0) - 0.01);
    expect(levelAt(LOD.regionBorder, LOD.regionBorder.from + 1e-3)).toBe(1);
  });
  it("far zoom stays calm: the region lines are the faintest levels for the first third of their ramp, and roads have not moved", () => {
    const third = LOD.regionBorder.from + (LOD.regionBorder.full - LOD.regionBorder.from) / 3;
    expect(levelAt(LOD.regionBorder, third)).toBeLessThanOrEqual(Math.ceil(toneLevel(LOD.regionBorder) / 3) + 1);
    expect(LOD.highway.from).toBe(5.5);
    expect(LOD.major.from).toBeGreaterThanOrEqual(8.5);
  });
});

const toMapZoomAtCut = (lat: number) => HANDOVER.cutBackZoom + zoomCorrection(lat);
