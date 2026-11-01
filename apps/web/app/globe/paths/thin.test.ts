import { describe, expect, it } from "vitest";
import { chained, CROWD_FROM, CROWD_STEPS, crowdLegs, crowdStep, fadeStraight, mercatorPx, OFF_ZOOM, STRAIGHT_FADE_STEPS, straightFadeLevel, thinLegs, thinZoomFor, thinZoomOf, windowFor, type ThinLeg } from "./thin";

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
  it("keeps a short leg at any zoom: it is a short line, not nothing (#459), unless it is under one art pixel", () => {
    const short = leg("short", [10, 45], [10.2, 45.05]);
    expect(thinLegs([short], 5, 2.5)!.has("short")).toBe(true);
    expect(thinLegs([short], 9, 2.5)!.has("short")).toBe(true);
    expect(thinLegs([leg("tiny", [10, 45], [10.0001, 45])], 3, 2.5)!.has("tiny")).toBe(false);
  });
  it("does not take a leg's own trip for a corridor shared twice: the next leg of a chain is kept", () => {
    const a = leg("trip:0", [10, 45], [10.4, 45.1]);
    const b = leg("trip:1", [10.4, 45.1], [10.8, 45.2]);
    const other = leg("other:0", [10.01, 45.002], [10.39, 45.098]); // the same corridor as the first, another trip
    const kept = thinLegs([a, b, other], 4, 2.5)!;
    expect(kept.has("trip:1")).toBe(true);
    expect(kept.has("other:0")).toBe(false);
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

describe("crowds: many legs in one place are one quiet tone, not removed", () => {
  const fan = (n: number, keyOf: (i: number) => string, ends?: (i: number) => [string, string]): ThinLeg[] =>
    Array.from({ length: n }, (_, i) => ({ key: keyOf(i), parts: [[[10 + i * 0.01, 45], [12 + i * 0.01, 46]]], ends: ends?.(i) }));
  it("steps with the number of other legs in the cells: none below the threshold, up to the last step", () => {
    expect(crowdStep(0)).toBe(0);
    expect(crowdStep(CROWD_FROM - 0.1)).toBe(0);
    expect(crowdStep(CROWD_FROM)).toBe(1);
    expect(crowdStep(1000)).toBe(CROWD_STEPS);
  });
  it("marks legs that run through the same cells, and nothing for legs that run apart", () => {
    const crowd = crowdLegs(fan(8, (i) => `r${i}:0`), 3, 2.5)!;
    expect(crowd).not.toBeNull();
    expect([...crowd.keys()].sort()).toEqual(Array.from({ length: 8 }, (_, i) => `r${i}:0`).sort());
    const apart: ThinLeg[] = Array.from({ length: 8 }, (_, i) => ({ key: `r${i}:0`, parts: [[[10, 10 + i * 8], [12, 10 + i * 8]]] }));
    expect(crowdLegs(apart, 3, 2.5)).toBeNull();
  });
  it("does not count the legs that meet at a place (a hub's fan, a trip's chain) as a crowd", () => {
    const hub = fan(8, (i) => `r${i}:0`, (i) => ["hub", `end${i}`]);
    expect(crowdLegs(hub, 3, 2.5)).toBeNull();
    const chain: ThinLeg[] = [0, 1, 2].map((i) => ({ key: `t:${i}`, parts: [[[10 + i, 45], [11 + i, 45]]] }));
    expect(crowdLegs(chain, 3, 2.5)).toBeNull();
    expect(chained("t:1", "t:2")).toBe(true);
    expect(chained("t:1", "t:3")).toBe(false);
    expect(chained("a:1", "b:2")).toBe(false);
  });
  it("never crowds the selected place's legs", () => {
    const legs = fan(8, (i) => `r${i}:0`).map((l, i) => (i === 0 ? { ...l, lit: true } : l));
    expect(crowdLegs(legs, 3, 2.5)!.has("r0:0")).toBe(false);
  });
});
