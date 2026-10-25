/**
 * The cinematic interlude's word as SOLID letters: a mesh with a front, a bevel, walls and a back, made from the baked outlines (`WORD_OUTLINES`,
 * scripts/font/bake-word-outlines.mjs), not a stack of flat copies of a picture of it. The faces are real surfaces with real normals, drawn once each
 * with ordinary depth testing and back-face culling, and lit by `CaptionLayer`'s shader; what the word shows from any side is geometry, so a letter
 * seen from behind is the back of a solid thing and its walls are where a solid's walls are.
 *
 * Coordinates: a vertex is `(u, v, z)`, the strip's own (engine/caption-layer.ts VERT): `u` along the word 0..1, `v` up the strip's box 0..1, `z` through
 * the thickness 0 (the back, towards the planet) to 1 (the front, the outer face). The normal is in the frame the vertex shader turns into the world's:
 * `(east, north, radial)`, with east and north in cap heights (the strip is the same scale both ways). Triangles wind counter-clockwise seen from
 * outside, in `(east, north, radial)`, which is right-handed like the world, so the faces are culled as any mesh's are.
 *
 * The outline is mitred inwards by `bevelCaps` (a vertex moves along the corner's mitre): the front face is that smaller outline, and a ROUNDED bevel (a quarter
 * circle in `bevelSegments` steps, so that it catches the light along its width) joins it to the true outline a bevel's depth behind the front. The walls run from there straight to the back, which is the true outline, flat
 * and sharp-edged (a bevel on the back read as a rounded word from behind). The front chamfer is the word's OUTLINE (`kind` 1), the walls its thickness (2).
 */
import { BufferAttribute, BufferGeometry, ShapeUtils, Vector2 } from "three";
import { WORD_OUTLINES } from "./cinematic-glyphs";
import { CAPTION_FACE, type PieceBox } from "./caption";

/** What a vertex belongs to (the shader's colour): the front face, the front chamfer (the outline), a wall and the back. */
export const KIND = { face: 0, outline: 1, wall: 2, back: 4 } as const;

export interface WordMesh {
  geometry: BufferGeometry;
  /** The box the strip is placed by (`placeEgg`): width in the caption's em, extents in cap heights. */
  box: PieceBox;
}

type P = readonly [number, number];

const area = (c: readonly P[]): number => {
  let s = 0;
  for (let i = 0; i < c.length; i++) {
    const a = c[i]!;
    const b = c[(i + 1) % c.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
};

const inside = (pt: P, poly: readonly P[]): boolean => {
  let on = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a[1] > pt[1] !== b[1] > pt[1] && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) on = !on;
  }
  return on;
};

/** The baked contours as polygons: the outer ones counter-clockwise, the holes clockwise (the solid on the left of every edge), each hole with its outer. */
export function glyphPolygons(contours: readonly (readonly number[])[] = WORD_OUTLINES.contours): { outer: P[]; holes: P[][] }[] {
  const polys: P[][] = contours.map((c) => {
    const out: P[] = [];
    for (let i = 0; i < c.length; i += 2) out.push([c[i]!, c[i + 1]!]);
    return out;
  });
  // (the winding the font gives the outer contours is the sign of the largest one's area)
  const outerSign = Math.sign(area(polys.reduce((a, p) => (Math.abs(area(p)) > Math.abs(area(a)) ? p : a))));
  const groups: { outer: P[]; holes: P[][] }[] = [];
  const holes: P[][] = [];
  for (const p of polys) {
    const isOuter = Math.sign(area(p)) === outerSign;
    const oriented = (isOuter ? area(p) > 0 : area(p) < 0) ? p : [...p].reverse();
    if (isOuter) groups.push({ outer: oriented, holes: [] });
    else holes.push(oriented);
  }
  for (const h of holes) {
    // (the smallest outer that contains the hole's first point)
    const owner = groups.filter((g) => inside(h[0]!, g.outer)).sort((a, b) => Math.abs(area(a.outer)) - Math.abs(area(b.outer)))[0];
    owner?.holes.push(h);
  }
  return groups;
}

