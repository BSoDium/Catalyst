import { describe, expect, it } from "vitest";
import { WAVE, waveGeometry, waveTotalMs } from "./wave";

describe("the tiled wave", () => {
  it("uses tiles of the set size where the screen is small, and larger ones where it would take too many rings", () => {
    const small = waveGeometry(600, 400, 3);
    expect(small.tile).toBe(3 * WAVE.tileCells);
    const big = waveGeometry(6000, 4000, 3);
    expect(big.rings).toBeLessThanOrEqual(WAVE.maxRings);
  });
  it("takes a ring's stagger per ring and the fade of the last", () => {
    expect(waveTotalMs(10)).toBe(10 * WAVE.staggerMs + WAVE.fadeMs);
    expect(waveTotalMs(WAVE.maxRings)).toBeLessThan(3000);
  });
});
