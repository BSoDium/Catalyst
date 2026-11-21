import { describe, expect, it } from "vitest";
import { isChristmasSeason, sessionRoll, XMAS_CHANCE, xmasMode } from "~/lib/xmas";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe("xmasMode", () => {
  it("is always on with ?xmas and always off with ?xmas=0, whatever the date", () => {
    expect(xmasMode("?xmas", new Date(2026, 5, 1))).toBe(true);
    expect(xmasMode("?xmas=1", new Date(2026, 5, 1))).toBe(true);
    expect(xmasMode("?xmas=0", new Date(2026, 11, 20), null, () => 0)).toBe(false);
  });
  it("is off outside the season, even with a lucky roll", () => {
    expect(xmasMode("", new Date(2026, 10, 30), null, () => 0)).toBe(false);
    expect(xmasMode("", new Date(2027, 0, 7), null, () => 0)).toBe(false);
  });
  it("is a chance in the season: on under the chance, off above it", () => {
    expect(xmasMode("", new Date(2026, 11, 24), null, () => XMAS_CHANCE - 0.01)).toBe(true);
    expect(xmasMode("", new Date(2026, 11, 24), null, () => XMAS_CHANCE + 0.01)).toBe(false);
  });
  it("keeps one roll for a session", () => {
    const store = memory();
    const first = sessionRoll(store, () => 0.1);
    expect(sessionRoll(store, () => 0.9)).toBe(first);
  });
});

describe("isChristmasSeason", () => {
  it("runs from 1 December to 6 January", () => {
    expect(isChristmasSeason(new Date(2026, 11, 1))).toBe(true);
    expect(isChristmasSeason(new Date(2027, 0, 6))).toBe(true);
    expect(isChristmasSeason(new Date(2026, 10, 30))).toBe(false);
    expect(isChristmasSeason(new Date(2027, 0, 7))).toBe(false);
  });
});
