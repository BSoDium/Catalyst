import { describe, expect, it } from "vitest";
import { loadBorders, loadCoastlines, type Polylines } from "@catalyst/geodata";
import type { GlobeRoute } from "../types";
import { OCCLUDER_RADIUS } from "./materials";
import { MAX_CHORD_DEG, graticuleSegments, isRouteStop, polylinesToSegments, routeBuffers, routesForPlace, segmentPieces } from "./geometry";

describe("polylinesToSegments", () => {
  it("emits one segment per consecutive vertex pair and never joins separate lines", () => {
    const p: Polylines = {
      positions: Float32Array.from([0, 0, 10, 0, 20, 0, 50, 10, 60, 10]),
      offsets: Uint32Array.from([0, 3, 5]),
    };
    const seg = polylinesToSegments(p, 1, 1000); // no cutting: the first line's segments are 10 degrees
    expect(seg.length / 6).toBe(3); // 2 + 1
    // second line's first segment starts at its own first vertex, not the previous line's end
    const second = seg.slice(12, 15);
    expect(Math.atan2(second[0]!, second[2]!) * (180 / Math.PI)).toBeCloseTo(50, 3);
  });
  it("places vertices on the requested radius", () => {
    const p: Polylines = { positions: Float32Array.from([10, 20, 30, 40]), offsets: Uint32Array.from([0, 2]) };
    const s = polylinesToSegments(p, 1.5);
    expect(Math.hypot(s[0]!, s[1]!, s[2]!)).toBeCloseTo(1.5, 5);
  });
});

/** Lowest radius (0 = centre, 1 = the surface) any point of a chord segment reaches: its midpoint. */
const chordMinRadius = (seg: Float32Array, i: number) => Math.hypot((seg[i * 6]! + seg[i * 6 + 3]!) / 2, (seg[i * 6 + 1]! + seg[i * 6 + 4]!) / 2, (seg[i * 6 + 2]! + seg[i * 6 + 5]!) / 2);

describe("long segments are cut so they never sink into the globe (far-zoom border bug)", () => {
  it("a 40 degree segment is cut into pieces of at most MAX_CHORD_DEG, along the parallel, ends unchanged", () => {
    const p: Polylines = { positions: Float32Array.from([-123, 49, -83, 49]), offsets: Uint32Array.from([0, 2]) };
    const seg = polylinesToSegments(p, 1);
    expect(seg.length / 6).toBe(segmentPieces(-123, 49, -83, 49));
    expect(seg.length / 6).toBeGreaterThanOrEqual(40 * Math.cos((49 * Math.PI) / 180) / MAX_CHORD_DEG);
    // pieces join end to start and stay on the parallel (constant latitude)
    for (let i = 0; i < seg.length / 6; i++) {
      const lat = (Math.asin(seg[i * 6 + 1]!) * 180) / Math.PI;
      expect(lat).toBeCloseTo(49, 3);
      if (i > 0) for (let k = 0; k < 3; k++) expect(seg[i * 6 + k]).toBeCloseTo(seg[(i - 1) * 6 + 3 + k]!, 6);
    }
    const first = [seg[0]!, seg[2]!];
    expect((Math.atan2(first[0]!, first[1]!) * 180) / Math.PI).toBeCloseTo(-123, 3);
  });
  it("short segments are left alone", () => {
    expect(segmentPieces(10, 10, 10.5, 10.2)).toBe(1);
  });
  it("the sag of every piece stays well inside the gap to the disc (the occluder is 0.002 under the surface)", () => {
    const sag = 1 - Math.cos((MAX_CHORD_DEG * Math.PI) / 180 / 2);
    expect(sag).toBeLessThan((1 - OCCLUDER_RADIUS) / 20);
  });
  it("in the real border and coastline data no piece dips under the disc, and the known long borders are whole", async () => {
    const borders = await loadBorders();
    const coast = await loadCoastlines();
    for (const [name, data] of [["borders", borders], ["coastlines", coast]] as const) {
      const seg = polylinesToSegments(data, 1);
      let worst = 1;
      for (let i = 0; i < seg.length / 6; i++) worst = Math.min(worst, chordMinRadius(seg, i));
      expect(worst, name).toBeGreaterThan(OCCLUDER_RADIUS + (1 - OCCLUDER_RADIUS) * 0.9);
    }
    // an uncut long segment DOES sink: that is the bug (pins what the regression is about; the dataset itself is being rebuilt
    // with denser lines, so this does not depend on it)
    const longOne: Polylines = { positions: Float32Array.from([-123, 49, -83, 49]), offsets: Uint32Array.from([0, 2]) };
    const raw = polylinesToSegments(longOne, 1, 1000);
    let rawWorst = 1;
    for (let i = 0; i < raw.length / 6; i++) rawWorst = Math.min(rawWorst, chordMinRadius(raw, i));
    expect(rawWorst).toBeLessThan(OCCLUDER_RADIUS);
  });
  it("presence: the USA-Canada border (49th parallel, 123 W to 95 W) and the Alaska-Canada border (141 W) are in the segment set along their whole length", async () => {
    const seg = polylinesToSegments(await loadBorders(), 1);
    const dist = (lon: number, lat: number) => {
      const x = Math.cos((lat * Math.PI) / 180) * Math.sin((lon * Math.PI) / 180);
      const y = Math.sin((lat * Math.PI) / 180);
      const z = Math.cos((lat * Math.PI) / 180) * Math.cos((lon * Math.PI) / 180);
      let best = Infinity;
      for (let i = 0; i < seg.length / 6; i++) {
        // distance from the point to the segment (3D)
        const ax = seg[i * 6]!, ay = seg[i * 6 + 1]!, az = seg[i * 6 + 2]!;
        const bx = seg[i * 6 + 3]! - ax, by = seg[i * 6 + 4]! - ay, bz = seg[i * 6 + 5]! - az;
        const l2 = bx * bx + by * by + bz * bz || 1e-12;
        const t = Math.max(0, Math.min(1, ((x - ax) * bx + (y - ay) * by + (z - az) * bz) / l2));
        best = Math.min(best, Math.hypot(x - ax - t * bx, y - ay - t * by, z - az - t * bz));
      }
      return best;
    };
    // 0.004 of the radius = 25 km: the data is simplified to 0.04 degrees
    for (let lon = -122; lon <= -96; lon += 2) expect(dist(lon, 49), `49N ${lon}`).toBeLessThan(0.004);
    for (let lat = 62; lat <= 69; lat += 1.5) expect(dist(-141, lat), `141W ${lat}`).toBeLessThan(0.004);
  });
});

