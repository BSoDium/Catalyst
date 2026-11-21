import { describe, expect, it } from "vitest";
import { GLASS_IOR, roundedNormal, traceEmitter, traceSun, type GlassBox } from "./glass-caustics";

const box: GlassBox = { c: [0, 1, 0], h: [0.46, 1, 0.46], r: 0.16 };
const sun = ((): [number, number, number] => {
  const l = Math.hypot(0.45, 1, 0.55);
  return [0.45 / l, -1 / l, -0.55 / l];
})();
let seed = 7;
const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

describe("roundedNormal", () => {
  it("is a face's normal on a flat face, and turns smoothly round an edge", () => {
    expect(roundedNormal([0.46, 0, 0], box.h, box.r)).toEqual([1, 0, 0]);
    const edge = roundedNormal([0.46, 0, 0.46], box.h, box.r);
    expect(edge[0]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(edge[2]).toBeCloseTo(Math.SQRT1_2, 5);
  });
});

describe("traceSun", () => {
  it("loses power to reflection but never makes any (the net of what lands and what is taken away is not positive)", () => {
    let net = 0;
    let freed = 0;
    traceSun(box, sun, 40, random, (_x, _z, p) => (net += p), (_x, _z, p) => ((net -= p), (freed += p)));
    // (some is reflected, some leaves upward, some is trapped: a loss, but not all of it)
    expect(net).toBeLessThan(0);
    expect(net).toBeGreaterThan(-freed);
  });
  it("lands the rays that went through the block in front of it, not behind it, for light that comes from the sun's side", () => {
    let sx = 0;
    let n = 0;
    traceSun(box, sun, 30, random, (x, _z, p) => ((sx += x * p), (n += p)), () => {});
    // (the sun is at -x: its shadow, and the light it bends, fall at +x)
    expect(sx / n).toBeGreaterThan(0);
  });
  it("has an index to refract with", () => {
    expect(GLASS_IOR).toBeGreaterThan(1);
  });
});

describe("traceEmitter", () => {
  it("lands light on the ground around the block, none of it in the sky", () => {
    let count = 0;
    traceEmitter(box, { cy: 0, rx: 0.1, ry: 0.8 }, 400, random, (x, z, share) => {
      count++;
      expect(Number.isFinite(x) && Number.isFinite(z)).toBe(true);
      expect(share).toBeGreaterThan(0);
      expect(share).toBeLessThanOrEqual(1);
    });
    expect(count).toBeGreaterThan(100);
  });
});
