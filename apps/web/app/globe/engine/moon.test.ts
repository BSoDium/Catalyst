import { describe, expect, it } from "vitest";
import { CELL, MOON, direction, dither4, inclinationFor, inertialPosition, moonAmount, moonAxes, moonSprite, orbitAngle, orbitBasis, rollFor, sampleMoon, spriteCells, sunDirection, toEarthFrame, toRad, unhidden, type MoonMap, type Vec3 } from "./moon";
import { SURFACE } from "./surface";
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

/* ------------------------------------------------------------------ light and the picture */

/** A moon far down -z seen from a camera on +z: the view axes are the earth's, the near side faces +z. */
const axes = moonAxes([0, 0, -9], [0, 0, 5], [1, 0, 0], [0, 1, 0]);
const map: MoonMap = { width: 8, height: 4, data: Uint8Array.from({ length: 32 }, (_, k) => (k % 8 < 4 ? 40 : 230)) };
const N = spriteCells(40, 3);
const sprite = (sun: Vec3, o: Partial<Parameters<typeof moonSprite>[0]> = {}) => moonSprite({ cells: N, axes, sun, map, phaseX: 0, phaseY: 0, opaqueBody: false, ...o });
const column = (s: Uint8Array, i: number) => Array.from({ length: N }, (_, j) => s[j * N + i]!);
const count = (s: Uint8Array, pred: (c: number) => boolean) => [...s].filter(pred).length;

describe("the moon's axes", () => {
  it("are a right-handed set: right x up = toward, and the body's east x north = near", () => {
    const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    for (const [a, b, c] of [[axes.right, axes.up, axes.toward], [axes.east, axes.north, axes.near]] as const) {
      const x = cross(a, b);
      for (let i = 0; i < 3; i++) expect(x[i]).toBeCloseTo(c[i]!);
    }
    // the near side faces the earth (the origin), and the camera sees the moon from the earth's side
    expect(axes.near[2]).toBeCloseTo(1);
    expect(axes.toward[2]).toBeCloseTo(1);
  });
});

describe("the sun", () => {
  it("is a unit vector, toward the camera's right and a little up of the opening camera's direction", () => {
    const sun = sunDirection();
    expect(Math.hypot(...sun)).toBeCloseTo(1);
    const camera = direction(MOON.ref.lonDeg, MOON.ref.latDeg);
    expect(sun[0] * camera[0] + sun[1] * camera[1] + sun[2] * camera[2]).toBeCloseTo(Math.cos(toRad(MOON.sunAzimuthDeg)) * Math.cos(toRad(MOON.sunElevationDeg)), 5);
  });
});

describe("the moon's picture", () => {
  it("is read by direction: east to the right, the near side in the middle", () => {
    expect(sampleMoon(map, 0.9, 0, 0.1)).toBeGreaterThan(0.8);
    expect(sampleMoon(map, -0.9, 0, 0.1)).toBeLessThan(0.3);
  });

  it("has the globe's own dither: a lattice of period 8 and under 1.25", () => {
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        const d = dither4(x, y);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThan(1.25);
        expect(dither4(x + 8, y + 8)).toBeCloseTo(d);
      }
  });
});

