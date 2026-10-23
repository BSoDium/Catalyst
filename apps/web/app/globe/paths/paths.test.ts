import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodePolyline5 as schemaDecode, encodePolyline5 as schemaEncode } from "@catalyst/schemas";
import { parsePublishedProjection } from "@catalyst/schemas";
import type { GlobeRoute } from "../types";
import { lonLatToVec3 } from "../engine/geo";
import { FADE_FROM_CELLS, FADE_FULL_CELLS, LEVEL_HYSTERESIS, fadeLevel, levelFor, metresPerCell } from "./lod";
import { LEG_MODES, MODE_STYLE, RAIL_TICK_DASH, dashArray } from "./modes";
import { ARC_STEP_DEG, LOD_TOLERANCES_M, arcPoints, buildBuffers, buildNetwork, legsAt, pathLengthM, placeKey } from "./network";
import { decodePolyline5, encodePolyline5 } from "./polyline";
import { EARTH_RADIUS_M, simplify } from "./simplify";

const A = { lat: 48.0, lon: 2.0 };
const B = { lat: 48.5, lon: 2.1 };
const C = { lat: 48.9, lon: 2.4 };

/** A wiggly line from p to q with n points: lon, lat interleaved. */
function wiggle(p: { lat: number; lon: number }, q: { lat: number; lon: number }, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    out.push(p.lon + (q.lon - p.lon) * t + 0.01 * Math.sin(t * 40) * Math.sin(Math.PI * t), p.lat + (q.lat - p.lat) * t);
  }
  return out;
}

describe("polyline codec (the client's copy)", () => {
  it("round-trips lon/lat order at 5 decimals", () => {
    const pts = [2.35, 48.86, 2.3512, 48.8601, 14.5, 46.05];
    expect(Array.from(decodePolyline5(encodePolyline5(pts))!)).toEqual(pts);
  });
  it("agrees with the contract's reference codec on the worked example and on a wiggle", () => {
    const ref = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";
    const mine = decodePolyline5(ref)!;
    const theirs = schemaDecode(ref)!;
    expect(Array.from(mine)).toEqual(theirs.flatMap(([lat, lon]) => [lon, lat]));
    const w = wiggle(A, B, 200).map((v) => Math.round(v * 1e5) / 1e5);
    const enc = encodePolyline5(w);
    const latLon = Array.from({ length: w.length / 2 }, (_, i) => [w[i * 2 + 1]!, w[i * 2]!] as [number, number]);
    expect(enc).toBe(schemaEncode(latLon));
  });
  it("returns null for garbage and for a single point", () => {
    expect(decodePolyline5("!!")).toBeNull();
    expect(decodePolyline5("_p~iF")).toBeNull();
    expect(decodePolyline5(encodePolyline5([1, 1]))).toBeNull();
  });
});

