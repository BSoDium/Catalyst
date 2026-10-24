import { describe, expect, it } from "vitest";
import { eggX } from "./caption";
import { CINEMATIC } from "./cinematic";
import { FLIGHT, blendPose, flightPose, type FlightEnd } from "./flight";
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
/** The word's middle and its ends at progress u: on the equator shell, the page at longitude 0, the interlude's own path from its start (its leading end at `leadStartLon`). */
const wordAt = (u: number) => {
  const s = CINEMATIC.shape;
  const t = Math.max(0, u * (s.leaveMs + s.gapMs + s.enterMs) - s.leaveMs - s.gapMs);
  const lon = (eggX(t, ((CINEMATIC.leadStartLon + 42) * Math.PI) / 180, s) * DEG) * CINEMATIC.side;
  const at = (l: number) => lonLatToVec3(l, 0).map((x) => x * CINEMATIC.radius);
  return { centre: at(lon), lead: at(lon - 42), trail: at(lon + 42), at, lon };
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
  it("is over Greece at its first key, the horizon level (up is the local vertical), aimed along it with the earth in the lower part of the picture", () => {
    const k = FLIGHT.keys[0]!;
    const { p, f, up } = frame(k.u);
    expect(len(p.pos) - 1).toBeCloseTo(k.alt, 6);
    expect(p.lon).toBeCloseTo(k.lon, 6);
    expect(p.lat).toBeCloseTo(k.lat, 6);
    const c = unit(p.pos);
    expect(dot(up, c)).toBeGreaterThan(0.8); // (a roll of a few degrees tips it off the vertical a little)
    // along the horizon, tipped up a few degrees: the line of sight is that much above the horizon's dip
    const dip = Math.asin(-dot(f, c)) * DEG;
    const hd = Math.acos(1 / len(p.pos)) * DEG;
    expect(dip).toBeLessThan(hd - 3);
    expect(dip).toBeGreaterThan(hd - 9);
  });
  /** The planet's limb in the flight's bearing, as seen from the camera at u: where in the picture the horizon is. */
  const horizonSeen = (u: number) => {
    const { p } = frame(u);
    const d = len(p.pos);
    const cu = unit(p.pos);
    const e = unit(cross([0, 1, 0], cu));
    const n = cross(cu, e);
    const bearing = FLIGHT.keys[0]!.bearing / DEG;
    const alpha = Math.acos(1 / d);
    const t = [n[0]! * Math.cos(bearing) + e[0]! * Math.sin(bearing), n[1]! * Math.cos(bearing) + e[1]! * Math.sin(bearing), n[2]! * Math.cos(bearing) + e[2]! * Math.sin(bearing)];
    return seen(u, [cu[0]! * Math.cos(alpha) + t[0]! * Math.sin(alpha), cu[1]! * Math.cos(alpha) + t[1]! * Math.sin(alpha), cu[2]! * Math.cos(alpha) + t[2]! * Math.sin(alpha)]);
  };
  it("holds the horizon in the picture, below its middle, while the camera backs away and climbs: the planet stays in view as the word rises from the limb", () => {
    for (let u = FLIGHT.keys[0]!.u; u <= FLIGHT.keys[1]!.u + 1e-9; u += 0.01) {
      const h = horizonSeen(u);
      expect(h.pitch).toBeLessThan(0);
      expect(h.pitch).toBeGreaterThan(-15);
      expect(Math.abs(h.yaw)).toBeLessThan(10);
    }
  });
  it("keeps part of the word in the picture from the moment it has come over the horizon to the end (the picture is 37 degrees tall and about 59 wide; the word is 84 degrees long, and the camera is inside its ring for the first half, so its ends are off to the sides)", () => {
    for (let u = 0.3; u <= 0.97; u += 0.01) {
      const w = wordAt(u);
      // (a point for each letter, from the leading end to the trailing one)
      const points = Array.from({ length: 9 }, (_, i) => w.at(w.lon - 42 + (84 * i) / 8));
      const inPicture = points.some((pt) => {
        const s = seen(u, pt);
        return s.ahead && Math.abs(s.yaw) < 28 && Math.abs(s.pitch) < 18.4;
      });
      expect(inPicture, `u = ${u.toFixed(2)}`).toBe(true);
    }
  });
  it("is in the space view well before the word has settled: from 0.88 the planet is in the middle and the whole word is across the picture in front of it", () => {
    for (let u = 0.88; u <= 1; u += 0.02) {
      const planet = seen(u, [0, 0, 0]);
      expect(Math.abs(planet.yaw)).toBeLessThan(8);
      expect(Math.abs(planet.pitch)).toBeLessThan(8);
      const w = wordAt(u);
      expect(Math.abs(seen(u, w.lead).yaw)).toBeLessThan(34);
      expect(Math.abs(seen(u, w.trail).yaw)).toBeLessThan(34);
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

  it("glides from a pose to the page's own camera when the flight is cut short: the start is the pose, the end exactly the orbit camera, and no step between", () => {
    const from = flightPose(0.4, end);
    const home = flightPose(1, end);
    const at0 = blendPose(from, home, 0);
    const at1 = blendPose(from, home, 1);
    for (let i = 0; i < 3; i++) {
      expect(at0.pos[i]).toBeCloseTo(from.pos[i]!, 12);
      expect(at1.pos[i]).toBeCloseTo(home.pos[i]!, 12);
      expect(at1.target[i]).toBeCloseTo(home.target[i]!, 12);
      expect(at1.up[i]).toBeCloseTo(home.up[i]!, 9);
    }
    // from any point of the flight: the camera moves steadily, and its up never turns over
    for (const u of [0.1, 0.3, 0.6, 0.9]) {
      const a = flightPose(u, end);
      let prev = a;
      for (let k = 0.02; k <= 1.0001; k += 0.02) {
        const b = blendPose(a, home, Math.min(1, k));
        expect(len(sub(b.pos, prev.pos))).toBeLessThan(0.5);
        expect(dot(unit(b.up), unit(prev.up))).toBeGreaterThan(0.9);
        prev = b;
      }
    }
  });

  it("eases in and out of the opening shot: the camera is nearly still where the dive ends, and the dive is long and slow at both ends", () => {
    const k = FLIGHT.keys[0]!.u;
    const speed = (u: number) => len(sub(flightPose(u + 0.0005, end).pos, flightPose(u - 0.0005, end).pos)) / 0.001;
    const mid = speed(k / 2);
    expect(speed(k)).toBeLessThan(mid * 0.15); // (arrives at rest)
    expect(speed(0.004)).toBeLessThan(mid * 0.2); // (leaves the page's camera at rest)
    expect(speed(k + 0.01)).toBeLessThan(mid * 0.25); // (and backs away from it gently)
    expect(k).toBeGreaterThanOrEqual(0.15); // (3.5 s: not a rush)
  });
});
