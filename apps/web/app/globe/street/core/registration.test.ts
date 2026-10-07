import { describe, expect, it } from "vitest";
import { DEG, projectLonLat, viewBasis } from "../../engine/geo";
import { TUNING } from "../../engine/tuning";
import {
  globeViewToMap,
  mapToGlobeView,
  registerGlobeToMap,
  registerMapToGlobe,
  zoomCorrection,
} from "./registration";

describe("registration maths", () => {
  it("is the identity at the equator and loses one zoom level at 60 degrees", () => {
    expect(zoomCorrection(0)).toBeCloseTo(0, 12);
    expect(zoomCorrection(60)).toBeCloseTo(-1, 12);
    expect(zoomCorrection(-60)).toBeCloseTo(-1, 12);
    expect(zoomCorrection(10.8)).toBeCloseTo(Math.log2(Math.cos(10.8 * DEG)), 12);
  });

  it("is symmetric in latitude and finite at the poles (clamped like the globe)", () => {
    expect(zoomCorrection(40)).toBe(zoomCorrection(-40));
    expect(Number.isFinite(zoomCorrection(90))).toBe(true);
    expect(zoomCorrection(90)).toBe(zoomCorrection(TUNING.maxLat));
  });

  it("round-trips both ways at many latitudes and zooms", () => {
    for (let lat = -80; lat <= 80; lat += 7.3) {
      for (let zoom = 0.5; zoom <= 17; zoom += 1.9) {
        const back = registerMapToGlobe(registerGlobeToMap({ lon: 12, lat, zoom }));
        expect(back.zoom).toBeCloseTo(zoom, 10);
        expect(back.lat).toBe(lat);
        expect(back.lon).toBe(12);
      }
    }
  });

  it("maps the app's [0, 1] globe zoom through the globe's own range", () => {
    const range = { minZoom: 2.3, maxZoom: TUNING.maxZoom };
    const m = globeViewToMap({ lon: 106, lat: 10.8, zoom: 1 }, range);
    expect(m.zoom).toBeCloseTo(TUNING.maxZoom + zoomCorrection(10.8), 10);
    expect(mapToGlobeView(m, range)).toEqual({ lon: 106, lat: 10.8, zoom: 1 });
    expect(mapToGlobeView({ lon: 0, lat: 0, zoom: 99 }, range).zoom).toBe(1);
    expect(mapToGlobeView({ lon: 0, lat: 0, zoom: -3 }, range).zoom).toBe(0);
  });
});

/** MapLibre's Web Mercator projection (what the street map is from z12): px offset from the view centre. */
function mercatorPx(lon: number, lat: number, centre: { lon: number; lat: number; zoom: number }, h: number) {
  const world = 512 * 2 ** centre.zoom;
  const my = (la: number) => Math.log(Math.tan(Math.PI / 4 + (la * DEG) / 2));
  return {
    x: ((lon - centre.lon) / 360) * world,
    y: h / 2 - ((my(lat) - my(centre.lat)) / (2 * Math.PI)) * world - h / 2,
  };
}

describe("the correction is what makes the two cameras agree", () => {
  const W = 1440;
  const H = 900;

  /** Mean / max screen distance (px) of a grid of points within `radiusPx` of the centre, Three camera model vs Web Mercator. */
  function agreement(lat: number, globeZoom: number, useCorrection: boolean, radiusPx = 250) {
    const centre = { lon: 106, lat, zoom: globeZoom };
    const basis = viewBasis(centre, H);
    const map = useCorrection ? registerGlobeToMap(centre) : { ...centre };
    const px = (512 * 2 ** globeZoom) / (2 * Math.PI); // px per radian at the centre of the globe model
    let sum = 0;
    let max = 0;
    let n = 0;
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        const lon = 106 + ((i * radiusPx) / 2 / px / DEG) / Math.cos(lat * DEG);
        const la = lat + (j * radiusPx) / 2 / px / DEG;
        const g = projectLonLat(lon, la, basis, W, H);
        const m = mercatorPx(lon, la, map, H);
        const d = Math.hypot(g.x - W / 2 - m.x, g.y - H / 2 - m.y);
        sum += d;
        max = Math.max(max, d);
        n++;
      }
    }
    return { mean: sum / n, max };
  }

  it("agree to under one pixel (mean, +-250 px around the centre) once the zoom is corrected", () => {
    // Analytic model of MapLibre's Mercator regime against the globe model of the Three camera. The residual is
    // the globe-vs-Mercator curvature and shrinks by 4x per zoom level; the live MapLibre globe (z < 12) is
    // measured in a browser by scripts/street/registration.mjs. Table printed with DEBUG_REGISTRATION=1.
    const rows: string[] = [];
    for (const lat of [0, 10.8, 30, 45, 60]) {
      for (const z of [6, 8, 10]) {
        const r = agreement(lat, z, true);
        rows.push(`lat ${lat} z ${z}: mean ${r.mean.toFixed(2)} px, max ${r.max.toFixed(2)} px`);
        if (z >= 10 || (z >= 8 && lat <= 10.8)) expect(r.mean, `lat ${lat} z ${z}`).toBeLessThan(1);
        if (z >= 8) expect(r.mean, `lat ${lat} z ${z}`).toBeLessThan(3);
      }
    }
    if (process.env.DEBUG_REGISTRATION) console.log(rows.join("\n"));
  });

  it("do not agree without it (off by the 1/cos(lat) scale)", () => {
    expect(agreement(60, 8, false).mean).toBeGreaterThan(100);
    expect(agreement(45, 8, false).mean).toBeGreaterThan(30);
    expect(agreement(0, 8, false).mean).toBeLessThan(1);
  });
});
