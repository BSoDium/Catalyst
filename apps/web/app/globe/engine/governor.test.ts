import { describe, expect, it } from "vitest";
import { FrameGovernor, GOVERNOR } from "./governor";

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
    r = feed(g, r.t, 20, 40);
    expect(g.level).toBe(1);
    r = feed(g, r.t, 1500, 16.7); // 25 s of calm: no step up (locked)
    expect(g.level).toBe(1);
  });
});
