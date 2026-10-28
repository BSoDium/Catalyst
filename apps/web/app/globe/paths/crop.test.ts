import { describe, expect, it } from "vitest";
import type { GlobeRoute } from "../types";
import { legFeatures } from "./leg-features";
import { arcPoints, buildNetwork } from "./network";
import { cropToBoxes, type CropBox } from "./crop";

// A box 2 x 2 degrees around (10, 10): west 9, south 9, east 11, north 11.
const BOX: CropBox = [9, 9, 11, 11];
const pts = (...p: [number, number][]) => Float64Array.from(p.flat());

describe("cropToBoxes", () => {
  it("cuts a path that starts in the box exactly on the edge it leaves through", () => {
    const r = cropToBoxes(pts([10, 10], [12, 10], [14, 10]), null, BOX)!;
    expect(Array.from(r.lonlat)).toEqual([11, 10, 12, 10, 14, 10]);
  });
  it("cuts the end that arrives in the box", () => {
    const r = cropToBoxes(pts([0, 10], [10, 10]), null, undefined, BOX)!;
    expect(Array.from(r.lonlat)).toEqual([0, 10, 9, 10]);
  });
  it("cuts both ends, through the top and the west edge", () => {
    const r = cropToBoxes(pts([10, 10], [10, 20], [30, 20], [30, 30], [50, 30], [10, 30], [10, 5]), null, BOX, [20, 28, 60, 32])!;
    expect(r.lonlat[0]).toBe(10);
    expect(r.lonlat[1]).toBe(11); // north edge, exact
    expect(r.lonlat.length).toBeGreaterThan(4);
  });
  it("leaves a corner exit on the corner", () => {
    const r = cropToBoxes(pts([10, 10], [12, 12]), null, BOX)!;
    expect(r.lonlat[0]).toBe(11);
    expect(r.lonlat[1]).toBe(11);
  });
  it("is idempotent, and leaves a path that already ends on the edge alone (the roads the repository cut)", () => {
    const once = cropToBoxes(pts([10, 10], [14, 10]), null, BOX)!;
    const twice = cropToBoxes(once.lonlat, null, BOX)!;
    expect(Array.from(twice.lonlat)).toEqual(Array.from(once.lonlat));
    const onEdge = pts([11, 10], [14, 10]);
    expect(Array.from(cropToBoxes(onEdge, null, BOX)!.lonlat)).toEqual(Array.from(onEdge));
    const justOutside = pts([11.00001, 10], [14, 10]);
    expect(Array.from(cropToBoxes(justOutside, null, BOX)!.lonlat)).toEqual(Array.from(justOutside));
  });
  it("leaves an end alone when it is not inside its box (a recorded point outside the box, no box at all)", () => {
    const p = pts([20, 20], [30, 20]);
    expect(Array.from(cropToBoxes(p, null, BOX)!.lonlat)).toEqual(Array.from(p));
    expect(Array.from(cropToBoxes(p, null)!.lonlat)).toEqual(Array.from(p));
  });
  it("draws nothing when no part of the path is outside the box", () => {
    expect(cropToBoxes(pts([10, 10], [10.5, 10.5]), null, BOX)).toBeNull();
    expect(cropToBoxes(pts([10, 10], [10.5, 10.5]), null, undefined, BOX)).toBeNull();
    // two boxes that overlap: the path between them is wholly inside one or the other
    expect(cropToBoxes(pts([10, 10], [10.8, 10]), null, BOX, [10.4, 9, 12, 11])).toBeNull();
  });
  it("finds the edge across the antimeridian", () => {
    const box: CropBox = [179, -1, 180, 1];
    const r = cropToBoxes(pts([179.5, 0], [-179, 0], [-170, 0]), null, box)!;
    expect(r.lonlat[0]).toBe(180);
    expect(r.lonlat[1]).toBeCloseTo(0, 12);
    expect(r.lonlat[2]).toBe(-179);
  });
  it("sets a cut lifted arc down on the ground at the edge and keeps its arch", () => {
    const a = arcPoints({ lat: 10, lon: 10 }, { lat: 10, lon: 40 });
    const r = cropToBoxes(a.lonlat, a.lift, BOX)!;
    expect(r.lonlat[0]).toBe(11);
    expect(r.lift[0]).toBe(0);
    expect(r.lift[r.lift.length - 1]).toBe(0);
    const mid = r.lift[Math.floor(r.lift.length / 2)]!;
    expect(mid).toBeGreaterThan(0);
    expect(Math.max(...r.lift)).toBeLessThanOrEqual(Math.max(...a.lift) + 1e-9);
    expect(Math.min(...r.lift)).toBeGreaterThanOrEqual(0);
  });
});

const route = (mode: "road" | "rail" | "ferry" | "flight" | "walk" | "unknown", boxes: GlobeRoute["boxes"]): GlobeRoute => ({
  id: `r-${mode}`,
  title: mode,
  points: [{ lat: 10, lon: 10 }, { lat: 10, lon: 40 }],
  legs: [{ mode }],
  ...(boxes ? { boxes } : {}),
});
const BOXES: GlobeRoute["boxes"] = [BOX, [39, 9, 41, 11]];

describe("every mode is cropped to the boxes of its stops", () => {
  for (const mode of ["road", "rail", "ferry", "flight", "walk", "unknown"] as const) {
    it(`${mode}: the globe's leg ends on both edges`, () => {
      const leg = buildNetwork([route(mode, BOXES)]).legs[0]!;
      const n = leg.lonlat.length / 2;
      expect(leg.lonlat[0]).toBe(11);
      expect(leg.lonlat[n * 2 - 2]).toBe(39);
      expect(leg.lift[0]).toBe(0);
      expect(leg.lift[n - 1]).toBe(0);
    });
    it(`${mode}: the street map's feature ends on both edges`, () => {
      const [feature] = legFeatures([route(mode, BOXES)]).features;
      const line = feature!.geometry.coordinates[0]!;
      expect(line[0]![0]).toBe(11);
      expect(line[line.length - 1]![0]).toBe(39);
    });
  }
  it("a route without boxes is drawn as before, and a box change is a different network", () => {
    const plain = buildNetwork([route("flight", undefined)]).legs[0]!;
    expect(plain.lonlat[0]).toBe(10);
    const cut = buildNetwork([route("flight", BOXES)]).legs[0]!;
    expect(cut.lengthM).toBeLessThan(plain.lengthM);
  });
  it("a leg that stays in its boxes is not drawn", () => {
    const r = route("rail", [[0, 0, 50, 50], undefined]);
    expect(buildNetwork([r]).legs).toHaveLength(0);
    expect(legFeatures([r]).features).toHaveLength(0);
  });
});
