import { describe, expect, it } from "vitest";
import {
  angularDistance,
  cameraDistance,
  fitZoom,
  horizonAngle,
  lonLatToVec3,
  normalizeLon,
  projectLonLat,
  projectUnit,
  radiusPxToZoom,
  sampleRoute,
  shortestLonDelta,
  vec3ToLonLat,
  viewBasis,
  zoomToRadiusPx,
} from "./geo";

describe("lon/lat <-> vec3", () => {
  it("round-trips", () => {
    for (const [lon, lat] of [
      [0, 0],
      [-9.14, 38.72],
      [135.77, 35.01],
      [-179.9, -60],
      [174.78, -41.29],
    ] as const) {
      const r = vec3ToLonLat(lonLatToVec3(lon, lat));
      expect(r.lon).toBeCloseTo(lon, 8);
      expect(r.lat).toBeCloseTo(lat, 8);
    }
  });
  it("maps cardinal points", () => {
    expect(lonLatToVec3(0, 0)).toEqual([0, 0, 1]);
    expect(lonLatToVec3(90, 0)[0]).toBeCloseTo(1);
    expect(lonLatToVec3(0, 90)[1]).toBeCloseTo(1);
  });
});

describe("longitude helpers", () => {
  it("normalises", () => {
    expect(normalizeLon(190)).toBe(-170);
    expect(normalizeLon(-190)).toBe(170);
    expect(normalizeLon(180)).toBe(-180);
    expect(normalizeLon(540)).toBe(-180);
  });
  it("takes the shortest way across the antimeridian", () => {
    expect(shortestLonDelta(170, -170)).toBe(20);
    expect(shortestLonDelta(-170, 170)).toBe(-20);
    expect(shortestLonDelta(10, 40)).toBe(30);
  });
});

describe("zoom and camera", () => {
  it("round-trips zoom and radius", () => {
    expect(radiusPxToZoom(zoomToRadiusPx(3.3))).toBeCloseTo(3.3, 10);
  });
  it("is larger when zoomed out and closer when zoomed in", () => {
    expect(cameraDistance(1, 800)).toBeGreaterThan(cameraDistance(3, 800));
    expect(cameraDistance(6, 800)).toBeGreaterThan(1);
  });
  it("horizon cap grows as the camera moves away", () => {
    expect(horizonAngle(8)).toBeGreaterThan(horizonAngle(2));
    expect(horizonAngle(1.0001)).toBeLessThan(0.05);
  });
  it("fitZoom makes the silhouette fit within the margin", () => {
    const w = 900;
    const h = 700;
    const z = fitZoom(w, h, 0.1);
    const d = cameraDistance(z, h);
    const f = (h / 2) / Math.tan((36.87 * Math.PI) / 360);
    const silhouette = f / Math.sqrt(d * d - 1);
    expect(silhouette).toBeCloseTo((Math.min(w, h) / 2) * 0.9, 3);
  });
});

describe("projection and occlusion", () => {
  const w = 800;
  const h = 600;
  const view = { lon: 10, lat: 20, zoom: 2.2 };
  const basis = viewBasis(view, h);
  it("puts the view centre in the middle of the screen", () => {
    const p = projectLonLat(10, 20, basis, w, h);
    expect(p.x).toBeCloseTo(w / 2, 6);
    expect(p.y).toBeCloseTo(h / 2, 6);
    expect(p.visible).toBe(true);
    expect(p.facing).toBeCloseTo(1, 6);
  });
  it("places east to the right and north up", () => {
    const e = projectLonLat(15, 20, basis, w, h);
    const n = projectLonLat(10, 25, basis, w, h);
    expect(e.x).toBeGreaterThan(w / 2);
    expect(n.y).toBeLessThan(h / 2);
  });
  it("hides the far side", () => {
    const anti = projectLonLat(-170, -20, basis, w, h);
    expect(anti.visible).toBe(false);
    expect(anti.facing).toBe(0);
  });
  it("hides points just beyond the horizon and shows those just inside", () => {
    const hz = horizonAngle(basis.d) / (Math.PI / 180);
    expect(projectLonLat(10, 20 + hz - 0.5, basis, w, h).visible).toBe(true);
    expect(projectLonLat(10, 20 + hz + 0.5, basis, w, h).visible).toBe(false);
  });
  it("scale at the centre matches the zoom definition", () => {
    const a = projectLonLat(10, 20, basis, w, h);
    const b = projectLonLat(10 + 0.01 / Math.cos(20 * (Math.PI / 180)), 20, basis, w, h);
    const pxPerRad = (b.x - a.x) / (0.01 * (Math.PI / 180));
    expect(pxPerRad / zoomToRadiusPx(view.zoom)).toBeCloseTo(1, 2);
  });
});

