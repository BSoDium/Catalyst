import { describe, expect, it } from "vitest";
import { clock, eclipseAhead, litShare, phaseName } from "./moon-hud";
import { MOON, type Vec3 } from "./moon";

describe("litShare", () => {
  const sun: Vec3 = [1, 0, 0];
  it("is new between the earth and the sun, full behind the earth, half at the quarters", () => {
    expect(litShare([9, 0, 0], sun)).toBeCloseTo(0, 5);
    expect(litShare([-9, 0, 0], sun)).toBeCloseTo(1, 5);
    expect(litShare([0, 9, 0], sun)).toBeCloseTo(0.5, 5);
  });
});

describe("phaseName", () => {
  it("names the eight phases", () => {
    expect(phaseName(0, true)).toBe("New moon");
    expect(phaseName(0.2, true)).toBe("Waxing crescent");
    expect(phaseName(0.5, true)).toBe("First quarter");
    expect(phaseName(0.5, false)).toBe("Last quarter");
    expect(phaseName(0.8, false)).toBe("Waning gibbous");
    expect(phaseName(1, true)).toBe("Full moon");
    expect(phaseName(0.2, false)).toBe("Waning crescent");
    expect(phaseName(0.8, true)).toBe("Waxing gibbous");
  });
});

describe("eclipseAhead", () => {
  const sun: Vec3 = [1, 0, 0];
  const R = MOON.orbit;
  /** A circular orbit in the plane of the sun line: the moon goes through the shadow (behind the earth) once a lap. */
  const inPlane = (start: number) => (a: number): Vec3 => [R * Math.cos(start + a), R * Math.sin(start + a), 0];
  it("finds the shadow ahead, and its middle, on an orbit that crosses it", () => {
    const r = eclipseAhead(inPlane(Math.PI / 2), sun);
    expect(r.now).toBe(false);
    expect(r.fromAngle).not.toBeNull();
    // from a quarter before the middle of the shadow (at pi), the middle is a quarter lap on and the shadow begins before it
    expect(r.peakAngle!).toBeGreaterThan(r.fromAngle!);
    expect(r.peakAngle!).toBeCloseTo(Math.PI / 2, 0);
  });
  it("says so while the moon is in it", () => {
    const r = eclipseAhead(inPlane(Math.PI), sun);
    expect(r.now).toBe(true);
    expect(r.fromAngle).toBe(0);
  });
  it("finds none on an orbit that misses the shadow", () => {
    const tilted = (a: number): Vec3 => [R * Math.cos(a) * 0.1, R * Math.sin(a), R * Math.cos(a)];
    expect(eclipseAhead(tilted, sun)).toEqual({ now: false, fromAngle: null, peakAngle: null });
  });
});

describe("clock", () => {
  it("is mm:ss", () => {
    expect(clock(65_000)).toBe("01:05");
    expect(clock(0)).toBe("00:00");
    expect(clock(-1)).toBe("--:--");
  });
});
