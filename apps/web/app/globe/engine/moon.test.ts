import { describe, expect, it } from "vitest";
import { MOON, direction, inclinationFor, inertialPosition, moonAmount, orbitAngle, orbitBasis, litTurn, rollFor, sunDirection, toEarthFrame, toRad, unhidden, visibleBounds, type Vec3 } from "./moon";
import { viewBasis } from "./geo";

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
    const b = orbitBasis(MOON.rollWideDeg, MOON.inclinationWideDeg);
    const near = inertialPosition(toRad(90), b);
    const far = inertialPosition(toRad(270), b);
    expect(dot(near, camera)).toBeGreaterThan(0);
    expect(dot(far, camera)).toBeLessThan(0);
    // a modest inclination: well in front, and not far from the line of sight
    expect(dot(near, camera) / MOON.orbit).toBeCloseTo(Math.cos(toRad(MOON.inclinationWideDeg)), 5);
    // and the ends of the orbit are level with the planet, to the camera's right and left
    expect(Math.abs(dot(inertialPosition(0, b), camera))).toBeLessThan(1e-9);
  });

  it("is far and the moon is small in the picture: the half on the camera's side is behind the camera, the far half is in the background", () => {
    const d = 4.3; // the camera's distance from the planet at the whole-globe view
    const sil = 1 / Math.sqrt(d * d - 1);
    expect(MOON.orbit).toBeGreaterThan(d);
    const camera = direction(MOON.ref.lonDeg, MOON.ref.latDeg);
    const b = orbitBasis(0, MOON.inclinationWideDeg);
    // the moon's radius in the picture at the farthest and the nearest it is in front of the camera, against the planet's silhouette
    const far = inertialPosition(toRad(270), b);
    const farDepth = d - dot(far, camera);
    expect(MOON.radius / farDepth / sil).toBeLessThan(0.1);
    // the camera's side of the orbit is behind the camera (or too close to be in the picture)
    const near = inertialPosition(toRad(90), b);
    expect(d - dot(near, camera)).toBeLessThan(0.5);
  });

  it("comes out from behind the planet at its sides, a little above the middle: the far half's ends are beside the planet on the screen and the orbit leans up", () => {
    const d = 5; // the camera's distance at the page's lowest zoom
    const sil = 1 / Math.sqrt(d * d - 1);
    const v = viewBasis({ lon: MOON.ref.lonDeg, lat: MOON.ref.latDeg, zoom: 0 }, 1);
    for (const incl of [MOON.inclinationWideDeg, MOON.inclinationNarrowDeg]) {
      const b = orbitBasis(0, incl);
      const at = (deg: number) => {
        const p = inertialPosition(toRad(deg), b);
        const depth = d - dot(p, v.c);
        return { x: dot(p, v.east) / depth, y: dot(p, v.north) / depth };
      };
      // behind the planet, in the middle of the far half: inside the silhouette (hidden)
      const mid = at(270);
      expect(Math.hypot(mid.x, mid.y)).toBeLessThan(sil);
      // and beside it on both sides, above the planet's middle line, outside its silhouette
      for (const deg of [243, 297]) {
        const p = at(deg);
        expect(Math.hypot(p.x, p.y)).toBeGreaterThan(sil);
        expect(p.y).toBeGreaterThan(0);
      }
      // left on one side and right on the other
      expect(at(243).x).toBeLessThan(0);
      expect(at(297).x).toBeGreaterThan(0);
    }
    expect(inclinationFor(1.6)).toBe(MOON.inclinationWideDeg);
    expect(inclinationFor(0.46)).toBe(MOON.inclinationNarrowDeg);
  });

  it("is not in the picture when the page opens: it starts on the camera's side of the orbit, behind the camera", () => {
    const camera = direction(MOON.ref.lonDeg, MOON.ref.latDeg);
    const p = inertialPosition(toRad(MOON.startDeg), orbitBasis(rollFor(1.6), MOON.inclinationWideDeg));
    expect(dot(p, camera)).toBeGreaterThan(4.3 - 0.5);
  });

  it("leans a little on a wide window and is level on a narrow one, in between by a smoothstep", () => {
    expect(rollFor(1.6)).toBe(MOON.rollWideDeg);
    expect(rollFor(0.46)).toBe(MOON.rollNarrowDeg);
    const mid = rollFor((MOON.narrowAspect + MOON.wideAspect) / 2);
    expect(mid).toBeGreaterThan(MOON.rollNarrowDeg);
    expect(mid).toBeLessThan(MOON.rollWideDeg);
  });

  it("is a sixth of the earth's radius", () => {
    expect(MOON.radius).toBeCloseTo(1 / 6);
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

/* ------------------------------------------------------------------ light */

describe("the sun", () => {
  it("is a unit vector, toward the camera's right and a little up of the opening camera's direction", () => {
    const sun = sunDirection();
    expect(Math.hypot(...sun)).toBeCloseTo(1);
    const camera = direction(MOON.ref.lonDeg, MOON.ref.latDeg);
    expect(sun[0] * camera[0] + sun[1] * camera[1] + sun[2] * camera[2]).toBeCloseTo(Math.cos(toRad(MOON.sunAzimuthDeg)) * Math.cos(toRad(MOON.sunElevationDeg)), 5);
  });

  it("is where the moon's phase comes from: seen from the opening camera the moon is lit on the planet's side wherever it is beside it", () => {
    // the moon at the two places it is in the picture, from the opening camera: its lit side is the one toward the sun; the phase is the angle between the sun and the camera,
    // seen from the moon (the moon is far behind the planet, so about the sun's own angle to the camera's direction)
    const camera = direction(MOON.ref.lonDeg, MOON.ref.latDeg);
    const sun = sunDirection();
    const phaseAngle = Math.acos(sun[0] * camera[0] + sun[1] * camera[1] + sun[2] * camera[2]);
    // a gibbous: more than half of the visible disc lit (the sun within 90 degrees of the camera's direction)
    expect(phaseAngle).toBeLessThan(Math.PI / 2);
    expect(phaseAngle).toBeGreaterThan(toRad(20)); // and not a full moon
  });
});

describe("litTurn", () => {
  it("is 0 at the opening camera and within the tolerance of it", () => {
    expect(litTurn(0, 70)).toBe(0);
    expect(litTurn(20, 70)).toBe(0);
  });
  it("turns back the short way to the opening camera's longitude in the inertial frame", () => {
    expect(Math.abs(litTurn(180, 70))).toBeCloseTo(180, 5);
    expect(litTurn(-90, 70)).toBeCloseTo(90, 5);
    expect(litTurn(100, 70)).toBeCloseTo(-100, 5);
  });
  it("does not depend on the idle turn (view down, era up by the same angle)", () => {
    expect(litTurn(-40, 110)).toBe(litTurn(0, 70));
  });
});

describe("visibleBounds", () => {
  const moon = { x: 100, y: 100, r: 10 };

  it("is the whole disc where nothing is in front of it", () => {
    expect(visibleBounds(moon, null)).toEqual({ x0: 90, y0: 90, x1: 110, y1: 110 });
    expect(visibleBounds(moon, { x: 300, y: 100, r: 50 })).toEqual({ x0: 90, y0: 90, x1: 110, y1: 110 });
  });

  it("is what the planet leaves: a planet to the left of the moon takes its left part", () => {
    const b = visibleBounds(moon, { x: 40, y: 100, r: 55 })!; // its limb is at x = 95
    expect(b.x0).toBeGreaterThan(94);
    expect(b.x1).toBeCloseTo(110, 5);
    expect(b.y0).toBeGreaterThan(90 - 1e-9);
    expect(b.y1).toBeLessThan(110 + 1e-9);
  });

  it("is null once the planet covers the whole moon", () => {
    expect(visibleBounds(moon, { x: 100, y: 100, r: 80 })).toBeNull();
  });
});
