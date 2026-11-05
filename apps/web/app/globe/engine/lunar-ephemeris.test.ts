import { describe, expect, it } from "vitest";
import { LUNAR, lunarPosition } from "./lunar-ephemeris";

const at = (iso: string) => Date.parse(iso);
const angleBetween = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

describe("lunar ephemeris", () => {
  it("agrees with the worked example of Meeus (1992 April 12, 0h): longitude, latitude and distance", () => {
    const p = lunarPosition(at("1992-04-12T00:00:00Z"));
    // (the book's values: 133.162655, -3.229126, 368409.7 km; right ascension 134.688470, declination 13.768368; the truncated series is within a hundredth of a degree and 100 km of them)
    expect(angleBetween(p.lonDeg, 133.162655)).toBeLessThan(0.02);
    expect(Math.abs(p.latDeg - -3.229126)).toBeLessThan(0.02);
    expect(Math.abs(p.distanceKm - 368409.7)).toBeLessThan(100);
    expect(angleBetween(p.raDeg, 134.68847)).toBeLessThan(0.05);
    expect(Math.abs(p.decDeg - 13.768368)).toBeLessThan(0.05);
  });
  it("puts the new moon at the sun and the full moon opposite it", () => {
    // the total eclipse of 2024 April 8 (new moon, 18:21 UTC) and the full moon of 2024 March 25 (07:00 UTC)
    const newMoon = lunarPosition(at("2024-04-08T18:21:00Z"));
    expect(newMoon.elongationDeg).toBeLessThan(1);
    expect(newMoon.illuminatedFraction).toBeLessThan(0.001);
    const full = lunarPosition(at("2024-03-25T07:00:00Z"));
    expect(Math.abs(full.elongationDeg - 180)).toBeLessThan(1);
    expect(full.illuminatedFraction).toBeGreaterThan(0.999);
    expect(Math.abs(full.ageDays - LUNAR.synodicDays / 2)).toBeLessThan(0.5);
  });
  it("is half lit at the quarters", () => {
    const first = lunarPosition(at("2024-04-15T19:13:00Z"));
    expect(Math.abs(first.elongationDeg - 90)).toBeLessThan(1.5);
    expect(Math.abs(first.illuminatedFraction - 0.5)).toBeLessThan(0.02);
    expect(Math.abs(first.ageDays - LUNAR.synodicDays / 4)).toBeLessThan(0.5);
  });
  it("keeps the distance between the perigee and the apogee, and passes them when they were", () => {
    let min = { km: Infinity, ms: 0 };
    let max = { km: 0, ms: 0 };
    const start = at("2024-10-01T00:00:00Z");
    for (let d = 0; d < 28; d += 0.05) {
      const ms = start + d * 86_400_000;
      const km = lunarPosition(ms).distanceKm;
      if (km < min.km) min = { km, ms };
      if (km > max.km) max = { km, ms };
    }
    // the perigee of 2024 October 17 (about 357,400 km) and the apogee of 2024 October 2 (about 406,500 km), to a day and a few hundred km
    expect(Math.abs(min.km - 357_400)).toBeLessThan(600);
    expect(Math.abs(min.ms - at("2024-10-17T00:00:00Z"))).toBeLessThan(86_400_000);
    expect(Math.abs(max.km - 406_500)).toBeLessThan(600);
    expect(Math.abs(max.ms - at("2024-10-02T20:00:00Z"))).toBeLessThan(86_400_000);
  });
  it("stays within 5.4 degrees of the ecliptic and has its sublunar point on the earth", () => {
    for (let d = 0; d < 60; d += 1.7) {
      const p = lunarPosition(at("2025-01-01T00:00:00Z") + d * 86_400_000);
      expect(Math.abs(p.latDeg)).toBeLessThan(5.4);
      expect(Math.abs(p.sublunar.lat)).toBeLessThan(29);
      expect(Math.abs(p.sublunar.lon)).toBeLessThanOrEqual(180);
      expect(p.lonDeg).toBeGreaterThanOrEqual(0);
      expect(p.lonDeg).toBeLessThan(360);
    }
  });
  it("moves a sidereal month round the sky", () => {
    const start = at("2024-06-01T00:00:00Z");
    const a = lunarPosition(start);
    const b = lunarPosition(start + LUNAR.siderealDays * 86_400_000);
    // after a sidereal month it is back among the same stars (the longitude of date has moved by the precession, a hundredth of a degree)
    expect(angleBetween(a.lonDeg, b.lonDeg)).toBeLessThan(1.5);
  });
  it("does not read the clock", () => {
    const t = at("2030-05-05T05:05:00Z");
    expect(lunarPosition(t)).toEqual(lunarPosition(t));
  });
});
