import { describe, expect, it } from "vitest";
import type { Polylines } from "@catalyst/geodata";
import type { GlobeRoute } from "../types";
import { graticuleSegments, isRouteStop, polylinesToSegments, routeBuffers, routeForPlace } from "./geometry";

describe("polylinesToSegments", () => {
  it("emits one segment per consecutive vertex pair and never joins separate lines", () => {
    const p: Polylines = {
      positions: Float32Array.from([0, 0, 10, 0, 20, 0, 50, 10, 60, 10]),
      offsets: Uint32Array.from([0, 3, 5]),
    };
    const seg = polylinesToSegments(p, 1);
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
  it("finds the route of a place, or null", () => {
    const hue = { slug: "hue", name: "Hue", lat: 16.46, lon: 107.59, labelPriority: 1 };
    const paris = { slug: "paris", name: "Paris", lat: 48.86, lon: 2.35, labelPriority: 1 };
    expect(routeForPlace([route], hue)?.id).toBe("r");
    expect(routeForPlace([route], paris)).toBeNull();
    expect(routeForPlace([route], undefined)).toBeNull();
  });
});
