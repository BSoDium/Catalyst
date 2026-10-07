import { describe, expect, it } from "vitest";
import { bboxExtentsKm, bboxFitRadiusKm, radiusFitZoom } from "./framing";
import { LOD, LodTree, buildLodNodes, newLodCamera, placeHalfPx, setLodCamera, type GroupKind, type LodCamera, type LodNodeInput } from "./lod-tree";
import { projectLonLat, viewBasis } from "./geo";
import { chipText, labelLayout } from "./pixel-labels";

const W = 1440;
const H = 900;
const CELL = 2.5;

const g = (slug: string, kind: LodNodeInput["kind"], parent: string | undefined, lat: number, lon: number, radiusKm: number, priority = 50): LodNodeInput => ({ slug, name: slug, kind, parent, lat, lon, radiusKm, priority });
const p = (slug: string, parent: string | undefined, lat: number, lon: number, radiusKm = 12): LodNodeInput => g(slug, "place", parent, lat, lon, radiusKm, 40);

const camAt = (lon: number, lat: number, zoom: number, free = W, cell = CELL): LodCamera => {
  const c = newLodCamera();
  setLodCamera(c, { lon, lat, zoom }, { width: W, height: H, centreX: W - free / 2 > W / 2 ? W / 2 : (W - (W - free)) / 2 }, free, cell);
  return c;
};

/** Alphas of every drawn node; each call is a distinct camera (never a cache hit between calls). */
function evaluate(tree: LodTree, cam: LodCamera, reduced = false) {
  tree.update({ ...cam, zoom: cam.zoom + 1e-12 * Math.random() }, -1, -1, reduced);
  const out = new Map<string, number>();
  for (let k = 0; k < tree.count; k++) out.set(tree.slug[tree.visible[k]!]!, tree.alpha[tree.visible[k]!]!);
  return out;
}

const chain = (tree: LodTree, i: number) => {
  const out: number[] = [];
  for (let c = i; c >= 0; c = tree.parent[c]!) out.push(c);
  return out;
};

/** Ten places inside a country (Germany-like), ~55 km apart: crowded until zoomed in. */
function germany(): LodNodeInput[] {
  const nodes: LodNodeInput[] = [g("de", "country", undefined, 51, 10, 400, 70)];
  for (let k = 0; k < 10; k++) nodes.push(p(`de-${k}`, "de", 50 + (k % 4) * 0.5, 9 + Math.floor(k / 4) * 0.6));
  return nodes;
}

describe("box geometry (pure)", () => {
  it("a place's half side is its view radius over 1.25 at the camera's local scale: the framed place's box fits the free area with the 25 % margin", () => {
    for (const radius of [3, 12, 40, 120]) {
      const zoom = radiusFitZoom(radius, W, H, 0);
      const half = placeHalfPx(radius, zoom, H, 1);
      // framing: the CIRCLE of the radius is 0.8 of the smaller side; the box has half side radius / 1.25 = 0.8 of that
      expect(2 * half).toBeCloseTo(H * 0.8 * 0.8, 1);
      expect(2 * half).toBeLessThan(H);
    }
  });
  it("is foreshortened towards the limb and finite beyond it", () => {
    const centre = placeHalfPx(100, 3, H, 1);
    expect(placeHalfPx(100, 3, H, 0.5)).toBeLessThan(centre);
    for (const pc of [0.2, 0, -0.5, -1]) expect(Number.isFinite(placeHalfPx(100, 3, H, pc))).toBe(true);
    expect(placeHalfPx(100, 3, H, -0.7)).toBeCloseTo(placeHalfPx(100, 3, H, -0.2), 12);
  });
  it("a place's rectangle is centred on its projection, axis aligned, and at least minBoxCells across", () => {
    const t = new LodTree([p("a", undefined, 10, 20, 12)]);
    evaluate(t, camAt(20, 10, 2.7));
    const i = 0;
    expect((t.boxX0[i]! + t.boxX1[i]!) / 2).toBeCloseTo(t.px[i]!, 9);
    expect((t.boxY0[i]! + t.boxY1[i]!) / 2).toBeCloseTo(t.py[i]!, 9);
    expect(t.boxX1[i]! - t.boxX0[i]!).toBeGreaterThanOrEqual(LOD.minBoxCells * CELL - 1e-9);
    expect(t.boxY1[i]! - t.boxY0[i]!).toBeCloseTo(t.boxX1[i]! - t.boxX0[i]!, 9);
    // zoomed in the true extent takes over and grows x2 per level
    evaluate(t, camAt(20, 10, 9));
    const s9 = t.boxX1[i]! - t.boxX0[i]!;
    evaluate(t, camAt(20, 10, 10));
    expect((t.boxX1[i]! - t.boxX0[i]!) / s9).toBeCloseTo(2, 2);
  });
  it("a group's rectangle is the union of its visible places' TRUE boxes, clamped to the minimum, with padCells of room", () => {
    const t = new LodTree(germany());
    const pad = LOD.padCells * CELL;
    const min = LOD.minBoxCells * CELL;
    for (const z of [2.7, 3, 7]) {
      evaluate(t, camAt(10, 50.7, z));
      const i = t.indexOf("de");
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let k = 0; k < 10; k++) {
        const j = t.indexOf(`de-${k}`);
        expect(t.shown[j]).toBe(1);
        x0 = Math.min(x0, t.px[j]! - t.side[j]! / 2);
        x1 = Math.max(x1, t.px[j]! + t.side[j]! / 2);
        y0 = Math.min(y0, t.py[j]! - t.side[j]! / 2);
        y1 = Math.max(y1, t.py[j]! + t.side[j]! / 2);
      }
      const w = Math.max(x1 - x0, min);
      const h = Math.max(y1 - y0, min);
      expect(t.boxX1[i]! - t.boxX0[i]!, `w at z ${z}`).toBeCloseTo(w + 2 * pad, 6);
      expect(t.boxY1[i]! - t.boxY0[i]!, `h at z ${z}`).toBeCloseTo(h + 2 * pad, 6);
      expect((t.boxX0[i]! + t.boxX1[i]!) / 2).toBeCloseTo((x0 + x1) / 2, 6);
      expect(t.side[i]).toBeCloseTo(Math.max(x1 - x0, y1 - y0), 6);
    }
  });
  it("a group's label carries the chip \"<N> entries\", a place's does not, in whole cells", () => {
    const t = new LodTree(germany());
    const de = t.indexOf("de");
    expect(t.total[de]).toBe(10);
    expect(t.chip[de]).toBe("10 entries");
    expect(t.labelW[de]).toBe(labelLayout("de", chipText(10)).w);
    expect(t.chip[t.indexOf("de-3")]).toBeNull();
    expect(t.labelW[t.indexOf("de-3")]).toBe(labelLayout("de-3", null).w);
    expect(labelLayout("Kraków", null).w).toBeGreaterThan(labelLayout("Kra", null).w);
  });
});

