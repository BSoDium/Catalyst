import { describe, expect, it } from "vitest";
import {
  MERCATOR_FROM,
  MESH_STEP,
  NO_WARP,
  buildWarpMesh,
  globeBasis,
  mercatorLonLat,
  mercatorXY,
  projectGlobe,
  projectMercator,
  sameCamera,
  unprojectGlobe,
  unprojectMercator,
  warpPoint,
  type WarpCamera,
} from "./warp";

const cam = (o: Partial<WarpCamera> = {}): WarpCamera => ({ lon: 2.35, lat: 48.85, zoom: 12, cx: 720, cy: 450, cell: 2.5, ...o });
const COLS = 576;
const ROWS = 360;

describe("mercator", () => {
  it("round-trips lon/lat through the unit square and the screen", () => {
    for (const [lon, lat] of [[0, 0], [2.35, 48.85], [-122.4, 37.8], [139.7, 35.7], [-58.4, -34.6]] as const) {
      const [x, y] = mercatorXY(lon, lat);
      const b = mercatorLonLat(x, y);
      expect(b.lon).toBeCloseTo(lon, 9);
      expect(b.lat).toBeCloseTo(lat, 9);
      const c = cam({ lon, lat, zoom: 14 });
      const s = projectMercator(c, lon + 0.001, lat + 0.0007);
      const u = unprojectMercator(c, s[0], s[1]);
      expect(u.lon).toBeCloseTo(lon + 0.001, 9);
      expect(u.lat).toBeCloseTo(lat + 0.0007, 9);
    }
  });
  it("the centre is at the projection centre", () => {
    const c = cam();
    const s = projectMercator(c, c.lon, c.lat);
    expect(s[0]).toBeCloseTo(c.cx, 9);
    expect(s[1]).toBeCloseTo(c.cy, 9);
  });
});

describe("globe", () => {
  it("un-projection is the inverse of projection on the facing hemisphere", () => {
    for (const z of [2.6, 4, 6, 9]) {
      const c = cam({ zoom: z, lat: 40 });
      const b = globeBasis(c);
      for (const [dx, dy] of [[0, 0], [60, -40], [-300, 200], [500, -150]] as const) {
        const x = c.cx + dx;
        const y = c.cy + dy;
        const ll = unprojectGlobe(c, b, x, y);
        if (!ll) continue;
        const s = projectGlobe(c, b, ll.lon, ll.lat)!;
        expect(s[0]).toBeCloseTo(x, 6);
        expect(s[1]).toBeCloseTo(y, 6);
      }
    }
  });
  it("rays that miss the globe have no ground", () => {
    const c = cam({ zoom: 1.2, lat: 0, lon: 0 });
    expect(unprojectGlobe(c, globeBasis(c), c.cx + 700, c.cy)).toBeNull();
  });
});

