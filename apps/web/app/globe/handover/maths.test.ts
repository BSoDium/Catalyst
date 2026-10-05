import { describe, expect, it } from "vitest";
import { TUNING } from "../engine/tuning";
import {
  GLOBE_MAX_ZOOM,
  HANDOVER,
  blendAt,
  blendTarget,
  fromMapZoom,
  mountWanted,
  overlayOwner,
  routeLift,
  slew,
  streetSelectZoom,
  toMapZoom,
  zoomCeiling,
} from "./maths";

describe("dissolve", () => {
  it("is 0 below the band, 1 above it, monotonic and smooth inside", () => {
    expect(blendAt(HANDOVER.blendStart - 0.5)).toBe(0);
    expect(blendAt(HANDOVER.blendEnd + 0.5)).toBe(1);
    let prev = 0;
    for (let z = HANDOVER.blendStart; z <= HANDOVER.blendEnd; z += 0.01) {
      const b = blendAt(z);
      expect(b).toBeGreaterThanOrEqual(prev);
      prev = b;
    }
    expect(blendAt((HANDOVER.blendStart + HANDOVER.blendEnd) / 2)).toBeCloseTo(0.5);
  });
  it("finishes before the Three.js globe's own maximum, and starts after the street map follows", () => {
    expect(HANDOVER.blendEnd).toBeLessThan(GLOBE_MAX_ZOOM);
    expect(HANDOVER.followZoom).toBeLessThan(HANDOVER.blendStart);
    expect(HANDOVER.mountZoom).toBeLessThan(HANDOVER.followZoom);
    expect(HANDOVER.unmountZoom).toBeLessThan(HANDOVER.mountZoom);
  });
  it("shows nothing while the street map is unusable, except up in street scale (retreat)", () => {
    expect(blendTarget(5.2, false)).toBe(0);
    expect(blendTarget(6.4, false)).toBe(0);
    expect(blendTarget(9, false)).toBe(1);
    expect(blendTarget(5.2, true)).toBeCloseTo(blendAt(5.2));
  });
});

describe("slew limiter", () => {
  it("moves at most one full swing per dissolveMs and lands exactly", () => {
    expect(slew(0, 1, 45, 450)).toBeCloseTo(0.1);
    expect(slew(0.95, 1, 45, 450)).toBe(1);
    expect(slew(1, 0, 90, 450)).toBeCloseTo(0.8);
    expect(slew(0.3, 0.3, 16, 450)).toBe(0.3);
  });
  it("is instant with a zero duration", () => {
    expect(slew(0, 1, 16, 0)).toBe(1);
  });
});

describe("overlay owner hysteresis", () => {
  it("does not flap around the threshold", () => {
    let o = overlayOwner("globe", 0.5);
    expect(o).toBe("globe");
    o = overlayOwner(o, HANDOVER.overlayIn);
    expect(o).toBe("street");
    // jitter between the two thresholds changes nothing
    for (const b of [0.78, 0.7, 0.72, 0.79, 0.67]) expect(overlayOwner(o, b)).toBe("street");
    expect(overlayOwner("street", HANDOVER.overlayOut)).toBe("globe");
    for (const b of [0.7, 0.75, 0.66]) expect(overlayOwner("globe", b)).toBe("globe");
  });
});

describe("mount hysteresis", () => {
  it("mounts at mountZoom, stays until unmountZoom, and a wanted place keeps it", () => {
    expect(mountWanted(false, HANDOVER.mountZoom - 0.1, false)).toBe(false);
    expect(mountWanted(false, HANDOVER.mountZoom, false)).toBe(true);
    expect(mountWanted(true, HANDOVER.mountZoom - 0.1, false)).toBe(true);
    expect(mountWanted(true, HANDOVER.unmountZoom - 0.1, false)).toBe(false);
    expect(mountWanted(false, 2, true)).toBe(true);
  });
});

describe("registration of the unified zoom", () => {
  it("round-trips and agrees with the street module's rule", () => {
    for (const lat of [0, 10.8, 40, 60, -33]) {
      expect(fromMapZoom(toMapZoom(5.3, lat), lat)).toBeCloseTo(5.3, 12);
      expect(toMapZoom(5, lat)).toBeCloseTo(5 + Math.log2(Math.cos((lat * Math.PI) / 180)), 12);
    }
  });
  it("selects at the street zoom for the latitude, deeper than the globe maximum", () => {
    expect(streetSelectZoom(10.8)).toBeGreaterThan(GLOBE_MAX_ZOOM);
    expect(toMapZoom(streetSelectZoom(48.9), 48.9)).toBeCloseTo(HANDOVER.streetMapZoom, 12);
  });
  it("ceiling: the globe's maximum without a street map, the street map's maximum with one", () => {
    expect(zoomCeiling(30, false)).toBe(TUNING.maxZoom);
    expect(toMapZoom(zoomCeiling(30, true), 30)).toBeCloseTo(TUNING.streetMapMaxZoom, 12);
  });
});

describe("route arcs", () => {
  it("are lifted on the globe and flat before the dissolve starts", () => {
    expect(routeLift(3)).toBe(1);
    expect(routeLift(HANDOVER.routeFlat.end)).toBe(0);
    expect(HANDOVER.routeFlat.end).toBeLessThanOrEqual(HANDOVER.blendStart);
  });
});
