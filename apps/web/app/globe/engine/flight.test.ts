import { describe, expect, it } from "vitest";
import { FLIGHT, flightPose, type FlightEnd, type FlightWord } from "./flight";
import { lonLatToVec3, viewBasis } from "./geo";

const end: FlightEnd = { lon: 12, lat: 20, alt: 2.4, roll: (12 * Math.PI) / 180 };
const len = (a: readonly number[]) => Math.hypot(a[0]!, a[1]!, a[2]!);
/** A word on the shell at the equator, its middle going from 110 degrees east of the page's meridian to the meridian, with half a span of 40 degrees. */
const word: FlightWord = (u) => {
  const e = u * u * (3 - 2 * u);
  const lon = end.lon + 110 * (1 - e);
  const at = (l: number): [number, number, number] => {
    const p = lonLatToVec3(l, 0);
    return [p[0] * 2, p[1] * 2, p[2] * 2];
  };
  return { centre: at(lon), lead: at(lon - 40) };
};
const angleTo = (u: number, to: (w: NonNullable<ReturnType<FlightWord>>) => number[]): number => {
  const p = flightPose(u, end, word);
  const w = word(u)!;
  const t = to(w);
  const f = [p.target[0] - p.pos[0], p.target[1] - p.pos[1], p.target[2] - p.pos[2]];
  const d = [t[0]! - p.pos[0], t[1]! - p.pos[1], t[2]! - p.pos[2]];
  return Math.acos(Math.min(1, (f[0]! * d[0]! + f[1]! * d[1]! + f[2]! * d[2]!) / (len(f) * len(d)))) * (180 / Math.PI);
};

describe("the camera's flight", () => {
  const b = viewBasis({ lon: end.lon, lat: end.lat, zoom: 0, roll: end.roll }, 900);
  for (const [name, u] of [["ends on", 1], ["starts on", 0]] as const) {
    it(`${name} exactly the camera the page draws without a flight: the orbit camera's position, looking at the centre, with the same up`, () => {
      const p = flightPose(u, end, word);
      for (let i = 0; i < 3; i++) {
        expect(p.pos[i]).toBeCloseTo(b.c[i]! * (1 + end.alt), 9);
        expect(p.target[i]).toBeCloseTo(0, 9);
        expect(p.up[i]).toBeCloseTo(b.north[i]!, 9);
      }
    });
  }
  it("is over Greece at its first key, looking at the word's LEADING end, with the earth below the line of sight", () => {
    const k = FLIGHT.keys[0]!;
    const p = flightPose(k.u, end, word);
    expect(len(p.pos) - 1).toBeCloseTo(k.alt, 6);
    expect(p.lon).toBeCloseTo(k.lon, 6);
    expect(p.lat).toBeCloseTo(k.lat, 6);
    // aimed at the leading end, the camera pitched down from it by the key's pitch
    expect(angleTo(k.u, (w) => w.lead)).toBeCloseTo(k.pitch, 4);
    // the line of sight is above the horizon's dip: the earth is under it (the planet fills the lower part of the frame)
    const f = [p.target[0] - p.pos[0], p.target[1] - p.pos[1], p.target[2] - p.pos[2]];
    const c = [p.pos[0] / len(p.pos), p.pos[1] / len(p.pos), p.pos[2] / len(p.pos)];
    const dip = Math.asin(-(f[0]! * c[0]! + f[1]! * c[1]! + f[2]! * c[2]!) / len(f)) * (180 / Math.PI);
    const horizon = Math.acos(1 / len(p.pos)) * (180 / Math.PI);
    expect(dip).toBeLessThan(horizon + 5); // (aimed at or above the horizon, give or take: the earth is below the middle of the picture)
  });
  it("has the horizon level at the start: up is (nearly) the local vertical, so the earth is below the line of sight", () => {
    const k = FLIGHT.keys[0]!;
    const p = flightPose(k.u, end, word);
    const c = [p.pos[0] / len(p.pos), p.pos[1] / len(p.pos), p.pos[2] / len(p.pos)];
    // (the roll of a few degrees tips it off the vertical a little)
    expect(p.up[0]! * c[0]! + p.up[1]! * c[1]! + p.up[2]! * c[2]!).toBeGreaterThan(0.8);
  });
  it("keeps the word in the picture all the way: the look is never far from its middle (the picture is 37 degrees tall and 59 wide), and at the start it is on its leading end", () => {
    for (let u = FLIGHT.keys[0]!.u; u <= 0.8; u += 0.02) expect(angleTo(u, (w) => w.centre)).toBeLessThan(45);
    expect(angleTo(FLIGHT.keys[0]!.u, (w) => w.lead)).toBeLessThan(FLIGHT.keys[0]!.pitch + 0.1);
  });
  it("looks at the word, not at the planet, until the last stretch, where it settles on the planet's centre", () => {
    for (const u of [0.1, 0.3, 0.55]) expect(angleTo(u, (w) => w.centre)).toBeLessThan(angleTo(u, () => [0, 0, 0]));
    expect(len(flightPose(0.97, end, word).target)).toBeLessThan(len(flightPose(0.6, end, word).target));
  });
  it("climbs and goes west through the Mediterranean in order: Greece, then Italy, then Spain", () => {
    const lons = FLIGHT.keys.map((k) => flightPose(k.u, end, word).lon);
    for (let i = 1; i < lons.length; i++) expect(lons[i]).toBeLessThan(lons[i - 1]!);
    let last = 0;
    for (let u = FLIGHT.keys[0]!.u; u <= 1; u += 0.02) {
      const alt = len(flightPose(u, end, word).pos) - 1;
      expect(alt).toBeGreaterThanOrEqual(last - 0.02);
      last = alt;
    }
  });
  it("takes the short way round to the page's longitude, whatever it is", () => {
    for (const lon of [-170, -90, 0, 90, 170]) {
      let prev = flightPose(0, { ...end, lon }, word).lon;
      for (let u = 0.01; u <= 1; u += 0.01) {
        const now = flightPose(u, { ...end, lon }, word).lon;
        expect(Math.abs(now - prev)).toBeLessThan(40);
        prev = now;
      }
    }
  });
  it("is smooth: no step of the camera between two close instants is large, and there is a pose without a word", () => {
    let prev = flightPose(0, end, word).pos;
    for (let u = 0.001; u <= 1; u += 0.001) {
      const p = flightPose(u, end, word).pos;
      expect(Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2])).toBeLessThan(0.08);
      prev = p;
    }
    expect(len(flightPose(0.3, end, null).pos)).toBeGreaterThan(1); // (no word: the camera still flies, looking at the centre, pitched)
  });
});