describe("the moon's sprite", () => {
  it("asks for an odd number of cells, at least seven", () => {
    expect(spriteCells(10, 4)).toBe(7);
    expect(spriteCells(54, 3) % 2).toBe(1);
  });

  it("is lit on the side the sun is on and is NOTHING on the other: the dark side blends into the sky, with no rim and no body", () => {
    const s = sprite([1, 0, 0.001]); // from the right
    const left = column(s, 1);
    const right = column(s, N - 2);
    // (the unlit side's interior is not there: only the faintest ring of its rim, so that it can still be found)
    expect(left.every((c) => c === CELL.none || c === CELL.ghost)).toBe(true);
    expect(right.some((c) => c !== CELL.none && c !== CELL.ghost)).toBe(true);
    // and the rim is outlined only where it is lit, a ghost of a ring where it is not
    expect(s[((N - 1) / 2) * N + 0]).toBe(CELL.ghost);
    expect(s[((N - 1) / 2) * N + N - 1]).toBe(CELL.outline);
    expect([...s].filter((c) => c === CELL.body)).toHaveLength(0);
  });

  it("is only the faint ring at the new moon (the sun behind it) and the whole disc at the full (the sun behind the camera)", () => {
    const dark = sprite([0, 0, -1]);
    expect(count(dark, (c) => c !== CELL.none && c !== CELL.ghost)).toBe(0);
    expect(count(dark, (c) => c === CELL.ghost)).toBeGreaterThan(N); // a ring all the way round
    const full = sprite([0, 0, 1]);
    // every cell of the rim is outlined and the interior carries tones in about MOON.cover of its cells
    const mid = (N - 1) / 2;
    expect(full[mid]).toBe(CELL.outline);
    expect(full[mid * N]).toBe(CELL.outline);
    // every lit interior cell carries a tone of the ground (`MOON.cover` is the share that does, 1 now)
    const inside = count(full, (c) => c >= CELL.tone0 && c <= CELL.tone2);
    const disc = count(sprite([0, 0, 1], { opaqueBody: true }), (c) => c !== CELL.none && c !== CELL.outline);
    expect(inside / disc).toBeGreaterThan(MOON.cover - 0.05);
  });

  it("has a terminator that is a dithered edge: between a lit and a dark cell there are cells of both, not a line", () => {
    const s = sprite([0.7071, 0, 0.7071]); // a half moon, lit from the right a little in front
    const mid = (N - 1) / 2;
    const row = Array.from({ length: N }, (_, i) => s[(mid - 1) * N + i]!).map((c) => c !== CELL.none && c !== CELL.ghost);
    // the lit share of the row grows to the right, and there is a stretch where it is mixed
    expect(row[0]).toBe(false); // the dark edge
    expect(row.slice(-2).some((b) => b)).toBe(true); // the lit one
    // and the middle of the disc, where the terminator runs, is a mixture of both
    const mixed = row.slice(2, N - 2);
    expect(mixed.some((b) => b) && mixed.some((b) => !b)).toBe(true);
  });

  it("carries the three tones by the picture's brightness, by the Earth's cuts: dark ground on the picture's dark half, light on its light half", () => {
    const s = sprite([0, 0, 1]);
    const mid = (N - 1) / 2;
    const left = [...s].filter((c, k) => k % N < mid - 1 && c >= CELL.tone0 && c <= CELL.tone2);
    const right = [...s].filter((c, k) => k % N > mid + 1 && c >= CELL.tone0 && c <= CELL.tone2);
    expect(left.every((c) => c === CELL.tone0)).toBe(true);
    expect(right.every((c) => c === CELL.tone2)).toBe(true);
    expect(SURFACE.cuts[0]).toBeLessThan(SURFACE.cuts[1]);
  });

  it("is a rigid picture: the same pixels for the same phase, others for another", () => {
    expect([...sprite([0.4, 0.1, 0.9], { phaseX: 3, phaseY: 5 })]).toEqual([...sprite([0.4, 0.1, 0.9], { phaseX: 11, phaseY: 13 })]);
    expect([...sprite([0.4, 0.1, 0.9], { phaseX: 3, phaseY: 5 })]).not.toEqual([...sprite([0.4, 0.1, 0.9], { phaseX: 4, phaseY: 5 })]);
  });

  it("paints the body in the page's colour only when asked (in front of the planet), and leaves a cell the planet hides empty", () => {
    const sun: Vec3 = [1, 0, 0.001];
    const sky = sprite(sun);
    const front = sprite(sun, { opaqueBody: true });
    expect(count(sky, (c) => c === CELL.body)).toBe(0);
    expect(count(front, (c) => c === CELL.body)).toBeGreaterThan(0);
    expect(count(front, (c) => c !== CELL.none)).toBeGreaterThan(count(sky, (c) => c !== CELL.none));
    const hidden = sprite([0, 0, 1], { hidden: (i) => i < N / 2 });
    expect(column(hidden, 2).every((c) => c === CELL.none)).toBe(true);
    expect(column(hidden, N - 3).some((c) => c !== CELL.none)).toBe(true);
  });
});
