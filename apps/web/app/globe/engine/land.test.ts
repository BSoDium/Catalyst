import { readFileSync } from "node:fs";
import { decodePolylines, type EncodedPolylines } from "@catalyst/geodata";
import { describe, expect, it } from "vitest";
import { LAND_H, LAND_W, landMask, landRings } from "./land";

const coast = decodePolylines(JSON.parse(readFileSync(new URL("../../../../../packages/geodata/data/coastlines-110m.json", import.meta.url), "utf8")) as EncodedPolylines);
const mask = landMask(coast);
const at = (lon: number, lat: number) => mask[Math.min(LAND_H - 1, Math.floor(((lat + 90) / 180) * LAND_H)) * LAND_W + Math.min(LAND_W - 1, Math.floor(((lon + 180) / 360) * LAND_W))];

describe("the land mask", () => {
  it("is land where there are continents and sea where there is sea", () => {
    for (const [name, lon, lat] of [["the Sahara", 15, 25], ["Siberia", 100, 62], ["Australia", 135, -25], ["Brazil", -55, -10], ["Canada", -100, 60], ["Greenland", -40, 75], ["Spain", -4, 40], ["Antarctica", 0, -80], ["Antarctica, at the antimeridian (the Ross Ice Shelf reaches -84.7 there)", 179, -86], ["Antarctica, the other side", -179, -86], ["India", 78, 22]] as const) {
      expect(at(lon, lat), name).toBe(255);
    }
    for (const [name, lon, lat] of [["the Atlantic", -30, 30], ["the Pacific", -150, 0], ["the Indian Ocean", 80, -30], ["the Southern Ocean", 0, -65], ["the Arctic", 0, 88], ["the Mediterranean", 18, 35]] as const) {
      expect(at(lon, lat), name).toBe(0);
    }
  });
  it("covers about the share of the earth that is land: a third of the sphere (the grid is stretched towards the poles, so by area on the sphere)", () => {
    let area = 0;
    let total = 0;
    for (let r = 0; r < LAND_H; r++) {
      const w = Math.cos(((-90 + ((r + 0.5) * 180) / LAND_H) * Math.PI) / 180);
      for (let c = 0; c < LAND_W; c++) {
        total += w;
        if (mask[r * LAND_W + c]) area += w;
      }
    }
    expect(area / total).toBeGreaterThan(0.25);
    expect(area / total).toBeLessThan(0.34);
  });
  it("closes the rings the antimeridian cut (the open ones of the data are joined, none is left open but the cut ones)", () => {
    const rings = landRings(coast);
    expect(rings.length).toBe(coast.offsets.length - 1);
    // Antarctica's ring now runs through the pole
    expect(rings.some((r) => r.some(([, lat]) => lat === -90))).toBe(true);
  });
});
