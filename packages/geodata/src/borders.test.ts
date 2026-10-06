import { describe, expect, it } from "vitest";
import { loadBorders } from "./index";
import reference from "./frontier-reference.json";

/**
 * Checks of the committed border dataset (data/borders-50m.json) against `frontier-reference.json`, which the generator writes
 * from the pinned Natural Earth file (`pnpm --filter @catalyst/geodata generate -- --fixture ...`, see README):
 *  - `present`: points every 40 km along frontiers that must be COMPLETE (hard-coded country pairs, the US / Canada border
 *    including Alaska / Canada first);
 *  - `absent`: points along stretches that must NOT be in the data (disputed, line of control, indefinite, or carried by OpenStreetMap
 *    only as a disputed or maritime line: the Moroccan wall, Kashmir, Arunachal, the Crimean isthmus, the Golan, ...);
 *  - `neKm`: the Natural Earth length of each present frontier.
 */
const KM_LON = 111.32;
const KM_LAT = 110.57;

type Seg = [number, number, number, number];

async function load() {
  const p = await loadBorders();
  const lines: number[][][] = [];
  const segs: Seg[] = [];
  for (let l = 0; l < p.offsets.length - 1; l++) {
    const line: number[][] = [];
    for (let v = p.offsets[l]!; v < p.offsets[l + 1]!; v++) line.push([p.positions[v * 2]!, p.positions[v * 2 + 1]!]);
    lines.push(line);
    for (let i = 1; i < line.length; i++) segs.push([line[i - 1]![0]!, line[i - 1]![1]!, line[i]![0]!, line[i]![1]!]);
  }
  const grid = new Map<string, number[]>();
  segs.forEach((s, id) => {
    for (let x = Math.floor(Math.min(s[0], s[2])); x <= Math.floor(Math.max(s[0], s[2])); x++)
      for (let y = Math.floor(Math.min(s[1], s[3])); y <= Math.floor(Math.max(s[1], s[3])); y++) {
        const k = `${x},${y}`;
        (grid.get(k) ?? grid.set(k, []).get(k)!).push(id);
      }
  });
  /** Distance in km from a point to the nearest border segment (Infinity if none within about 3 degrees). */
  const dist = (lon: number, lat: number) => {
    const c = Math.cos((lat * Math.PI) / 180) * KM_LON;
    const gx = Math.floor(lon);
    const gy = Math.floor(lat);
    const span = Math.min(30, Math.ceil(2 / Math.max(0.05, Math.cos((lat * Math.PI) / 180))));
    let best = Infinity;
    for (let dx = -span; dx <= span; dx++)
      for (let dy = -2; dy <= 2; dy++)
        for (const id of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
          const [x0, y0, x1, y1] = segs[id]!;
          const ax = x0 * c;
          const ay = y0 * KM_LAT;
          const ddx = x1 * c - ax;
          const ddy = y1 * KM_LAT - ay;
          const L = ddx * ddx + ddy * ddy;
          const px = lon * c;
          const py = lat * KM_LAT;
          const t = L ? Math.max(0, Math.min(1, ((px - ax) * ddx + (py - ay) * ddy) / L)) : 0;
          best = Math.min(best, Math.hypot(px - ax - t * ddx, py - ay - t * ddy));
        }
    return best;
  };
  return { lines, segs, dist };
}

const lengthKm = (segs: Seg[]) => segs.reduce((s, [x0, y0, x1, y1]) => s + Math.hypot((x1 - x0) * Math.cos(((y0 + y1) / 2 * Math.PI) / 180) * KM_LON, (y1 - y0) * KM_LAT), 0);

const pointsOf = (flat: number[]) => Array.from({ length: flat.length / 2 }, (_, i) => [flat[i * 2]!, flat[i * 2 + 1]!] as const);

/** Simplification (0.03 degrees, 3.3 km) plus 1/100 degree quantisation. */
const TOLERANCE_KM = 5;

