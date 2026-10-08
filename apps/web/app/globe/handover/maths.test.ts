import { describe, expect, it } from "vitest";
import { TUNING } from "../engine/tuning";
import { bordersWanted, borderLevel, peakLevel } from "../engine/palette";
import { EASE } from "../street/core/ease";
import { DEFAULT_HANDOFF, borderHandoff } from "../street/style/street-style";
import { STREET_TUNING } from "../street/tuning";
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
  cutWanted,
  selectionZoom,
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
  it("selection zoom: exactly the framing with a street map (in or out), capped by its maximum", () => {
    expect(selectionZoom(10.8, 38.7, true, 2)).toBe(10.8);
    expect(selectionZoom(10.8, 38.7, true, 14)).toBe(10.8); // zooms out to the framing too
    expect(toMapZoom(selectionZoom(30, 48.9, true, 2), 48.9)).toBeCloseTo(TUNING.streetMapMaxZoom, 12);
  });
  it("selection zoom without a street map: the regional select zoom, never zooming out, or the framing if further out", () => {
    expect(selectionZoom(10.8, 38.7, false, 1)).toBe(TUNING.selectZoom);
    expect(selectionZoom(10.8, 38.7, false, 5)).toBe(5);
    expect(selectionZoom(2.4, 38.7, false, 1)).toBe(2.4);
  });
  it("ceiling: the globe's maximum without a street map, the street map's maximum with one", () => {
    expect(zoomCeiling(30, false)).toBe(TUNING.maxZoom);
    expect(toMapZoom(zoomCeiling(30, true), 30)).toBeCloseTo(TUNING.streetMapMaxZoom, 12);
  });
});

describe("route arcs", () => {
  it("are lifted on the globe and flat before the dissolve starts", () => {
    expect(routeLift(HANDOVER.routeFlat.start - 0.1)).toBe(1);
    expect(routeLift(HANDOVER.routeFlat.end)).toBe(0);
    expect(HANDOVER.routeFlat.end).toBeLessThanOrEqual(HANDOVER.blendStart);
  });
});

describe("the early cut (owner: the switch to the high-resolution coast and borders came too late)", () => {
  it("is at least a zoom and a half before the old cut (5.05), after the globe's own borders are on", () => {
    expect(HANDOVER.cutZoom).toBeLessThanOrEqual(5.05 - 1.3);
    // the globe's borders are ON from TUNING.borderZoom.on (a timed tone ramp, then the peak level), well below the cut and the cut back: at both
    // renderers are at the same tone, so the swap changes the geometry only
    for (const z of [HANDOVER.cutZoom, HANDOVER.cutBackZoom]) {
      expect(bordersWanted(false, z, TUNING.borderZoom), `zoom ${z}`).toBe(true);
      expect(z).toBeGreaterThan(TUNING.borderZoom.on + TUNING.borderZoom.band + 0.1); // a fade of 200 ms is long over by the time the camera gets there
    }
    expect(borderLevel(1, 12)).toBe(peakLevel(12));
  });
  it("the street map's tile coast takes over from the first zoom it can have at the cut, at any latitude the app reaches", () => {
    // the cut in MapLibre zoom: unified zoom + log2 cos(lat). At 70 degrees it is the lowest a place can be framed at
    const lowest = toMapZoom(HANDOVER.cutBackZoom, 70);
    expect(DEFAULT_HANDOFF.openmaptiles).toBeLessThanOrEqual(lowest);
    expect(borderHandoff(DEFAULT_HANDOFF.openmaptiles)).toBeLessThanOrEqual(lowest);
    expect(lowest).toBeGreaterThanOrEqual(STREET_TUNING.minZoom);
  });
  it("the map is created and follows before the cut, so its tiles are in when the camera gets there", () => {
    expect(HANDOVER.mountZoom).toBeLessThan(HANDOVER.followZoom);
    expect(HANDOVER.followZoom).toBeLessThanOrEqual(HANDOVER.cutBackZoom - 0.3);
    expect(HANDOVER.cutBackZoom).toBeLessThan(HANDOVER.cutZoom);
    expect(HANDOVER.routeFlat.end).toBeLessThanOrEqual(HANDOVER.cutZoom);
  });
  it("waits a moment for the tiles but not long: the world lines stand in for them while they load", () => {
    expect(HANDOVER.cutMaxWaitMs).toBeGreaterThanOrEqual(500);
    expect(HANDOVER.cutMaxWaitMs).toBeLessThanOrEqual(2500);
  });
  it("the swap is a tone cross-fade of a quarter of a second: as long as the loudest map tone takes to climb", () => {
    expect(HANDOVER.crossfadeMs).toBeGreaterThanOrEqual(EASE.msPerLevel * peakLevel(12));
    expect(HANDOVER.crossfadeMs).toBeLessThanOrEqual(400);
  });
});

describe("cut", () => {
  it("is off below the threshold, on above it, and holds with hysteresis in between", () => {
    expect(cutWanted(false, HANDOVER.cutZoom - 0.01, true)).toBe(false);
    expect(cutWanted(false, HANDOVER.cutZoom, true)).toBe(true);
    expect(cutWanted(true, HANDOVER.cutZoom - 0.01, true)).toBe(true);
    expect(cutWanted(true, HANDOVER.cutBackZoom - 0.01, true)).toBe(false);
  });
  it("hysteresis band is non-empty and sits inside the mount-to-globe-max range", () => {
    expect(HANDOVER.cutBackZoom).toBeLessThan(HANDOVER.cutZoom);
    expect(HANDOVER.cutBackZoom).toBeGreaterThan(HANDOVER.followZoom);
    expect(HANDOVER.cutZoom).toBeLessThan(GLOBE_MAX_ZOOM);
  });
  it("an unusable street map shows nothing, unless the camera is still above the globe's maximum (retreat)", () => {
    expect(cutWanted(true, 5.5, false)).toBe(false);
    expect(cutWanted(true, GLOBE_MAX_ZOOM + 1, false)).toBe(true);
  });
});
