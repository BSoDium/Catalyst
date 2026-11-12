import { describe, expect, it } from "vitest";
import { daysToAnomaly, moonAngularSizeDeg, moonEquatorInclinationDeg, moonSpeedKmS, nextPhaseMs } from "./lunar-ephemeris";
import { computeRealLines, realLines } from "./moon-real";

const at = (iso: string) => Date.parse(iso);

describe("the moon's real numbers", () => {
  it("has the speed and the size the moon has at perigee and apogee", () => {
    expect(moonSpeedKmS(363_300)).toBeGreaterThan(1.07);
    expect(moonSpeedKmS(363_300)).toBeLessThan(1.09);
    expect(moonSpeedKmS(405_500)).toBeGreaterThan(0.96);
    expect(moonSpeedKmS(405_500)).toBeLessThan(0.98);
    expect(moonAngularSizeDeg(384_400)).toBeCloseTo(0.518, 2);
    expect(moonAngularSizeDeg(357_400)).toBeGreaterThan(moonAngularSizeDeg(406_500));
  });
  it("finds the next new and full moon on known dates", () => {
    // the new moon of 2024 April 8 18:21 UTC, the full moon of 2024 April 23 23:49 UTC
    expect(Math.abs(nextPhaseMs(at("2024-03-26T00:00:00Z"), 0) - at("2024-04-08T18:21:00Z"))).toBeLessThan(2 * 3_600_000);
    expect(Math.abs(nextPhaseMs(at("2024-04-09T00:00:00Z"), 180) - at("2024-04-23T23:49:00Z"))).toBeLessThan(2 * 3_600_000);
    // always ahead, and within a month
    const now = at("2026-11-12T12:00:00Z");
    for (const target of [0, 90, 180]) {
      const t = nextPhaseMs(now, target);
      expect(t).toBeGreaterThan(now);
      expect(t - now).toBeLessThan(30 * 86_400_000);
    }
  });
  it("counts the days to perigee and apogee on the mean clock", () => {
    // the perigee of 2024 October 17 about 12:00 UTC: from ten days before it is about ten days away (to the day or so the perturbations allow)
    expect(Math.abs(daysToAnomaly(at("2024-10-07T12:00:00Z"), 0) - 10)).toBeLessThan(2);
    for (const t of [0, 180]) expect(daysToAnomaly(at("2026-11-12T00:00:00Z"), t)).toBeLessThan(27.56);
  });
  it("puts the orbit at 18 to 29 degrees of the equator over the node's turn", () => {
    expect(moonEquatorInclinationDeg(at("2025-01-01T00:00:00Z"))).toBeGreaterThan(27.5);
    expect(moonEquatorInclinationDeg(at("2015-06-01T00:00:00Z"))).toBeLessThan(20);
  });
});

describe("the REAL lines", () => {
  it("are all REAL, and the same inside a tick", () => {
    const lines = computeRealLines(at("2026-11-12T12:00:00Z"));
    expect(lines.length).toBeGreaterThanOrEqual(12);
    for (const l of lines) expect(l).toMatch(/^REAL /);
    expect(realLines(1_000_000)).toBe(realLines(1_000_050));
    expect(realLines(1_000_000)).not.toBe(realLines(1_000_200));
  });
});
