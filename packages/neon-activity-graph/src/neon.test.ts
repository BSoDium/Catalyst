import { beforeAll, describe, expect, it, vi } from "vitest";
import { createNeon, type NeonBlock } from "./neon";

const blocks: NeonBlock[] = Array.from({ length: 60 }, (_, i) => ({ x: (i % 12) * 1.12, z: Math.floor(i / 12) * 1.12, pan: ((i % 12) / 11) * 2 - 1, t: (i % 7) / 6 }));

describe("createNeon", () => {
  // (the tests run without a browser: just what `stop` touches)
  beforeAll(() => {
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.stubGlobal("window", { clearTimeout: () => {} });
    vi.stubGlobal("document", { removeEventListener: () => {}, addEventListener: () => {} });
  });
  it("starts with the flickering rods off, every level between 0 and 1, and the same run for the same seed", () => {
    const a = createNeon({ blocks, apply: vi.fn(), done: vi.fn(), sound: false, seed: 3 });
    const b = createNeon({ blocks, apply: vi.fn(), done: vi.fn(), sound: false, seed: 3 });
    expect(a.count).toBeGreaterThan(0);
    expect([...a.levels].every((v) => v >= 0 && v <= 1)).toBe(true);
    expect([...a.levels].filter((v) => v === 0).length).toBe(a.count);
    expect([...a.levels]).toEqual([...b.levels]);
  });
  it("puts every rod back on when it is stopped", () => {
    const n = createNeon({ blocks, apply: vi.fn(), done: vi.fn(), sound: false });
    n.stop();
    expect([...n.levels].every((v) => v === 1)).toBe(true);
  });
  it("copes with no blocks", () => {
    const n = createNeon({ blocks: [], apply: vi.fn(), done: vi.fn(), sound: false });
    expect(n.count).toBe(0);
    expect(() => n.stop()).not.toThrow();
  });
});
