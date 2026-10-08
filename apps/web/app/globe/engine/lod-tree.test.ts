import { describe, expect, it } from "vitest";
import { bboxExtentsKm, bboxFitRadiusKm, radiusFitZoom } from "./framing";
import { LOD, LodTree, buildLodNodes, newLodCamera, placeHalfPx, setLodCamera, type GroupKind, type LodCamera, type LodNodeInput } from "./lod-tree";
import { projectLonLat, viewBasis } from "./geo";
import { chipText, labelText } from "./label-text";

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

/** Opacity of every drawn node at REST for a camera (every transition run to its end), PEEKS included; each call is a distinct camera (never a cache hit between calls). */
function evaluateAll(tree: LodTree, cam: LodCamera, reduced = false) {
  return tree.alphas({ ...cam, zoom: cam.zoom + 1e-12 * Math.random() }, reduced);
}

/** What the CUT draws at rest: the same without the peeks (places drawn inside a closed group, `peek.test.ts`), whose own rules are tested apart. */
function evaluate(tree: LodTree, cam: LodCamera, reduced = false) {
  const a = evaluateAll(tree, cam, reduced);
  for (const slug of [...a.keys()]) if (tree.isPeek(tree.indexOf(slug))) a.delete(slug);
  return a;
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
  it("a group's label carries the chip \"<N> entries\", a place's does not, measured in CSS px", () => {
    const t = new LodTree(germany());
    const de = t.indexOf("de");
    expect(t.total[de]).toBe(10);
    expect(t.chip[de]).toBe("10 entries");
    expect(t.labelW[de]).toBeCloseTo(labelText("de", chipText(10)).w, 4);
    expect(t.chip[t.indexOf("de-3")]).toBeNull();
    expect(t.labelW[t.indexOf("de-3")]).toBeCloseTo(labelText("de-3", null).w, 4);
    expect(labelText("Kraków", null).w).toBeGreaterThan(labelText("Kra", null).w);
  });
});

