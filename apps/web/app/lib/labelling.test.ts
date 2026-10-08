import { describe, expect, it } from "vitest";
import { ENTRY_KINDS, ENTRY_KIND_LABEL, isEntryKind } from "./entry-kind";
import { entryCode, formatCoordinates, formatIndex, formatStamp, slashJoin, statusBracket, statusText } from "./labelling";

describe("formatIndex", () => {
  it("pads to four digits by default", () => {
    expect(formatIndex(42)).toBe("0042");
    expect(formatIndex(0)).toBe("0000");
    expect(formatIndex(7, 2)).toBe("07");
  });
  it("never truncates, floors fractions and tolerates bad input", () => {
    expect(formatIndex(123456)).toBe("123456");
    expect(formatIndex(3.9)).toBe("0003");
    expect(formatIndex(-5)).toBe("0000");
    expect(formatIndex(Number.NaN)).toBe("0000");
    expect(formatIndex(Number.POSITIVE_INFINITY)).toBe("0000");
    expect(formatIndex(5, 0)).toBe("5");
  });
});

describe("entryCode", () => {
  it("is KIND / NNNN for every kind", () => {
    expect(entryCode("article", 42)).toBe("ARTICLE / 0042");
    for (const kind of ENTRY_KINDS) expect(entryCode(kind, 1)).toBe(`${ENTRY_KIND_LABEL[kind].toUpperCase()} / 0001`);
  });
});

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

describe("status and joins", () => {
  it("brackets the word", () => {
    expect(statusText(" published ")).toBe("PUBLISHED");
    expect(statusBracket("draft")).toBe("[ DRAFT ]");
  });
  it("slashJoin drops empty parts", () => {
    expect(slashJoin(["A", "", null, undefined, false, "B"])).toBe("A / B");
    expect(slashJoin([])).toBe("");
  });
});

describe("entry kinds", () => {
  it("knows its five kinds", () => {
    expect(ENTRY_KINDS).toEqual(["article", "project", "artwork", "poem", "place"]);
    expect(isEntryKind("poem")).toBe(true);
    expect(isEntryKind("photo")).toBe(false);
    expect(isEntryKind(undefined)).toBe(false);
  });
});