describe("a crowd of places is one rectangle that opens on zoom", () => {
  const tree = new LodTree(germany());

  it("ten places 55 km apart are ONE rectangle at the world view, with 10 places in it", () => {
    const a = evaluate(tree, camAt(10, 50.7, 2.7));
    expect([...a.keys()]).toEqual(["de"]);
    expect(tree.members[tree.indexOf("de")]).toBe(10);
  });

  it("zooming in, the group's rectangle fades out while the ten places' rectangles come in, never missing: the alphas sum to 1", () => {
    let boxGone = -1;
    let allIn = -1;
    for (let z = 2.7; z <= 9; z += 0.01) {
      const a = evaluate(tree, camAt(9.8, 50.7, z));
      const box = a.get("de") ?? 0;
      let best = 0;
      for (let k = 0; k < 10; k++) best = Math.max(best, a.get(`de-${k}`) ?? 0);
      const sum = box + best;
      expect(sum, `z ${z.toFixed(2)}`).toBeGreaterThanOrEqual(1 - LOD.alphaMin - 1e-6);
      expect(sum).toBeLessThanOrEqual(1 + 1e-6);
      if (box === 0 && boxGone < 0) boxGone = z;
      if (best === 1 && allIn < 0 && box === 0) allIn = z;
    }
    expect(boxGone).toBeGreaterThan(3);
    expect(allIn).toBeGreaterThanOrEqual(boxGone - 1e-9);
    expect(allIn).toBeLessThan(8);
    // and then there are ten rectangles
    const a = evaluate(tree, camAt(9.8, 50.7, 9));
    expect([...a.keys()].filter((k) => k.startsWith("de-")).length).toBe(10);
  });

  it("alpha never jumps: steps of 0.01 zoom change a node's alpha by less than 0.2, and nodes enter at a low opacity", () => {
    let prev = new Map<string, number>();
    for (let z = 2.7; z <= 8; z += 0.01) {
      const a = evaluate(tree, camAt(9.8, 50.7, z));
      for (const [slug, alpha] of a) {
        const before = prev.get(slug);
        if (before !== undefined) expect(Math.abs(alpha - before), `${slug} at ${z.toFixed(2)}`).toBeLessThan(0.2);
        else if (z > 2.72) expect(alpha, `${slug} enters at ${alpha}`).toBeLessThan(0.3);
      }
      prev = a;
    }
  });

  it("is the same going in and going out (alpha is a function of the camera, not of history)", () => {
    const zs = [2.7, 3.4, 4.2, 5, 6, 7.5];
    const norm = (m: Map<string, number>) => [...m].map(([k, v]) => [k, +v.toFixed(6)]).sort();
    const inward = zs.map((z) => norm(evaluate(tree, camAt(9.8, 50.7, z))));
    const outward = [...zs].reverse().map((z) => norm(evaluate(tree, camAt(9.8, 50.7, z)))).reverse();
    expect(outward).toEqual(inward);
  });

  it("no flapping: a camera jittering around the opening zoom only moves the opacity by a hair and never changes the set", () => {
    let mid = 0;
    for (let z = 2.7; z <= 8; z += 0.001) {
      evaluate(tree, camAt(9.8, 50.7, z));
      if (tree.alpha[tree.indexOf("de")]! < 0.5) {
        mid = z;
        break;
      }
    }
    expect(mid).toBeGreaterThan(0);
    const alphas: number[] = [];
    const sets = new Set<string>();
    for (let k = 0; k < 60; k++) {
      const a = evaluate(tree, camAt(9.8, 50.7, mid + (k % 2 ? 1 : -1) * 0.002));
      sets.add([...a.keys()].sort().join());
      alphas.push(tree.alpha[tree.indexOf("de")]!);
    }
    expect(sets.size).toBe(1);
    expect(Math.max(...alphas) - Math.min(...alphas)).toBeLessThan(0.05);
  });
});

