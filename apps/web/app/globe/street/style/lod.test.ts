import { describe, expect, it } from "vitest";
import { THIN_INK, expInterp } from "../core/art-line";
import { MAP_CONTRAST_DARK, buildRamp, peakLevel, roleLevel, srgbToOklab } from "../../engine/palette";
import { HANDOVER } from "../../handover/maths";
import { PATTERN } from "../core/palette";
import { radiusFitZoom } from "../../engine/framing";
import { zoomCorrection } from "../core/registration";
import { FILL_LOD, LOD, levelAt, toneLevel, visibleAt, type LodKey } from "./lod";
import { LayerSwitch, ZOOM_BAND, switchRules } from "./layer-switch";
import { decodePattern, levelOfPaint } from "./probe";
import { DEFAULT_HANDOFF, MAJOR_WIDE_FROM, SPECS, WORLD_PLACEHOLDER_BELOW, hasPlaceholder, artWidthStopsOf, buildStreetStyle, linePaint, seaFrom, type Schema } from "./street-style";

const KEYS = Object.keys(LOD) as LodKey[];
const LEVEL_COUNTS = [3, 4, 6, 8, 10, 12];
const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const TILES = { tiles: ["cat-p1://https://tiles.example/{z}/{x}/{y}.pbf"], minzoom: 0, maxzoom: 14, bounds: null };
const make = (schema: Schema) => buildStreetStyle({ schema, tiles: TILES, coastlines: empty, borders: empty, graticule: empty, routes: empty });
type L = { id: string; minzoom?: number; maxzoom?: number; layout?: { visibility?: string }; paint: Record<string, unknown> };

describe("LOD table", () => {
  it("every class has a switch zoom in a sane range, and an `off` only where it hands over to another class", () => {
    for (const k of KEYS) {
      const e = LOD[k];
      expect(e.on, k).toBeGreaterThanOrEqual(4);
      expect(e.on, k).toBeLessThanOrEqual(17.5 + 1e-9); // the street map stops at z17.5
      if (e.off !== undefined) expect(e.off, k).toBeGreaterThan(e.on);
    }
    expect(Object.entries(LOD).filter(([, e]) => e.off !== undefined).map(([k]) => k)).toEqual(["minor"]);
    expect(LOD.minor.off).toBe(LOD.minorSolid.on); // dotted residential streets hand over to solid ones at one zoom, never both, never neither
  });
  it("roads appear by rank: motorways first, then primary, secondary, tertiary, residential, service, paths", () => {
    const order: LodKey[] = ["highway", "major", "secondary", "medium", "minor", "service", "path"];
    for (let i = 1; i < order.length; i++) expect(LOD[order[i]!].on, order[i]).toBeGreaterThan(LOD[order[i - 1]!].on);
    // far-zoom calm (owner, earlier pass): nothing road-like below z6, nothing but motorways and trunks below z8.5
    expect(LOD.highway.on).toBeGreaterThanOrEqual(6);
    expect(LOD.major.on).toBeGreaterThanOrEqual(8.5);
    // rivers: the tile data holds the big ones from z4 (probed with scripts/street/layer-probe.mjs), the line starts as the regions do
    expect(LOD.river.on).toBeGreaterThanOrEqual(5);
    // the tile data bounds how early a class can show (OpenMapTiles: tertiary from z11, residential from z12, service from z13)
    expect(LOD.medium.on).toBeGreaterThanOrEqual(10.5);
    expect(LOD.minor.on).toBeGreaterThanOrEqual(12);
    expect(LOD.service.on).toBeGreaterThanOrEqual(13);
    expect(LOD.path.on).toBeGreaterThanOrEqual(14);
    expect(LOD.buildingOutline.on).toBeGreaterThanOrEqual(16);
    expect(FILL_LOD.building.on).toBeGreaterThanOrEqual(15.5);
  });
  it("tone follows the hierarchy: major roads at least as strong as minor roads, rail and paths softer, borders stronger than washes", () => {
    for (const n of LEVEL_COUNTS) {
      const lv = (k: LodKey) => toneLevel(LOD[k], n);
      expect(lv("highway"), `n=${n}`).toBeGreaterThanOrEqual(lv("medium"));
      expect(lv("medium"), `n=${n}`).toBeGreaterThanOrEqual(lv("service"));
      // (the quiet classes are the decor: they may sit below the dashes of water, which cover 1 cell in 8, so no floor against the water role)
      expect(lv("service"), `n=${n}`).toBeGreaterThanOrEqual(1);
      expect(lv("rail"), `n=${n}`).toBeGreaterThanOrEqual(lv("minor"));
      expect(lv("river"), `n=${n}`).toBeGreaterThanOrEqual(lv("minor"));
    }
  });
  it("minor classes keep a dashed pattern whose dashes can catch a cell centre on a diagonal", () => {
    for (const k of ["minor", "link", "service", "path", "rail", "canal", "stream", "regionBorder"] as const) {
      const d = LOD[k].dash;
      expect(d, k).toBeDefined();
      expect(d![0]!, k).toBeGreaterThanOrEqual(1.42);
    }
  });
});

