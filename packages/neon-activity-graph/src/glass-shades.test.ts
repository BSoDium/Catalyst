import { describe, expect, it } from "vitest";
import { glassShades } from "./view";

describe("glassShades", () => {
  it("leaves a lone block as it is", () => {
    expect(glassShades([{ x: 0, z: 0, y0: 0, h: 1 }])).toEqual([1]);
  });
  it("dims the block behind another, not the one in front", () => {
    // (the camera looks from -z: the block with the smaller z is the nearer one)
    const [near, far] = glassShades([
      { x: 0, z: -1, y0: 0, h: 2 },
      { x: 0, z: 0, y0: 0, h: 2 },
    ]);
    expect(near).toBe(1);
    expect(far).toBeLessThan(1);
  });
  it("never goes below the floor, and blocks far apart do not touch", () => {
    const stack = Array.from({ length: 12 }, (_, k) => ({ x: 0, z: k * 0.1, y0: 0, h: 2 }));
    expect(Math.min(...glassShades(stack))).toBeGreaterThanOrEqual(0.4);
    expect(glassShades([{ x: 0, z: 0, y0: 0, h: 1 }, { x: 30, z: 30, y0: 0, h: 1 }])).toEqual([1, 1]);
  });
});