describe("places that are not crowded are never merged", () => {
  it("a lone place under a group is its own rectangle at every zoom, the group never appears", () => {
    const t = new LodTree([g("c", "country", undefined, 40, 0, 300), p("only", "c", 40, 0), g("o", "country", undefined, -30, 150, 300), p("a", "o", -30, 150), p("b", "o", -30.05, 150.05)]);
    for (let z = 2.7; z <= 12; z += 0.05) {
      const a = evaluate(t, camAt(0, 40, z));
      expect(a.has("c"), `z ${z.toFixed(2)}`).toBe(false);
      expect(a.get("only") ?? 0).toBe(1);
    }
  });
  it("a place with no group is a rectangle at every zoom (small, never a dot)", () => {
    const t = new LodTree([p("solo", undefined, 10, 10), p("other", undefined, 10.01, 10.01)]);
    for (const z of [2.7, 5, 9, 12]) {
      expect(evaluate(t, camAt(10, 10, z)).get("solo")).toBe(1);
      expect(t.boxX1[0]! - t.boxX0[0]!).toBeGreaterThanOrEqual(LOD.minBoxCells * CELL - 1e-9);
    }
  });
  it("a country with two far apart places shows two rectangles and no group", () => {
    const t = new LodTree([g("c", "country", undefined, 0, 0, 2000), p("a", "c", 0, -12), p("b", "c", 0, 12)]);
    const a = evaluate(t, camAt(0, 0, 2.7));
    expect(a.has("c")).toBe(false);
    expect(a.get("a")).toBe(1);
    expect(a.get("b")).toBe(1);
  });
  it("...and two close ones are one rectangle", () => {
    const t = new LodTree([g("c", "country", undefined, 0, 0, 200), p("a", "c", 0, -0.4), p("b", "c", 0, 0.4)]);
    expect([...evaluate(t, camAt(0, 0, 2.7)).keys()]).toEqual(["c"]);
  });
  it("two places whose rectangles are far apart but whose LABELS collide are still merged (the label counts)", () => {
    // 85 CSS px apart: the rectangles are 60 px apart (open on their own), but a long name makes the label of the left one reach the right one
    const long = "A very long place name indeed";
    const t = new LodTree([{ ...g("c", "country", undefined, 0, 0, 200), name: "c" }, { ...p("a", "c", 0, 0), name: long }, p("b", "c", 0, 0.9)]);
    const a = evaluate(t, camAt(0.45, 0, 6));
    const gap = t.boxX0[t.indexOf("b")]! - t.boxX1[t.indexOf("a")]!;
    expect(gap).toBeGreaterThan(LOD.sepPx);
    expect(labelLayout(long, null).w * CELL).toBeGreaterThan(t.boxX1[t.indexOf("a")]! - t.boxX0[t.indexOf("a")]! + gap - LOD.sepClosedPx);
    expect(a.has("c")).toBe(true);
    expect(a.has("a")).toBe(false);
  });
  it("continents and subregions are only drawn when the view is crowded: a spread-out tree shows its places", () => {
    const t = new LodTree([
      g("eu", "continent", undefined, 50, 10, 2000),
      g("w", "subregion", "eu", 48, 2, 800),
      g("e", "subregion", "eu", 52, 25, 800),
      p("p1", "w", 48.8, 2.3),
      p("p2", "w", 51.5, -0.1),
      p("p3", "e", 52.2, 21),
      p("p4", "e", 50, 36),
    ]);
    const a = evaluate(t, camAt(15, 50, 4.5));
    expect(a.has("eu")).toBe(false);
    expect(a.has("w") || a.has("e")).toBe(false);
    for (const s of ["p1", "p2", "p3", "p4"]) expect(a.get(s), s).toBe(1);
  });
});

describe("only members that pass the visibility rule count", () => {
  it("a place on the far side is not in the group: with one visible member the group is just that place's rectangle", () => {
    const t = new LodTree([g("c", "country", undefined, 0, 90, 9000), p("near", "c", 0, 2), p("far", "c", 0, 178)]);
    const a = evaluate(t, camAt(0, 0, 2.7));
    expect(t.members[t.indexOf("c")]).toBe(1);
    expect(a.has("c")).toBe(false);
    expect(a.get("near")).toBe(1);
    expect(t.shown[t.indexOf("far")]).toBe(0);
    expect(a.has("far")).toBe(false);
  });
  it("two visible members count, whatever hides on the far side", () => {
    const t = new LodTree([g("c", "country", undefined, 0, 90, 9000), p("a", "c", 0, 1), p("b", "c", 0.2, 1.3), p("far", "c", 0, 178)]);
    evaluate(t, camAt(0, 0, 2.7));
    expect(t.members[t.indexOf("c")]).toBe(2);
    expect(t.total[t.indexOf("c")]).toBe(3);
  });
});

describe("size rules", () => {
  it("a place's own rectangle fades out once it is much bigger than the screen (you are inside it)", () => {
    const t = new LodTree([p("city", undefined, 10, 10, 12)]);
    const sizeAt = (z: number) => {
      const a = evaluate(t, camAt(10, 10, z));
      return { a: a.get("city") ?? 0, side: (t.boxX1[0]! - t.boxX0[0]!) / H };
    };
    let prevA = 1;
    let seenPartial = false;
    for (let z = 5; z <= 16; z += 0.05) {
      const { a, side } = sizeAt(z);
      if (side < LOD.sizeFadeFrom) expect(a).toBe(1);
      if (side >= LOD.sizeFadeTo) expect(a).toBe(0);
      if (a > 0 && a < 1) seenPartial = true;
      expect(a).toBeLessThanOrEqual(prevA + 1e-9);
      prevA = a;
    }
    expect(seenPartial).toBe(true);
  });
  it("a group wider than boxMaxTo of the screen is open whatever its places' spacing; street scale opens everything", () => {
    const t = new LodTree([g("c", "continent", undefined, 20, 30, 4000), p("a", "c", 0, 20), p("b", "c", 0.1, 20.2), p("far1", "c", 40, 60), p("far2", "c", 41, 61)]);
    for (let z = 2.7; z <= 6; z += 0.1) {
      const a = evaluate(t, camAt(40, 20, z));
      const i = t.indexOf("c");
      const frac = Math.max(t.boxX1[i]! - t.boxX0[i]!, t.boxY1[i]! - t.boxY0[i]!) / H;
      if (t.members[i]! > 1 && frac >= LOD.boxMaxTo) expect(a.get("c") ?? 0).toBeLessThan(LOD.alphaMin + 1e-6);
    }
    const same = new LodTree([g("s", "area", undefined, 0, 0, 5), p("x", "s", 0, 0, 0.5), p("y", "s", 0, 0, 0.5)]);
    expect(evaluate(same, camAt(0, 0, 8)).has("s")).toBe(true);
    const deep = evaluate(same, camAt(0, 0, LOD.forceOpenZoom + 0.1));
    expect(deep.has("s")).toBe(false);
    expect(deep.get("x")).toBe(1);
  });
});