describe("a class is on or off, never half way (no tone ramp over zoom)", () => {
  for (const n of LEVEL_COUNTS) {
    it(`n=${n}: not drawn below its switch zoom, its role's level from it, and nothing in between`, () => {
      for (const k of KEYS) {
        const e = LOD[k];
        const final = toneLevel(e, n);
        for (let z = 0; z < e.on; z += 0.1) expect(levelAt(e, z, n), `${k} z${z}`).toBe(0);
        for (let z = e.on; z <= (e.off ?? 20) - 0.01; z += 0.1) expect(levelAt(e, z, n), `${k} z${z}`).toBe(final);
        expect(visibleAt(e, e.on - 0.01)).toBe(false);
        expect(visibleAt(e, e.on)).toBe(true);
      }
    });
  }
  it("a class that hands over (dotted to solid residential streets) is on in exactly one of the two at every zoom", () => {
    for (let z = 12; z <= 17.5; z += 0.01) expect(Number(visibleAt(LOD.minor, z)) + Number(visibleAt(LOD.minorSolid, z)), `z ${z.toFixed(2)}`).toBe(z >= LOD.minor.on ? 1 : 0);
  });
});

describe("style wiring of the LOD", () => {
  it("every class is ONE layer with one constant colour: no ramp layers, no tone-channel layers, no zoom `step` colour, no static minzoom (the layer switch owns it)", () => {
    for (const schema of ["protomaps", "openmaptiles"] as const) {
      const st = make(schema).layers as unknown as L[];
      expect(st.some((l) => /-ramp$/.test(l.id))).toBe(false);
      const byId = new Map(st.map((l) => [l.id, l]));
      for (const spec of SPECS.filter((s) => s.lod)) {
        const l = byId.get(spec.id)!;
        expect(l.minzoom, `${schema} ${spec.id}`).toBeUndefined();
        expect(typeof l.paint["line-color"], `${schema} ${spec.id}`).toBe("string");
        expect(levelOfPaint(l.paint["line-color"], 0), `${schema} ${spec.id}`).toBe(toneLevel(LOD[spec.lod!]));
      }
    }
  });
  it("the layers that start on follow the switch for the camera the style is built for (a style swap shows no flash)", () => {
    const sw = new LayerSwitch(switchRules(seaFrom(DEFAULT_HANDOFF.openmaptiles)));
    sw.update({ zoom: 11.5, unifiedZoom: 11.5, heightPx: 900 });
    const st = buildStreetStyle({ schema: "openmaptiles", tiles: TILES, coastlines: empty, borders: empty, graticule: empty, routes: empty, visible: sw.visibleIds() }).layers as unknown as L[];
    const vis = (id: string) => st.find((l) => l.id === id)!.layout?.visibility !== "none";
    expect(vis("road-highway-case")).toBe(true);
    expect(vis("road-medium-case")).toBe(true);
    expect(vis("road-minor-dotted")).toBe(false); // 13
    expect(vis("building-fill")).toBe(false); // 16.3
    expect(vis("water-fill")).toBe(true); // flat at 11.5
    expect(vis("graticule")).toBe(false); // so the graticule is gone
    // and without a switch state everything is on (tests, tools)
    const all = make("openmaptiles").layers as unknown as L[];
    expect(all.filter((l) => !/^world-/.test(l.id)).every((l) => l.layout?.visibility !== "none")).toBe(true); // (the world lines are placeholders, hidden until tiles are loading)
  });
  it("regression (owner: from space everything but the graticule vanished, then came back layer by layer): with NOTHING switched on, only the switched layers are hidden; the coast, the country borders and every other always-on layer stay visible", () => {
    for (const schema of ["protomaps", "openmaptiles"] as const) {
      const st = buildStreetStyle({ schema, tiles: TILES, coastlines: empty, borders: empty, graticule: empty, routes: empty, visible: new Set() }).layers as unknown as L[];
      const hidden = st.filter((l) => l.layout?.visibility === "none").map((l) => l.id);
      const switchedIds = new Set([...SPECS.filter((s) => s.lod || s.fade).map((s) => s.id), "graticule"]);
      for (const id of hidden) expect(switchedIds.has(id) || /^world-/.test(id), `${schema} ${id} must not be hidden by the switch`).toBe(true);
      for (const id of ["water-edge", "boundary-country", "road-major-fill", "road-medium-fill", "routes-line", "routes-halo", "background"]) expect(hidden.includes(id), `${schema} ${id}`).toBe(false);
      for (const id of switchedIds) expect(hidden.includes(id), `${schema} ${id}`).toBe(true);
    }
  });
  it("regression (owner: street-scale London, no road hierarchy, every road the same band): built for a street zoom the style has every road class on with its own tone and a width ordered down the hierarchy, and the erasing interiors that make big roads hollow are on", () => {
    const sw = new LayerSwitch(switchRules(seaFrom(DEFAULT_HANDOFF.openmaptiles)));
    sw.update({ zoom: 17.2, unifiedZoom: 17.2 - zoomCorrection(51.5), heightPx: 900 });
    const st = buildStreetStyle({ schema: "openmaptiles", tiles: TILES, coastlines: empty, borders: empty, graticule: empty, routes: empty, visible: sw.visibleIds() }).layers as unknown as L[];
    const on = (id: string) => st.find((l) => l.id === id)!.layout?.visibility !== "none";
    const tiers = ["road-highway-case", "road-major-case", "road-secondary-case", "road-medium-case", "road-minor"];
    for (const id of [...tiers, "road-major-fill", "road-medium-fill", "road-link-dotted", "road-other-dotted", "path-dotted"]) expect(on(id), id).toBe(true);
    expect(on("road-minor-dotted")).toBe(false); // handed over to the solid one
    const tone = (id: string) => levelOfPaint(st.find((l) => l.id === id)!.paint["line-color"], 17.2);
    const tones = tiers.map(tone);
    for (let i = 1; i < tones.length; i++) expect(tones[i]!, tiers[i]).toBeLessThanOrEqual(tones[i - 1]!);
    expect(new Set(tones).size).toBeGreaterThanOrEqual(4); // distinct tones: 10, 9, 7, 5, 4
    const width = (id: string) => artWidthStopsOf(SPECS.find((s) => s.id === id)!);
    const w = (id: string) => { const v = width(id); return typeof v === "number" ? v : expInterp(v, 17.2, 1.5); };
    expect(w("road-major-case")).toBeGreaterThan(w("road-medium-case"));
    expect(w("road-medium-case")).toBeGreaterThan(w("road-minor"));
  });
  it("fills are constant patterns at their wash level", () => {
    for (const spec of SPECS.filter((s) => s.type === "fill")) {
      const st = (make("openmaptiles").layers as unknown as L[]).find((l) => l.id === spec.id)!;
      const f = spec.fade!;
      expect(st.minzoom, spec.id).toBeUndefined();
      expect(levelOfPaint(st.paint["fill-color"], 0), spec.id).toBe(roleLevel(f.role));
      expect(st.paint["fill-opacity"]).toBe(1);
    }
  });
  it("water and green areas are distinct patterns in a dimmed level (below the roads), buildings a flat wash", () => {
    const st = make("openmaptiles").layers as unknown as L[];
    const pat = (id: string) => decodePattern(st.find((l) => l.id === id)!.paint["fill-color"] as string);
    expect(pat("water-fill")).toBe(PATTERN.water);
    expect(pat("park-fill")).toBe(PATTERN.green);
    expect(pat("building-fill")).toBe(PATTERN.flat);
    expect(PATTERN.water).not.toBe(PATTERN.green);
    for (const n of LEVEL_COUNTS) {
      // with only three or four levels the map has one or two greys and the roles collapse: never louder, strictly dimmer once there is room
      const cmp = n >= 6 ? "toBeLessThan" : "toBeLessThanOrEqual";
      expect(roleLevel(FILL_LOD.water.role, n), `n=${n}`)[cmp](toneLevel(LOD.major, n));
      expect(roleLevel(FILL_LOD.park.role, n), `n=${n}`)[cmp](toneLevel(LOD.major, n));
    }
  });
  it("the two schemas expose the same layers (identical look), with the same zoom ranges", () => {
    // the world-data layers, the sea outline and the tile country border follow the per-schema hand-over zoom (the one deliberate difference)
    const tiles = (st: L[]) => st.filter((l) => !/^world-|^water-edge$|^boundary-country$/.test(l.id)).map((l) => [l.id, l.minzoom, l.maxzoom]);
    expect(tiles(make("protomaps").layers as unknown as L[])).toEqual(tiles(make("openmaptiles").layers as unknown as L[]));
  });
  it("the sea texture may start 0.7 zoom after the hand-over to tile geometry in either schema (a source whose tiles only cover a place must not show their edges)", () => {
    for (const schema of ["protomaps", "openmaptiles"] as const) expect(seaFrom(DEFAULT_HANDOFF[schema])).toBeCloseTo(DEFAULT_HANDOFF[schema] + 0.7, 9);
    const rule = (h: number) => switchRules(seaFrom(h)).find((r) => r.id === "water-fill")!;
    expect(rule(DEFAULT_HANDOFF.protomaps).on).toBeGreaterThan(rule(DEFAULT_HANDOFF.openmaptiles).on);
  });
  it("lines keep the one-art-pixel floor wherever they are on", () => {
    for (const spec of SPECS.filter((s) => s.lod && s.type === "line")) {
      const w = linePaint(spec, 3).paint["line-width"];
      const at = (z: number) => (typeof w === "number" ? w : expInterp(((w as unknown[]).slice(3) as number[]).reduce<[number, number][]>((acc, v, i, arr) => (i % 2 === 0 ? [...acc, [v, arr[i + 1]!]] : acc), []), z, 1.5));
      for (let z = LOD[spec.lod!].on; z < LOD[spec.lod!].on + 3; z += 0.25) expect(at(z), `${spec.id} z${z}`).toBeGreaterThanOrEqual(3 - 1e-9);
    }
  });
  it("nothing road-like is drawn below country scale", () => {
    for (const spec of SPECS.filter((s) => /^(road|path|rail)/.test(s.id) && !/fill$/.test(s.id))) {
      const on = spec.lod ? LOD[spec.lod].on : (spec.minzoom ?? 0);
      expect(on, spec.id).toBeGreaterThanOrEqual(6);
    }
  });
  it("the sea keeps its outline at every zoom; lakes and small water switch on", () => {
    const st = make("openmaptiles").layers as unknown as L[];
    const sea = st.find((l) => l.id === "water-edge")!;
    expect(sea.maxzoom).toBeUndefined();
    expect(switchRules(1.7).find((r) => r.id === "water-edge-detail")!.on).toBe(LOD.waterDetail.on);
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
  /** On, as the layer switch settles when the camera arrives from below (it zooms in to a city): the hysteresis band counts against. */
  const on = (e: { on: number; off?: number }, z: number) => z >= e.on + ZOOM_BAND && (e.off === undefined || z < e.off);

  it("the framing zoom table is what the style is tuned to: 10.0 to 11.4 on a 1440x900 desktop for 10 to 18 km", () => {
    const zs = Object.values(CITIES).flatMap((lat) => [10, 12, 14, 18].map((km) => framing(km, lat, 1440, 900, 0)));
    expect(Math.min(...zs)).toBeGreaterThan(9.95);
    expect(Math.max(...zs)).toBeLessThan(11.5);
    expect(framing(12, CITIES.paris, 1440, 900, 0)).toBeCloseTo(10.59, 1);
    expect(framing(12, CITIES.hcmc, 1440, 900, 0)).toBeCloseTo(11.17, 1);
  });
  it("desktop, default 12 km radius, panel closed or open: motorways, primary and secondary roads, links, rail, rivers, lakes and parks are on", () => {
    for (const lat of Object.values(CITIES)) for (const inset of [0, 720]) {
      const z = framing(12, lat, 1440, 900, inset);
      for (const k of ["highway", "major", "secondary", "link", "rail", "river", "lake"] as const) expect(on(LOD[k], z), `${k} lat ${lat} inset ${inset} z${z.toFixed(2)}`).toBe(true);
      expect(on(FILL_LOD.park, z), `park lat ${lat}`).toBe(true);
    }
  });
  it("every framing a person can get (10 to 18 km, desktop with or without the panel, a phone): motorways and primary roads are on", () => {
    for (const lat of Object.values(CITIES)) for (const km of [10, 12, 14, 18]) for (const [w, h, inset] of [[1440, 900, 0], [1440, 900, 720], [390, 844, 0]] as const) {
      const z = framing(km, lat, w, h, inset);
      expect(on(LOD.highway, z), `${km} km ${w}x${h} inset ${inset} lat ${lat} z${z.toFixed(2)}`).toBe(true);
      expect(on(LOD.major, z), `${km} km ${w}x${h} inset ${inset} lat ${lat} z${z.toFixed(2)}`).toBe(true);
    }
  });
  it("tertiary roads switch on as soon as their tiles exist (OpenMapTiles z11), so the closest framing has them; residential streets follow dotted a zoom or two later", () => {
    expect(LOD.medium.on).toBeLessThan(11.2);
    expect(on(LOD.medium, framing(12, CITIES.hcmc, 1440, 900, 0))).toBe(true); // 11.17: the closest typical framing
    expect(LOD.minor.on).toBeLessThanOrEqual(13);
    expect(LOD.minor.dash).toBeDefined();
  });
  it("far zoom is as calm as before: of the roads only motorways and trunks below z8.5, none below z6 (rivers and region borders started earlier on purpose)", () => {
    for (let z = 0; z <= 8.5; z += 0.1) for (const k of ["major", "secondary", "medium", "minor", "link", "service", "path", "rail", "canal", "stream", "waterDetail"] as const) expect(levelAt(LOD[k], z), `${k} z${z.toFixed(1)}`).toBe(0);
    for (let z = 0; z <= 6; z += 0.1) expect(levelAt(LOD.highway, z)).toBe(0);
  });
  it("the tone hierarchy at the framing: arterials louder than links and rail", () => {
    for (const z of [9, 9.5, 10, 10.5, 11, 11.5]) {
      expect(levelAt(LOD.major, z)).toBeGreaterThanOrEqual(levelAt(LOD.link, z));
      expect(levelAt(LOD.secondary, z)).toBeGreaterThanOrEqual(levelAt(LOD.rail, z));
    }
  });
});

describe("road hierarchy: the class is told by tone and by width (owner: everything was the same colour)", () => {
  // The tiers, loudest first, as palette levels of the 12-level palette (peak = 10, ink = 11).
  const TIERS: [string, LodKey, number][] = [
    ["motorway, trunk", "highway", 10],
    ["primary", "major", 8],
    ["secondary", "secondary", 6],
    ["tertiary", "medium", 4],
    ["links, solid residential", "minorSolid", 3],
    ["residential", "minor", 2],
    ["service", "service", 2],
    ["paths", "path", 2],
  ];
  const lightTheme = { background: [0.984, 0.984, 0.984] as const, ink: [0.039, 0.039, 0.039] as const };
  const darkTheme = { background: [0.039, 0.039, 0.039] as const, ink: [0.96, 0.96, 0.96] as const };
  const lightness = (rgb: readonly [number, number, number]) => srgbToOklab(rgb)[0];

  it("the tone table by class (final level, 12 levels)", () => {
    for (const [name, key, level] of TIERS) expect(toneLevel(LOD[key]), name).toBe(level);
    // links are the faint tier (the decor), rail the soft one, rivers and lakes the strong one, the region borders the mid one
    expect(toneLevel(LOD.link)).toBe(3);
    expect(toneLevel(LOD.rail)).toBe(roleLevel("soft"));
    expect(toneLevel(LOD.river)).toBe(roleLevel("strong"));
  });
  it("tone only goes down the hierarchy: motorway >= primary > secondary > tertiary > residential, service and paths softest", () => {
    for (let i = 1; i < TIERS.length; i++) expect(TIERS[i]![2], TIERS[i]![0]).toBeLessThanOrEqual(TIERS[i - 1]![2]);
    // every tier down to the tertiary ones is clearly (two levels) louder than the next: that is what lets a main road stand out of a mesh
    for (const [a, b] of [["highway", "major"], ["major", "secondary"], ["secondary", "medium"], ["medium", "minorSolid"], ["minorSolid", "minor"]] as const) expect(toneLevel(LOD[a]) - toneLevel(LOD[b]), `${a} over ${b}`).toBeGreaterThanOrEqual(1);
    for (const n of LEVEL_COUNTS.filter((x) => x >= 6)) {
      const lvl = (k: LodKey) => toneLevel(LOD[k], n);
      expect(lvl("highway"), `n=${n}`).toBeGreaterThanOrEqual(lvl("major"));
      expect(lvl("major"), `n=${n}`).toBeGreaterThan(lvl("secondary"));
      expect(lvl("secondary"), `n=${n}`).toBeGreaterThanOrEqual(lvl("medium"));
      expect(lvl("medium"), `n=${n}`).toBeGreaterThanOrEqual(lvl("minor"));
      expect(lvl("minor"), `n=${n}`).toBeGreaterThanOrEqual(lvl("path"));
    }
  });
  it("the streets are the quietest element of the map (owner: they are only decor): every minor class strictly dimmer than tertiary, no louder than the dashes of water, and 1 art px wide at every zoom", () => {
    const minors = ["minor", "minorSolid", "link", "service", "path"] as const;
    for (const n of LEVEL_COUNTS.filter((x) => x >= 6)) for (const k of minors) {
      // (strictly below the tertiary tier with the 10 and 12 levels of the app; with fewer levels two tiers may share one)
      if (n >= 10) expect(toneLevel(LOD[k], n), `${k} n=${n}`).toBeLessThan(toneLevel(LOD.medium, n));
      else expect(toneLevel(LOD[k], n), `${k} n=${n}`).toBeLessThanOrEqual(toneLevel(LOD.medium, n));
      expect(toneLevel(LOD[k], n), `${k} n=${n}`).toBeLessThanOrEqual(roleLevel(FILL_LOD.park.role, n));
      expect(toneLevel(LOD[k], n), `${k} n=${n}`).toBeLessThanOrEqual(toneLevel(LOD.secondary, n));
    }
    // the dotted residential streets, service roads and paths are the very faintest and never louder than the rail or the links
    for (const k of ["minor", "service", "path"] as const) expect(toneLevel(LOD[k]), k).toBeLessThanOrEqual(toneLevel(LOD.link));
    // they enter after the tertiary roads (links excepted) and are not drawn wider than one art pixel at any zoom (floor, centre sampling, stair removal)
    for (const id of ["road-minor-dotted", "road-minor", "road-link-dotted", "road-other-dotted", "path-dotted"]) expect(artWidthStopsOf(SPECS.find((s) => s.id === id)!), id).toBe(1);
    for (const k of ["minor", "minorSolid", "service", "path"] as const) expect(LOD[k].on, k).toBeGreaterThan(LOD.medium.on); // (the links come with the city framing, in the faint tier)
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
      expect(Math.abs(L("path") - bg)).toBeGreaterThan(0.06);
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

  it("the region lines are on when a country fills the screen", () => {
    for (const [name, km, lat] of COUNTRIES) {
      const z = fillZoom(km, lat);
      expect(z, `${name} z${z.toFixed(2)}`).toBeGreaterThanOrEqual(LOD.regionBorder.on + ZOOM_BAND);
    }
  });
  it("the switch zooms are earlier than the ramps they replace were at their middle, and not before the data exists", () => {
    // before (HEAD aae202e): region 4.5..6.5, lake 7.5..10, river 8.6..10.4, rail 10.2..12.2, park 8.4..10.6, sea 5.2..10
    const BEFORE = { regionBorder: [4.5, 6.5], lake: [7.5, 10], river: [8.6, 10.4], rail: [10.2, 12.2] } as const;
    for (const k of Object.keys(BEFORE) as (keyof typeof BEFORE)[]) expect(LOD[k].on, k).toBeLessThanOrEqual((BEFORE[k][0] + BEFORE[k][1]) / 2 - 0.5);
    expect(FILL_LOD.park.on).toBeLessThanOrEqual((8.4 + 10.6) / 2 - 0.5);
    // none of them starts before the data exists (OpenMapTiles): lakes z3, rivers z4, parks z5 (rail, z8, stays where it was: it only adds clutter at the city framing)
    expect(LOD.lake.on).toBeGreaterThanOrEqual(3);
    expect(LOD.river.on).toBeGreaterThanOrEqual(4);
    expect(FILL_LOD.park.on).toBeGreaterThanOrEqual(5);
  });
  it("the region lines start just after the cut at the equator (and later further north, where the cut is at a lower map zoom): the globe never gets them", () => {
    expect(LOD.regionBorder.on).toBeGreaterThanOrEqual(toMapZoomAtCut(0) - 0.01);
  });
  it("far zoom stays calm: roads have not moved", () => {
    expect(LOD.highway.on).toBeGreaterThanOrEqual(6);
    expect(LOD.major.on).toBeGreaterThanOrEqual(8.5);
  });
});

const toMapZoomAtCut = (lat: number) => HANDOVER.cutBackZoom + zoomCorrection(lat);