describe("simplify (Douglas-Peucker on the sphere, metres)", () => {
  const toXyz = (lonlat: number[]) => {
    const out = new Float64Array((lonlat.length / 2) * 3);
    for (let i = 0; i < lonlat.length / 2; i++) {
      const v = lonLatToVec3(lonlat[i * 2]!, lonlat[i * 2 + 1]!);
      out.set([v[0] * EARTH_RADIUS_M, v[1] * EARTH_RADIUS_M, v[2] * EARTH_RADIUS_M], i * 3);
    }
    return out;
  };
  it("keeps both ends and drops what is within tolerance of the chord", () => {
    const xyz = toXyz([0, 0, 0.001, 0, 0.002, 0, 0.003, 0, 0.004, 0]);
    expect(Array.from(simplify(xyz, 10))).toEqual([0, 4]);
  });
  it("keeps a corner", () => {
    const xyz = toXyz([0, 0, 0.05, 0, 0.1, 0, 0.1, 0.05, 0.1, 0.1]);
    expect(Array.from(simplify(xyz, 100))).toEqual([0, 2, 4]);
  });
  it("never leaves a dropped point farther than the tolerance from the result", () => {
    const lonlat = wiggle(A, C, 600);
    const xyz = toXyz(lonlat);
    for (const tol of [20, 320, 5120]) {
      const keep = simplify(xyz, tol);
      for (let k = 0; k < keep.length - 1; k++) {
        const a = keep[k]!, b = keep[k + 1]!;
        for (let p = a + 1; p < b; p++) {
          // distance of p to segment a-b
          const ax = xyz[a * 3]!, ay = xyz[a * 3 + 1]!, az = xyz[a * 3 + 2]!;
          const dx = xyz[b * 3]! - ax, dy = xyz[b * 3 + 1]! - ay, dz = xyz[b * 3 + 2]! - az;
          const px = xyz[p * 3]! - ax, py = xyz[p * 3 + 1]! - ay, pz = xyz[p * 3 + 2]! - az;
          const t = Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / (dx * dx + dy * dy + dz * dz)));
          expect(Math.hypot(px - dx * t, py - dy * t, pz - dz * t)).toBeLessThanOrEqual(tol + 1e-6);
        }
      }
    }
  });
  it("a coarser level is a subset of a finer one, and the counts only fall", () => {
    const xyz = toXyz(wiggle(A, C, 800));
    let prev = simplify(xyz, LOD_TOLERANCES_M[0]);
    for (const tol of LOD_TOLERANCES_M.slice(1)) {
      const next = simplify(xyz, tol, prev);
      expect(next.length).toBeLessThanOrEqual(prev.length);
      const set = new Set(prev);
      for (const i of next) expect(set.has(i)).toBe(true);
      prev = next;
    }
  });
  it("a long straight chord is not allowed to sink under the surface: it is split where its sag passes the tolerance", () => {
    // 4000 points along the equator, 90 degrees: at 5 km tolerance a chord is at most about 2 * sqrt(2 R tol) = 16 km
    const lonlat: number[] = [];
    for (let i = 0; i <= 900; i++) lonlat.push(i * 0.1, 0);
    const keep = simplify(toXyz(lonlat), 5120);
    const longest = Math.max(...Array.from(keep).slice(1).map((v, k) => (v - keep[k]!) * 0.1));
    expect(longest * 111_195).toBeLessThan(2 * Math.sqrt(2 * EARTH_RADIUS_M * 5120) * 1.05);
  });
});

describe("arcs", () => {
  it("run from stop to stop, at most the step apart, lifted in the middle only", () => {
    const { lonlat, lift, omega } = arcPoints({ lat: 0, lon: 0 }, { lat: 0, lon: 90 });
    expect(omega).toBeCloseTo(Math.PI / 2, 6);
    expect(lonlat.length / 2).toBe(Math.ceil(90 / ARC_STEP_DEG) + 1);
    expect(Array.from(lonlat.slice(0, 2))).toEqual([0, 0]);
    expect(Array.from(lonlat.slice(-2))).toEqual([90, 0]);
    expect(lift[0]).toBe(0);
    expect(lift[lift.length - 1]).toBeCloseTo(0, 6);
    expect(Math.max(...lift)).toBeCloseTo(0.12 * omega, 3);
  });
  it("a path length is the sum of great-circle steps", () => {
    expect(pathLengthM([0, 0, 0, 1])).toBeCloseTo((Math.PI / 180) * EARTH_RADIUS_M, 0);
  });
});