describe("the demo hierarchy", () => {
  const nodes = (): LodNodeInput[] => [
    g("americas", "continent", undefined, 19.6, -92.2, 4740, 90),
    g("asia", "continent", undefined, 25.4, 116.6, 2350, 90),
    g("europe", "continent", undefined, 53.1, 0, 1935, 90),
    g("balkans", "region", "europe", 45.5, 17.5, 280, 80),
    g("croatia", "country", "balkans", 44.7, 16.2, 155, 70),
    g("sea", "subregion", "asia", 15.8, 105.4, 650, 80),
    g("vietnam", "country", "sea", 15.9, 106.3, 643, 70),
    g("da-nang-area", "area", "vietnam", 16, 108.3, 25, 55),
    p("lisbon", "europe", 38.72, -9.14, 10),
    p("paris", "europe", 48.86, 2.35, 14),
    p("reykjavik", "europe", 64.15, -21.94),
    p("kyoto", "asia", 35.01, 135.77),
    p("cusco", "americas", -13.52, -71.97),
    p("vancouver", "americas", 49.28, -123.12),
    p("cape-town", undefined, -33.92, 18.42),
    p("wellington", undefined, -41.29, 174.78),
    p("hanoi", "vietnam", 21.03, 105.85),
    p("hue", "vietnam", 16.46, 107.59),
    p("ho-chi-minh-city", "vietnam", 10.82, 106.63, 18),
    p("ljubljana", "balkans", 46.06, 14.51),
    p("belgrade", "balkans", 44.79, 20.45),
    p("zagreb", "croatia", 45.81, 15.98),
    p("split", "croatia", 43.51, 16.44),
    p("bangkok", "sea", 13.76, 100.5),
    p("da-nang", "da-nang-area", 16.05, 108.22),
    p("hoi-an", "da-nang-area", 15.88, 108.33),
  ];
  const tree = new LodTree(nodes());

  it("the isolated places are rectangles at the world view and at every zoom", () => {
    for (const z of [2.7, 3.5, 5, 8]) expect(evaluate(tree, camAt(18.4, -33.9, z)).get("cape-town"), `z ${z}`).toBe(1);
    expect(evaluate(tree, camAt(174.8, -41.3, 2.7)).get("wellington")).toBe(1);
  });

  it("each branch always shows exactly one level (the alphas along a chain sum to 1) while zooming into a place", () => {
    for (const [lon, lat] of [[108.3, 16], [16, 44.6], [2.35, 48.86]] as const) {
      for (let z = 2.7; z <= 13; z += 0.02) {
        const a = evaluate(tree, camAt(lon, lat, z));
        for (let i = 0; i < tree.size; i++) {
          if (tree.isGroup[i] || !a.has(tree.slug[i]!)) continue;
          const total = chain(tree, i).reduce((acc, c) => acc + (a.get(tree.slug[c]!) ?? 0), 0);
          // a place's own huge rectangle fades without anything to hand over to (street scale): that is the only way under 1
          const own = tree.boxX1[i]! - tree.boxX0[i]!;
          if (own / H >= LOD.sizeFadeFrom) continue;
          expect(total, `${tree.slug[i]} at ${z.toFixed(2)}`).toBeGreaterThanOrEqual(1 - 6 * LOD.alphaMin);
          expect(total).toBeLessThanOrEqual(1 + 1e-6);
        }
      }
    }
  });

  it("selected and focused places are always drawn at full alpha, even inside a closed group", () => {
    const hue = tree.indexOf("hue");
    tree.update({ ...camAt(107, 16, 2.7), zoom: 2.7000001 }, hue, tree.indexOf("kyoto"), false);
    const drawn = new Map<string, number>();
    for (let k = 0; k < tree.count; k++) drawn.set(tree.slug[tree.visible[k]!]!, tree.alpha[tree.visible[k]!]!);
    expect(drawn.get("hue")).toBe(1);
    expect(tree.level[hue]).toBe(tree.ink);
  });

  it("the stops of a shown route are drawn too", () => {
    tree.setExtraForced([tree.indexOf("hanoi"), tree.indexOf("ho-chi-minh-city")]);
    const a = evaluate(tree, camAt(107, 16, 2.7));
    expect(a.get("hanoi")).toBe(1);
    expect(a.get("ho-chi-minh-city")).toBe(1);
    tree.setExtraForced([]);
  });
});

