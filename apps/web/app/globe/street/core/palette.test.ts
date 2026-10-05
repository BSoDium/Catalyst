import { describe, expect, it } from "vitest";
import { CODE } from "./art-line";
import { MAX_LEVELS, PALETTE_LEVELS, buildPalette, paletteLevels } from "./palette";

const theme = { background: [1, 1, 1], ink: [0, 0, 0], outline: [0.5, 0.5, 0.5] } as const;

describe("palette", () => {
  it("is strict 1-bit plus the muted line colour today", () => {
    expect(PALETTE_LEVELS).toBe(2);
    expect(paletteLevels().map((l) => l.name)).toEqual(["bg", "ink", "muted"]);
  });
  it("derives a ramp of N levels from the two tokens", () => {
    const p = buildPalette(theme, 5);
    expect(p.levels.map((l) => l.name)).toEqual(["bg", "ramp-1", "ramp-2", "ramp-3", "ink", "muted"]);
    expect(p.rgb[2]).toEqual([0.5, 0.5, 0.5]);
    expect(p.rgb.length).toBeLessThanOrEqual(MAX_LEVELS);
  });
  it("draws every line class in the ink level whatever N is", () => {
    for (const n of [2, 5, 8]) {
      const p = buildPalette(theme, n);
      const ink = p.levels.findIndex((l) => l.role === "ink");
      expect(p.codeLevel[CODE.thin]).toBe(ink);
      expect(p.codeLevel[CODE.solid]).toBe(ink);
      expect(p.codeLevel[CODE.none]).toBe(0);
      expect(p.levels[p.codeLevel[CODE.muted]!]!.role).toBe("muted");
    }
  });
});
