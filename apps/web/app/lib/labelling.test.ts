import { describe, expect, it } from "vitest";
import { ENTRY_KINDS, isEntryKind } from "./entry-kind";
import { decimalsOf, formatCoordinates, formatPlaceCoordinates, formatStamp, statusLabel } from "./labelling";

describe("formatCoordinates", () => {
  it("writes hemispheres instead of signs", () => {
    expect(formatCoordinates(10.7769, 106.7009)).toBe("10.7769° N / 106.7009° E");
    expect(formatCoordinates(-33.9249, -18.4241, 2)).toBe("33.92° S / 18.42° W");
    expect(formatCoordinates(0, 0)).toBe("0.0000° N / 0.0000° E");
  });
  it("answers a placeholder for impossible values", () => {
    for (const [lat, lon] of [[91, 0], [0, 181], [Number.NaN, 0], [0, Number.POSITIVE_INFINITY]] as const) {
      expect(formatCoordinates(lat, lon)).toBe("--.---- / --.----");
    }
  });
});

describe("formatStamp", () => {
  it("is UTC and dotted", () => {
    expect(formatStamp("2026-10-08T23:59:59Z")).toBe("2026.10.08");
    expect(formatStamp(new Date(Date.UTC(2001, 0, 2)))).toBe("2001.01.02");
    expect(formatStamp("2026-10-08")).toBe("2026.10.08");
  });
  it("answers a placeholder for an invalid date", () => {
    expect(formatStamp("not a date")).toBe("----.--.--");
  });
});

describe("decimalsOf and formatPlaceCoordinates", () => {
  it("counts the decimals a value is stored with", () => {
    expect(decimalsOf(48.85)).toBe(2);
    expect(decimalsOf(2)).toBe(0);
    expect(decimalsOf(-33.9249)).toBe(4);
    expect(decimalsOf(1e-7)).toBe(6); // capped: a decimetre is the finest a place is stored at
    expect(decimalsOf(Number.NaN)).toBe(0);
  });
  it("writes each value at its own precision, never more (a 2-decimal value is not 4 decimals)", () => {
    expect(formatPlaceCoordinates(48.85, 2.35)).toBe("48.85° N, 2.35° E");
    expect(formatPlaceCoordinates(48.8566, 2.3522)).toBe("48.8566° N, 2.3522° E");
    expect(formatPlaceCoordinates(-33.9, -18)).toBe("33.9° S, 18° W");
    expect(formatPlaceCoordinates(0, 0)).toBe("0° N, 0° E");
  });
  it("answers the placeholder for impossible values", () => {
    expect(formatPlaceCoordinates(91, 0)).toBe("--.---- / --.----");
    expect(formatPlaceCoordinates(0, Number.NaN)).toBe("--.---- / --.----");
  });
});

describe("statusLabel", () => {
  it("is one plain word", () => {
    expect(statusLabel(" published ")).toBe("Published");
    expect(statusLabel("DRAFT")).toBe("Draft");
    expect(statusLabel("")).toBe("");
  });
});

describe("entry kinds", () => {
  it("knows its six kinds", () => {
    expect(ENTRY_KINDS).toEqual(["article", "project", "artwork", "poem", "photograph", "place"]);
    expect(isEntryKind("poem")).toBe(true);
    expect(isEntryKind("photo")).toBe(false);
    expect(isEntryKind(undefined)).toBe(false);
  });
});
