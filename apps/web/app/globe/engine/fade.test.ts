import { describe, expect, it } from "vitest";
import { FADE_MS, FRAME_MS, FadeArray, MAX_STEP_MS, clockStep, easeFade, hysteresis } from "./fade";

describe("the ease", () => {
  it("runs 0 to 1, flat at both ends, symmetric", () => {
    expect(easeFade(0)).toBe(0);
    expect(easeFade(1)).toBe(1);
    expect(easeFade(-3)).toBe(0);
    expect(easeFade(7)).toBe(1);
    for (let p = 0; p <= 1; p += 0.05) expect(easeFade(p) + easeFade(1 - p)).toBeCloseTo(1, 12); // two things that swap sum to 1
    expect(easeFade(0.01)).toBeLessThan(0.01);
  });
});

describe("the clock", () => {
  it("the first reading and a clock that goes backwards count for nothing", () => {
    expect(clockStep(0, 1000)).toBe(0);
    expect(clockStep(1000, 1000)).toBe(0);
    expect(clockStep(1000, 900)).toBe(0);
  });
  it("a normal gap is the gap; a pause counts as one frame", () => {
    expect(clockStep(1000, 1016)).toBe(16);
    expect(clockStep(1000, 1000 + MAX_STEP_MS)).toBe(MAX_STEP_MS);
    expect(clockStep(1000, 1000 + MAX_STEP_MS + 1)).toBe(FRAME_MS);
    expect(clockStep(1000, 1_000_000)).toBe(FRAME_MS);
  });
});

describe("hysteresis", () => {
  it("is on above `high`, off below `low`, and keeps its state between", () => {
    expect(hysteresis(false, 0.8, 0.3, 0.7)).toBe(true);
    expect(hysteresis(true, 0.2, 0.3, 0.7)).toBe(false);
    expect(hysteresis(true, 0.5, 0.3, 0.7)).toBe(true);
    expect(hysteresis(false, 0.5, 0.3, 0.7)).toBe(false);
  });
  it("a value jittering inside the band never flips it", () => {
    let on = true;
    for (let k = 0; k < 100; k++) on = hysteresis(on, 0.5 + (k % 2 ? 0.1 : -0.1), 0.3, 0.7);
    expect(on).toBe(true);
  });
});

describe("FadeArray", () => {
  it("is at rest when everything is at its target, and `set` to the same state starts nothing", () => {
    const f = new FadeArray(3);
    f.set(0, false);
    expect(f.moving).toBe(false);
    expect(f.step(16)).toBe(false);
  });
  it("runs to the target over `ms` whatever the frame length, then reports that it has stopped", () => {
    for (const dt of [1, 7, 16, 33, 64]) {
      const f = new FadeArray(1);
      f.set(0, true);
      expect(f.moving).toBe(true);
      let t = 0;
      while (f.step(dt)) t += dt;
      expect(t, `dt ${dt}`).toBeLessThanOrEqual(FADE_MS + 1);
      expect(t + dt, `dt ${dt}`).toBeGreaterThanOrEqual(FADE_MS - 1);
      expect(f.value(0)).toBe(1);
      expect(f.moving).toBe(false);
    }
  });
  it("goes down the same way, and a value never overshoots", () => {
    const f = new FadeArray(1);
    f.snap(0, true);
    f.set(0, false);
    let last = 1;
    while (f.step(10)) {
      expect(f.value(0)).toBeLessThan(last);
      expect(f.value(0)).toBeGreaterThan(0);
      last = f.value(0);
    }
    expect(f.value(0)).toBe(0);
  });
  it("a reversal turns around from where the value is, not from an end", () => {
    const f = new FadeArray(1);
    f.set(0, true);
    f.step(FADE_MS / 4);
    const here = f.p[0]!;
    expect(here).toBeCloseTo(0.25, 6);
    f.set(0, false);
    f.step(FADE_MS / 10);
    expect(f.p[0]!).toBeCloseTo(here - 0.1, 6);
    while (f.step(16));
    expect(f.p[0]).toBe(0);
  });
  it("two values that swap and start together keep an opacity sum of exactly 1 on the way", () => {
    const f = new FadeArray(2);
    f.snap(0, true);
    f.set(0, false);
    f.set(1, true);
    for (let k = 0; k < 12; k++) {
      f.step(16);
      expect(f.value(0) + f.value(1)).toBeCloseTo(1, 6);
    }
  });
  it("reduced motion: `instant` goes all the way in one step", () => {
    const f = new FadeArray(2);
    f.set(0, true);
    f.set(1, true);
    expect(f.step(0, true)).toBe(false);
    expect(f.value(0)).toBe(1);
    expect(f.value(1)).toBe(1);
  });
  it("`snap` jumps without moving, `settle` finishes everything", () => {
    const f = new FadeArray(2);
    f.snap(0, true);
    expect(f.value(0)).toBe(1);
    expect(f.moving).toBe(false);
    f.set(1, true);
    f.settle();
    expect(f.value(1)).toBe(1);
    expect(f.moving).toBe(false);
  });
});