describe("graticuleSegments", () => {
  it("is built from whole segments", () => {
    expect(graticuleSegments(15, 3).length % 6).toBe(0);
  });
});

const route: GlobeRoute = {
  id: "r",
  title: "R",
  points: [
    { lat: 21.03, lon: 105.85 },
    { lat: 16.46, lon: 107.59 },
    { lat: 10.82, lon: 106.63 },
  ],
};

describe("routeBuffers", () => {
  const b = routeBuffers(route);
  it("duplicates the stroke four times with matching buffer sizes", () => {
    const vertices = b.position.length / 3;
    expect(b.distance.length).toBe(vertices);
    expect(b.offset.length).toBe(vertices * 2);
    expect(vertices % 8).toBe(0);
    expect(b.length).toBeGreaterThan(0);
  });
  it("uses exactly the four 1px offsets", () => {
    const set = new Set<string>();
    for (let i = 0; i < b.offset.length; i += 2) set.add(`${b.offset[i]},${b.offset[i + 1]}`);
    expect([...set].sort()).toEqual(["0,0", "0,1", "1,0", "1,1"]);
  });
});

describe("route membership", () => {
  it("recognises stops by coordinates and nothing else", () => {
    expect(isRouteStop(route, { lat: 16.46, lon: 107.59 })).toBe(true);
    expect(isRouteStop(route, { lat: 16.46, lon: 107.6 })).toBe(false);
  });
  it("a route is shown only for a selected stop: the routes through the place, none for any other place or no selection", () => {
    const hue = { slug: "hue", name: "Hue", lat: 16.46, lon: 107.59, labelPriority: 1 };
    const paris = { slug: "paris", name: "Paris", lat: 48.86, lon: 2.35, labelPriority: 1 };
    const other = { id: "o", title: "o", points: [{ lat: 16.46, lon: 107.59 }, { lat: 1, lon: 2 }] };
    expect(routesForPlace([route], hue).map((r) => r.id)).toEqual(["r"]);
    expect(routesForPlace([route, other], hue).map((r) => r.id)).toEqual(["r", "o"]);
    expect(routesForPlace([route], paris)).toEqual([]);
    expect(routesForPlace([route], undefined)).toEqual([]);
  });
});
