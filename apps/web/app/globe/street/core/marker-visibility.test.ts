import { describe, expect, it } from "vitest";
import { projectLonLat, viewBasis } from "../../engine/geo";
import { markerShown } from "../../engine/visibility";
import { MERCATOR_FROM, footprintInside, markerDrawn, onVisibleGlobe, type MarkerViewport } from "./marker-visibility";
import { registerMapToGlobe, type MapView } from "./registration";

const vp: MarkerViewport = { width: 1440, height: 900, centreX: 720 };
const CELL = 3;

describe("markers are drawn whole or not at all", () => {
  it("rejects any footprint that crosses the container edge, by a single cell", () => {
    // a 9-cell marker has a 27 px footprint: the centre must be at least 13.5 px from every edge
    expect(footprintInside(13.5, 450, 9, CELL, vp)).toBe(true);
    expect(footprintInside(12, 450, 9, CELL, vp)).toBe(false);
    expect(footprintInside(1440 - 13.5, 450, 9, CELL, vp)).toBe(true);
    expect(footprintInside(1440 - 12, 450, 9, CELL, vp)).toBe(false);
    expect(footprintInside(720, 12, 9, CELL, vp)).toBe(false);
    expect(footprintInside(720, 900 - 12, 9, CELL, vp)).toBe(false);
    // the small marker is allowed closer to the edge
    expect(footprintInside(5, 450, 3, CELL, vp)).toBe(true);
  });

  it("shows places on the visible globe and hides the ones on the far side or at the limb", () => {
    const view: MapView = { lon: 10, lat: 20, zoom: 3.5 };
    expect(onVisibleGlobe({ lon: 10, lat: 20 }, view, vp, CELL)).toBe(true);
    expect(onVisibleGlobe({ lon: 10 + 180, lat: -20 }, view, vp, CELL)).toBe(false);
    expect(onVisibleGlobe({ lon: 10 + 100, lat: 20 }, view, vp, CELL)).toBe(false);
  });

  it("agrees with the globe's rule: shown iff front hemisphere and >= 4 art pixels inside the silhouette", () => {
    const view: MapView = { lon: 0, lat: 0, zoom: 3 };
    const basis = viewBasis(registerMapToGlobe(view), vp.height);
    let flips = 0;
    let last: boolean | null = null;
    for (let lon = 0; lon <= 100; lon += 0.25) {
      const p = projectLonLat(lon, 0, basis, vp.width, vp.height, 1, vp.centreX);
      const expected = markerShown(p, basis, vp.centreX, vp.height / 2, 4 * CELL);
      expect(onVisibleGlobe({ lon, lat: 0 }, view, vp, CELL)).toBe(expected);
      if (last !== null && last !== expected) flips++;
      last = expected;
    }
    expect(flips).toBe(1); // monotone: one transition from shown to hidden on the way to the limb
  });

  it("in the Mercator regime every place is on the visible side", () => {
    const view: MapView = { lon: 10, lat: 20, zoom: MERCATOR_FROM + 0.1 };
    expect(onVisibleGlobe({ lon: 190, lat: -20 }, view, vp, CELL)).toBe(true);
  });

  it("combines both rules", () => {
    const view: MapView = { lon: 106.7, lat: 10.78, zoom: 14 };
    expect(markerDrawn({ lon: 106.7, lat: 10.78 }, { x: 720.5, y: 450.5 }, 9, view, vp, CELL)).toBe(true);
    expect(markerDrawn({ lon: 106.7, lat: 10.78 }, { x: 4.5, y: 450.5 }, 9, view, vp, CELL)).toBe(false);
  });

  it("is invariant under the inset shift: the globe is only translated, so the near side does not change", () => {
    const shifted: MarkerViewport = { ...vp, centreX: 360 };
    const view: MapView = { lon: 0, lat: 0, zoom: 3 };
    for (let lon = 0; lon <= 100; lon += 0.5) {
      expect(onVisibleGlobe({ lon, lat: 0 }, view, shifted, CELL)).toBe(onVisibleGlobe({ lon, lat: 0 }, view, vp, CELL));
    }
  });
});
