import { describe, expect, it } from "vitest";
import { flatZoom } from "../core/flatness";
import { LayerSwitch, SEA_LAYER, GRATICULE_LAYER, ZOOM_BAND, isSwitched, switchRules, type SwitchView } from "./layer-switch";
import { FILL_LOD, LOD } from "./lod";
import { DEFAULT_HANDOFF, SPECS, seaFrom } from "./street-style";

const H = 900;
const view = (zoom: number): SwitchView => ({ zoom, unifiedZoom: zoom, heightPx: H });
const mk = (handoff = DEFAULT_HANDOFF.openmaptiles) => new LayerSwitch(switchRules(seaFrom(handoff)));
const isOn = (sw: LayerSwitch, id: string) => sw.visibleIds().has(id);

describe("the rules", () => {
  it("every class of the LOD table and every fill has exactly one rule, and nothing else (but the graticule) is switched", () => {
    const ids = switchRules(1.7).map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const spec of SPECS) expect(ids.includes(spec.id), spec.id).toBe(Boolean(spec.lod || spec.fade));
    for (const spec of SPECS.filter((s) => s.lod)) expect(switchRules(1.7).find((r) => r.id === spec.id)!.on).toBe(LOD[spec.lod!].on);
    expect(isSwitched(GRATICULE_LAYER)).toBe(true);
    expect(isSwitched("water-edge")).toBe(false); // the sea outline and the country borders hand over by geometry, not by a switch
    expect(isSwitched("boundary-country")).toBe(false);
  });
});

describe("a layer is on or off, with a hysteresis band", () => {
  it("a road class switches on above its zoom plus the band, off again below its zoom minus the band, and keeps its state in between", () => {
    const sw = mk();
    const z = LOD.medium.on;
    sw.update(view(z - 1));
    expect(isOn(sw, "road-medium-case")).toBe(false);
    sw.update(view(z));
    expect(isOn(sw, "road-medium-case")).toBe(false); // zooming in: not yet, the band counts against
    sw.update(view(z + ZOOM_BAND));
    expect(isOn(sw, "road-medium-case")).toBe(true);
    sw.update(view(z));
    expect(isOn(sw, "road-medium-case")).toBe(true); // zooming out: stays until below the band
    sw.update(view(z - ZOOM_BAND));
    expect(isOn(sw, "road-medium-case")).toBe(false);
  });
  it("a zoom jittering around the threshold changes the layer at most once", () => {
    const sw = mk();
    sw.update(view(5));
    let changes = 0;
    for (let k = 0; k < 200; k++) changes += sw.update(view(LOD.secondary.on + (k % 2 ? 0.03 : -0.03))).filter((c) => c.id === "road-secondary-case").length;
    expect(changes).toBe(0); // inside the band from below: it never switches on
    for (let k = 0; k < 200; k++) changes += sw.update(view(LOD.secondary.on + (k % 2 ? 0.06 : -0.03))).filter((c) => c.id === "road-secondary-case").length;
    expect(changes).toBe(1); // once on, it stays on
  });
  it("reports only the layers that changed, once", () => {
    const sw = mk();
    const first = sw.update(view(12));
    expect(first.length).toBeGreaterThan(5);
    expect(sw.update(view(12))).toEqual([]);
    expect(sw.update(view(12.01))).toEqual([]);
  });
  it("the dotted residential streets hand over to the solid ones: one or the other at every zoom (with the band, never neither)", () => {
    const sw = mk();
    for (let z = LOD.minor.on + 0.2; z < 17.5; z += 0.01) {
      sw.update(view(z));
      expect(isOn(sw, "road-minor-dotted") || isOn(sw, "road-minor"), `z ${z.toFixed(2)}`).toBe(true);
    }
    expect(isOn(sw, "road-minor-dotted")).toBe(false);
    expect(isOn(sw, "road-minor")).toBe(true);
  });
  it("at rest at any zoom every class is on or off as its table says, outside the band (no resting half state)", () => {
    const sw = mk();
    for (let z = 0; z <= 17.5; z += 0.01) {
      sw.update(view(z));
      for (const spec of SPECS.filter((s) => s.lod)) {
        const e = LOD[spec.lod!];
        if (z < e.on - ZOOM_BAND - 1e-9) expect(isOn(sw, spec.id), `${spec.id} z${z.toFixed(2)}`).toBe(false);
        if (z > e.on + ZOOM_BAND + 1e-9 && (e.off === undefined || z < e.off - ZOOM_BAND - 1e-9)) expect(isOn(sw, spec.id), `${spec.id} z${z.toFixed(2)}`).toBe(true);
      }
    }
  });
  it("zooming OUT the minor classes leave before the major ones, each one exactly a band under its switch zoom (the hysteresis never keeps a class alive longer); zooming in they arrive in rank order, a band above it", () => {
    const RANK = ["road-highway-case", "road-major-case", "road-secondary-case", "road-medium-case", "road-minor-dotted", "road-other-dotted", "path-dotted"] as const;
    const KEY = { "road-highway-case": "highway", "road-major-case": "major", "road-secondary-case": "secondary", "road-medium-case": "medium", "road-minor-dotted": "minor", "road-other-dotted": "service", "path-dotted": "path" } as const;
    const STEP = 0.005;
    const out = mk();
    out.update(view(17.4));
    const left = new Map<string, number>();
    for (let z = 17.4; z >= 5; z -= STEP) for (const c of out.update(view(z))) if (!c.visible && !left.has(c.id)) left.set(c.id, z);
    const arrived = new Map<string, number>();
    const into = mk();
    into.update(view(5));
    for (let z = 5; z <= 17.4; z += STEP) for (const c of into.update(view(z))) if (c.visible && !arrived.has(c.id)) arrived.set(c.id, z);
    for (const id of RANK) {
      const on = LOD[KEY[id]].on;
      expect(left.get(id)!, `${id} leaves`).toBeLessThan(on - ZOOM_BAND + 1e-9);
      expect(left.get(id)!, `${id} leaves`).toBeGreaterThan(on - ZOOM_BAND - 2 * STEP);
      expect(arrived.get(id)!, `${id} arrives`).toBeGreaterThan(on + ZOOM_BAND - 1e-9);
      expect(arrived.get(id)!, `${id} arrives`).toBeLessThan(on + ZOOM_BAND + 2 * STEP);
    }
    // zooming out the finest class leaves first, the motorways last; zooming in the other way round
    for (let i = 1; i < RANK.length; i++) {
      expect(left.get(RANK[i]!)!, `${RANK[i]} leaves before ${RANK[i - 1]}`).toBeGreaterThan(left.get(RANK[i - 1]!)!);
      expect(arrived.get(RANK[i]!)!, `${RANK[i]} arrives after ${RANK[i - 1]}`).toBeGreaterThan(arrived.get(RANK[i - 1]!)!);
    }
  });
  it("fills (parks, green areas, buildings) follow their switch zoom", () => {
    const sw = mk();
    sw.update(view(FILL_LOD.park.on - 0.5));
    expect(isOn(sw, "park-fill")).toBe(false);
    sw.update(view(FILL_LOD.park.on + 0.5));
    expect(isOn(sw, "park-fill")).toBe(true);
    expect(isOn(sw, "building-fill")).toBe(false);
  });
});

