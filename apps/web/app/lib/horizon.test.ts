import { describe, expect, it } from "vitest";
import { findHorizon } from "./horizon";

const column = (n: number, at: number, above: number, below: number, noise = 0) => Array.from({ length: n }, (_, i) => (i < at ? above : below) + (Math.sin(i * 7.3) * noise));

describe("findHorizon: where a photograph's horizon is", () => {
  it("finds a horizon between two colours of the same brightness (sunset sky over brown water)", () => {
    const rows = Array.from({ length: 60 }, (_, i) => (i < 36 ? [0.55, 0.6, 0.75] : [0.62, 0.55, 0.48]) as [number, number, number]);
    expect(findHorizon(rows)!).toBeCloseTo(36 / 60, 1);
  });
  it("finds the row where the sky meets the ground", () => {
    const h = findHorizon(column(60, 36, 0.8, 0.3, 0.01));
    expect(h).not.toBeNull();
    expect(h!).toBeCloseTo(36 / 60, 1);
  });
  it("finds it the other way round too (dark sky, light snow)", () => {
    expect(findHorizon(column(60, 20, 0.2, 0.85, 0.01))!).toBeCloseTo(20 / 60, 1);
  });
  it("finds nothing in a picture without one (flat, noisy or a smooth ramp)", () => {
    expect(findHorizon(column(60, 30, 0.5, 0.5, 0.02))).toBeNull();
    expect(findHorizon(Array.from({ length: 60 }, (_, i) => i / 60))).toBeNull();
    expect(findHorizon(Array.from({ length: 60 }, (_, i) => 0.5 + Math.sin(i * 1.7) * 0.15))).toBeNull();
  });
  it("ignores an edge at the very top or bottom, and a picture too small to say", () => {
    expect(findHorizon(column(60, 3, 0.9, 0.2))).toBeNull();
    expect(findHorizon([0.1, 0.9, 0.1])).toBeNull();
  });
});