describe("border dataset: complete frontiers", () => {
  it("has every frontier of the reference list", () => {
    expect(Object.keys(reference.present).sort()).toEqual(
      [
        "Algeria / Morocco", "Angola / Dem. Rep. Congo", "Argentina / Chile", "Bangladesh / India", "Bolivia / Brazil", "Botswana / South Africa",
        "Canada / United States of America", "China / Mongolia", "China / Russia", "Dem. Rep. Congo / Zambia", "Ethiopia / Somalia", "France / Spain",
        "Germany / Poland", "Israel / Palestine", "Kazakhstan / Russia", "Mali / Mauritania", "Mexico / United States of America", "Mongolia / Russia",
        "North Korea / South Korea", "Norway / Sweden",
      ].sort(),
    );
  });

  for (const [pair, flat] of Object.entries(reference.present)) {
    it(`${pair}: no gap (a point every 40 km along Natural Earth's line, each within ${TOLERANCE_KM} km of a polyline)`, async () => {
      const { dist } = await load();
      const pts = pointsOf(flat);
      expect(pts.length).toBeGreaterThan(2);
      const far = pts.filter(([lon, lat]) => dist(lon, lat) > TOLERANCE_KM).map(([lon, lat]) => `${lon.toFixed(2)},${lat.toFixed(2)}`);
      expect(far, `${pair}: points farther than ${TOLERANCE_KM} km from the data`).toEqual([]);
    });

    it(`${pair}: at least 97 % of Natural Earth's length is there`, async () => {
      const { segs } = await load();
      const pts = pointsOf(flat);
      // Segments whose midpoint is within 25 km of a reference sample (the samples are 40 km apart along the frontier): a corridor that
      // may include a few km of a neighbouring frontier at a tripoint, so only the lower bound is a test.
      const near = (x: number, y: number) => {
        const c = Math.cos((y * Math.PI) / 180) * KM_LON;
        return pts.some(([px, py]) => Math.hypot((px - x) * c, (py - y) * KM_LAT) < 25);
      };
      const mine = segs.filter(([x0, y0, x1, y1]) => near((x0 + x1) / 2, (y0 + y1) / 2));
      const ne = reference.neKm[pair as keyof typeof reference.neKm];
      const km = lengthKm(mine);
      expect(km / ne, `${pair}: ${Math.round(km)} km in the data, ${ne} km in Natural Earth`).toBeGreaterThan(0.97);
    });
  }

  it("USA / Canada, Alaska included, is one connected run from the Pacific to the Atlantic, with no segment a globe would sink", async () => {
    const { lines } = await load();
    // The 141 W meridian (Alaska / Yukon, 60 N to 69.6 N) and the 49th parallel (Pacific to Lake of the Woods) are straight in the source.
    const along = (pred: (p: number[]) => boolean) => lines.filter((l) => l.filter(pred).length >= 3);
    const alaska = along(([x, y]) => Math.abs(x! + 141) < 0.02 && y! > 60 && y! < 69.6);
    expect(alaska.length).toBeGreaterThan(0);
    const alaskaLat = alaska.flatMap((l) => l.filter(([x]) => Math.abs(x! + 141) < 0.02).map(([, y]) => y!));
    expect(Math.min(...alaskaLat)).toBeLessThan(60.7);
    expect(Math.max(...alaskaLat)).toBeGreaterThan(69.4);
    const parallel = along(([x, y]) => Math.abs(y! - 49) < 0.02 && x! > -123 && x! < -95.2);
    expect(parallel.length).toBeGreaterThan(0);
    const lons = parallel.flatMap((l) => l.filter(([, y]) => Math.abs(y! - 49) < 0.02).map(([x]) => x!));
    expect(Math.min(...lons)).toBeLessThan(-122.5);
    expect(Math.max(...lons)).toBeGreaterThan(-95.4);
  });
});

describe("border dataset: no segment a chord-drawn globe would sink", () => {
  it("every segment is at most 4 degrees long", async () => {
    const { segs } = await load();
    const long = segs.filter(([x0, y0, x1, y1]) => Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) > 4.0001);
    expect(long).toEqual([]);
  });
});

describe("border dataset: antimeridian and poles", () => {
  it("no polyline is split by, or wraps around, the antimeridian or a pole", async () => {
    const { lines } = await load();
    for (const l of lines) {
      for (let i = 1; i < l.length; i++) {
        expect(Math.abs(l[i]![0]! - l[i - 1]![0]!), "wrap-around jump").toBeLessThan(180);
        expect(Math.abs(l[i]![1]!), "pole").toBeLessThan(89.99);
      }
      // A line that ends on the antimeridian has been cut there (a frontier crossing it is split into a +-180 pair).
      for (const end of [l[0]!, l[l.length - 1]!]) expect(Math.abs(end[0]!), "line ends on the antimeridian").toBeLessThan(179.99);
    }
  });
});

describe("border dataset: disputed frontiers are removed", () => {
  const absent = Object.entries(reference.absent);
  it("has stretches to check, the Moroccan wall, Kashmir, the Crimean isthmus and the Golan among them", () => {
    const names = absent.map(([n]) => n).join("\n");
    for (const needle of ["Morocco / W. Sahara", "India / Pakistan", "China / India", "Russia / Ukraine", "Israel / Syria", "Cyprus / N. Cyprus", "China / Pakistan"]) expect(names).toContain(needle);
  });
  for (const [name, flat] of absent) {
    it(`no polyline along ${name}`, async () => {
      const { dist } = await load();
      const pts = pointsOf(flat);
      // Points 12 km or more inside the stretch; a kept frontier that runs beside it (a tripoint) may come within a few km.
      const near = pts.filter(([lon, lat]) => dist(lon, lat) < 2.5);
      expect(near.length / pts.length, `${near.length} of ${pts.length} points within 2.5 km of a polyline`).toBeLessThan(0.15);
    });
  }
});

describe("border dataset: size and shape", () => {
  it("is plausible: 150 to 250 polylines, 190 000 to 215 000 km", async () => {
    const { lines, segs } = await load();
    expect(lines.length).toBeGreaterThan(150);
    expect(lines.length).toBeLessThan(250);
    expect(lengthKm(segs)).toBeGreaterThan(190000);
    expect(lengthKm(segs)).toBeLessThan(215000);
  });
});