describe("sampleRoute", () => {
  const stops = [
    [105.85, 21.03],
    [107.59, 16.46],
    [106.63, 10.82],
  ] as const;
  const r = sampleRoute(stops, { stepDeg: 0.5 });
  it("starts and ends at the stops, lifted only in between", () => {
    const first = r.positions.slice(0, 3);
    const last = r.positions.slice(-3);
    const f = vec3ToLonLat([first[0]!, first[1]!, first[2]!]);
    const l = vec3ToLonLat([last[0]!, last[1]!, last[2]!]);
    expect(f.lon).toBeCloseTo(105.85, 3);
    expect(l.lat).toBeCloseTo(10.82, 3);
    expect(Math.hypot(first[0]!, first[1]!, first[2]!)).toBeCloseTo(1, 6);
    const mid = r.positions.length / 6 | 0;
    expect(Math.hypot(r.positions[mid * 3]!, r.positions[mid * 3 + 1]!, r.positions[mid * 3 + 2]!)).toBeGreaterThan(1);
  });
  it("has monotonic cumulative distance equal to the sum of legs", () => {
    for (let i = 1; i < r.distance.length; i++) expect(r.distance[i]!).toBeGreaterThanOrEqual(r.distance[i - 1]!);
    const legs = angularDistance(105.85, 21.03, 107.59, 16.46) + angularDistance(107.59, 16.46, 106.63, 10.82);
    expect(r.length).toBeCloseTo(legs, 6);
    expect(r.distance[r.distance.length - 1]).toBeCloseTo(legs, 5);
  });
  it("never samples points that are not on the stop list's great circles (step bound)", () => {
    for (let i = 1; i < r.positions.length / 3; i++) {
      const a = [r.positions[i * 3 - 3]!, r.positions[i * 3 - 2]!, r.positions[i * 3 - 1]!] as const;
      const b = [r.positions[i * 3]!, r.positions[i * 3 + 1]!, r.positions[i * 3 + 2]!] as const;
      expect(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])).toBeLessThan(0.02);
    }
  });
  it("handles coincident stops", () => {
    const s = sampleRoute([[0, 0], [0, 0]]);
    expect(s.length).toBe(0);
    expect(s.positions.length).toBeGreaterThanOrEqual(6);
  });
});

describe("projectUnit", () => {
  it("is bit-identical to projectLonLat for the same point (the LOD tree keeps unit vectors)", () => {
    for (const view of [{ lon: 10, lat: 20, zoom: 2.5 }, { lon: -120, lat: -40, zoom: 5 }, { lon: 170, lat: 70, zoom: 6.4 }]) {
      const basis = viewBasis(view, 900);
      for (const [lon, lat] of [[0, 0], [12.3, 45.6], [-100, 33], [179, -80], [60, 10]] as const) {
        const a = projectLonLat(lon, lat, basis, 1440, 900, 1, 700);
        const v = lonLatToVec3(lon, lat);
        const b = projectUnit(v[0], v[1], v[2], basis, 900, 1, 700);
        expect(b).toEqual(a);
      }
    }
  });
  it("fills the object it is given", () => {
    const out = { x: 0, y: 0, visible: false, facing: 0 };
    const basis = viewBasis({ lon: 0, lat: 0, zoom: 3 }, 900);
    const r = projectUnit(0, 0, 1, basis, 900, 1, 720, out);
    expect(r).toBe(out);
    expect(out.x).toBeCloseTo(720, 6);
    expect(out.visible).toBe(true);
  });
});
