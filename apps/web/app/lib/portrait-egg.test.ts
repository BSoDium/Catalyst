import { describe, expect, it } from "vitest";
import { PORTRAIT_EGG, portraitEggDrawn } from "./portrait-egg";

describe("the portrait's Easter egg", () => {
  it("is drawn by chance: small odds, below the chance and no more", () => {
    expect(PORTRAIT_EGG.chance).toBeLessThanOrEqual(0.05);
    expect(portraitEggDrawn("", 0)).toBe(true);
    expect(portraitEggDrawn("", PORTRAIT_EGG.chance - 1e-9)).toBe(true);
    expect(portraitEggDrawn("", PORTRAIT_EGG.chance)).toBe(false);
    expect(portraitEggDrawn("", 0.99)).toBe(false);
  });

  it("is forced by the query, and never by `?bsod=0`", () => {
    expect(portraitEggDrawn("?bsod", 0.99)).toBe(true);
    expect(portraitEggDrawn("?x=1&bsod=1", 0.99)).toBe(true);
    expect(portraitEggDrawn("?bsod=0", 0)).toBe(false);
    expect(portraitEggDrawn("?bsod=false", 0)).toBe(false);
  });

  it("rolls a fresh number at each call when none is given", () => {
    const n = 4000;
    const hits = Array.from({ length: n }, () => portraitEggDrawn("")).filter(Boolean).length;
    expect(hits).toBeGreaterThan(0);
    expect(hits).toBeLessThan(n * PORTRAIT_EGG.chance * 3);
  });
});