describe("reduced motion", () => {
  const tree = new LodTree(germany());
  it("no cross-fade: every alpha is 0 or 1 at every zoom", () => {
    for (let z = 2.7; z <= 9; z += 0.02) for (const [slug, alpha] of evaluate(tree, camAt(9.8, 50.7, z), true)) expect(alpha, `${slug} at ${z}`).toBe(1);
  });
  it("switches once, with a hysteresis band: going in switches higher than going out", () => {
    const zs: number[] = [];
    let open = false;
    for (let z = 2.7; z <= 9; z += 0.001) {
      const now = !evaluate(tree, camAt(9.8, 50.7, z), true).has("de");
      if (now !== open) {
        zs.push(z);
        open = now;
      }
    }
    expect(zs.length).toBe(1);
    const back: number[] = [];
    for (let z = 9; z >= 2.7; z -= 0.001) {
      const now = !evaluate(tree, camAt(9.8, 50.7, z), true).has("de");
      if (now !== open) {
        back.push(z);
        open = now;
      }
    }
    expect(back.length).toBe(1);
    expect(back[0]!).toBeLessThan(zs[0]!);
  });
});

describe("deep synthetic tree (6 levels)", () => {
  const nodes: LodNodeInput[] = [];
  const kinds: GroupKind[] = ["continent", "subregion", "region", "country", "area"];
  const radius = [4000, 1700, 800, 350, 80];
  function grow(parent: string | undefined, level: number, lat: number, lon: number, path: string) {
    if (level === kinds.length) {
      nodes.push(p(`place-${path}`, parent, lat, lon));
      return;
    }
    const slug = `${kinds[level]}-${path}`;
    nodes.push(g(slug, kinds[level]!, parent, lat, lon, radius[level]!, 90 - level * 10));
    for (let d = 0; d < 2; d++) {
      const s = d - 0.5;
      grow(slug, level + 1, lat + s * radius[level]! * 0.004, lon + s * radius[level]! * 0.005, `${path}${d}`);
    }
  }
  grow(undefined, 0, 20, 30, "r");
  const tree = new LodTree(nodes);
  const leaf = nodes.find((n) => n.slug === "place-r00000")!;

  it("has the depth and size we think", () => {
    expect(tree.size).toBe(1 + 2 + 4 + 8 + 16 + 32);
    expect(Math.max(...tree.depth)).toBe(5);
    expect(tree.total[tree.indexOf("continent-r")]).toBe(32);
  });

  it("zooming into one place, the rectangles go from the top group to the place, and the alphas along its chain sum to 1", () => {
    const seen = new Set<string>();
    for (let z = 2.7; z <= 14; z += 0.01) {
      const a = evaluate(tree, camAt(leaf.lon, leaf.lat, z));
      for (const slug of a.keys()) seen.add(slug.split("-")[0]!);
      const i = tree.indexOf("place-r00000");
      if ((tree.boxX1[i]! - tree.boxX0[i]!) / H >= LOD.sizeFadeFrom) continue;
      const sum = chain(tree, i).reduce((acc, c) => acc + (a.get(tree.slug[c]!) ?? 0), 0);
      expect(sum, `z ${z.toFixed(2)}`).toBeGreaterThanOrEqual(1 - 6 * LOD.alphaMin);
      expect(sum).toBeLessThanOrEqual(1 + 1e-6);
    }
    expect(seen.has("place")).toBe(true);
    expect(["continent", "subregion", "region", "country", "area"].some((k) => seen.has(k))).toBe(true);
  });

  it("parents are drawn before their children (painter's order of the traversal)", () => {
    for (let z = 2.7; z <= 10; z += 0.2) {
      evaluate(tree, camAt(leaf.lon, leaf.lat, z));
      const order = new Map<number, number>();
      for (let k = 0; k < tree.count; k++) order.set(tree.visible[k]!, k);
      for (const [i, k] of order) {
        const par = tree.parent[i]!;
        if (par >= 0 && order.has(par)) expect(order.get(par)!).toBeLessThan(k);
      }
    }
  });
});

describe("cost and cache", () => {
  const nodes: LodNodeInput[] = [];
  for (let c = 0; c < 6; c++) {
    const clat = -50 + c * 20;
    const clon = -150 + c * 58;
    nodes.push(g(`c${c}`, "continent", undefined, clat, clon, 2500, 90));
    for (let k = 0; k < 8; k++) {
      const lat = clat + ((k % 4) - 1.5) * 6;
      const lon = clon + (Math.floor(k / 4) - 0.5) * 24;
      nodes.push(g(`c${c}k${k}`, "country", `c${c}`, lat, lon, 300, 70));
      for (let q = 0; q < 8; q++) nodes.push(p(`c${c}k${k}q${q}`, `c${c}k${k}`, lat + ((q % 4) - 1.5) * 1.1, lon + (Math.floor(q / 4) - 0.5) * 1.6));
    }
  }
  const tree = new LodTree(nodes);

  it("the world view draws a handful of rectangles, not hundreds", () => {
    evaluate(tree, camAt(0, 0, 2.7));
    expect(tree.count).toBeLessThan(40);
  });

  it("the traversal only visits the roots and the children of open groups", () => {
    for (let z = 2.7; z <= 12; z += 0.3) {
      evaluate(tree, camAt(-120, -45, z));
      expect(tree.visited).toBeLessThanOrEqual(tree.size);
    }
    evaluate(tree, camAt(0, 0, 2.7));
    expect(tree.visited).toBeLessThan(40);
  });

  it("the same camera is evaluated once; a different one again", () => {
    const cam = camAt(10, 40, 4);
    tree.update({ ...cam, zoom: 4.0001 }, -1, -1, false);
    const n = tree.evaluations;
    tree.update({ ...cam, zoom: 4.0001 }, -1, -1, false);
    tree.update({ ...cam, zoom: 4.0001 }, -1, -1, false);
    expect(tree.evaluations).toBe(n);
    tree.update({ ...cam, zoom: 4.001 }, -1, -1, false);
    expect(tree.evaluations).toBe(n + 1);
    tree.update({ ...cam, zoom: 4.001 }, 0, -1, false);
    expect(tree.evaluations).toBe(n + 2);
  });
});

