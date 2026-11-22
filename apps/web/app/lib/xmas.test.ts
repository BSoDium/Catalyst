import { describe, expect, it } from "vitest";
import { RED_SHARE, xmasRod } from "~/lib/xmas-lights";
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

describe("xmasRod", () => {
  const ctx = (index: number, layer: "top" | "bottom") => ({ index, layer, date: "2026-12-24", t: 0.5 });
  it("leaves the bottom layer, and most of the top one, to the stock neon", () => {
    expect(Array.from({ length: 371 }, (_, i) => xmasRod(ctx(i, "bottom"))).every((c) => c === null)).toBe(true);
    const reds = Array.from({ length: 371 }, (_, i) => xmasRod(ctx(i, "top"))).filter((c) => c !== null).length;
    expect(reds / 371).toBeGreaterThan((RED_SHARE - 8) / 100);
    expect(reds / 371).toBeLessThan((RED_SHARE + 8) / 100);
  });
  it("picks the same days each time, and a red that is red", () => {
    expect(xmasRod(ctx(40, "top"))).toEqual(xmasRod(ctx(40, "top")));
    const red = Array.from({ length: 50 }, (_, i) => xmasRod(ctx(i, "top"))).find((c) => c !== null)!;
    expect(red[0]).toBeGreaterThan(1.5);
    expect(red[1]).toBeLessThan(0.1);
    expect(red[2]).toBeLessThan(0.1);
  });
});
