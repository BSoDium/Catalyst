import { describe, expect, it } from "vitest";
import { sameRect, spotFollow, spotLevel, spotRect } from "./spot";

const GREYS = 12;
const tune = { lift: 0.95, dim: 0.45, fill: 0.12 };

describe("spotLevel", () => {
  it("lifts the lines inside, never past the peak, and keeps their order", () => {
    const lifted = [1, 3, 6, 8, 9].map((l) => spotLevel(l, true, true, tune, GREYS));
    for (const v of lifted) expect(v).toBeLessThanOrEqual(GREYS - 2);
    expect([...lifted].sort((a, b) => a - b)).toEqual(lifted);
    expect(spotLevel(9, true, true, tune, GREYS)).toBe(10);
  });
  it("never lowers a line that is already at the peak or the ink", () => {
    expect(spotLevel(10, true, true, tune, GREYS)).toBe(10);
    expect(spotLevel(11, true, true, tune, GREYS)).toBe(11);
  });
  it("lifts a fill inside by much less than a line", () => {
    const line = spotLevel(4, true, true, tune, GREYS) - 4;
    const fill = spotLevel(4, false, true, tune, GREYS) - 4;
    expect(fill).toBeGreaterThanOrEqual(0);
    expect(fill).toBeLessThan(line);
  });
  it("dims the lines outside (never to nothing) and leaves the fills alone", () => {
    expect(spotLevel(8, true, false, tune, GREYS)).toBeLessThan(8);
    expect(spotLevel(1, true, false, tune, GREYS)).toBe(1);
    expect(spotLevel(8, false, false, tune, GREYS)).toBe(8);
  });
  it("never touches the page colour, the path trails, or an off spotlight", () => {
    expect(spotLevel(0, true, true, tune, GREYS)).toBe(0);
    expect(spotLevel(GREYS + 3, true, true, tune, GREYS)).toBe(GREYS + 3);
    expect(spotLevel(GREYS + 3, true, false, tune, GREYS)).toBe(GREYS + 3);
    expect(spotLevel(6, true, true, { lift: 0, dim: 0, fill: 0 }, GREYS)).toBe(6);
  });
  it("scales with the fade: half the strength gives a level between", () => {
    const half = spotLevel(4, true, true, { lift: tune.lift / 2, dim: 0, fill: 0 }, GREYS);
    expect(half).toBeGreaterThan(4);
    expect(half).toBeLessThan(spotLevel(4, true, true, tune, GREYS));
  });
});

describe("spotRect", () => {
  it("is the drawn box in art cells", () => {
    expect(spotRect({ x0: 40, y0: 20, x1: 200, y1: 100 }, 4)).toEqual({ c0: 10, r0: 5, c1: 50, r1: 25 });
  });
  it("sameRect compares all four sides", () => {
    const r = { c0: 1, r0: 2, c1: 3, r1: 4 };
    expect(sameRect(r, { ...r })).toBe(true);
    expect(sameRect(r, { ...r, r1: 5 })).toBe(false);
    expect(sameRect(null, r)).toBe(false);
  });
});

describe("spotFollow", () => {
  const a = { c0: 10, r0: 10, c1: 20, r1: 20 };
  const b = { c0: 50, r0: 60, c1: 70, r1: 80 };
  it("is on the selected rectangle when it is drawn", () => {
    expect(spotFollow(a, b, true)).toEqual({ box: a, target: 1 });
    expect(spotFollow(a, null, false)).toEqual({ box: a, target: 1 });
  });
  it("stays on the previous node, as the camera has it now, while it fades out", () => {
    expect(spotFollow(null, b, true)).toEqual({ box: b, target: 0 });
  });
  it("has no light with nothing to follow, or once it has faded out", () => {
    expect(spotFollow(null, null, true)).toEqual({ box: null, target: 0 });
    expect(spotFollow(null, b, false)).toEqual({ box: null, target: 0 });
  });
});