describe("network and buffers", () => {
  const poly = encodePolyline5(wiggle(A, B, 300));
  const route: GlobeRoute = {
    id: "r",
    title: "R",
    points: [A, B, C],
    legs: [{ mode: "road", polyline: poly }, { mode: "flight" }],
  };
  const net = buildNetwork([route]);

  it("a mount with the same routes takes the network and the buffers the page already built (the loader's array is a new object each time it revalidates)", () => {
    const again = buildNetwork(JSON.parse(JSON.stringify([route])) as GlobeRoute[]); // same content, a different array of different objects
    expect(again).toBe(net);
    expect(buildNetwork([route])).toBe(net);
    expect(buildBuffers(again)).toBe(buildBuffers(net));
    // another content is another network: a moved stop, another mode, another polyline
    expect(buildNetwork([{ ...route, points: [A, B, { ...C, lat: C.lat + 0.001 }] }])).not.toBe(net);
    expect(buildNetwork([{ ...route, legs: [{ mode: "rail", polyline: poly }, { mode: "flight" }] }])).not.toBe(net);
    expect(buildNetwork([{ ...route, legs: [{ mode: "road", polyline: encodePolyline5(wiggle(A, B, 200)) }, { mode: "flight" }] }])).not.toBe(net);
    expect(buildNetwork([route, { ...route, id: "s" }])).not.toBe(net);
  });

  it("one leg per consecutive pair, polylines decoded once, arcs for the rest", () => {
    expect(net.legs.map((l) => [l.mode, l.arc])).toEqual([["road", false], ["flight", true]]);
    expect(net.legs[0]!.lonlat.length / 2).toBe(300);
    expect(net.legs[1]!.lift.some((v) => v > 0)).toBe(true);
    expect(net.legs[0]!.lift.every((v) => v === 0)).toBe(true);
    expect(net.points).toBe(300 + net.legs[1]!.lonlat.length / 2);
  });
  it("a flight carrying a polyline is still an arc, and an unknown mode becomes `unknown`", () => {
    const n = buildNetwork([{ id: "x", title: "x", points: [A, B, C], legs: [{ mode: "flight", polyline: poly }, { mode: "teleport" as never }] }]);
    expect(n.legs[0]!.arc).toBe(true);
    expect(n.legs[1]!.mode).toBe("unknown");
  });
  it("routes without legs are arcs of unknown mode (as the curated routes always were)", () => {
    const n = buildNetwork([{ id: "x", title: "x", points: [A, B, C] }]);
    expect(n.legs.map((l) => [l.mode, l.arc])).toEqual([["unknown", true], ["unknown", true]]);
  });
  it("a repeated stop makes no leg, and a bad polyline falls back to the arc", () => {
    const n = buildNetwork([{ id: "x", title: "x", points: [A, A, B], legs: [{ mode: "road" }, { mode: "rail", polyline: "!!" }] }]);
    expect(n.legs).toHaveLength(1);
    expect(n.legs[0]!.arc).toBe(true);
    expect(n.legs[0]!.mode).toBe("rail");
  });
  it("finds the legs at a place, with the way the draw-on runs", () => {
    expect(legsAt(net, placeKey(B.lat, B.lon))).toEqual([{ leg: 0, dir: "rev" }, { leg: 1, dir: "fwd" }]);
    expect(legsAt(net, placeKey(A.lat, A.lon))).toEqual([{ leg: 0, dir: "fwd" }]);
    expect(legsAt(net, placeKey(1, 1))).toEqual([]);
  });
  it("levels are nested subsets that keep the ends", () => {
    for (const leg of net.legs) {
      let prev = new Set(leg.levels[0]);
      const n = leg.lonlat.length / 2;
      for (const lv of leg.levels) {
        expect(lv[0]).toBe(0);
        expect(lv[lv.length - 1]).toBe(n - 1);
        for (const i of lv) expect(prev.has(i)).toBe(true);
        prev = new Set(lv);
      }
    }
  });
  it("buffers: shared vertices, one index range per level, mode and leg ids in the vertex", () => {
    const b = buildBuffers(net);
    expect(b.vertexCount).toBe(net.points);
    expect(b.levels).toHaveLength(LOD_TOLERANCES_M.length);
    let at = 0;
    for (const [k, l] of b.levels.entries()) {
      expect(l.start).toBe(at);
      at += l.count;
      const segs = net.legs.reduce((s, leg) => s + leg.levels[k]!.length - 1, 0);
      expect(l.count).toBe(segs * 2);
    }
    expect(b.index.length).toBe(at);
    expect(Math.max(...b.index)).toBeLessThan(b.vertexCount);
    // the vertex of the first point of leg 1
    const v0 = net.legs[0]!.lonlat.length / 2;
    expect(b.info[v0 * 4]).toBe(1);
    expect(b.info[v0 * 4 + 1]).toBe(MODE_STYLE.flight.id);
    expect(b.info[v0 * 4 + 3]).toBe(net.legs[1]!.palette);
    expect(b.dist[0]).toBe(0);
    expect(b.dist[v0 - 1]).toBeCloseTo(net.legs[0]!.lengthM / EARTH_RADIUS_M, 5);
    // lifted arcs sit above the unit sphere, ground legs on it
    const r = (i: number) => Math.hypot(b.position[i * 3]!, b.position[i * 3 + 1]!, b.position[i * 3 + 2]!);
    expect(r(5)).toBeCloseTo(1, 5);
    expect(Math.max(...Array.from({ length: net.legs[1]!.lonlat.length / 2 }, (_, k) => r(v0 + k)))).toBeGreaterThan(1.0005);
  });
});

