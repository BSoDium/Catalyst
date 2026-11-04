import { describe, expect, it } from "vitest";
import { GLYPHS, scrambleFrame, scrambleText } from "~/lib/scramble";

describe("scrambleText", () => {
  const rand = () => 0.5;
  it("is the one text at 0 and the other at 1", () => {
    expect(scrambleText("Elliot", "BSoD", 0, rand)).toBe("Elliot");
    expect(scrambleText("Elliot", "BSoD", 1, rand)).toBe("BSoD");
  });
  it("settles from the left, with glyphs after, and its length goes from one to the other", () => {
    const mid = scrambleText("Elliot Negrel", "BSoDium", 0.5, rand);
    expect(mid.length).toBe(Math.round(13 + (7 - 13) * 0.5));
    expect(mid.startsWith("BS")).toBe(true);
    for (const c of mid.slice(4)) expect(GLYPHS.includes(c)).toBe(true);
  });
  it("keeps the hyphens and spaces of the text it goes to", () => {
    expect(scrambleText("BSoD", "Négrel-Jerzy", 0.9, rand)[6]).toBe("-");
  });
});

describe("scrambleFrame", () => {
  const rand = () => 0.5;
  it("keeps the old letters of the first positions for a moment, then ghosts, then settles", () => {
    const early = scrambleFrame("Elliot", "BSoD", 0.02, rand);
    expect(early[0]).toEqual({ ch: "E", lit: true });
    const mid = scrambleFrame("Elliot Negrel", "BSoDium", 0.5, rand);
    expect(mid.slice(0, 3).every((c) => c.lit)).toBe(true);
    expect(mid.slice(5).every((c) => !c.lit)).toBe(true);
    expect(scrambleFrame("a", "bc", 1, rand)).toEqual([{ ch: "b", lit: true }, { ch: "c", lit: true }]);
  });
});