describe("warp mesh", () => {
  it("identical cameras: identity, nothing moved", () => {
    const m = buildWarpMesh(cam(), cam(), COLS, ROWS);
    expect(m.kind).toBe("identity");
    expect(m.maxShift).toBe(0);
    expect(m.exact).toBe(true);
  });
  it("sameCamera tolerates float noise and nothing else", () => {
    expect(sameCamera(cam(), cam({ lon: 2.35 + 1e-12 }))).toBe(true);
    expect(sameCamera(cam(), cam({ lon: 2.35 + 1e-6 }))).toBe(false);
    expect(sameCamera(cam(), cam({ cx: 721 }))).toBe(false);
  });
  it("a Mercator pan by a whole number of cells is exactly that translation", () => {
    const a = cam();
    const cells = 7;
    const dLon = ((cells * a.cell) / (512 * 2 ** a.zoom)) * 360;
    const b = cam({ lon: a.lon + dLon });
    const m = buildWarpMesh(a, b, COLS, ROWS);
    expect(m.kind).toBe("mercator");
    expect(m.exact).toBe(true);
    expect(m.maxShift).toBeCloseTo(cells, 3);
    // the new cell (u, v) was at (u + 7, v) in the previous frame: the camera went east, content moves west
    const p = warpPoint(m, 100.5, 80.5)!;
    expect(p[0]).toBeCloseTo(100.5 + cells, 3);
    expect(p[1]).toBeCloseTo(80.5, 3);
  });
  it("a fractional pan is not exact", () => {
    const a = cam();
    const b = cam({ lon: a.lon + ((0.37 * a.cell) / (512 * 2 ** a.zoom)) * 360 });
    expect(buildWarpMesh(a, b, COLS, ROWS).exact).toBe(false);
  });
  it("Mercator: a ground point's cell at the new camera maps to its cell at the previous one (zoom and pan)", () => {
    const a = cam({ zoom: 13.2, lon: 106.7, lat: 10.77 });
    const b = cam({ zoom: 13.27, lon: 106.7031, lat: 10.7712 });
    const m = buildWarpMesh(a, b, COLS, ROWS);
    let worst = 0;
    for (let k = 0; k < 40; k++) {
      const sx = 40 + ((k * 37) % 1300);
      const sy = 30 + ((k * 91) % 820);
      const ll = unprojectMercator(b, sx, sy);
      const was = projectMercator(a, ll.lon, ll.lat);
      const p = warpPoint(m, sx / b.cell, sy / b.cell)!;
      worst = Math.max(worst, Math.hypot(p[0] - was[0] / a.cell, p[1] - was[1] / a.cell));
    }
    expect(worst).toBeLessThan(1e-3);
  });
  it("globe: same property below the Mercator zoom, to a fraction of a cell (the mesh interpolates a smooth map)", () => {
    for (const z of [3.1, 5, 8]) {
      const a = cam({ zoom: z, lon: 10, lat: 45 });
      const b = cam({ zoom: z + 0.05, lon: 10.4, lat: 45.2 });
      expect(a.zoom).toBeLessThan(MERCATOR_FROM);
      const m = buildWarpMesh(a, b, COLS, ROWS);
      expect(m.kind).toBe("globe");
      const ba = globeBasis(a);
      const bb = globeBasis(b);
      let worst = 0;
      let n = 0;
      for (let k = 0; k < 60; k++) {
        const sx = 100 + ((k * 53) % 1200);
        const sy = 60 + ((k * 101) % 760);
        const ll = unprojectGlobe(b, bb, sx, sy);
        const was = ll ? projectGlobe(a, ba, ll.lon, ll.lat) : null;
        const p = was ? warpPoint(m, sx / b.cell, sy / b.cell) : null;
        if (!was || !p) continue;
        worst = Math.max(worst, Math.hypot(p[0] - was[0] / a.cell, p[1] - was[1] / a.cell));
        n++;
      }
      expect(n).toBeGreaterThan(30);
      expect(worst, `zoom ${z}`).toBeLessThan(0.3);
    }
  });
  it("cells off the globe have no previous position", () => {
    const a = cam({ zoom: 2.2, lon: 0, lat: 0, cx: 720, cy: 450 });
    const b = cam({ zoom: 2.2, lon: 1, lat: 0, cx: 720, cy: 450 });
    const m = buildWarpMesh(a, b, COLS, ROWS);
    expect(m.kind).toBe("globe");
    expect(m.data[0]).toBe(NO_WARP); // the corner of the viewport is outside the disc at this zoom
    expect(warpPoint(m, 1, 1)).toBeNull();
    expect(warpPoint(m, COLS / 2, ROWS / 2)).not.toBeNull();
  });
  it("the mesh covers the whole grid at MESH_STEP", () => {
    const m = buildWarpMesh(cam(), cam({ lon: 2.351 }), COLS, ROWS);
    expect(m.mw).toBe(Math.ceil(COLS / MESH_STEP) + 1);
    expect(m.mh).toBe(Math.ceil(ROWS / MESH_STEP) + 1);
    expect(warpPoint(m, COLS - 0.5, ROWS - 0.5)).not.toBeNull();
  });
});