describe("level of detail and fade", () => {
  it("picks the coarsest level whose error is under half an art pixel", () => {
    expect(levelFor(10, null)).toBe(0); // 5 m per half cell: even the finest is over it
    expect(levelFor(1000, null)).toBe(2); // 500 m: 320 fits, 1280 does not
    expect(levelFor(1_000_000, null)).toBe(LOD_TOLERANCES_M.length - 1);
  });
  it("has a hysteresis: a zoom that hovers at a boundary does not flip between two levels", () => {
    const boundary = (2 * LOD_TOLERANCES_M[2]!); // mPerCell at which level 2 starts being the plain answer
    let level = levelFor(boundary * 1.01, null);
    expect(level).toBe(2);
    const seen = new Set<number>();
    for (let i = 0; i < 100; i++) {
      level = levelFor(boundary * (1 + 0.1 * Math.sin(i / 3)), level); // +-10 % around it
      seen.add(level);
    }
    expect(seen.size).toBe(1);
    // ... but a real move does change level, both ways
    expect(levelFor(boundary * LEVEL_HYSTERESIS * 12, 2)).toBeGreaterThan(2);
    expect(levelFor(boundary / (LEVEL_HYSTERESIS * 3), 2)).toBeLessThan(2);
  });
  it("hides short legs and steps the rest in through the palette levels", () => {
    expect(fadeLevel(0.5, 9)).toBe(0);
    expect(fadeLevel(FADE_FROM_CELLS, 9)).toBe(0);
    expect(fadeLevel(FADE_FROM_CELLS + 0.01, 9)).toBe(1);
    expect(fadeLevel(FADE_FULL_CELLS, 9)).toBe(9);
    expect(fadeLevel(500, 9)).toBe(9);
    let last = 0;
    for (let c = 0; c < 30; c += 0.1) {
      const l = fadeLevel(c, 9);
      expect(l).toBeGreaterThanOrEqual(last);
      last = l;
    }
  });
  it("a 300 km leg is hidden on the world view and full on a regional one", () => {
    const world = metresPerCell(512 / (2 * Math.PI), 2.5); // zoom 0
    expect(300_000 / world).toBeLessThan(FADE_FROM_CELLS);
    const regional = metresPerCell((512 * 2 ** 4) / (2 * Math.PI), 2.5); // zoom 4
    expect(300_000 / regional).toBeGreaterThan(FADE_FULL_CELLS);
  });
});

describe("mode styles", () => {
  it("has one entry per mode with distinct ids, in the order of the buffer ids", () => {
    expect(LEG_MODES.map((m) => MODE_STYLE[m].id)).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it("road is solid, rail is 4 on 2 off with a tick every 6, the dotted ones are at least 1.42 cells", () => {
    expect(dashArray("road")).toBeUndefined();
    expect(dashArray("rail")).toEqual([4, 2]);
    expect(MODE_STYLE.rail.tick).toBe(true);
    for (const m of ["ferry", "flight", "walk"] as const) expect(MODE_STYLE[m].on).toBeGreaterThanOrEqual(1.42);
    expect(RAIL_TICK_DASH.reduce((a, b) => a + b, 0) * 3).toBeCloseTo(MODE_STYLE.rail.period);
  });
});

describe("the demo fixture", () => {
  it("decodes into a network of every mode with endpoints on the stops", () => {
    const demo = parsePublishedProjection(JSON.parse(readFileSync(new URL("../../../../../packages/published/fixtures/demo.json", import.meta.url), "utf8")));
    const bySlug = new Map(demo.places.map((p) => [p.slug, p]));
    const routes: GlobeRoute[] = demo.routes.map((r) => ({
      id: r.id,
      title: r.title,
      points: r.stops.map((s) => ({ lat: bySlug.get(s)!.coordinates.lat, lon: bySlug.get(s)!.coordinates.lon })),
      ...(r.legs ? { legs: r.legs.map((l) => ({ mode: l.mode, ...(l.polyline ? { polyline: l.polyline } : {}) })) } : {}),
    }));
    const n = buildNetwork(routes);
    expect(new Set(n.legs.map((l) => l.mode))).toEqual(new Set(LEG_MODES));
    const b = buildBuffers(n);
    expect(b.levels[0]!.count).toBeGreaterThan(b.levels[4]!.count);
    // the coarsest level of every polyline leg keeps far fewer points than the finest
    const poly = n.legs.filter((l) => !l.arc);
    for (const leg of poly) expect(leg.levels[4]!.length).toBeLessThanOrEqual(leg.levels[0]!.length);
    const fine = poly.reduce((s, l) => s + l.levels[0]!.length, 0);
    const coarse = poly.reduce((s, l) => s + l.levels[4]!.length, 0);
    expect(coarse).toBeLessThan(fine / 4);
  });
});
