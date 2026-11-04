import { describe, expect, it } from "vitest";
import { GLYPHS, scrambleText } from "~/lib/scramble";

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