describe("tones and projection", () => {
  it("a fully opaque rectangle is the full ink (never a map grey); fading only lowers its opacity", () => {
    const t = new LodTree([p("a", undefined, 10, 20, 12)]);
    t.setTones(12);
    expect(t.ink).toBe(11);
    evaluate(t, camAt(20, 10, 6));
    expect(t.alpha[0]).toBe(1);
    expect(t.level[0]).toBe(t.ink);
  });
  it("the tree projects like the globe: a place at the view centre lands on the centre", () => {
    const t = new LodTree([p("c", undefined, 12, 34)]);
    evaluate(t, camAt(34, 12, 5));
    expect(t.px[0]).toBeCloseTo(W / 2, 6);
    expect(t.py[0]).toBeCloseTo(H / 2, 6);
    const basis = viewBasis({ lon: 30, lat: 10, zoom: 4 }, H);
    const pt = projectLonLat(34, 12, basis, W, H, 1, W / 2);
    evaluate(t, camAt(30, 10, 4));
    expect(t.px[0]).toBeCloseTo(pt.x, 9);
    expect(t.py[0]).toBeCloseTo(pt.y, 9);
  });
});

describe("buildLodNodes and the tree's structure", () => {
  it("maps places and groups, with the default radius for a place without one", () => {
    const nodes = buildLodNodes([{ slug: "a", name: "A", lat: 1, lon: 2, labelPriority: 5, groupSlug: "g" }], [{ slug: "g", name: "G", kind: "country", lat: 1, lon: 2, viewRadiusKm: 50, labelPriority: 70 }]);
    expect(nodes.map((n) => [n.slug, n.kind, n.parent, n.radiusKm])).toEqual([
      ["g", "country", undefined, 50],
      ["a", "place", "g", LOD.defaultPlaceRadiusKm],
    ]);
  });
  it("an unknown parent makes a root, a duplicate slug is ignored, a cycle is cut, a place cannot be a parent", () => {
    const tree = new LodTree([g("x", "country", "nowhere", 0, 0, 100), g("x", "country", undefined, 5, 5, 100), g("c1", "country", "c2", 10, 10, 100), g("c2", "country", "c1", 11, 11, 100), p("q", "c1", 10, 10), p("a", undefined, 0, 0), p("b", "a", 1, 1)]);
    expect(tree.size).toBe(6);
    expect(tree.parent[tree.indexOf("x")]).toBe(-1);
    expect(chain(tree, tree.indexOf("q")).length).toBeLessThanOrEqual(3);
    expect(tree.parent[tree.indexOf("b")]).toBe(-1);
  });
});

describe("minimum size and its fill", () => {
  const side = (t: LodTree, slug: string) => t.boxX1[t.indexOf(slug)]! - t.boxX0[t.indexOf(slug)]!;
  const one = () => new LodTree([p("a", undefined, 10, 20, 12)]);
  it("the minimum is 8 to 10 art cells", () => {
    expect(LOD.minBoxCells).toBeGreaterThanOrEqual(8);
    expect(LOD.minBoxCells).toBeLessThanOrEqual(10);
  });
  it("a place clamped to the minimum has its interior fully masked (the mask is as opaque as the node)", () => {
    const t = one();
    evaluate(t, camAt(20, 10, 2.7));
    expect(side(t, "a")).toBeCloseTo(LOD.minBoxCells * CELL, 9);
    expect(t.side[0]).toBeLessThan(LOD.minBoxCells * CELL);
    expect(t.alpha[0]).toBe(1);
    expect(t.fillAlpha[0]).toBe(1);
  });
  it("the mask fades by OPACITY as the true side goes from 1x to 1.6x the minimum, leaving the hollow outline", () => {
    const t = one();
    const values: number[] = [];
    let hollowAt = -1;
    let fullUntil = -1;
    for (let z = 2; z <= 8; z += 0.005) {
      evaluate(t, camAt(20, 10, z));
      const ratio = t.side[0]! / (LOD.minBoxCells * CELL);
      const f = t.fillAlpha[0]!;
      values.push(f);
      if (ratio <= LOD.fillFadeFrom) expect(f, `ratio ${ratio}`).toBeCloseTo(1, 6);
      if (ratio >= LOD.fillFadeTo) expect(f, `ratio ${ratio}`).toBe(0);
      if (f > 1 - 1e-6 && ratio <= LOD.fillFadeFrom + 1e-9) fullUntil = z;
      if (f === 0 && hollowAt < 0) hollowAt = z;
    }
    expect(fullUntil).toBeGreaterThan(0);
    expect(hollowAt).toBeGreaterThan(fullUntil);
    // monotone non-increasing with zoom (the box only grows) and continuous: many distinct opacities, no step of more than a few percent
    for (let k = 1; k < values.length; k++) {
      expect(values[k]!).toBeLessThanOrEqual(values[k - 1]! + 1e-9);
      expect(values[k - 1]! - values[k]!).toBeLessThan(0.1);
    }
    expect(new Set(values.map((v) => +v.toFixed(3))).size).toBeGreaterThan(30);
    // a box bigger than the minimum is only its outline
    evaluate(t, camAt(20, 10, 9));
    expect(t.fillAlpha[0]).toBe(0);
    expect(side(t, "a")).toBeGreaterThan(LOD.minBoxCells * CELL * LOD.fillFadeTo);
  });
  it("the mask follows the node's own fade: it is never more opaque than the node", () => {
    const t = new LodTree(germany());
    for (let z = 2.7; z <= 6; z += 0.02) {
      evaluate(t, camAt(10, 50.7, z));
      for (let k = 0; k < t.count; k++) {
        const i = t.visible[k]!;
        expect(t.fillAlpha[i]!).toBeLessThanOrEqual(t.alpha[i]! + 1e-6);
      }
    }
  });
  it("reduced motion: the mask switches on or off at once, with a hysteresis band", () => {
    const t = one();
    const f = (z: number) => {
      evaluate(t, camAt(20, 10, z), true);
      return t.fillAlpha[0]!;
    };
    let on = true;
    const flips: number[] = [];
    for (let z = 2; z <= 8; z += 0.01) {
      const v = f(z);
      expect(v === 0 || v === t.alpha[0]).toBe(true);
      if ((v > 0) !== on) {
        flips.push(z);
        on = v > 0;
      }
    }
    expect(flips.length).toBe(1);
  });
  it("a closed group is masked while its box is about the minimum and hollow once it is bigger", () => {
    const t = new LodTree(germany());
    evaluate(t, camAt(10, 50.7, 2.7));
    const de = t.indexOf("de");
    expect(t.fillAlpha[de]).toBeCloseTo(t.alpha[de]!, 6);
    // close to the point where it opens, the group's box is much bigger than the minimum
    let hollow = false;
    for (let z = 2.7; z < 4.5; z += 0.02) {
      evaluate(t, camAt(10, 50.7, z));
      if (t.alpha[de]! > 0.5 && t.side[de]! > LOD.minBoxCells * CELL * LOD.fillFadeTo) hollow = hollow || t.fillAlpha[de] === 0;
    }
    expect(hollow).toBe(true);
  });
});

