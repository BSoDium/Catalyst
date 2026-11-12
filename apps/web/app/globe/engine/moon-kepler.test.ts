import { describe, expect, it } from "vitest";
import { lunarPosition, moonMeanAnomalyDeg } from "./lunar-ephemeris";
import { DEFAULT_ORBIT, MOON, eccentricAnomaly, inertialPosition, meanOfTrue, msAtAngle, orbitAngle, orbitBasis, orbitRadius, rollFor, startFor, sunDirection, toRad, inclinationFor, type Vec3 } from "./moon";

const len = (a: Vec3) => Math.hypot(...a);
const E = MOON.eccentricity;

describe("the elliptical orbit (#630)", () => {
  it("solves Kepler's equation", () => {
    for (const m of [0, 0.4, 1.7, 3.1, 4.5, 6.2, 12.9]) {
      const ecc = eccentricAnomaly(m);
      expect(ecc - E * Math.sin(ecc)).toBeCloseTo(m, 6);
    }
  });

  it("has the real perigee and apogee distances about the mean radius", () => {
    expect(orbitRadius(0)).toBeCloseTo(MOON.orbit * (1 - E), 9);
    expect(orbitRadius(Math.PI)).toBeCloseTo(MOON.orbit * (1 + E), 9);
    const b = orbitBasis(rollFor(1.6), inclinationFor(1.6));
    expect(len(inertialPosition(0, b, orbitRadius(0)))).toBeCloseTo(MOON.orbit * (1 - E), 9);
  });

  it("sweeps equal areas in equal times (fastest at perigee), and a lap takes the period", () => {
    const dt = MOON.periodMs / 400;
    const area = (t: number) => {
      const a0 = orbitAngle(t);
      const a1 = orbitAngle(t + dt);
      const r0 = orbitRadius(a0);
      const r1 = orbitRadius(a1);
      return 0.5 * r0 * r1 * Math.sin(a1 - a0);
    };
    const first = area(0);
    for (let i = 1; i < 400; i += 37) expect(area(i * dt) / first).toBeCloseTo(1, 2);
    expect(orbitAngle(MOON.periodMs) - orbitAngle(0)).toBeCloseTo(2 * Math.PI, 9);
    // faster at perigee than at apogee
    const rate = (from: number) => {
      const t = msAtAngle(from);
      return orbitAngle(t + 1000) - orbitAngle(t);
    };
    expect(rate(0)).toBeGreaterThan(rate(Math.PI));
  });

  it("reproduces the circle exactly when e = 0", () => {
    for (const ms of [0, 12_345, 100_000, 333_333]) {
      expect(orbitAngle(ms, { mean: toRad(MOON.startDeg), perigee: 0 }, 0)).toBeCloseTo(toRad(MOON.startDeg) + (2 * Math.PI * ms) / MOON.periodMs, 10);
    }
    expect(orbitRadius(1.234, DEFAULT_ORBIT, 0)).toBe(MOON.orbit);
  });

  it("starts where the page says, and the inverse finds the same time", () => {
    expect(orbitAngle(0)).toBeCloseTo(toRad(MOON.startDeg), 9);
    const turn = 2 * Math.PI;
    for (const deg of [1, 100, 254, 330]) expect((((orbitAngle(msAtAngle(toRad(deg))) - toRad(deg)) % turn) + turn + 1e-9) % turn).toBeLessThan(1e-6 + 1e-9);
    expect(meanOfTrue(0)).toBe(0);
  });
});

describe("the lap starts at the real phase (#629)", () => {
  const basis = orbitBasis(rollFor(1.6), inclinationFor(1.6));
  const sun = sunDirection();
  const share = (start: ReturnType<typeof startFor>) => {
    const p = inertialPosition(orbitAngle(0, start), basis, 1);
    return (1 - (p[0] * sun[0] + p[1] * sun[1] + p[2] * sun[2])) / 2;
  };
  const grows = (start: ReturnType<typeof startFor>) => {
    const p = (ms: number) => {
      const q = inertialPosition(orbitAngle(ms, start), basis, 1);
      return (1 - (q[0] * sun[0] + q[1] * sun[1] + q[2] * sun[2])) / 2;
    };
    return p(20) > p(0);
  };

  it("gives the real lit share, within 2 % (or the nearest the orbit's plane reaches), and the real direction of change", () => {
    const base = Date.UTC(2026, 10, 12, 12);
    for (let day = 0; day < 30; day += 1.5) {
      const ms = base + day * 86_400_000;
      const real = lunarPosition(ms);
      const start = startFor(real.illuminatedFraction, real.ageDays < 14.765, toRad(moonMeanAnomalyDeg(ms)), basis, sun);
      // (the composition plane does not hold the sun: a wide window's orbit reaches 6 % lit at the thinnest and 94 % at the fullest, a new or full moon is shown at that)
      expect(Math.abs(share(start) - Math.min(0.94, Math.max(0.06, real.illuminatedFraction)))).toBeLessThan(0.02);
      expect([day, grows(start)]).toEqual([day, real.ageDays < 14.765]);
    }
  });

  it("places perigee so that the real mean anomaly is the moon's at the start", () => {
    const ms = Date.UTC(2026, 10, 12, 12);
    const real = lunarPosition(ms);
    const start = startFor(real.illuminatedFraction, true, toRad(moonMeanAnomalyDeg(ms)), basis, sun);
    expect(start.mean).toBeCloseTo(toRad(moonMeanAnomalyDeg(ms)), 9);
    expect(Number.isFinite(start.perigee)).toBe(true);
  });
});
