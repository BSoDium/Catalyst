import { describe, expect, it } from "vitest";
import { fadeStraight, mercatorPx, OFF_ZOOM, STRAIGHT_FADE_STEPS, straightFadeLevel, thinLegs, thinZoomFor, thinZoomOf, windowFor, type ThinLeg } from "./thin";

const leg = (key: string, a: [number, number], b: [number, number], lit = false): ThinLeg => ({ key, parts: [[a, b]], lit });

describe("thinLegs", () => {
  it("keeps one of two legs along the same corridor (the longer first), and both when they go different ways", () => {
    const long = leg("long", [10, 45], [16, 48]);
    const same = leg("same", [10.2, 45.1], [15.8, 47.9]); // along the same line
    const away = leg("away", [10, 45], [14, 41]);
    const kept = thinLegs([same, long, away], 5, 2.5)!;
    expect(kept.has("long")).toBe(true);
    expect(kept.has("same")).toBe(false);
    expect(kept.has("away")).toBe(true);
  });
  it("drops a leg too short to read at this zoom, and brings it back when zoomed in", () => {
    const short = leg("short", [10, 45], [10.2, 45.05]);
    expect(thinLegs([short], 5, 2.5)!.has("short")).toBe(false);
    expect(thinLegs([short], 9, 2.5)!.has("short")).toBe(true);
  });
  it("never drops a lit leg, and keeps it first so it is the one a duplicate loses to", () => {
    const long = leg("long", [10, 45], [16, 48]);
    const litShort = leg("lit", [10, 45], [10.1, 45.02], true);
    const kept = thinLegs([long, litShort], 4, 2.5)!;
    expect(kept.has("lit")).toBe(true);
    const litSame = leg("litSame", [10.2, 45.1], [15.8, 47.9], true);
    const k2 = thinLegs([long, litSame], 4, 2.5)!;
    expect(k2.has("litSame")).toBe(true);
    expect(k2.has("long")).toBe(false);
  });
  it("does nothing from a city's scale on", () => {
    expect(thinLegs([leg("a", [1, 1], [1.01, 1.01])], OFF_ZOOM, 2.5)).toBeNull();
  });
  it("quantises the zoom to quarters", () => {
    expect(thinZoomOf(5.1)).toBe(5);
    expect(thinZoomOf(5.2)).toBe(5.25);
  });
});

describe("fadeStraight: straight lines quieten with the share of the screen they take", () => {
  it("steps from as-it-is (up to a screen) to the last step (three screens), nothing before", () => {
    expect(straightFadeLevel(500, 1000)).toBe(0);
    expect(straightFadeLevel(1000, 1000)).toBe(0);
    expect(straightFadeLevel(1500, 1000)).toBe(1);
    expect(straightFadeLevel(2500, 1000)).toBe(3);
    expect(straightFadeLevel(9000, 1000)).toBe(STRAIGHT_FADE_STEPS);
    expect(straightFadeLevel(100, 0)).toBe(0);
  });
  it("a short flight (Minsk to Moscow) stays as it is where it fits the screen, and goes quiet once it is much bigger than the screen", () => {
    const flight: ThinLeg = { key: "f", parts: [[[27.57, 53.9], [37.62, 55.75]]], straight: true };
    expect(fadeStraight([flight], 5, 1200)).toBeNull(); // ~ 0.9 of a screen wide
    expect(fadeStraight([flight], 8, 1200)!.get("f")).toBe(STRAIGHT_FADE_STEPS);
  });
  it("leaves the legs that follow the ground and the selected place's legs alone", () => {
    const ground: ThinLeg = { key: "g", parts: [[[0, 0], [30, 0]]] };
    const lit: ThinLeg = { key: "l", parts: [[[0, 0], [30, 0]]], straight: true, lit: true };
    expect(fadeStraight([ground, lit], 8, 1000)).toBeNull();
  });
});

describe("thinZoomFor: a hysteresis on the quarter steps", () => {
  it("keeps the step in force until the zoom is past the middle by the hysteresis, and quantises as before without one", () => {
    expect(thinZoomFor(5.2, null)).toBe(thinZoomOf(5.2));
    expect(thinZoomFor(5.14, 5)).toBe(5); // past the middle (5.125) but inside the hysteresis
    expect(thinZoomFor(5.2, 5)).toBe(5.25);
    expect(thinZoomFor(5.11, 5.25)).toBe(5.25);
  });
});

describe("the window the thinning works in", () => {
  it("is null when it would take in the world, and a box round the view otherwise", () => {
    expect(windowFor(0, 0, 1000, 2, null)).toBeNull();
    const w = windowFor(100000, 100000, 1000, 8, null)!;
    expect(w.window.x1 - w.window.x0).toBe(2500);
    expect(w.window.x0).toBeLessThan(100000 - 500);
    expect(w.window.x1).toBeGreaterThan(100000 + 500);
  });
  it("stays on its grid point while the centre moves less than 3/4 of a step, then moves", () => {
    const a = windowFor(100000, 100000, 1000, 8, null)!;
    const near = windowFor(100000 + 0.7 * 500, 100000, 1000, 8, a.anchor)!;
    expect(near.anchor).toEqual(a.anchor);
    const far = windowFor(100000 + 0.8 * 500, 100000, 1000, 8, a.anchor)!;
    expect(far.anchor.ix).toBe(a.anchor.ix + 1);
  });
  it("leaves out the cells of a leg outside it (the leg is kept, it is not on the screen) but not those inside, and keeps the length", () => {
    const [cx, cy] = mercatorPx(10, 45, 9);
    const w = windowFor(cx, cy, 1000, 9, null)!.window;
    const inside = leg("in", [10, 45], [10.2, 45.1]);
    const copy = leg("copy", [10.01, 45.005], [10.19, 45.095]);
    const outside = leg("out", [60, 10], [60.5, 10.2]);
    const outCopy = leg("outCopy", [60.01, 10.005], [60.49, 10.195]);
    const kept = thinLegs([inside, copy, outside, outCopy], 9, 2.5, w)!;
    expect(kept.has("in")).toBe(true);
    expect(kept.has("copy")).toBe(false);
    expect(kept.has("out")).toBe(true);
    expect(kept.has("outCopy")).toBe(true);
  });
});