describe("bounding box rectangles (place bbox) and the radius fallback", () => {
  // Houston-like: a 70 x 60 km area whose recorded point is NOT at its centre
  const HOUSTON: readonly [number, number, number, number] = [-95.8, 29.5, -95.1, 30.1];
  const withBox = (bbox?: LodNodeInput["bbox"]): LodNode[] => [{ ...p("hou", undefined, 29.76, -95.37, 12), bbox }];
  type LodNode = LodNodeInput;
  const cam = (z: number) => camAt(-95.45, 29.8, z);
  it("the rectangle is the box's own width and height, centred on the box's centre (not the point), at the camera's local scale", () => {
    const t = new LodTree(withBox(HOUSTON));
    const ext = bboxExtentsKm(HOUSTON)!;
    evaluate(t, cam(9));
    const pxPerKm = (t.boxX1[0]! - t.boxX0[0]!) / (2 * ext.halfXKm);
    expect(t.boxX1[0]! - t.boxX0[0]!).toBeGreaterThan(t.boxY1[0]! - t.boxY0[0]!); // 0.7 deg of lon at 30 N is wider than 0.6 deg of lat
    expect((t.boxY1[0]! - t.boxY0[0]!) / (t.boxX1[0]! - t.boxX0[0]!)).toBeCloseTo(ext.halfYKm / ext.halfXKm, 4);
    expect((t.boxY1[0]! - t.boxY0[0]!) / (2 * ext.halfYKm)).toBeCloseTo(pxPerKm, 6); // one scale on both axes
    // centred on the projected box centre
    const basis = viewBasis({ lon: -95.45, lat: 29.8, zoom: 9 }, H);
    const c = projectLonLat(ext.lon, ext.lat, basis, W, H, 1, W / 2);
    expect((t.boxX0[0]! + t.boxX1[0]!) / 2).toBeCloseTo(c.x, 6);
    expect((t.boxY0[0]! + t.boxY1[0]!) / 2).toBeCloseTo(c.y, 6);
    // and the rectangle grows x2 per zoom level like any true extent
    const w9 = t.boxX1[0]! - t.boxX0[0]!;
    evaluate(t, cam(10));
    expect((t.boxX1[0]! - t.boxX0[0]!) / w9).toBeCloseTo(2, 2);
  });
  it("is independent of the view radius and of the recorded point", () => {
    const a = new LodTree(withBox(HOUSTON));
    const b = new LodTree([{ ...withBox(HOUSTON)[0]!, radiusKm: 400, lat: 29.55, lon: -95.75 }]);
    evaluate(a, cam(9));
    evaluate(b, cam(9));
    for (const k of ["boxX0", "boxX1", "boxY0", "boxY1"] as const) expect(b[k][0]).toBeCloseTo(a[k][0]!, 9);
  });
  it("without a box (or with an invalid one) it is the square of the view radius around the point, as before", () => {
    const radius = new LodTree(withBox(undefined));
    evaluate(radius, cam(9));
    expect(radius.boxX1[0]! - radius.boxX0[0]!).toBeCloseTo(radius.boxY1[0]! - radius.boxY0[0]!, 9);
    expect(radius.boxX1[0]! - radius.boxX0[0]!).toBeCloseTo(2 * placeHalfPx(12, 9, H, 1), 0); // the view radius over 1.25, about the view centre
    for (const bad of [[1, 2, 3], [-95.1, 29.5, -95.8, 30.1], [-95.8, 30.1, -95.1, 29.5], [NaN, 29.5, -95.1, 30.1], [-200, 0, 10, 10]] as unknown as LodNodeInput["bbox"][]) {
      const t = new LodTree(withBox(bad));
      evaluate(t, cam(9));
      expect(t.boxX1[0]! - t.boxX0[0]!, JSON.stringify(bad)).toBeCloseTo(radius.boxX1[0]! - radius.boxX0[0]!, 9);
    }
  });
  it("each axis is clamped to the minimum on its own: a far-away wide box is a wide strip, never smaller than minBoxCells", () => {
    const t = new LodTree(withBox([-95.8, 29.99, -95.1, 30.0]));
    evaluate(t, cam(3));
    expect(t.boxY1[0]! - t.boxY0[0]!).toBeCloseTo(LOD.minBoxCells * CELL, 9);
    evaluate(t, cam(9));
    expect(t.boxX1[0]! - t.boxX0[0]!).toBeGreaterThan(LOD.minBoxCells * CELL * 2);
    expect(t.boxY1[0]! - t.boxY0[0]!).toBeGreaterThanOrEqual(LOD.minBoxCells * CELL - 1e-9);
  });
  it("a group is the union of its children's boxes, bbox ones included", () => {
    const t = new LodTree([g("us", "country", undefined, 30, -95, 300, 70), { ...p("hou", "us", 29.76, -95.37), bbox: HOUSTON }, { ...p("aus", "us", 30.27, -97.74), bbox: [-98, 30.1, -97.5, 30.5] }]);
    evaluate(t, camAt(-96.5, 30, 6.5));
    const us = t.indexOf("us");
    const hou = t.indexOf("hou");
    const aus = t.indexOf("aus");
    const pad = LOD.padCells * CELL;
    expect(t.boxX0[us]!).toBeLessThanOrEqual(Math.min(t.boxX0[hou]!, t.boxX0[aus]!) - pad + 1e-6);
    expect(t.boxX1[us]!).toBeGreaterThanOrEqual(Math.max(t.boxX1[hou]!, t.boxX1[aus]!) + pad - 1e-6);
    expect(t.boxY0[us]!).toBeLessThanOrEqual(Math.min(t.boxY0[hou]!, t.boxY0[aus]!) - pad + 1e-6);
  });
  it("buildLodNodes passes the box of a place", () => {
    const nodes = buildLodNodes([{ slug: "a", name: "A", lat: 1, lon: 2, labelPriority: 5, bbox: [1, 0, 3, 2] }, { slug: "b", name: "B", lat: 1, lon: 2, labelPriority: 5 }], []);
    expect(nodes[0]!.bbox).toEqual([1, 0, 3, 2]);
    expect(nodes[1]!.bbox).toBeUndefined();
  });
  it("framing: the radius that frames the box is its larger half extent seen from the point, with the old fallback when absent", () => {
    const ext = bboxExtentsKm(HOUSTON)!;
    expect(bboxFitRadiusKm(HOUSTON)).toBeCloseTo(Math.max(ext.halfXKm, ext.halfYKm), 9);
    expect(bboxFitRadiusKm(HOUSTON, { lat: ext.lat, lon: ext.lon })).toBeCloseTo(bboxFitRadiusKm(HOUSTON)!, 9);
    expect(bboxFitRadiusKm(HOUSTON, { lat: 29.55, lon: -95.75 })!).toBeGreaterThan(bboxFitRadiusKm(HOUSTON)!);
    expect(bboxFitRadiusKm(undefined)).toBeNull();
    expect(bboxFitRadiusKm([5, 5, 1, 1])).toBeNull();
  });
});

