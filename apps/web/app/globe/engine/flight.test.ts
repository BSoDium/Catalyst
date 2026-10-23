import { describe, expect, it } from "vitest";
import { FLIGHT, flightPose, type FlightEnd } from "./flight";
import { viewBasis } from "./geo";

const end: FlightEnd = { lon: 12, lat: 20, alt: 2.4, roll: (12 * Math.PI) / 180 };
const len = (a: readonly number[]) => Math.hypot(a[0]!, a[1]!, a[2]!);

describe("the camera's flight", () => {
  it("ends on exactly the camera the page draws without a flight: the orbit camera's position, looking at the centre, with the same up", () => {
    const p = flightPose(1, end);
    const b = viewBasis({ lon: end.lon, lat: end.lat, zoom: 0, roll: end.roll }, 900);
    for (let i = 0; i < 3; i++) {
      expect(p.pos[i]).toBeCloseTo(b.c[i]! * (1 + end.alt), 9);
      expect(p.target[i]).toBeCloseTo(0, 9);
      expect(p.up[i]).toBeCloseTo(b.north[i]!, 9);
    }
  });
  it("starts on the same camera (the page's own), so that nothing jumps when the interlude begins", () => {
    const p = flightPose(0, end);
    const b = viewBasis({ lon: end.lon, lat: end.lat, zoom: 0, roll: end.roll }, 900);
    for (let i = 0; i < 3; i++) {
      expect(p.pos[i]).toBeCloseTo(b.c[i]! * (1 + end.alt), 9);
      expect(p.target[i]).toBeCloseTo(0, 9);
      expect(p.up[i]).toBeCloseTo(b.north[i]!, 9);
    }
  });
  it("is low over Greece at its first key, looking along the ground, and climbs after it", () => {
    const k = FLIGHT.keys[0]!;
    const p = flightPose(k.u, end);
    expect(len(p.pos) - 1).toBeCloseTo(k.alt, 6);
    expect(p.lon).toBeCloseTo(k.lon, 6);
    expect(p.lat).toBeCloseTo(k.lat, 6);
    // looking at the ground: the target is on the surface
    expect(len(p.target)).toBeCloseTo(1, 6);
    // the line of sight looks well ahead, not down at the ground
    const f = [p.target[0] - p.pos[0], p.target[1] - p.pos[1], p.target[2] - p.pos[2]];
    const c = [p.pos[0] / len(p.pos), p.pos[1] / len(p.pos), p.pos[2] / len(p.pos)];
    const cos = (f[0]! * c[0]! + f[1]! * c[1]! + f[2]! * c[2]!) / len(f);
    expect(Math.abs(cos)).toBeLessThan(0.55); // (about 30 degrees below level: the horizon in the upper part of the frame)
    let last = 0;
    for (let u = k.u; u <= 1; u += 0.02) {
      const alt = len(flightPose(u, end).pos) - 1;
      expect(alt).toBeGreaterThanOrEqual(last - 0.02); // (it climbs; the spline may dip a hair between keys, not more)
      last = alt;
    }
  });
  it("goes through the Mediterranean in order: Greece, then Italy, then Spain, west all the way", () => {
    const lons = FLIGHT.keys.map((k) => flightPose(k.u, end).lon);
    for (let i = 1; i < lons.length; i++) expect(lons[i]).toBeLessThan(lons[i - 1]!);
  });
  it("takes the short way round to the page's longitude, whatever it is", () => {
    for (const lon of [-170, -90, 0, 90, 170]) {
      let prev = flightPose(0, { ...end, lon }).lon;
      for (let u = 0.01; u <= 1; u += 0.01) {
        const now = flightPose(u, { ...end, lon }).lon;
        expect(Math.abs(now - prev)).toBeLessThan(40); // (no jump of a turn: the path is continuous)
        prev = now;
      }
    }
  });
  it("is smooth: no step of the camera between two close instants is large", () => {
    let prev = flightPose(0, end).pos;
    for (let u = 0.001; u <= 1; u += 0.001) {
      const p = flightPose(u, end).pos;
      expect(Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2])).toBeLessThan(0.08);
      prev = p;
    }
  });
});
