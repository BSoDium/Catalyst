import { describe, expect, it } from "vitest";
import { hudLines, orbitPath } from "./moon-overlay";

describe("orbitPath", () => {
  it("draws runs of points and lifts the pen where the orbit is behind the camera", () => {
    expect(orbitPath([[0, 0], [1, 1], null, [5, 5], [6, 6]])).toBe("M0.0 0.0L1.0 1.0M5.0 5.0L6.0 6.0");
    expect(orbitPath([null, null])).toBe("");
  });
});

describe("hudLines", () => {
  const base = { orbit: [], ticks: [], lit: 0.62, waxing: true, angleDeg: 7.4 };
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
