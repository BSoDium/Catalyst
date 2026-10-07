import { describe, expect, it } from "vitest";
import { cutBetween, cutLongSegments, dp, mergeAtContinuations, splitArtificial } from "./lines";

describe("splitArtificial", () => {
  it("splits a segment that jumps across the antimeridian at +-180", () => {
    const out = splitArtificial([[[178, 10], [-178, 12]]]);
    expect(out).toHaveLength(2);
    expect(out[0]!.at(-1)).toEqual([180, 11]);
    expect(out[1]![0]).toEqual([-180, 11]);
  });
  it("drops edges along the antimeridian and the south pole", () => {
    expect(splitArtificial([[[180, 10], [180, 20]]])).toEqual([]);
    expect(splitArtificial([[[10, -90], [20, -90]]])).toEqual([]);
  });
});

describe("cutLongSegments", () => {
  it("cuts a long parallel into equal straight pieces on the same line", () => {
    const out = cutLongSegments([[-123, 49], [-95, 49]], 4);
    expect(out).toHaveLength(8);
    expect(out[0]).toEqual([-123, 49]);
    expect(out.at(-1)).toEqual([-95, 49]);
    expect(out.every(([, y]) => y === 49)).toBe(true);
    for (let i = 1; i < out.length; i++) expect(out[i]![0]! - out[i - 1]![0]!).toBeLessThanOrEqual(4);
  });
  it("keeps short segments", () => {
    const l = [[0, 0], [1, 1], [2, 0]];
    expect(cutLongSegments(l, 4)).toEqual(l);
  });
});

describe("mergeAtContinuations", () => {
  it("joins two lines that meet end to end, in either orientation", () => {
    const out = mergeAtContinuations([[[0, 0], [1, 0]], [[2, 0], [1, 0]]]);
    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(3);
  });
  it("at a tripoint, the first line taken stays apart and the vertices are all kept", () => {
    const out = mergeAtContinuations([[[0, 0], [1, 0]], [[1, 0], [2, 0]], [[1, 0], [1, 1]]]);
    expect(out).toHaveLength(2);
    expect(out.flat()).toHaveLength(5);
  });
  it("does not modify its input", () => {
    const a = [[0, 0], [1, 0]];
    mergeAtContinuations([a, [[1, 0], [2, 0]]]);
    expect(a).toEqual([[0, 0], [1, 0]]);
  });
});

describe("cutBetween", () => {
  const line = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]];
  it("removes the stretch between two points and keeps both ends", () => {
    const r = cutBetween(line, [1, 0], [3, 0])!;
    expect(r.kept).toHaveLength(2);
    expect(r.removed[0]).toEqual([1, 0]);
    expect(r.removed.at(-1)).toEqual([3, 0]);
  });
  it("returns null when a point is not on the line", () => {
    expect(cutBetween(line, [1, 5], [3, 0])).toBeNull();
  });
});

describe("dp", () => {
  it("keeps the end points and drops collinear vertices", () => {
    expect(dp([[0, 0], [1, 0.001], [2, 0]], 0.01)).toEqual([[0, 0], [2, 0]]);
  });
});
