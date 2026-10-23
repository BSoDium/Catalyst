import { describe, expect, it } from "vitest";
import { WORD_OUTLINES } from "./cinematic-glyphs";
import { CINEMATIC } from "./cinematic";
import { buildWordGeometry, glyphPolygons, KIND } from "./cinematic-word";

const opts = { bevelCaps: CINEMATIC.bevelCaps, depthCaps: CINEMATIC.depthCaps };

describe("the interlude's word, baked", () => {
  it("is the word the interlude says, from the page's face", () => {
    expect(WORD_OUTLINES.word).toBe(CINEMATIC.word);
    expect(WORD_OUTLINES.weight).toBe(800);
    // nine capitals: U N I V E R S A L, as nine outlines and the counters of the R and the A
    expect(WORD_OUTLINES.contours.length).toBe(11);
    expect(WORD_OUTLINES.widthCaps).toBeGreaterThan(5.5);
    expect(WORD_OUTLINES.widthCaps).toBeLessThan(10);
    // (capitals: the round ones overshoot the cap height a little, and nothing stands above it)
    expect(WORD_OUTLINES.aboveCaps).toBeGreaterThan(0.99);
    expect(WORD_OUTLINES.aboveCaps).toBeLessThan(1.06);
  });
  it("splits into outlines and holes: the R and the A each have a hole, the other seven capitals none", () => {
    const g = glyphPolygons();
    expect(g.length).toBe(9);
    expect(g.reduce((a, x) => a + x.holes.length, 0)).toBe(2);
    for (const x of g) {
      expect(signed(x.outer)).toBeGreaterThan(0);
      for (const h of x.holes) expect(signed(h)).toBeLessThan(0);
    }
  });
});

describe("the interlude's word, solid", () => {
  const { geometry, box } = buildWordGeometry(opts);
  const pos = geometry.getAttribute("position");
  const nor = geometry.getAttribute("normal");
  const kind = geometry.getAttribute("kind");

  it("has the box the strip is placed by", () => {
    expect(box.widthEm).toBeCloseTo(WORD_OUTLINES.widthCaps * 0.712, 6);
    expect(box.aboveCaps).toBe(WORD_OUTLINES.aboveCaps);
  });
  it("stays inside the strip, and through the thickness from the back (0) to the front (1)", () => {
    for (let i = 0; i < pos.count; i++) {
      expect(pos.getX(i)).toBeGreaterThanOrEqual(-1e-3);
      expect(pos.getX(i)).toBeLessThanOrEqual(1.001);
      expect(pos.getY(i)).toBeGreaterThanOrEqual(-1e-3);
      expect(pos.getY(i)).toBeLessThanOrEqual(1.001);
      expect(pos.getZ(i)).toBeGreaterThanOrEqual(0);
      expect(pos.getZ(i)).toBeLessThanOrEqual(1);
    }
  });
  it("has unit normals, and every triangle winds the way its normals face (so back-face culling shows the outside)", () => {
    const W = WORD_OUTLINES.widthCaps;
    const Hh = WORD_OUTLINES.aboveCaps + WORD_OUTLINES.belowCaps;
    for (let i = 0; i < nor.count; i++) expect(Math.hypot(nor.getX(i), nor.getY(i), nor.getZ(i))).toBeCloseTo(1, 5);
    for (let t = 0; t < pos.count; t += 3) {
      const p = [0, 1, 2].map((k) => [pos.getX(t + k) * W, pos.getY(t + k) * Hh, pos.getZ(t + k) * opts.depthCaps]);
      const u = [p[1]![0]! - p[0]![0]!, p[1]![1]! - p[0]![1]!, p[1]![2]! - p[0]![2]!];
      const v = [p[2]![0]! - p[0]![0]!, p[2]![1]! - p[0]![1]!, p[2]![2]! - p[0]![2]!];
      const g = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
      const len = Math.hypot(g[0]!, g[1]!, g[2]!);
      if (len < 1e-12) continue; // (a sliver)
      const n = [0, 1, 2].reduce((a, k) => [a[0]! + nor.getX(t + k), a[1]! + nor.getY(t + k), a[2]! + nor.getZ(t + k)], [0, 0, 0]);
      expect((g[0]! * n[0]! + g[1]! * n[1]! + g[2]! * n[2]!) / len).toBeGreaterThan(0);
    }
  });
  it("is closed: the front faces cover the letters' area less the bevel, and there is a chamfer and a wall for every edge (the back has no bevel)", () => {
    const kinds = [0, 0, 0, 0, 0];
    for (let i = 0; i < kind.count; i += 3) kinds[kind.getX(i)!]!++;
    const edges = WORD_OUTLINES.contours.reduce((a, c) => a + c.length / 2, 0);
    expect(kinds[KIND.outline]).toBe(edges * 2);
    expect(kinds[KIND.wall]).toBe(edges * 2);
    // (the same polygons, inset and not: earcut may drop a sliver from one of them)
    expect(Math.abs(kinds[KIND.face]! - kinds[KIND.back]!)).toBeLessThanOrEqual(6);
    expect(kinds[KIND.face]).toBeGreaterThan(100);
    // the front's area, from its triangles (in caps), is the letters' area (outlines less holes) less a ring of the bevel's width round every contour
    const W = WORD_OUTLINES.widthCaps;
    const Hh = WORD_OUTLINES.aboveCaps + WORD_OUTLINES.belowCaps;
    let front = 0;
    for (let t = 0; t < pos.count; t += 3) {
      if (kind.getX(t) !== KIND.face) continue;
      const ax = pos.getX(t) * W;
      const ay = pos.getY(t) * Hh;
      front += Math.abs((pos.getX(t + 1) * W - ax) * (pos.getY(t + 2) * Hh - ay) - (pos.getX(t + 2) * W - ax) * (pos.getY(t + 1) * Hh - ay)) / 2;
    }
    let ink = 0;
    let perimeter = 0;
    for (const g of glyphPolygons()) {
      ink += signed(g.outer);
      for (const h of g.holes) ink += signed(h); // (negative)
      for (const c of [g.outer, ...g.holes]) for (let i = 0; i < c.length; i++) perimeter += Math.hypot(c[(i + 1) % c.length]![0] - c[i]![0], c[(i + 1) % c.length]![1] - c[i]![1]);
    }
    expect(front).toBeLessThan(ink);
    expect(front).toBeGreaterThan(ink - perimeter * opts.bevelCaps * 1.3);
  });
});

function signed(c: readonly (readonly [number, number])[]): number {
  let s = 0;
  for (let i = 0; i < c.length; i++) {
    const a = c[i]!;
    const b = c[(i + 1) % c.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}
