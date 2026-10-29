import { describe, expect, it } from "vitest";
import { MOON } from "./moon";
import { opening, subsolarPoint } from "./daylight";

describe("subsolarPoint", () => {
  it("is on the equator near the March equinox, over Greenwich around noon UTC", () => {
    const p = subsolarPoint(Date.UTC(2024, 2, 20, 3, 6)); // 2024 equinox, 03:06 UTC
    expect(Math.abs(p.lat)).toBeLessThan(0.3);
    const noon = subsolarPoint(Date.UTC(2024, 2, 20, 12, 0));
    expect(Math.abs(noon.lon)).toBeLessThan(4); // (the equation of time moves it a few degrees)
  });
  it("reaches the tropics at the solstices", () => {
    expect(subsolarPoint(Date.UTC(2024, 5, 20, 21, 0)).lat).toBeCloseTo(23.44, 1);
    expect(subsolarPoint(Date.UTC(2024, 11, 21, 9, 0)).lat).toBeCloseTo(-23.44, 1);
  });
  it("moves west fifteen degrees an hour", () => {
    const a = subsolarPoint(Date.UTC(2026, 9, 29, 10, 0)).lon;
    const b = subsolarPoint(Date.UTC(2026, 9, 29, 11, 0)).lon;
    expect(a - b).toBeCloseTo(15, 0);
  });
});

describe("opening", () => {
  it("is the page's old fixed state without a time", () => {
    expect(opening(null, 70)).toEqual({ lon: 0, eraDeg: 70, sunElevationDeg: MOON.sunElevationDeg });
  });
  it("keeps the camera at MOON.ref in the inertial frame, and the sun azimuth to its right", () => {
    const o = opening(Date.UTC(2026, 9, 29, 15, 30), 70);
    const sub = subsolarPoint(Date.UTC(2026, 9, 29, 15, 30));
    const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
    expect(wrap(o.lon + o.eraDeg - MOON.ref.lonDeg)).toBeCloseTo(0, 6);
    expect(wrap(sub.lon - o.lon - MOON.sunAzimuthDeg)).toBeCloseTo(0, 6);
    expect(o.sunElevationDeg).toBeCloseTo(sub.lat, 6);
  });
});
