import { describe, expect, it } from "vitest";
import { hudLines, itemAngle, itemWidth, orbitAlpha, orbitPath, pathItems, tickGlow } from "./moon-overlay";

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
    expect(l[0]).toBe("SIM PHASE 062% WAXING GIBBOUS");
    expect(l[1]).toBe("SIM ORBIT 007\u00b0");
    expect(l[2]).toMatch(/^SIM ECLIPSE T-\d\d:\d\d$/);
  });
  it("says when the moon is in the shadow and when there is none", () => {
    expect(hudLines({ ...base, eclipse: { now: true, fromAngle: 0, peakAngle: 0, at: null, peakAt: null } })[2]).toBe("SIM ECLIPSE UNDER WAY");
    expect(hudLines({ ...base, eclipse: { now: false, fromAngle: null, peakAngle: null, at: null, peakAt: null } })[2]).toBe("NO ECLIPSE ON THIS ORBIT");
  });
});

describe("itemWidth and itemAngle", () => {
  it("takes room by the characters of the text", () => {
    expect(itemWidth("ABCD")).toBeGreaterThan(itemWidth("AB"));
  });
  it("turns an item along the orbit at its tick, reading left to right", () => {
    const ticks = [{ at: [0, 0] as [number, number] }, { at: [10, 0] as [number, number] }, { at: [20, 10] as [number, number] }];
    expect(itemAngle(ticks, 1)).toBeCloseTo(Math.atan2(10, 20) * (180 / Math.PI), 5);
    // going right to left is turned over, not upside down
    const back = [{ at: [20, 0] as [number, number] }, { at: [10, 0] as [number, number] }, { at: [0, 0] as [number, number] }];
    expect(itemAngle(back, 1)).toBeCloseTo(0, 5);
    expect(itemAngle([{ at: null }, { at: [1, 1] as [number, number] }, { at: null }], 1)).toBeNull();
    expect(itemAngle([{ at: null }, { at: null }, { at: null }], 1)).toBeNull();
  });
});

describe("pathItems", () => {
  const h = { orbit: [], ticks: [], lit: 0.5, waxing: true, angleDeg: 90, info: { range: 8.25, inclDeg: -12, phaseDeg: 90 } };
  it("has the orbit's real constants and the scene's own numbers above, the moon's now and the shadow's below, each said to be real or simulated", () => {
    const { above, below } = pathItems({ ...h, eclipse: { now: false, fromAngle: Math.PI / 2, peakAngle: Math.PI, at: null, peakAt: null } });
    expect(above).toContain("REAL MEAN RADIUS 384,400 KM");
    expect(above).toContain("REAL INCL 5.145\u00b0");
    expect(above).toContain("REAL ECC 0.0549");
    expect(above).toContain("REAL SIDEREAL 27.32 D");
    expect(above).toContain("REAL SYNODIC 29.53 D");
    expect(above).toContain("SIM RATE x6,557");
    expect(above).toContain("SIM LAP 06:00");
    expect(above).toContain("SIM VIEW ANGLE -12.0\u00b0");
    expect(above).toContain("SCENE 9.0 ER, RANGE 8.25 ER (NOT TO SCALE)");
    expect(below).toContain("SIM PHASE ANGLE 090\u00b0");
    expect(below).toContain("SIM SHADOW AT 180\u00b0 PEAK 270\u00b0");
    expect(below).toContain("SIM T-01:30");
  });
  it("puts the live REAL lines in, half above and half below, when it is given them (#631)", () => {
    const real = Array.from({ length: 15 }, (_, i) => `REAL LIVE ${i}`);
    const { above, below } = pathItems({ ...h, eclipse: { now: false, fromAngle: null, peakAngle: null, at: null, peakAt: null } }, real);
    expect(above).toEqual(expect.arrayContaining(real.slice(0, 7)));
    expect(below).toEqual(expect.arrayContaining(real.slice(7)));
  });
  it("never gives a scene constant as a physical quantity", () => {
    const { above, below } = pathItems({ ...h, eclipse: { now: false, fromAngle: Math.PI / 2, peakAngle: Math.PI, at: null, peakAt: null } });
    for (const line of [...above, ...below]) {
      if (line === "LUNA ORBIT" || line.startsWith("NO ") || line.startsWith("SHADOW NOT")) continue;
      expect(line, line).toMatch(/^(REAL|SIM|SCENE) /);
    }
    // (the scene's radius, period and angular speed are no longer printed as the orbit's)
    expect(above.join("|")).not.toMatch(/ANG VEL|RADIUS 9|PERIOD 06/);
  });
  it("says there is no shadow on a path that misses it", () => {
    const { below } = pathItems({ ...h, eclipse: { now: false, fromAngle: null, peakAngle: null, at: null, peakAt: null } });
    expect(below).toContain("SHADOW NOT ON PATH");
    expect(below).toContain("NO ECLIPSE");
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
