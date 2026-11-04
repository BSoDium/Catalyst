import { describe, expect, it } from "vitest";
import { hudLines, longestRun, orbitPath, pathLines } from "./moon-overlay";

describe("orbitPath", () => {
  it("draws runs of points and lifts the pen where the orbit is behind the camera", () => {
    expect(orbitPath([[0, 0], [1, 1], null, [5, 5], [6, 6]])).toBe("M0.0 0.0L1.0 1.0M5.0 5.0L6.0 6.0");
    expect(orbitPath([null, null])).toBe("");
  });
});

describe("hudLines", () => {
  const base = { orbit: [], ticks: [], lit: 0.62, waxing: true, angleDeg: 7.4, info: { range: 8.2, inclDeg: -12, phaseDeg: 70 } };
  it("reads the phase, the place on the orbit and the time to the shadow", () => {
    const l = hudLines({ ...base, eclipse: { now: false, fromAngle: Math.PI, peakAngle: null, at: null, peakAt: null } });
    expect(l[0]).toBe("PHASE 062% WAXING GIBBOUS");
    expect(l[1]).toBe("ORBIT 007\u00b0");
    expect(l[2]).toMatch(/^ECLIPSE IN \d\d:\d\d$/);
  });
  it("says when the moon is in the shadow and when there is none", () => {
    expect(hudLines({ ...base, eclipse: { now: true, fromAngle: 0, peakAngle: 0, at: null, peakAt: null } })[2]).toBe("ECLIPSE UNDER WAY");
    expect(hudLines({ ...base, eclipse: { now: false, fromAngle: null, peakAngle: null, at: null, peakAt: null } })[2]).toBe("NO ECLIPSE ON THIS ORBIT");
  });
});

describe("longestRun", () => {
  it("is the longest stretch of the orbit in view, put left to right", () => {
    expect(longestRun([[0, 0], [1, 0], null, [9, 0], [8, 0], [7, 0]])).toEqual([[7, 0], [8, 0], [9, 0]]);
    expect(longestRun([null, null])).toEqual([]);
  });
});

describe("pathLines", () => {
  const h = { orbit: [], ticks: [], lit: 0.5, waxing: true, angleDeg: 90, info: { range: 8.25, inclDeg: -12, phaseDeg: 90 } };
  it("runs the orbit's own numbers above the path and the moon's and the shadow's below", () => {
    const [a, b] = pathLines({ ...h, eclipse: { now: false, fromAngle: Math.PI / 2, peakAngle: Math.PI, at: null, peakAt: null } });
    expect(a).toContain("RADIUS 9.0 ER");
    expect(a).toContain("PERIOD 06:00");
    expect(a).toContain("ANG VEL 1.00\u00b0/S");
    expect(a).toContain("RANGE 8.25 ER");
    expect(b).toContain("PHASE ANGLE 090\u00b0");
    expect(b).toContain("SHADOW AT 180\u00b0 PEAK 270\u00b0");
    expect(b).toContain("T-01:30");
  });
  it("says there is no shadow on a path that misses it", () => {
    const [, b] = pathLines({ ...h, eclipse: { now: false, fromAngle: null, peakAngle: null, at: null, peakAt: null } });
    expect(b).toContain("SHADOW NOT ON PATH");
    expect(b).toContain("NO ECLIPSE");
  });
});
