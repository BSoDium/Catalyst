import { describe, expect, it } from "vitest";
import { ghostOpenness } from "./box-scene";
import { LOD } from "./lod-tree";

describe("ghostOpenness (#585)", () => {
  const sq = (n: number) => ({ c0: 0, r0: 0, c1: n, r1: n });
  it("keeps a ghost at the floor size closed (masked) and opens a bigger one (hollow)", () => {
    expect(ghostOpenness(sq(LOD.floorCells))).toBe(0);
    expect(ghostOpenness(sq(LOD.floorCells * 2))).toBe(1);
    expect(ghostOpenness(sq(Math.round(LOD.floorCells * 1.5)))).toBeGreaterThan(0);
  });
});
