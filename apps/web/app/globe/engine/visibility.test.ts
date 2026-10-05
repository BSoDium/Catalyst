import { describe, expect, it } from "vitest";
import { horizonAngle, projectLonLat, viewBasis } from "./geo";
import { TUNING } from "./tuning";
import { limbClearance, markerShown, silhouetteRadius } from "./visibility";

const DEG = Math.PI / 180;
const W = 1440;
const H = 900;
/** Clearance in CSS px for a 3 px art pixel, as the renderer passes it. */
const CLEARANCE = TUNING.markerLimbClearance * 3;

function shown(view: { lon: number; lat: number; zoom: number }, lon: number, lat: number, centreX = W / 2, clearance = CLEARANCE) {
  const basis = viewBasis(view, H);
  const p = projectLonLat(lon, lat, basis, W, H, 1, centreX);
  return markerShown(p, basis, centreX, H / 2, clearance);
}

describe("silhouette", () => {
  it("equals the screen radius of a point exactly on the horizon", () => {
    for (const zoom of [0.5, 2.2, 3.6, 5.5]) {
      const basis = viewBasis({ lon: 10, lat: 20, zoom }, H);
      const hz = horizonAngle(basis.d) / DEG;
      const limb = projectLonLat(10, 20 + hz, basis, W, H);
      expect(Math.hypot(limb.x - W / 2, limb.y - H / 2)).toBeCloseTo(silhouetteRadius(basis), 4);
    }
  });

  it("clearance is the silhouette radius at the view centre and 0 on the limb", () => {
    const basis = viewBasis({ lon: 10, lat: 20, zoom: 2.2 }, H);
    const centre = projectLonLat(10, 20, basis, W, H);
    expect(limbClearance(centre, basis, W / 2, H / 2)).toBeCloseTo(silhouetteRadius(basis), 6);
    const limb = projectLonLat(10, 20 + horizonAngle(basis.d) / DEG, basis, W, H);
    expect(limbClearance(limb, basis, W / 2, H / 2)).toBeCloseTo(0, 4);
  });
});

describe("whole-marker visibility", () => {
  const view = { lon: 10, lat: 20, zoom: 2.2 };

  it("shows markers in the middle and hides the far side", () => {
    expect(shown(view, 10, 20)).toBe(true);
    expect(shown(view, 25, 35)).toBe(true);
    expect(shown(view, -170, -20)).toBe(false);
    expect(shown(view, 10 + 180, -20)).toBe(false);
  });

  it("hides a marker whose centre is on or just inside the limb, even though it is geometrically in front", () => {
    const basis = viewBasis(view, H);
    const hz = horizonAngle(basis.d) / DEG;
    const justInside = projectLonLat(10, 20 + hz - 0.2, basis, W, H);
    expect(justInside.visible).toBe(true); // front hemisphere, so labels and the old test said yes
    expect(shown(view, 10, 20 + hz - 0.2)).toBe(false); // but its footprint would overhang the limb
    expect(shown(view, 10, 20 + hz + 0.2)).toBe(false);
  });

  it("flips exactly once on the way to the limb, at the clearance", () => {
    // Walk a marker from the view centre out to the far side along a meridian, in 0.05 degree steps.
    const basis = viewBasis(view, H);
    const results: boolean[] = [];
    let lastShownClearance = Infinity;
    let firstHiddenFront: number | null = null;
    for (let a = 0; a <= 120; a += 0.05) {
      const lat = 20 + a;
      const over = lat > 90; // past the pole: same meridian plane, other side
      const p = projectLonLat(over ? 190 : 10, over ? 180 - lat : lat, basis, W, H, 1);
      const s = markerShown(p, basis, W / 2, H / 2, CLEARANCE);
      results.push(s);
      const c = limbClearance(p, basis, W / 2, H / 2);
      if (s) lastShownClearance = c;
      else if (p.visible && firstHiddenFront === null) firstHiddenFront = c;
    }
    const flips = results.filter((v, i) => i > 0 && v !== results[i - 1]).length;
    expect(flips).toBe(1);
    expect(results[0]).toBe(true);
    expect(results[results.length - 1]).toBe(false);
    expect(lastShownClearance).toBeGreaterThanOrEqual(CLEARANCE);
    expect(firstHiddenFront!).toBeLessThan(CLEARANCE);
  });

  it("treats north and south alike (no hemisphere bias)", () => {
    const equator = { lon: 0, lat: 0, zoom: 2.4 };
    for (let a = 0; a <= 100; a += 0.5) {
      expect(shown(equator, 0, a)).toBe(shown(equator, 0, -a));
      expect(shown(equator, a, 0)).toBe(shown(equator, -a, 0));
    }
    // And a marker above the centre behaves like the mirrored one below, at any view latitude.
    const north = { lon: 0, lat: 40, zoom: 2.4 };
    const south = { lon: 0, lat: -40, zoom: 2.4 };
    for (let a = -100; a <= 100; a += 0.5) expect(shown(north, 0, 40 + a)).toBe(shown(south, 0, -(40 + a)));
  });

  it("does not depend on where the projection centre is (detail panel inset)", () => {
    // Same view drawn around a shifted centre: the decision is about the globe, not the screen position.
    for (const lon of [-60, -30, 0, 30, 60, 80]) {
      expect(shown(view, 10 + lon, 20, W / 2 - 360)).toBe(shown(view, 10 + lon, 20, W / 2));
    }
  });

  it("keeps everything near the view centre at high zoom, where the limb is far off screen", () => {
    const zoomed = { lon: 2.35, lat: 48.86, zoom: 5.5 };
    for (const [dlon, dlat] of [[0, 0], [3, 2], [-3, 2], [3, -2], [-3, -2], [6, 0]] as const) {
      expect(shown(zoomed, 2.35 + dlon, 48.86 + dlat)).toBe(true);
    }
  });

  it("clearance covers the largest marker (the 9 px ring is 4 px each side of its centre)", () => {
    expect(TUNING.markerLimbClearance).toBeGreaterThanOrEqual(4);
  });

  it("is a pure function of its inputs (no hidden state, so no flicker)", () => {
    const basis = viewBasis(view, H);
    const p = projectLonLat(60, 20, basis, W, H);
    const first = markerShown(p, basis, W / 2, H / 2, CLEARANCE);
    for (let i = 0; i < 5; i++) expect(markerShown(p, basis, W / 2, H / 2, CLEARANCE)).toBe(first);
  });
});