describe("label text: the country is appended to the only place of its country", () => {
  const withCountry = (slug: string, name: string, cc: string | undefined, lat: number, lon: number): LodNodeInput => ({ ...p(slug, undefined, lat, lon), name, countryCode: cc });
  it("a single place in its country says the country; one of several does not", () => {
    const t = new LodTree([
      withCountry("bog", "Bogotá", "CO", 4.7, -74.1),
      withCountry("par", "Paris", "FR", 48.8, 2.3),
      withCountry("lyo", "Lyon", "FR", 45.7, 4.8),
      withCountry("ksv", "Pristina", "XK", 42.7, 21.2),
    ]);
    expect(t.text[t.indexOf("bog")]).toBe("Bogotá, Colombia");
    expect(t.text[t.indexOf("par")]).toBe("Paris");
    expect(t.text[t.indexOf("lyo")]).toBe("Lyon");
    expect(t.text[t.indexOf("ksv")]).toBe("Pristina, Kosovo");
  });
  it("hidden silently when the code is missing or unknown; groups never get it", () => {
    const t = new LodTree([
      withCountry("a", "Nowhere", undefined, 0, 0),
      withCountry("b", "Elsewhere", "ZZ", 10, 10),
      withCountry("c", "Malformed", "xx1", 20, 20),
      { ...g("grp", "country", undefined, 4.7, -74, 100), name: "Colombia", countryCode: "CO" },
      withCountry("d", "Cali", "CO", 3.4, -76.5),
    ]);
    for (const [s, n] of [["a", "Nowhere"], ["b", "Elsewhere"], ["c", "Malformed"], ["grp", "Colombia"]] as const) expect(t.text[t.indexOf(s)]).toBe(n);
    expect(t.text[t.indexOf("d")]).toBe("Cali, Colombia");
  });
  it("the plate is wider by the appended text", () => {
    const t = new LodTree([withCountry("bog", "Bogotá", "CO", 4.7, -74.1)]);
    expect(t.labelW[0]).toBe(labelLayout("Bogotá, Colombia", null).w);
    expect(t.labelW[0]).toBeGreaterThan(labelLayout("Bogotá", null).w);
  });
  it("buildLodNodes passes the country code of a place", () => {
    const nodes = buildLodNodes([{ slug: "x", name: "X", lat: 1, lon: 2, labelPriority: 5, countryCode: "CO" }], []);
    expect(nodes[0]!.countryCode).toBe("CO");
  });
});