interface Ring {
  /** The true outline, the inset one, and per vertex: the outward normal of the edge that follows it, and the normal to shade with (the edges' mean at a smooth join, the edge's own at a corner). */
  o: P[];
  i: P[];
  edge: P[];
  smooth: (P | null)[];
}

/** A contour's rings: its inset by `b` along the mitres, and its normals. The solid is on the contour's left, so the outward normal of an edge is on its right. */
function ringOf(c: readonly P[], b: number, cornerCos = Math.cos((35 * Math.PI) / 180)): Ring {
  const n = c.length;
  const edge: P[] = c.map((a, k) => {
    const e = c[(k + 1) % n]!;
    const dx = e[0] - a[0];
    const dy = e[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    return [dy / l, -dx / l] as P;
  });
  const i: P[] = [];
  const smooth: (P | null)[] = [];
  for (let k = 0; k < n; k++) {
    const n0 = edge[(k + n - 1) % n]!;
    const n1 = edge[k]!;
    const dot = n0[0] * n1[0] + n0[1] * n1[1];
    // the mitre: the sum of the two normals over one plus their dot (its length is 1 / cos of half the turn), held to twice the bevel at a very sharp turn
    const sx = n0[0] + n1[0];
    const sy = n0[1] + n1[1];
    const f = 1 / Math.max(1 + dot, 0.25);
    const mx = sx * f;
    const my = sy * f;
    const ml = Math.hypot(mx, my);
    const cap = ml > 2.2 ? 2.2 / ml : 1;
    i.push([c[k]![0] - b * mx * cap, c[k]![1] - b * my * cap]);
    const sl = Math.hypot(sx, sy) || 1;
    smooth.push(dot > cornerCos ? ([sx / sl, sy / sl] as P) : null);
  }
  return { o: [...c], i, edge, smooth };
}

/**
 * Build the word. `bevelCaps`: the bevel's width and depth, cap heights; `depthCaps`: the thickness, cap heights (the strip's `uDepth` is that many caps
 * in planet radii: the chamfers' share of it is the same at every size).
 */
export function buildWordGeometry(o: { bevelCaps: number; depthCaps: number; bevelSegments?: number }, contours: readonly (readonly number[])[] = WORD_OUTLINES.contours): WordMesh {
  const { widthCaps, aboveCaps, belowCaps } = WORD_OUTLINES;
  const b = o.bevelCaps;
  const zFront = 1;
  const zFrontEdge = 1 - b / o.depthCaps;
  const zBack = 0;
  const height = aboveCaps + belowCaps;
  const pos: number[] = [];
  const nor: number[] = [];
  const kind: number[] = [];
  /** A vertex in cap units: pushed as the strip's `(u, v, z)`. */
  const vert = (x: number, y: number, z: number, nx: number, ny: number, nz: number, k: number) => {
    pos.push(x / widthCaps, (y + belowCaps) / height, z);
    const l = Math.hypot(nx, ny, nz) || 1;
    nor.push(nx / l, ny / l, nz / l);
    kind.push(k);
  };
  /** A triangle, wound so that its geometric normal agrees with `want` (the shading normal's mean). */
  const tri = (a: number[], bb: number[], c: number[], k: number) => {
    // a vertex is [x, y, z, nx, ny, nz]; the geometric normal is taken in cap units, with z scaled to caps by the thickness
    const ax = bb[0]! - a[0]!;
    const ay = bb[1]! - a[1]!;
    const az = (bb[2]! - a[2]!) * o.depthCaps;
    const bx = c[0]! - a[0]!;
    const by = c[1]! - a[1]!;
    const bz = (c[2]! - a[2]!) * o.depthCaps;
    const gx = ay * bz - az * by;
    const gy = az * bx - ax * bz;
    const gz = ax * by - ay * bx;
    const want = [a[3]! + bb[3]! + c[3]!, a[4]! + bb[4]! + c[4]!, a[5]! + bb[5]! + c[5]!];
    const flip = gx * want[0]! + gy * want[1]! + gz * want[2]! < 0;
    const order = flip ? [a, c, bb] : [a, bb, c];
    for (const v of order) vert(v[0]!, v[1]!, v[2]!, v[3]!, v[4]!, v[5]!, k);
  };
  const quad = (a: number[], bb: number[], c: number[], d: number[], k: number) => {
    tri(a, bb, c, k);
    tri(a, c, d, k);
  };

  const segs = Math.max(1, o.bevelSegments ?? 1);
  /** A point of the bevel's quarter circle: how much of the inset is left (1 at the face, 0 at the wall), how far back, and the normal's share outward and forward. */
  const profile = (j: number) => {
    const th = (Math.PI / 2) * (j / segs);
    return { inset: 1 - Math.sin(th), dz: (b / o.depthCaps) * (1 - Math.cos(th)), sn: Math.sin(th), cn: Math.cos(th) };
  };
  for (const g of glyphPolygons(contours)) {
    const rings = [ringOf(g.outer, b), ...g.holes.map((h) => ringOf(h, b))];
    // the front: the inset outlines, outer then holes, triangulated; the back: the true ones
    const cover = (pick: (r: Ring) => P[], z: number, nz: number, k: number) => {
      const flat: P[] = [];
      for (const r of rings) flat.push(...pick(r));
      const faces = ShapeUtils.triangulateShape(
        pick(rings[0]!).map((p) => new Vector2(p[0], p[1])),
        rings.slice(1).map((r) => pick(r).map((p) => new Vector2(p[0], p[1]))),
      );
      for (const [ia, ib, ic] of faces as [number, number, number][]) {
        const pa = flat[ia!]!;
        const pb = flat[ib!]!;
        const pc = flat[ic!]!;
        tri([pa[0], pa[1], z, 0, 0, nz], [pb[0], pb[1], z, 0, 0, nz], [pc[0], pc[1], z, 0, 0, nz], k);
      }
    };
    cover((r) => r.i, zFront, 1, KIND.face);
    cover((r) => r.o, zBack, -1, KIND.back);
    for (const r of rings) {
      const n = r.o.length;
      for (let k = 0; k < n; k++) {
        const k1 = (k + 1) % n;
        const e = r.edge[k]!;
        const s0 = r.smooth[k] ?? e;
        const s1 = r.smooth[k1] ?? e;
        const I0 = r.i[k]!;
        const I1 = r.i[k1]!;
        const O0 = r.o[k]!;
        const O1 = r.o[k1]!;
        // the front bevel: a quarter circle from the front's smaller outline (inset b, at the front) to the true outline (a bevel's depth behind it), its
        // normal turning from straight out of the face to straight out of the wall
        for (let j = 0; j < segs; j++) {
          const a = profile(j);
          const c = profile(j + 1);
          const at = (P: P, Q: P, q: { inset: number; dz: number }) => [Q[0] + (P[0] - Q[0]) * q.inset, Q[1] + (P[1] - Q[1]) * q.inset, zFront - q.dz] as const;
          const v = (P: P, Q: P, q: ReturnType<typeof profile>, sm: P) => [...at(P, Q, q), sm[0] * q.sn, sm[1] * q.sn, q.cn];
          quad(v(I0, O0, a, s0), v(I1, O1, a, s1), v(I1, O1, c, s1), v(I0, O0, c, s0), KIND.outline);
        }
        // the wall, straight to the back
        quad([O0[0], O0[1], zFrontEdge, s0[0], s0[1], 0], [O1[0], O1[1], zFrontEdge, s1[0], s1[1], 0], [O1[0], O1[1], zBack, s1[0], s1[1], 0], [O0[0], O0[1], zBack, s0[0], s0[1], 0], KIND.wall);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  geometry.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3));
  geometry.setAttribute("kind", new BufferAttribute(new Float32Array(kind), 1));
  return { geometry, box: { widthEm: widthCaps * CAPTION_FACE.capEm, aboveCaps, belowCaps } };
}