describe("the graticule and the sea texture follow the flatness of the view", () => {
  const flatAt = flatZoom(H);
  it("the earth is curved: the graticule is on and the sea texture is not, up to the flat zoom", () => {
    const sw = mk();
    for (let z = 3.7; z < flatAt - 0.1; z += 0.1) {
      sw.update(view(z));
      expect(isOn(sw, GRATICULE_LAYER), `z ${z.toFixed(1)}`).toBe(true);
      expect(isOn(sw, SEA_LAYER), `z ${z.toFixed(1)}`).toBe(false);
    }
  });
  it("once the view is flat they swap in one step: the graticule goes, the sea texture comes, never both and never neither", () => {
    const sw = mk();
    let swappedAt = -1;
    for (let z = 3.7; z <= 12; z += 0.005) {
      sw.update(view(z));
      const grid = isOn(sw, GRATICULE_LAYER);
      const sea = isOn(sw, SEA_LAYER);
      expect(grid !== sea, `z ${z.toFixed(3)}`).toBe(true);
      if (sea && swappedAt < 0) swappedAt = z;
    }
    expect(swappedAt).toBeCloseTo(flatAt, 1);
    expect(swappedAt).toBeGreaterThan(8);
  });
  it("it is a hysteresis: going back out the texture stays a little longer than it took to come, and a jitter at the switch changes it once", () => {
    const sw = mk();
    sw.update(view(flatAt + 1));
    expect(isOn(sw, SEA_LAYER)).toBe(true);
    sw.update(view(flatAt - 0.1));
    expect(isOn(sw, SEA_LAYER)).toBe(true); // still, inside the band
    sw.update(view(flatAt - 1));
    expect(isOn(sw, SEA_LAYER)).toBe(false);
    const sw2 = mk();
    sw2.update(view(5));
    let flips = 0;
    for (let k = 0; k < 100; k++) flips += sw2.update(view(flatAt + (k % 2 ? 0.02 : -0.02))).filter((c) => c.id === SEA_LAYER).length;
    expect(flips).toBeLessThanOrEqual(1);
  });
  it("the viewport counts: a taller view is curved for longer", () => {
    const tall = new LayerSwitch(switchRules(1.7));
    tall.update({ zoom: flatAt + 0.3, unifiedZoom: flatAt + 0.3, heightPx: 1800 });
    expect(isOn(tall, SEA_LAYER)).toBe(false);
    const short = new LayerSwitch(switchRules(1.7));
    short.update({ zoom: flatAt + 0.3, unifiedZoom: flatAt + 0.3, heightPx: 600 });
    expect(isOn(short, SEA_LAYER)).toBe(true);
  });
  it("a tile source that only covers a place (the PMTiles extract) gets the texture later, never before its tiles are drawn", () => {
    const sw = mk(DEFAULT_HANDOFF.protomaps);
    sw.update({ zoom: 9, unifiedZoom: flatAt + 2, heightPx: H }); // flat, but before handoff + 0.7
    expect(isOn(sw, SEA_LAYER)).toBe(false);
    sw.update({ zoom: DEFAULT_HANDOFF.protomaps + 0.7 + ZOOM_BAND + 0.01, unifiedZoom: flatAt + 2, heightPx: H });
    expect(isOn(sw, SEA_LAYER)).toBe(true);
    expect(isOn(sw, GRATICULE_LAYER)).toBe(false);
  });
});
