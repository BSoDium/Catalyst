import { describe, expect, it } from "vitest";
import type { GlobeRoute } from "../types";
import { airportsOf, legEnds } from "./airports";
import { buildNetwork, legLengthM } from "./network";
import { legFeatures } from "./leg-features";

const A = { lat: 43.61, lon: 1.44 };
const B = { lat: 53.9, lon: 27.56 };
const TLS = { name: "Toulouse-Blagnac", code: "TLS", lat: 43.629, lon: 1.364 };
const MSQ = { name: "Minsk National", code: "MSQ", lat: 53.8825, lon: 28.0307 };
const boxA: [number, number, number, number] = [1.25, 43.469, 1.64, 43.741];

const route = (legs: GlobeRoute["legs"], boxes?: GlobeRoute["boxes"]): GlobeRoute => ({ id: "r", title: "R", points: [A, B], legs, ...(boxes ? { boxes } : {}) });

const boxB: [number, number, number, number] = [27.3, 53.7, 28.2, 54.1];
const boxFar: [number, number, number, number] = [27.3, 53.7, 27.8, 54.1]; // Minsk's box without the airport

describe("legEnds", () => {
  it("goes to the airports of a flight that lie in their stop's box, and does not crop there", () => {
    const e = legEnds(A, B, { mode: "flight", fromAirport: TLS, toAirport: MSQ }, { from: boxA, to: boxB });
    expect(e.from).toBe(TLS);
    expect(e.to).toBe(MSQ);
    expect([e.cropFrom, e.cropTo]).toEqual([false, false]);
  });
  it("ignores an airport outside its box, and one with no box: the arc ends at the box as it did", () => {
    const e = legEnds(A, B, { mode: "flight", fromAirport: TLS, toAirport: MSQ }, { from: undefined, to: boxFar });
    expect(e).toEqual({ from: A, to: B, cropFrom: true, cropTo: true });
    expect(legEnds(A, B, { mode: "flight", fromAirport: TLS })).toEqual({ from: A, to: B, cropFrom: true, cropTo: true });
  });
  it("is the stops, cropped, for a flight with no airport and for any other mode", () => {
    expect(legEnds(A, B, { mode: "flight" })).toEqual({ from: A, to: B, cropFrom: true, cropTo: true });
    expect(legEnds(A, B, { mode: "road", fromAirport: TLS }, { from: boxA })).toEqual({ from: A, to: B, cropFrom: true, cropTo: true });
    expect(legEnds(A, B, undefined)).toEqual({ from: A, to: B, cropFrom: true, cropTo: true });
  });
});

describe("airportsOf", () => {
  it("lists each airport once, flights only", () => {
    const r = route([{ mode: "flight", fromAirport: TLS, toAirport: MSQ }], [boxA, boxB]);
    const back: GlobeRoute = { ...r, id: "back", points: [B, A], boxes: [boxB, boxA], legs: [{ mode: "flight", fromAirport: MSQ, toAirport: TLS }] };
    expect(airportsOf([r, back])).toEqual([TLS, MSQ]);
    expect(airportsOf([route([{ mode: "rail", fromAirport: TLS }], [boxA, boxB])])).toEqual([]);
  });
  it("marks only the airports that lie in their city's box", () => {
    expect(airportsOf([route([{ mode: "flight", fromAirport: TLS, toAirport: MSQ }], [boxA, boxFar])])).toEqual([TLS]);
    expect(airportsOf([route([{ mode: "flight", fromAirport: TLS, toAirport: MSQ }])])).toEqual([]);
  });
});

describe("a flight between airports", () => {
  it("the globe's arc starts and ends at the airports, not cropped at the stop's box", () => {
    const net = buildNetwork([route([{ mode: "flight", fromAirport: TLS, toAirport: MSQ }], [boxA, boxB])]);
    const leg = net.legs[0]!;
    expect(leg.lonlat[0]).toBeCloseTo(TLS.lon, 4);
    expect(leg.lonlat[1]).toBeCloseTo(TLS.lat, 4);
    expect(leg.lonlat[leg.lonlat.length - 2]).toBeCloseTo(MSQ.lon, 4);
    expect(leg.lonlat[leg.lonlat.length - 1]).toBeCloseTo(MSQ.lat, 4);
  });
  it("without an airport the arc is cropped at the box, as it was", () => {
    const net = buildNetwork([route([{ mode: "flight" }], [boxA, undefined])]);
    const leg = net.legs[0]!;
    const inside = (lon: number, lat: number) => lon > boxA[0] && lon < boxA[2] && lat > boxA[1] && lat < boxA[3];
    expect(inside(leg.lonlat[0]!, leg.lonlat[1]!)).toBe(false);
  });
  it("the street map's feature and the length of the leg follow the airports too", () => {
    const r = route([{ mode: "flight", fromAirport: TLS, toAirport: MSQ }], [boxA, boxB]);
    const f = legFeatures([r]).features[0]!;
    const first = (f.geometry.coordinates[0] as number[][])[0]!;
    expect(first[0]).toBeCloseTo(TLS.lon, 4);
    expect(legLengthM(A, B, r.legs![0], { from: boxA, to: boxB })).not.toBeCloseTo(legLengthM(A, B, { mode: "flight" }), 0);
  });
});
