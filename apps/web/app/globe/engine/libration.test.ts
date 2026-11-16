import { describe, expect, it } from "vitest";
import { Object3D, Vector3 } from "three";
import { LUNAR_POLE_TILT_DEG, realLibration } from "./lunar-ephemeris";
import { libration } from "./libration";
import { MOON, orbitAngle, type OrbitStart } from "./moon";

const start: OrbitStart = { mean: 0.7, perigee: 0.4, node: 1.9 };
const lap = (n: number) => Array.from({ length: n }, (_, i) => (2 * Math.PI * i) / n);

describe("the scene's libration (#634)", () => {
  it("is zero everywhere on a circle with no tilt", () => {
    for (const a of lap(37)) {
      const l = libration(a, start, 0, 0);
      expect(l.lonDeg).toBeCloseTo(0, 9);
      expect(l.latDeg).toBeCloseTo(0, 9);
    }
  });
  it("has almost no longitude libration on a circle (the lean of the pole adds a fraction of a degree) and no latitude libration with no tilt", () => {
    for (const a of lap(37)) {
      expect(Math.abs(libration(a, start, 0).lonDeg)).toBeLessThan(0.2);
      expect(libration(a, start, MOON.eccentricity, 0).latDeg).toBeCloseTo(0, 9);
    }
  });
  it("reaches the real extremes: 6.7 degrees in latitude and 6 to 8 in longitude, and is zero at perigee and apogee", () => {
    const l = lap(720).map((a) => libration(a, start));
    expect(Math.max(...l.map((x) => x.latDeg))).toBeCloseTo(LUNAR_POLE_TILT_DEG, 1);
    expect(Math.min(...l.map((x) => x.latDeg))).toBeCloseTo(-LUNAR_POLE_TILT_DEG, 1);
    expect(Math.max(...l.map((x) => Math.abs(x.lonDeg)))).toBeGreaterThan(6);
    expect(Math.max(...l.map((x) => Math.abs(x.lonDeg)))).toBeLessThan(8.2);
    expect(libration(start.perigee, start, MOON.eccentricity, 0).lonDeg).toBeCloseTo(0, 6);
    expect(libration(start.perigee + Math.PI, start, MOON.eccentricity, 0).lonDeg).toBeCloseTo(0, 6);
  });
  it("sees the south pole a quarter of a lap after the ascending node (the moon north of the orbit's plane), the north pole after three quarters", () => {
    expect(libration(start.node, start).latDeg).toBeCloseTo(0, 6);
    expect(libration(start.node + Math.PI / 2, start).latDeg).toBeCloseTo(-LUNAR_POLE_TILT_DEG, 1);
    expect(libration(start.node + (3 * Math.PI) / 2, start).latDeg).toBeCloseTo(LUNAR_POLE_TILT_DEG, 1);
  });
  it("repeats every lap, and follows the orbit's own angle", () => {
    const a = orbitAngle(123_456, start);
    expect(libration(a + 2 * Math.PI, start).lonDeg).toBeCloseTo(libration(a, start).lonDeg, 9);
    expect(libration(a + 2 * Math.PI, start).latDeg).toBeCloseTo(libration(a, start).latDeg, 9);
  });
});

describe("the mesh's rotation (the layer's `rotateX(lat)` then `rotateY(-lon)` after `lookAt`)", () => {
  it("brings the libration's point (selenographic longitude east, latitude north, as the texture has them) under the earth", () => {
    const pos = new Vector3(3, 2, -5);
    for (const [lon, lat] of [[0, 0], [7.5, 0], [-6, 4], [3, -6.7], [-7.9, 6.7]] as const) {
      const m = new Object3D();
      m.position.copy(pos);
      m.lookAt(0, 0, 0);
      m.rotateX((lat * Math.PI) / 180);
      m.rotateY((-lon * Math.PI) / 180);
      const l = (lon * Math.PI) / 180;
      const b = (lat * Math.PI) / 180;
      const point = new Vector3(Math.sin(l) * Math.cos(b), Math.sin(b), Math.cos(l) * Math.cos(b)).applyQuaternion(m.quaternion);
      const toEarth = pos.clone().negate().normalize();
      expect(point.distanceTo(toEarth)).toBeLessThan(1e-9);
    }
  });
});

describe("the real libration (Meeus, chapter 53)", () => {
  it("matches the book's example, 1992 April 12 0h TD (l' = -1.206, b' = +4.194)", () => {
    const r = realLibration(Date.UTC(1992, 3, 11, 23, 59, 1));
    expect(Math.abs(r.lonDeg - -1.206)).toBeLessThan(0.6);
    expect(Math.abs(r.latDeg - 4.194)).toBeLessThan(0.6);
  });
  it("stays within the real limits over a year", () => {
    let lonMax = 0;
    let latMax = 0;
    for (let d = 0; d < 365; d += 0.5) {
      const r = realLibration(Date.UTC(2026, 0, 1) + d * 86_400_000);
      lonMax = Math.max(lonMax, Math.abs(r.lonDeg));
      latMax = Math.max(latMax, Math.abs(r.latDeg));
    }
    expect(lonMax).toBeGreaterThan(5);
    expect(lonMax).toBeLessThan(8.5);
    expect(latMax).toBeGreaterThan(5);
    expect(latMax).toBeLessThan(7);
  });
});