describe("a crowd of places is one rectangle that opens on zoom", () => {
  const tree = new LodTree(germany());

  it("ten places 55 km apart are ONE rectangle at the world view, with 10 places in it", () => {
    const a = evaluate(tree, camAt(10, 50.7, 2.7));
    expect([...a.keys()]).toEqual(["de"]);
    expect(tree.members[tree.indexOf("de")]).toBe(10);
  });

  it("zooming in, the cut swaps the group's rectangle for the ten places' rectangles at once: at rest each node is fully drawn or not at all, never missing", () => {
    let swapped = -1;
    for (let z = 2.7; z <= 9; z += 0.01) {
      const a = evaluate(tree, camAt(9.8, 50.7, z));
      const box = a.get("de") ?? 0;
      const places = [...a.keys()].filter((k) => k.startsWith("de-")).length;
      // binary: every opacity is 1 (a node that is not drawn is not in the map)
      for (const [slug, alpha] of a) expect(alpha, `${slug} at ${z.toFixed(2)}`).toBe(1);
      // exactly one level: the group or its places, never both, never neither
      expect(box === 1 ? places === 0 : places === 10, `z ${z.toFixed(2)}`).toBe(true);
      if (box === 0 && swapped < 0) swapped = z;
    }
    expect(swapped).toBeGreaterThan(3);
    expect(swapped).toBeLessThan(8);
  });

  it("is a function of the camera and of the history only through the hysteresis band: going in and out agree outside it", () => {
    const zs = [2.7, 2.8, 8, 9];
    const norm = (m: Map<string, number>) => [...m.keys()].sort();
    const inward = zs.map((z) => norm(evaluate(tree, camAt(9.8, 50.7, z))));
    const outward = [...zs].reverse().map((z) => norm(evaluate(tree, camAt(9.8, 50.7, z)))).reverse();
    expect(outward).toEqual(inward);
  });

  it("opens at a higher zoom than it closes (hysteresis), and a camera jittering around the opening zoom never changes the set after the first switch", () => {
    const setAt = (z: number) => [...evaluate(tree, camAt(9.8, 50.7, z)).keys()].sort().join();
    let openZ = 0;
    for (let z = 2.7; z <= 9; z += 0.001) {
      if (!evaluate(tree, camAt(9.8, 50.7, z)).has("de")) {
        openZ = z;
        break;
      }
    }
    expect(openZ).toBeGreaterThan(0);
    let closeZ = 0;
    for (let z = 9; z >= 2.7; z -= 0.001) {
      if (evaluate(tree, camAt(9.8, 50.7, z)).has("de")) {
        closeZ = z;
        break;
      }
    }
    expect(closeZ).toBeGreaterThan(0);
    expect(closeZ).toBeLessThan(openZ);
    // jitter around the opening zoom, starting closed: the set changes at most once
    evaluate(tree, camAt(9.8, 50.7, 2.7));
    const sets: string[] = [];
    for (let k = 0; k < 80; k++) sets.push(setAt(openZ + (k % 2 ? 1 : -1) * 0.002));
    let changes = 0;
    for (let k = 1; k < sets.length; k++) if (sets[k] !== sets[k - 1]) changes++;
    expect(changes).toBeLessThanOrEqual(1);
    // inside the band the state is whatever it was
    const mid = (openZ + closeZ) / 2;
    evaluate(tree, camAt(9.8, 50.7, 2.7));
    expect(evaluate(tree, camAt(9.8, 50.7, mid)).has("de")).toBe(true);
    evaluate(tree, camAt(9.8, 50.7, 9));
    expect(evaluate(tree, camAt(9.8, 50.7, mid)).has("de")).toBe(false);
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
    expect(labelText(long, null).w).toBeGreaterThan(t.boxX1[t.indexOf("a")]! - t.boxX0[t.indexOf("a")]! + gap - LOD.sepClosedPx);
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
  it("a place's own rectangle is hidden once it is much bigger than the screen (you are inside it), shown again a bit below, with nothing in between", () => {
    const t = new LodTree([p("city", undefined, 10, 10, 12)]);
    const probe = (z: number) => {
      const a = evaluate(t, camAt(10, 10, z));
      return { a: a.get("city") ?? 0, side: (t.boxX1[0]! - t.boxX0[0]!) / H };
    };
    let hiddenAt = -1;
    for (let z = 5; z <= 16; z += 0.05) {
      const { a, side } = probe(z);
      expect([0, 1], `z ${z}`).toContain(a);
      if (side < LOD.sizeFadeFrom) expect(a).toBe(1);
      if (side >= LOD.sizeFadeTo) expect(a).toBe(0);
      if (a === 0 && hiddenAt < 0) hiddenAt = z;
    }
    expect(hiddenAt).toBeGreaterThan(5);
    // coming back out it stays hidden until the box is below sizeFadeFrom (hysteresis)
    let shownAt = -1;
    for (let z = 16; z >= 5; z -= 0.05) {
      const { a } = probe(z);
      if (a === 1 && shownAt < 0) shownAt = z;
    }
    expect(shownAt).toBeLessThan(hiddenAt);
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

  it("each branch always shows exactly one level at rest (the opacities along a chain sum to 1) while zooming into a place", () => {
    for (const [lon, lat] of [[108.3, 16], [16, 44.6], [2.35, 48.86]] as const) {
      for (let z = 2.7; z <= 13; z += 0.02) {
        const a = evaluate(tree, camAt(lon, lat, z));
        for (const [slug, alpha] of a) expect(alpha, `${slug} at ${z.toFixed(2)}`).toBe(1);
        for (let i = 0; i < tree.size; i++) {
          if (tree.isGroup[i] || !tree.shown[i]) continue;
          // a place's own huge rectangle is hidden without anything to hand over to (street scale): that is the only way under 1
          if ((tree.boxX1[i]! - tree.boxX0[i]!) / H >= LOD.sizeFadeFrom) continue;
          const total = chain(tree, i).reduce((acc, c) => acc + (a.get(tree.slug[c]!) ?? 0), 0);
          expect(total, `${tree.slug[i]} at ${z.toFixed(2)}`).toBe(1);
        }
      }
    }
  });

  it("a node with no drawn ancestor is at full opacity at rest, wherever the camera is (regression: London at low opacity while its parent group was not drawn)", () => {
    for (let lon = -180; lon <= 180; lon += 20) {
      for (const lat of [-40, 0, 25, 50]) {
        for (let z = 2.7; z <= 12; z += 0.5) {
          const a = evaluateAll(tree, camAt(lon, lat, z));
          for (const [slug, alpha] of a) {
            const i = tree.indexOf(slug);
            expect(alpha, `${slug} at ${lon},${lat},${z}`).toBe(1);
            // a node and its ancestor are never both drawn, except a PEEK: it is drawn inside its closed group on purpose
            expect(tree.hasDrawnAncestor(i), `${slug}: a node and its ancestor are both drawn`).toBe(tree.isPeek(i));
          }
        }
      }
    }
  });

  it("selected and focused places are always drawn at full alpha, even inside a closed group", () => {
    const hue = tree.indexOf("hue");
    tree.update({ ...camAt(107, 16, 2.7), zoom: 2.7000001 }, hue, tree.indexOf("kyoto"), false);
    tree.settle();
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
  it("the same targets, and no transition: the very next frame is the resting frame", () => {
    const cam = camAt(9.8, 50.7, 2.7);
    tree.alphas(cam);
    const open = camAt(9.8, 50.7, 9);
    tree.update(open, -1, -1, true);
    tree.advance(5000);
    const a = new Map<string, number>();
    for (let k = 0; k < tree.count; k++) a.set(tree.slug[tree.visible[k]!]!, tree.alpha[tree.visible[k]!]!);
    expect([...a.values()].every((v) => v === 1)).toBe(true);
    expect([...a.keys()].filter((s) => s.startsWith("de-")).length).toBe(10);
    expect(a.has("de")).toBe(false);
    expect(tree.animating).toBe(false);
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

describe("timed transitions: the camera decides a target, the clock runs it", () => {
  const FADE = 200;
  const dump = (t: LodTree) => {
    const out = new Map<string, number>();
    for (let k = 0; k < t.count; k++) out.set(t.slug[t.visible[k]!]!, t.alpha[t.visible[k]!]!);
    return out;
  };
  /** Park the tree at the closed crowd, then set the camera of the open one: returns the clock reading of the switch. */
  function openingTree() {
    const t = new LodTree(germany());
    t.alphas(camAt(9.8, 50.7, 2.7));
    t.advance(1000); // the clock starts
    t.update(camAt(9.8, 50.7, 9), -1, -1, false);
    return t;
  }

  it("the group goes out and its places come in over the same fixed time, their opacities summing to 1 all along", () => {
    const t = openingTree();
    expect(t.animating).toBe(true);
    let now = 1000;
    let steps = 0;
    while (t.animating && steps++ < 100) {
      now += 16;
      t.advance(now);
      const a = dump(t);
      const box = a.get("de") ?? 0;
      let place = 0;
      for (let k = 0; k < 10; k++) place = Math.max(place, a.get(`de-${k}`) ?? 0);
      // while both are drawn they sum to 1 (a node below LOD.alphaMin is not drawn at all)
      expect(box + place, `t ${now - 1000}`).toBeGreaterThanOrEqual(1 - 2 * LOD.alphaMin);
      expect(box + place).toBeLessThanOrEqual(1 + 1e-6);
    }
    expect(now - 1000).toBeGreaterThanOrEqual(FADE - 16);
    expect(now - 1000).toBeLessThanOrEqual(FADE + 32);
    const end = dump(t);
    expect(end.has("de")).toBe(false);
    expect([...end.values()].every((v) => v === 1)).toBe(true);
    expect(end.size).toBe(10);
  });

  it("the camera stops mid-transition and nothing else happens: every transition still runs to its end, so the resting frame is fully drawn or not at all", () => {
    const t = openingTree();
    t.advance(1016);
    t.advance(1032); // the camera has now stopped for good: no more `update`
    const mid = dump(t);
    expect([...mid.values()].some((v) => v > 0 && v < 1)).toBe(true);
    let now = 1032;
    while (t.animating) {
      now += 16;
      t.advance(now);
      expect(now).toBeLessThan(3000);
    }
    expect([...dump(t).values()].every((v) => v === 1)).toBe(true);
    // and the mask, which has its own timed transition
    for (let k = 0; k < t.count; k++) {
      const i = t.visible[k]!;
      expect(t.fillAlpha[i] === 0 || t.fillAlpha[i] === t.alpha[i]).toBe(true);
    }
  });

  it("the duration does not depend on how many frames it takes", () => {
    const run = (dt: number) => {
      const t = openingTree();
      let now = 1000;
      while (t.animating) {
        now += dt;
        t.advance(now);
      }
      return now - 1000;
    };
    for (const dt of [4, 8, 16, 33, 50]) expect(run(dt) - FADE, `dt ${dt}`).toBeLessThanOrEqual(dt);
  });

  it("a reversal mid-way turns around from where the value is: no jump, and it still ends fully on or fully off", () => {
    const t = openingTree();
    t.advance(1048);
    const before = dump(t).get("de") ?? 0;
    expect(before).toBeGreaterThan(0);
    expect(before).toBeLessThan(1);
    t.update(camAt(9.8, 50.7, 2.7), -1, -1, false); // back to the crowd
    t.advance(1049);
    expect(Math.abs((dump(t).get("de") ?? 0) - before)).toBeLessThan(0.1);
    let now = 1049;
    while (t.animating) {
      now += 16;
      t.advance(now);
    }
    const end = dump(t);
    expect([...end.keys()]).toEqual(["de"]);
    expect(end.get("de")).toBe(1);
  });

  it("a pause (a hidden tab, an idle page) counts as one frame, not as the whole transition", () => {
    const t = openingTree();
    t.advance(1016);
    t.advance(60_000);
    expect(t.animating).toBe(true); // a minute of nothing did not complete it
  });

  it("an idle tree is not animating, and an unchanged camera starts nothing", () => {
    const t = new LodTree(germany());
    t.alphas(camAt(9.8, 50.7, 2.7));
    t.advance(1000);
    expect(t.animating).toBe(false);
    t.update(camAt(9.8, 50.7, 2.7), -1, -1, false);
    expect(t.animating).toBe(false);
  });

  it("opacities at rest are 0 or 1 for every node, mask included, at every camera of a sweep (no resting half state)", () => {
    const t = new LodTree(germany());
    for (let z = 2.7; z <= 12; z += 0.013) {
      t.alphas(camAt(9.8, 50.7, z));
      for (let k = 0; k < t.count; k++) {
        const i = t.visible[k]!;
        expect(t.alpha[i], `${t.slug[i]} at ${z.toFixed(3)}`).toBe(1);
        expect(t.fillAlpha[i] === 0 || t.fillAlpha[i] === 1, `${t.slug[i]} mask at ${z.toFixed(3)}`).toBe(true);
      }
    }
  });

  it("a place that leaves the front hemisphere vanishes at once (a fade would draw it mirrored behind the globe)", () => {
    const t = new LodTree([p("a", undefined, 0, 0), p("b", undefined, 0, 100)]);
    t.alphas(camAt(30, 0, 3));
    t.advance(1000);
    expect(dump(t).has("a")).toBe(true);
    t.update(camAt(150, 0, 3), -1, -1, false);
    t.advance(1016);
    expect(dump(t).has("a")).toBe(false);
  });
});

describe("a drawn ancestor (the checks' `parented`)", () => {
  const nodes = [g("c", "country", undefined, 40, 0, 300), p("a", "c", 40, 0), p("b", "c", 40, 0.05)];
  it("a place inside a group that is drawn has one; a place with the group open has none", () => {
    const t = new LodTree(nodes);
    t.alphas(camAt(0, 40, 2.7)); // closed: the group is drawn
    expect(t.hasDrawnAncestor(t.indexOf("a"))).toBe(true);
    t.alphas(camAt(0, 40, 11)); // open: only the places
    expect(t.hasDrawnAncestor(t.indexOf("a"))).toBe(false);
    expect(t.hasDrawnAncestor(t.indexOf("c"))).toBe(false);
  });
  it("a group that is opening does not count as an ancestor of the places replacing it", () => {
    const t = new LodTree(nodes);
    t.alphas(camAt(0, 40, 2.7));
    t.advance(1000);
    t.update(camAt(0, 40, 11), -1, -1, false);
    t.advance(1016);
    expect(t.alpha[t.indexOf("c")]).toBeGreaterThan(0); // still on screen, fading
    expect(t.hasDrawnAncestor(t.indexOf("a"))).toBe(false);
  });
  it("a place that is wanted (a route stop, the selected) inside a drawn group does have one", () => {
    const t = new LodTree(nodes);
    t.update(camAt(0, 40, 2.7), t.indexOf("a"), -1, false);
    t.settle();
    expect(t.alpha[t.indexOf("c")]).toBe(1);
    expect(t.alpha[t.indexOf("a")]).toBe(1);
    expect(t.hasDrawnAncestor(t.indexOf("a"))).toBe(true);
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
  it("the mask is switched off as the true side goes from 1x to 1.6x the minimum, leaving the hollow outline: binary at rest, with a hysteresis band", () => {
    const t = one();
    const fillAt = (z: number) => {
      evaluate(t, camAt(20, 10, z));
      return { f: t.fillAlpha[0]!, ratio: t.side[0]! / (LOD.minBoxCells * CELL) };
    };
    const up: number[] = [];
    let prev = 1;
    for (let z = 2; z <= 9; z += 0.005) {
      const { f, ratio } = fillAt(z);
      expect([0, 1], `z ${z}`).toContain(f);
      if (ratio <= LOD.fillFadeFrom) expect(f).toBe(1);
      if (ratio >= LOD.fillFadeTo) expect(f).toBe(0);
      if (f !== prev) up.push(z);
      prev = f;
    }
    expect(up).toHaveLength(1); // one switch on the way in
    const down: number[] = [];
    for (let z = 9; z >= 2; z -= 0.005) {
      const { f } = fillAt(z);
      if (f !== prev) down.push(z);
      prev = f;
    }
    expect(down).toHaveLength(1);
    expect(down[0]!).toBeLessThan(up[0]!); // hysteresis: it comes back lower than it went
    // a box bigger than the minimum is only its outline
    evaluate(t, camAt(20, 10, 9));
    expect(t.fillAlpha[0]).toBe(0);
    expect(side(t, "a")).toBeGreaterThan(LOD.minBoxCells * CELL * LOD.fillFadeTo);
  });
  it("the mask is timed too: it fades out over the fade time when it is switched off, whatever the camera does", () => {
    const t = one();
    t.alphas(camAt(20, 10, 2.7));
    expect(t.fillAlpha[0]).toBe(1);
    t.advance(1000);
    t.update(camAt(20, 10, 9), -1, -1, false);
    t.advance(1050);
    expect(t.fillAlpha[0]).toBeGreaterThan(0);
    expect(t.fillAlpha[0]).toBeLessThan(1);
    let now = 1050;
    while (t.animating) {
      now += 16;
      t.advance(now);
    }
    expect(t.fillAlpha[0]).toBe(0);
    expect(t.alpha[0]).toBe(1);
  });
  it("the mask follows the node's own opacity: it is never more opaque than the node", () => {
    const t = new LodTree(germany());
    for (let z = 2.7; z <= 6; z += 0.02) {
      evaluate(t, camAt(10, 50.7, z));
      for (let k = 0; k < t.count; k++) {
        const i = t.visible[k]!;
        expect(t.fillAlpha[i]!).toBeLessThanOrEqual(t.alpha[i]! + 1e-6);
      }
    }
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
    expect(bboxFitRadiusKm(undefined)).toBeNull();
    expect(bboxFitRadiusKm([5, 5, 1, 1])).toBeNull();
  });
});

describe("label text: the name alone; the country is kept for the hovered or selected label", () => {
  const withCountry = (slug: string, name: string, cc: string | undefined, lat: number, lon: number): LodNodeInput => ({ ...p(slug, undefined, lat, lon), name, countryCode: cc });
  it("every place says its name alone, whether or not it is the only one of its country, and knows its country", () => {
    const t = new LodTree([
      withCountry("bog", "Bogotá", "CO", 4.7, -74.1),
      withCountry("par", "Paris", "FR", 48.8, 2.3),
      withCountry("lyo", "Lyon", "FR", 45.7, 4.8),
      withCountry("ksv", "Pristina", "XK", 42.7, 21.2),
    ]);
    for (const [s, n, c] of [["bog", "Bogotá", "Colombia"], ["par", "Paris", "France"], ["lyo", "Lyon", "France"], ["ksv", "Pristina", "Kosovo"]] as const) {
      expect(t.text[t.indexOf(s)], s).toBe(n);
      expect(t.country[t.indexOf(s)], s).toBe(c);
    }
  });
  it("no country silently when the code is missing or unknown; groups never get one", () => {
    const t = new LodTree([
      withCountry("a", "Nowhere", undefined, 0, 0),
      withCountry("b", "Elsewhere", "ZZ", 10, 10),
      withCountry("c", "Malformed", "xx1", 20, 20),
      { ...g("grp", "country", undefined, 4.7, -74, 100), name: "Colombia", countryCode: "CO" },
      withCountry("d", "Cali", "CO", 3.4, -76.5),
    ]);
    for (const [s, n] of [["a", "Nowhere"], ["b", "Elsewhere"], ["c", "Malformed"], ["grp", "Colombia"], ["d", "Cali"]] as const) expect(t.text[t.indexOf(s)]).toBe(n);
    for (const s of ["a", "b", "c", "grp"]) expect(t.country[t.indexOf(s)], s).toBeNull();
    expect(t.country[t.indexOf("d")]).toBe("Colombia");
  });
  it("the resting plate is the name's: the country does not widen it (it is only added while hovered)", () => {
    const t = new LodTree([withCountry("bog", "Bogotá", "CO", 4.7, -74.1)]);
    expect(t.labelW[0]).toBeCloseTo(labelText("Bogotá", null).w, 4);
  });
  it("buildLodNodes passes the country code of a place", () => {
    const nodes = buildLodNodes([{ slug: "x", name: "X", lat: 1, lon: 2, labelPriority: 5, countryCode: "CO" }], []);
    expect(nodes[0]!.countryCode).toBe("CO");
  });
});
