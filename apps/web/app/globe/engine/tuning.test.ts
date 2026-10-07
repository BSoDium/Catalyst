import { afterEach, describe, expect, it } from "vitest";
import { ART_PIXEL, QUALITY, TUNING } from "./tuning";

afterEach(() => {
  QUALITY.cellBoost = 0;
});

describe("art pixel size: a function of the viewport only, unless the documented degrade applies", () => {
  it("at full quality it depends on (smaller side, device pixel ratio) and nothing else: no hidden state moves it", () => {
    const table = () => [320, 519, 520, 900, 1440].flatMap((s) => [1, 1.25, 1.5, 2, 2.625, 3].map((d) => TUNING.pixelSize(s, d)));
    const first = table();
    QUALITY.cellBoost = 1;
    table();
    QUALITY.cellBoost = 0; // a degrade that was undone leaves no trace
    expect(table()).toEqual(first);
    expect(TUNING.pixelSize(1440, 2)).toBe(2.5);
    expect(TUNING.pixelSize(400, 2)).toBe(2);
  });
  it("it is always a whole number of device pixels, and never coarser than the art pixel asks for", () => {
    for (const dpr of [1, 1.25, 1.5, 2, 2.625, 3]) {
      for (const side of [400, 1200]) {
        const size = TUNING.pixelSize(side, dpr);
        expect(Number.isInteger(Math.round(size * dpr * 1e6) / 1e6), `${side} @${dpr}`).toBe(true);
        const base = side < ART_PIXEL.phoneBelow ? ART_PIXEL.phone : ART_PIXEL.desktop;
        expect(size).toBeLessThanOrEqual(base + 0.5 / dpr + 1e-9);
      }
    }
  });
  it("the only other input is the governor's one-CSS-pixel boost, and zero restores the size exactly", () => {
    const full = TUNING.pixelSize(1440, 2);
    QUALITY.cellBoost = 1;
    expect(TUNING.pixelSize(1440, 2)).toBe(full + 1);
    QUALITY.cellBoost = 0;
    expect(TUNING.pixelSize(1440, 2)).toBe(full);
  });
});
