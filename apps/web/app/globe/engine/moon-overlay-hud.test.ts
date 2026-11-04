import { describe, expect, it } from "vitest";
import { orbitAlpha, tickGlow, alongText, hudLines, orbitPath, pathItems, runLength, runs } from "./moon-overlay";

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

describe("runs", () => {
  it("is every stretch of the orbit in view, each put left to right", () => {
    expect(runs([[0, 0], [1, 0], null, [9, 0], [8, 0], [7, 0]])).toEqual([[[0, 0], [1, 0]], [[7, 0], [8, 0], [9, 0]]]);
    expect(runs([null, [1, 1], null])).toEqual([]);
  });
  it("measures a run", () => {
    expect(runLength([[0, 0], [3, 4], [3, 10]])).toBe(11);
  });
});

describe("pathItems and alongText", () => {
  const h = { orbit: [], ticks: [], lit: 0.5, waxing: true, angleDeg: 90, info: { range: 8.25, inclDeg: -12, phaseDeg: 90 } };
  it("has the orbit's own numbers above and the moon's and the shadow's below", () => {
    const { above, below } = pathItems({ ...h, eclipse: { now: false, fromAngle: Math.PI / 2, peakAngle: Math.PI, at: null, peakAt: null } });
    expect(above).toContain("RADIUS 9.0 ER");
    expect(above).toContain("PERIOD 06:00");
    expect(above).toContain("RANGE 8.25 ER");
    expect(below).toContain("PHASE ANGLE 090\u00b0");
    expect(below).toContain("SHADOW AT 180\u00b0 PEAK 270\u00b0");
    expect(below).toContain("T-01:30");
  });
  it("says there is no shadow on a path that misses it", () => {
    const { below } = pathItems({ ...h, eclipse: { now: false, fromAngle: null, peakAngle: null, at: null, peakAt: null } });
    expect(below).toContain("SHADOW NOT ON PATH");
    expect(below).toContain("NO ECLIPSE");
  });
  it("sets the items one after another with blanks, and no separator, until the path is full", () => {
    const text = alongText(["A", "B"], 200);
    expect(text).not.toMatch(/[/|]/);
    expect(text.startsWith("A\u00a0")).toBe(true);
    expect(text.length).toBeGreaterThanOrEqual(Math.ceil(200 / 6.1));
    expect(alongText(["A", "B"], 5, 1).startsWith("B")).toBe(true);
  });
});

describe("tickGlow and orbitAlpha", () => {
  it("tints most at a graduation and least half way between two", () => {
    expect(tickGlow(30)).toBe(1);
    expect(tickGlow(40.0)).toBe(1);
    expect(tickGlow(35)).toBe(0);
    expect(tickGlow(32)).toBeGreaterThan(tickGlow(34));
    expect(tickGlow(-10)).toBe(1);
  });
  it("maps the glow to a line that is faint but never gone", () => {
    expect(orbitAlpha(1)).toBeGreaterThan(orbitAlpha(0.5));
    expect(orbitAlpha(0)).toBeGreaterThan(0);
    expect(orbitAlpha(2)).toBe(orbitAlpha(1));
  });
});
