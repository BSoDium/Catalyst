import { describe, expect, it } from "vitest";
import { ECLIPSE_YEARS, LUNAR_ECLIPSES, SOLAR_ECLIPSES, eclipseLines, eclipseNear, nextOf } from "./eclipse-table";

const at = (iso: string) => Date.parse(iso);

describe("the eclipse table", () => {
  it("is sorted and covers today and the years it says", () => {
    for (const list of [LUNAR_ECLIPSES, SOLAR_ECLIPSES]) {
      for (let i = 1; i < list.length; i++) expect(list[i]!.ms).toBeGreaterThan(list[i - 1]!.ms);
      expect(new Date(list[0]!.ms).getUTCFullYear()).toBe(ECLIPSE_YEARS[0]);
      expect(new Date(list.at(-1)!.ms).getUTCFullYear()).toBe(ECLIPSE_YEARS[1]);
      expect(list.length).toBeGreaterThan(40);
    }
    const now = Date.now();
    expect(now).toBeGreaterThan(LUNAR_ECLIPSES[0]!.ms);
    expect(nextOf(LUNAR_ECLIPSES, now)).not.toBeNull();
    expect(nextOf(SOLAR_ECLIPSES, now)).not.toBeNull();
  });
  it("finds the next eclipse on known dates", () => {
    // the total lunar eclipse of 2025 March 14, the total solar eclipse of 2026 August 12, the total lunar eclipse of 2026 March 3, the solar eclipse of 2027 August 2 (total, the longest for a century)
    const march = nextOf(LUNAR_ECLIPSES, at("2025-01-01T00:00:00Z"))!;
    expect(march.kind).toBe("T");
    expect(Math.abs(march.ms - at("2025-03-14T06:59:00Z"))).toBeLessThan(10 * 60_000);
    const sun = nextOf(SOLAR_ECLIPSES, at("2026-01-01T00:00:00Z"))!;
    expect(Math.abs(sun.ms - at("2026-02-17T12:12:00Z"))).toBeLessThan(10 * 60_000);
    const aug = nextOf(SOLAR_ECLIPSES, at("2026-03-01T00:00:00Z"))!;
    expect(aug.kind).toBe("T");
    expect(Math.abs(aug.ms - at("2026-08-12T17:46:00Z"))).toBeLessThan(10 * 60_000);
    const long = nextOf(SOLAR_ECLIPSES, at("2027-06-01T00:00:00Z"))!;
    expect(Math.abs(long.ms - at("2027-08-02T10:07:00Z"))).toBeLessThan(10 * 60_000);
    expect(long.kind).toBe("T");
    expect(nextOf(LUNAR_ECLIPSES, at("2100-01-01T00:00:00Z"))).toBeNull();
  });
  it("knows when the sky is near an eclipse", () => {
    expect(eclipseNear(at("2026-08-12T00:00:00Z"), 2)).toBe(true);
    expect(eclipseNear(at("2026-08-20T00:00:00Z"), 2)).toBe(false);
  });
  it("makes the HUD's lines", () => {
    const lines = eclipseLines(at("2026-05-01T00:00:00Z"));
    expect(lines[0]).toBe("REAL NEXT LUNAR ECLIPSE 2026-08-28 PARTIAL");
    expect(lines[1]).toBe("REAL NEXT SOLAR ECLIPSE 2026-08-12 TOTAL");
    expect(eclipseLines(at("2100-01-01T00:00:00Z"))[0]).toContain("BEYOND");
  });
});
