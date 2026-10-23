import { describe, expect, it } from "vitest";
import { eggX } from "./caption";
import { CINEMATIC } from "./cinematic";
import { FLIGHT, flightPose, type FlightEnd } from "./flight";
import { lonLatToVec3, viewBasis } from "./geo";

const end: FlightEnd = { lon: 0, lat: 8, alt: 3.4, roll: (12 * Math.PI / 180) };
const len = (a: readonly number[]) => Math.hypot(a[0]!, a[1]!, a[2]!);
const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const cross = (a: readonly number[], b: readonly number[]) => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
const sub = (a: readonly number[], b: readonly number[]) => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const unit = (a: readonly number[]) => a.map((x) => x / len(a));
const DEG = 180 / Math.PI;

/** The camera's forward, right and up at progress u. */
const frame = (u: number) => {
  const p = flightPose(u, end);
  const f = unit(sub(p.target, p.pos));
  const up = unit(p.up);
  return { p, f, up, right: unit(cross(f, up)) };
};
/** The word's middle and its ends at progress u: on the equator shell, the page at longitude 0, the interlude's own path from its start (138 degrees east). */
const wordAt = (u: number) => {
  const s = CINEMATIC.shape;
  const t = Math.max(0, u * (s.leaveMs + s.gapMs + s.enterMs) - s.leaveMs - s.gapMs);
  const lon = (eggX(t, (138 * Math.PI) / 180, s) * DEG) * CINEMATIC.side;
  const at = (l: number) => lonLatToVec3(l, 0).map((x) => x * CINEMATIC.radius);
  return { centre: at(lon), lead: at(lon - 42), trail: at(lon + 42) };
};
/** Where a point is in the picture: the angles to the right and up of the line of sight. */
const seen = (u: number, point: readonly number[]) => {
  const { p, f, up, right } = frame(u);
  const d = sub(point, p.pos);
  const z = dot(d, f);
  return { yaw: Math.atan2(dot(d, right), z) * DEG, pitch: Math.atan2(dot(d, up), z) * DEG, ahead: z > 0 };
};

describe("the camera's flight", () => {
  const b = viewBasis({ lon: end.lon, lat: end.lat, zoom: 0, roll: end.roll }, 900);
  for (const [name, u] of [["ends on", 1], ["starts on", 0]] as const) {
    it(`${name} exactly the camera the page draws without a flight: the orbit camera's position, looking at the centre, with the same up`, () => {
      const p = flightPose(u, end);
      for (let i = 0; i < 3; i++) {
        expect(p.pos[i]).toBeCloseTo(b.c[i]! * (1 + end.alt), 9);
        expect(p.target[i]).toBeCloseTo(0, 9);
        expect(p.up[i]).toBeCloseTo(b.north[i]!, 9);
      }
    });
  }
  it("is over Greece at its first key, the horizon level (up is the local vertical) and the earth below the line of sight", () => {
    const k = FLIGHT.keys[0]!;
    const { p, f, up } = frame(k.u);
    expect(len(p.pos) - 1).toBeCloseTo(k.alt, 6);
    expect(p.lon).toBeCloseTo(k.lon, 6);
    expect(p.lat).toBeCloseTo(k.lat, 6);
    const c = unit(p.pos);
    expect(dot(up, c)).toBeGreaterThan(0.8); // (a roll of a few degrees tips it off the vertical a little)
    // aimed at or above the horizon's dip, give or take a few degrees: the earth is in the lower part of the picture
    const dip = Math.asin(-dot(f, c)) * DEG;
    expect(dip).toBeLessThan(Math.acos(1 / len(p.pos)) * DEG + 3);
    expect(dip).toBeGreaterThan(Math.acos(1 / len(p.pos)) * DEG - 20);
  });
  it("brings the word's leading end into the picture at the start (the picture is 37 degrees tall and about 59 wide) and keeps the whole word in it, near the middle, all the way", () => {
    const first = FLIGHT.keys[0]!.u;
    const lead = seen(first, wordAt(first).lead);
    expect(lead.ahead).toBe(true);
    expect(Math.abs(lead.yaw)).toBeLessThan(29);
    expect(Math.abs(lead.pitch)).toBeLessThan(18.4);
    for (let u = first; u <= 0.95; u += 0.01) {
      const w = wordAt(u);
      const mid = seen(u, w.centre);
      expect(mid.ahead).toBe(true);
      expect(Math.abs(mid.yaw)).toBeLessThan(34);
      expect(Math.abs(mid.pitch)).toBeLessThan(25);
    }
  });
  it("is a spline, not a lock: the look does not depend on the word, and it is the same whatever the word does", () => {
    expect(flightPose.length).toBe(2); // (the progress and the end: no word)
  });
  it("climbs and goes west through the Mediterranean in order: Greece, then Italy, then Spain", () => {
    const lons = FLIGHT.keys.slice(0, 3).map((k) => flightPose(k.u, end).lon);
    for (let i = 1; i < lons.length; i++) expect(lons[i]).toBeLessThan(lons[i - 1]!);
    let last = 0;
    for (let u = FLIGHT.keys[0]!.u; u <= 1; u += 0.02) {
      const alt = len(flightPose(u, end).pos) - 1;
      expect(alt).toBeGreaterThanOrEqual(last - 0.02);
      last = alt;
    }
  });
  it("takes the short way round to the page's longitude, whatever it is", () => {
    for (const lon of [-170, -90, 0, 90, 170]) {
      let prev = flightPose(0, { ...end, lon }).lon;
      for (let u = 0.01; u <= 1; u += 0.01) {
        const now = flightPose(u, { ...end, lon }).lon;
        expect(Math.abs(now - prev)).toBeLessThan(40);
        prev = now;
      }
    }
  });
  it("is smooth: the camera and its line of sight move without steps, and their speed changes gently (no snap)", () => {
    const N = 2000;
    let prev = frame(0);
    let prevStep = 0;
    let prevTurn = 0;
    let maxTurnChange = 0;
    let maxStepChange = 0;
    for (let i = 1; i <= N; i++) {
      const cur = frame(i / N);
      const step = len(sub(cur.p.pos, prev.p.pos));
      const turn = Math.acos(Math.min(1, dot(cur.f, prev.f))) * DEG;
      expect(step).toBeLessThan(0.035); // (the dive at the start is the fastest part: about 3 earth radii in 2 s)
      expect(turn).toBeLessThan(0.6); // degrees per 1/2000 of the flight (the dive at the start is the fastest)
      if (i > 1) {
        maxStepChange = Math.max(maxStepChange, Math.abs(step - prevStep));
        maxTurnChange = Math.max(maxTurnChange, Math.abs(turn - prevTurn));
      }
      prev = cur;
      prevStep = step;
      prevTurn = turn;
    }
    expect(maxStepChange).toBeLessThan(0.002);
    expect(maxTurnChange).toBeLessThan(0.05);
  });
});
