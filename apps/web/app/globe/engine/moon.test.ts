import { describe, expect, it } from "vitest";
import { MOON, direction, inertialPosition, moonAmount, orbitAngle, orbitBasis, rollFor, toEarthFrame, toRad, unhidden, type Vec3 } from "./moon";

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => Math.hypot(...a);

describe("the moon's orbit", () => {
  it("turns once in a period, and starts where the page says", () => {
    expect(orbitAngle(0)).toBeCloseTo(toRad(MOON.startDeg));
    expect(orbitAngle(MOON.periodMs) - orbitAngle(0)).toBeCloseTo(2 * Math.PI);
  });

  it("has a plane spanned by two unit axes at a right angle, and is a circle about the earth's centre", () => {
    const b = orbitBasis(20);
    expect(len(b.e1)).toBeCloseTo(1);
    expect(len(b.e2)).toBeCloseTo(1);
    expect(dot(b.e1, b.e2)).toBeCloseTo(0);
    for (const deg of [0, 37, 90, 181, 300]) expect(len(inertialPosition(toRad(deg), b))).toBeCloseTo(MOON.orbit);
  });

  it("is laid against the opening camera: its near half is on the camera's side of the planet, its far half behind it", () => {
    const camera = direction(MOON.ref.lonDeg, MOON.ref.latDeg);
    const b = orbitBasis(MOON.rollWideDeg);
    const near = inertialPosition(toRad(90), b);
    const far = inertialPosition(toRad(270), b);
    expect(dot(near, camera)).toBeGreaterThan(0);
    expect(dot(far, camera)).toBeLessThan(0);
    // a modest inclination: well in front, and not far from the line of sight
    expect(dot(near, camera) / MOON.orbit).toBeCloseTo(Math.cos(toRad(MOON.inclinationDeg)), 5);
    // and the ends of the orbit are level with the planet, to the camera's right and left
    expect(Math.abs(dot(inertialPosition(0, b), camera))).toBeLessThan(1e-9);
  });

  it("leans on a wide window and stands upright on a narrow one", () => {
    expect(rollFor(1.6)).toBe(MOON.rollWideDeg);
    expect(rollFor(0.46)).toBe(MOON.rollNarrowDeg);
    const mid = rollFor((MOON.narrowAspect + MOON.wideAspect) / 2);
    expect(mid).toBeGreaterThan(MOON.rollWideDeg);
    expect(mid).toBeLessThan(MOON.rollNarrowDeg);
    // on a narrow window the orbit's long axis is nearer the vertical than on a wide one
    const camera = direction(MOON.ref.lonDeg, MOON.ref.latDeg);
    void camera;
    expect(Math.abs(orbitBasis(rollFor(0.46)).e1[1])).toBeGreaterThan(Math.abs(orbitBasis(rollFor(1.6)).e1[1]));
  });

  it("is a sixth of the earth's radius, and fits in the picture the whole-globe fit leaves: the orbit is wider than the planet and the moon's own radius", () => {
    expect(MOON.radius).toBeCloseTo(1 / 6);
    expect(MOON.orbit).toBeGreaterThan(1 + MOON.radius);
  });
});

describe("the earth-fixed frame", () => {
  it("is the inertial one turned about the axis by minus the earth rotation angle: the sky's relation, longitude minus ERA", () => {
    const p = direction(100, 20);
    const q = toEarthFrame(p, 70);
    const expected = direction(30, 20);
    for (let i = 0; i < 3; i++) expect(q[i]).toBeCloseTo(expected[i]!);
    // no rotation at 0, the axis is untouched, lengths are kept
    const same = toEarthFrame(p, 0);
    for (let i = 0; i < 3; i++) expect(same[i]).toBeCloseTo(p[i]!);
    expect(toEarthFrame([0, 1, 0], 123)[1]).toBeCloseTo(1);
    expect(len(toEarthFrame([0.3, 0.4, 0.5], 211))).toBeCloseTo(len([0.3, 0.4, 0.5]));
  });

  it("leaves the moon where it is as the earth turns under a camera that stays: the camera's inertial longitude (view + ERA) is what the moon is placed against", () => {
    // the opening camera: view lon 0, ERA 70. After a spin of 40 degrees the view's longitude is -40 and ERA 110: the camera's inertial direction is the same,
    // and so is the moon's place relative to it (the moon's earth-fixed longitude goes down by as much as the camera's)
    const b = orbitBasis(MOON.rollWideDeg);
    const p = inertialPosition(toRad(90), b);
    const before = toEarthFrame(p, 70);
    const after = toEarthFrame(p, 110);
    const lon = (v: Vec3) => (Math.atan2(v[0], v[2]) * 180) / Math.PI;
    expect(lon(after) - lon(before)).toBeCloseTo(-40);
  });
});

describe("what the planet leaves of the moon", () => {
  it("shows all of it in front of the planet's horizon plane, none well inside the silhouette behind it, and some at the limb", () => {
    expect(unhidden(false, 0, 100, 20)).toBe(1);
    expect(unhidden(true, 10, 100, 20)).toBe(0);
    expect(unhidden(true, 200, 100, 20)).toBe(1);
    const half = unhidden(true, 100, 100, 20);
    expect(half).toBeGreaterThan(0.2);
    expect(half).toBeLessThan(0.9);
  });
});

describe("the zoom's share", () => {
  it("belongs to the world view: gone by the time the first places are named", () => {
    expect(moonAmount(3, 3)).toBe(1);
    expect(moonAmount(3 + MOON.fadeFrom, 3)).toBe(1);
    expect(moonAmount(3 + MOON.fadeTo, 3)).toBe(0);
    expect(moonAmount(1, 3)).toBe(1);
  });
});
