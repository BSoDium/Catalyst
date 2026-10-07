import { describe, expect, it } from "vitest";
import { FrameGovernor, GOVERNOR, type FrameClock } from "./governor";

/** Feed `n` frames of `dt` ms starting at `t`; returns [new time, levels changed to]. */
function feed(g: FrameGovernor, t: number, n: number, dt: number | ((i: number) => number)) {
  const changes: number[] = [];
  for (let i = 0; i < n; i++) {
    t += typeof dt === "function" ? dt(i) : dt;
    const c = g.sample(t);
    if (c !== null) changes.push(c);
  }
  return { t, changes };
}

describe("frame governor", () => {
  it("stays at 0 on a healthy 60 Hz and 120 Hz display", () => {
    for (const dt of [16.7, 8.3]) {
      const g = new FrameGovernor();
      const r = feed(g, 1000, 2000, dt);
      expect(r.changes).toEqual([]);
      expect(g.level).toBe(0);
    }
  });

  it("ignores rare hitches: a few 40 ms frames do not step down", () => {
    const g = new FrameGovernor();
    const r = feed(g, 1000, 900, (i) => (i % 60 === 0 ? 40 : 16.7));
    expect(r.changes).toEqual([]);
  });

  it("steps down one level at a time with a dwell between them, to the maximum", () => {
    const g = new FrameGovernor();
    const r = feed(g, 1000, 600, 40); // 25 fps
    expect(r.changes).toEqual([1, 2]);
    expect(g.level).toBe(GOVERNOR.maxLevel);
  });

  it("does not count idle gaps as slow frames", () => {
    const g = new FrameGovernor();
    let t = 1000;
    for (let k = 0; k < 20; k++) {
      t = feed(g, t, 30, 16.7).t + 5000; // 30 frames, then idle
      expect(g.sample(t)).toBeNull();
    }
    expect(g.level).toBe(0);
  });

  it("steps back up only after sustained calm, and not at all when the lower level was the right one", () => {
    const g = new FrameGovernor();
    let r = feed(g, 1000, 100, 40);
    expect(g.level).toBe(1);
    // fast again, but not for long enough
    r = feed(g, r.t, 300, 16.7); // 5 s
    expect(g.level).toBe(1);
    r = feed(g, r.t, 800, 16.7); // 13 s more
    expect(g.level).toBe(0);
    // slow again right away: back to 1 and locked there for a long while
    r = feed(g, r.t, 60, 40); // (the median has to turn slow too: a few hitches are not a slow device)
    expect(g.level).toBe(1);
    r = feed(g, r.t, 1500, 16.7); // 25 s of calm: no step up (locked)
    expect(g.level).toBe(1);
  });
});

describe("regression: the resolution doubled for no reason and never came back", () => {
  /** What the renderer feeds the governor for a frame. */
  const clock = (over: Partial<FrameClock> = {}): FrameClock => ({ live: true, continuous: false, workMs: 4, ...over });

  it("root cause 1: input-limited frames (a wheel notch every 50 ms) are not slow frames", () => {
    // Wheel and trackpad zoom produce one frame per input event: the interval is the user's, the frame costs 4 ms.
    const legacy = new FrameGovernor(GOVERNOR, { live: false, continuous: false, workMs: 0 });
    feed(legacy, 1000, 400, 50);
    expect(legacy.level, "judged by intervals alone, a healthy device is degraded").toBe(GOVERNOR.maxLevel);

    const g = new FrameGovernor(GOVERNOR, clock());
    const r = feed(g, 1000, 600, 50);
    expect(r.changes).toEqual([]);
    expect(g.level).toBe(0);
    expect(g.history).toEqual([]);
  });

  it("a device whose frames really are slow is still degraded, whatever drives the frames", () => {
    const a = new FrameGovernor(GOVERNOR, clock({ continuous: true, workMs: 5 }));
    expect(feed(a, 1000, 600, 40).changes).toEqual([1, 2]); // a flight at 25 fps
    const b = new FrameGovernor(GOVERNOR, clock({ continuous: false, workMs: 40 }));
    expect(feed(b, 1000, 600, 50).changes).toEqual([1, 2]); // wheel zoom whose frames cost 40 ms of work
    expect(a.history.map((h) => [h.from, h.to])).toEqual([[0, 1], [1, 2]]);
  });

  it("a cluster of hitches (the street map mounting) is not a slow device: the median decides too", () => {
    const g = new FrameGovernor(GOVERNOR, clock({ continuous: true }));
    // 8 frames of 45 ms in every 90: p95 is far above the limit, the median is a healthy 16.7
    const r = feed(g, 1000, 3000, (i) => (i % 90 < 8 ? 45 : 16.7));
    expect(r.changes).toEqual([]);
  });

  it("root cause 2: a degrade is undone by calm, even though a gesture never lasts 10 s: idle time counts as calm", () => {
    const g = new FrameGovernor(GOVERNOR, clock({ continuous: true }));
    let t = feed(g, 1000, 600, 40).t; // slow: level 2
    expect(g.level).toBe(2);
    // the camera comes to rest, then the user zooms in short bursts (100 frames, 1.7 s) with 3 s of idle between: no burst lasts 10 s
    let up: number[] = [];
    for (let burst = 0; burst < 8; burst++) {
      t += 3000;
      const r = feed(g, t, 100, 16.7);
      t = r.t;
      up = up.concat(r.changes);
    }
    expect(up).toEqual([1, 0]);
    expect(g.level).toBe(0);
  });

  it("recovery does not come at once: a burst right after the degrade stays at the lower level", () => {
    const g = new FrameGovernor(GOVERNOR, clock({ continuous: true }));
    let t = feed(g, 1000, 100, 40).t;
    expect(g.level).toBe(1);
    t = feed(g, t + 3000, 150, 16.7).t;
    expect(g.level).toBe(1);
  });

  it("a really slow device settles: each undone recovery locks the level for longer", () => {
    const g = new FrameGovernor(GOVERNOR, clock({ continuous: true }));
    let t = 1000;
    const downs: number[] = [];
    // slow gestures separated by long rests
    for (let k = 0; k < 6; k++) {
      const r = feed(g, t, 150, 40);
      t = r.t + 15_000;
      if (r.changes.includes(1) || r.changes.includes(2)) downs.push(k);
      // a calm burst after each rest tries to recover
      t = feed(g, t, 120, 16.7).t;
    }
    const ups = g.history.filter((h) => h.to < h.from);
    const downsAfterUp = g.history.filter((h, i) => h.to > h.from && i > 0 && g.history[i - 1]!.to < g.history[i - 1]!.from);
    // never more recoveries than the backoff allows over six cycles
    expect(ups.length).toBeLessThanOrEqual(3);
    expect(downsAfterUp.length).toBeLessThanOrEqual(ups.length);
  });

  it("nothing is silent: every change is in `history`", () => {
    const g = new FrameGovernor(GOVERNOR, clock({ continuous: true }));
    feed(g, 1000, 600, 40);
    expect(g.history.length).toBe(2);
    expect(g.history[0]).toMatchObject({ from: 0, to: 1 });
    expect(g.history[0]!.p95).toBeGreaterThan(GOVERNOR.slowMs);
  });
});
