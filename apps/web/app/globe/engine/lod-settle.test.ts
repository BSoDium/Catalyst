import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LOD, LodTree } from "./lod-tree";
import { SWEEP_CENTRES, camera, nodesFromProjection, sweepZooms } from "./open-sweep";

/**
 * The memory of the hysteresis is dropped once the zoom has been still (`LOD.open.settleMs`, #648): after a zoom OUT, the places a fresh cut would have grouped (Western Europe, Europe) stayed drawn as
 * incumbents, crowding each other and moving at every step, until the globe was turned until they left the view. The owner's preview projection (git-ignored: skipped without it), and a synthetic tree.
 */
const previewUrl = new URL("../../../../../packages/published/data/preview.projection.json", import.meta.url);
const havePreview = existsSync(previewUrl);

const drawn = (t: LodTree): Set<string> => {
  const out = new Set<string>();
  for (let k = 0; k < t.count; k++) {
    const i = t.visible[k]!;
    if (t.life.target[i] === 1 && (t.isGroup[i] ? t.members[i]! > 0 : t.shown[i] === 1)) out.add(t.slug[i]!);
  }
  return out;
};

/** Move the camera over `zooms` at a frame a time, then leave it there: returns the clock. */
function travel(t: LodTree, centre: { lon: number; lat: number }, zooms: number[], now = 0): number {
  for (const z of zooms) {
    t.update(camera(centre.lon, centre.lat, z), -1, -1, false);
    now += 16;
    t.advance(now);
  }
  return now;
}

describe.skipIf(!havePreview)("after the zoom has stopped, on the owner's preview projection", () => {
  const nodes = () => nodesFromProjection(JSON.parse(readFileSync(previewUrl, "utf8")));
  const inThenOut = [...sweepZooms(2, 9, 0.05), ...sweepZooms(2, 9, 0.05).reverse().slice(1, 80)];
  const end = inThenOut[inThenOut.length - 1]!;

  it("a zoom in and out leaves incumbents a fresh cut would not have; once the zoom is still, what is drawn is what a fresh tree draws at that camera", () => {
    let differed = 0;
    for (const c of SWEEP_CENTRES.slice(0, 4)) {
      const t = new LodTree(nodes());
      let now = travel(t, c, inThenOut);
      t.settle();
      const fresh = new LodTree(nodes());
      fresh.update(camera(c.lon, c.lat, end), -1, -1, false);
      fresh.settle();
      const before = drawn(t);
      const want = drawn(fresh);
      if ([...before].some((s) => !want.has(s)) || [...want].some((s) => !before.has(s))) differed++;
      expect(t.settling, `${c.name}: waiting for the zoom to be still`).toBe(true);
      // the zoom is still: the clock runs past the settle time, the next frame takes the cut again
      now += LOD.open.settleMs + 50;
      t.advance(now);
      expect(t.settling).toBe(false);
      t.update(camera(c.lon, c.lat, end), -1, -1, false);
      t.settle();
      const after = drawn(t);
      expect([...after].filter((s) => !want.has(s)), `${c.name}: kept`).toEqual([]);
      expect([...want].filter((s) => !after.has(s)), `${c.name}: missing`).toEqual([]);
    }
    // (the problem exists: without it this test would prove nothing)
    expect(differed).toBeGreaterThanOrEqual(2);
  });

  it("nothing happens while the zoom is still changing: the memory holds for a camera that jitters or keeps moving, and a pan alone does not drop it", () => {
    const c = SWEEP_CENTRES[0]!;
    const t = new LodTree(nodes());
    let now = travel(t, c, sweepZooms(2, 6, 0.05));
    // zoom held, the camera panning: the clock goes past the settle time, but it started again at every change of zoom: here it does not change after the first frame
    const start = now;
    for (let k = 0; k < 40; k++) {
      t.update(camera(c.lon + k * 0.05, c.lat, 6), -1, -1, false);
      now += 30;
      t.advance(now);
    }
    expect(now - start).toBeGreaterThan(LOD.open.settleMs);
    // (a pan at a still zoom settles once, as a zoom does: the cut is taken again for where the camera is)
    expect(t.settling).toBe(false);
    // a zoom that moves again before the time is up does not settle
    now = travel(t, c, [6.01, 6.02, 6.03], now);
    now += LOD.open.settleMs - 100;
    t.advance(now);
    expect(t.settling).toBe(true);
  });
});

describe("the memory of a small tree", () => {
  it("is dropped and the cut taken again for the same camera: the same set, and nothing is animating once it has run", () => {
    const g = (slug: string, kind: "country", lat: number, lon: number) => ({ slug, name: slug, kind, parent: undefined as string | undefined, lat, lon, radiusKm: 300, priority: 70 });
    const p = (slug: string, lat: number, lon: number) => ({ slug, name: slug, kind: "place" as const, parent: "de", lat, lon, radiusKm: 12, priority: 40 });
    const nodes = [g("de", "country", 51, 10), ...Array.from({ length: 10 }, (_, k) => p(`de-${k}`, 50 + (k % 4) * 0.5, 9 + Math.floor(k / 4) * 0.6))];
    const t = new LodTree(nodes);
    let now = travel(t, { lon: 9.8, lat: 50.7 }, sweepZooms(2.7, 9, 0.05));
    t.settle();
    const before = drawn(t);
    now += LOD.open.settleMs + 50;
    t.advance(now);
    t.update(camera(9.8, 50.7, 9), -1, -1, false);
    t.settle();
    expect(drawn(t)).toEqual(before);
    t.advance(now + 2000);
    expect(t.animating).toBe(false);
    expect(t.settling).toBe(false);
  });
});
