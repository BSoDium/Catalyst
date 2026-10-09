import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FADE_MS } from "./fade";
import { LOD, LodTree, type GroupKind, type LodNodeInput } from "./lod-tree";
import { SWEEP, SWEEP_AREAS, SWEEP_CENTRES, SWEEP_GROUPS, belowGroup, camera, drawnAt, measure, nodesFromProjection, openingOf, runSweep, sweepZooms, type Drawn, type SweepRow } from "./open-sweep";

/**
 * The EARLY OPENING of groups (engine/lod-tree.ts `LodTree.cut`, `LOD.open`): a closed group opens into its most important children as soon as
 * two of them fit, and the group's box and label cross-fade with the children's in lockstep. Synthetic trees for the rules, then sweeps over the
 * owner's preview projection (git-ignored: those tests are skipped without it) with the numbers of docs/web-architecture.md.
 * `OPEN_REPORT=1 pnpm --filter @catalyst/web exec vitest run open` prints the table.
 */

const g = (slug: string, kind: LodNodeInput["kind"], parent: string | undefined, lat: number, lon: number, radiusKm: number, priority = 50): LodNodeInput => ({ slug, name: slug, kind, parent, lat, lon, radiusKm, priority });
const pl = (slug: string, parent: string | undefined, lat: number, lon: number, priority: number, radiusKm = 10) => g(slug, "place", parent, lat, lon, radiusKm, priority);

/**
 * A country of six places in two close pairs (Western Europe like, squeezed to 0.3 of its size so that it takes a few zoom levels to show its
 * places), inside a continent.
 */
function country(kind: GroupKind = "country", parentKind: GroupKind | null = "continent"): LodNodeInput[] {
  const at = (lat: number, lon: number): [number, number] => [46 + (lat - 46) * 0.3, 6 + (lon - 6) * 0.3];
  const place = (slug: string, lat: number, lon: number, priority: number) => pl(slug, "xx", ...at(lat, lon), priority);
  return [
    ...(parentKind ? [g("eu", parentKind, undefined, 46, 6, 2000, 90)] : []),
    g("xx", kind, parentKind ? "eu" : undefined, 46, 6, 100, 70),
    place("a1", 48.8, 2.3, 44),
    place("a2", 48.5, 2.9, 40),
    place("b1", 45.7, 5.7, 43),
    place("b2", 46.2, 6.1, 39),
    place("c", 43.6, 1.4, 38),
    place("d", 49.5, 8.5, 36),
  ];
}

const slugs = (d: readonly Drawn[]) => d.map((n) => n.slug);
const placesOf = (d: readonly Drawn[], prefix = "") => d.filter((n) => n.kind === "place" && n.slug.startsWith(prefix)).map((n) => n.slug);
const has = (d: readonly Drawn[], slug: string) => d.some((n) => n.slug === slug);
const gap = (a: Drawn, b: Drawn) => Math.max(b.box.x0 - a.box.x1, a.box.x0 - b.box.x1, b.box.y0 - a.box.y1, a.box.y0 - b.box.y1);

/** The first zoom (steps of `step`) at which `slug` is no longer drawn on a zoom-in from `from`, for a fresh tree. */
function opensAt(nodes: readonly LodNodeInput[], slug: string, lon: number, lat: number, early = true, from = 2, to = 9, step = 0.01): number {
  const tree = new LodTree(nodes, { early });
  for (const z of sweepZooms(from, to, step)) if (!has(drawnAt(tree, camera(lon, lat, z)), slug)) return z;
  return -1;
}

describe("the opening rule (synthetic country of six places)", () => {
  it("a closed country opens as soon as its two most important places fit: only the places that fit are drawn, the group's total is unchanged", () => {
    const tree = new LodTree(country());
    let opened = -1;
    for (const z of sweepZooms(2.5, 9, 0.01)) {
      const d = drawnAt(tree, camera(5, 46, z));
      const places = placesOf(d);
      if (has(d, "xx")) {
        expect(places, `z ${z}`).toEqual([]);
        continue;
      }
      if (opened < 0) {
        opened = z;
        // the two most important places (a1 44, b1 43) are the first drawn; the rest of the six come in as they fit
        expect(places).toContain("a1");
        expect(places).toContain("b1");
        expect(places.length).toBeLessThan(6);
        // every box is clear of every other by the enter gap when it comes in (the clear room the labels need is part of that test)
        for (const p of d) for (const q of d) if (p !== q) expect(gap(p, q), `${p.slug} ${q.slug} at ${z}`).toBeGreaterThanOrEqual(LOD.open.gapPx.enter - 1e-6);
      }
      expect(places.length, `z ${z}`).toBeGreaterThanOrEqual(2);
    }
    expect(opened).toBeGreaterThan(3);
    expect(tree.total[tree.indexOf("xx")]).toBe(6);
    // before: a group opened only when its box covered boxMaxTo of the screen
    expect(opensAt(country(), "xx", 5, 46, false)).toBeGreaterThan(opened + 0.5);
  });

  it("the places that did not fit at the opening come in as the zoom lets them in, and none ever goes away again on a zoom-in", () => {
    const tree = new LodTree(country());
    let last = new Set<string>();
    const firstAt = new Map<string, number>();
    for (const z of sweepZooms(3, 9, 0.01)) {
      const d = drawnAt(tree, camera(5, 46, z));
      const now = new Set(placesOf(d));
      for (const s of last) expect(now.has(s), `${s} at ${z}`).toBe(true);
      for (const s of now) if (!firstAt.has(s)) firstAt.set(s, z);
      last = now;
    }
    expect(last.size).toBe(6);
    // they come in by importance when they fit: a1 and b1 before c and d
    expect(firstAt.get("a1")!).toBeLessThanOrEqual(firstAt.get("c")!);
    expect(firstAt.get("b1")!).toBeLessThanOrEqual(firstAt.get("d")!);
    expect(new Set(firstAt.values()).size).toBeGreaterThan(2);
  });

  it("a group opens only when its first two children are BOTH there: it never leaves out its most important place for lesser ones", () => {
    // G's places t (60), u (50), v (40) are 67 km apart in a row; x, a place of nothing, sits 28 km from t: t fits only once x is clear of it
    const base = [g("G", "country", undefined, 0, 0, 200, 70), pl("t", "G", 0, 0, 60, 8), pl("u", "G", 0, 0.6, 50, 8), pl("v", "G", 0, -0.6, 40, 8)];
    const withX = [...base, pl("x", undefined, 0, 0.25, 30, 8)];
    const alone = opensAt(base, "G", 0, 0, true);
    const blocked = opensAt(withX, "G", 0, 0, true);
    expect(alone).toBeGreaterThan(0);
    expect(blocked).toBeGreaterThan(alone + 0.5);
    // in between, u and v would fit (and are not drawn), at the opening t is
    const tree = new LodTree(withX);
    for (const z of sweepZooms(2, blocked + 0.5, 0.01)) {
      const d = drawnAt(tree, camera(0, 0, z));
      if (z < blocked - 1e-9) expect(placesOf(d, "u") .concat(placesOf(d, "v"), placesOf(d, "t")), `z ${z}`).toEqual([]);
      else if (z === blocked) expect(has(d, "t")).toBe(true);
    }
  });

  it("a group with fewer than two visible children needs the ones it has; a group with one is that child's rectangle", () => {
    const one = new LodTree([g("C", "country", undefined, 0, 90, 9000), pl("near", "C", 0, 2, 40), pl("far", "C", 0, 178, 40)]);
    const d = drawnAt(one, camera(0, 0, 2.7));
    expect(slugs(d)).toEqual(["near"]);
    const two = new LodTree([g("C", "country", undefined, 0, 0, 200), pl("a", "C", 0, 0, 40), pl("b", "C", 0, 0.5, 40)]);
    // two children: both must fit; it opens with both
    let opened = false;
    for (const z of sweepZooms(2.7, 10, 0.05)) {
      const dd = drawnAt(two, camera(0.25, 0, z));
      if (!has(dd, "C")) {
        opened = true;
        expect(placesOf(dd).sort()).toEqual(["a", "b"]);
        break;
      }
    }
    expect(opened).toBe(true);
  });

  it("order of importance: the labelPriority, then the true size, then the slug, whatever the order of the input", () => {
    // five places with the same priority and sizes that differ: the biggest first, equal sizes by slug
    const tied: LodNodeInput[] = [g("eu", "continent", undefined, 46, 6, 2000, 90), g("xx", "country", "eu", 46, 6, 300, 70), pl("m", "xx", 48.8, 2.3, 40, 8), pl("n", "xx", 43.6, 1.4, 40, 14), pl("o", "xx", 45.7, 5.7, 40, 14), pl("p", "xx", 49.5, 8.5, 40, 11), pl("q", "xx", 46.5, 9, 40, 6)];
    const orders = [tied, [...tied].reverse(), [tied[0]!, tied[1]!, ...tied.slice(2).sort((a, b) => (a.slug < b.slug ? 1 : -1))]];
    const results = orders.map((o) => {
      const tree = new LodTree(o);
      const out: string[] = [];
      for (const z of sweepZooms(3, 6, 0.1)) out.push(`${z}:${placesOf(drawnAt(tree, camera(5, 46, z))).sort().join(",")}`);
      return out;
    });
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    // the two 14 km places (n then o, by slug) are the first two drawn when it opens
    const first = results[0]!.find((r) => r.split(":")[1]!.includes(","))!.split(":")[1]!.split(",");
    expect(first.slice(0, 2)).toEqual(expect.arrayContaining(["n", "o"]));
  });

  it("a child group opens by the same rule once it is drawn, and a child group that does not fit as a box opens into its own places when they fit", () => {
    // a continent with two countries whose boxes overlap (interleaved cities) and a third, lone one
    const nodes: LodNodeInput[] = [
      g("co", "continent", undefined, 0, 0, 800, 90),
      g("A", "country", "co", 0, 0.9, 120, 70),
      g("B", "country", "co", 0, 1.5, 120, 70),
      pl("a1", "A", 0, 0, 45),
      pl("a2", "A", 0, 1.2, 44),
      pl("b1", "B", 0.05, 0.6, 43),
      pl("b2", "B", 0.05, 1.8, 42),
    ];
    const tree = new LodTree(nodes);
    let throughSeen = false;
    let boxesSeen = false;
    for (const z of sweepZooms(2.7, 9, 0.02)) {
      const d = drawnAt(tree, camera(0.9, 0, z));
      // never a group with a drawn place below it
      for (const n of d) for (let a = tree.parent[tree.indexOf(n.slug)]!; a >= 0; a = tree.parent[a]!) expect(has(d, tree.slug[a]!), `${n.slug} under ${tree.slug[a]} at ${z}`).toBe(false);
      if (!has(d, "co") && placesOf(d).length >= 2 && !has(d, "A") && !has(d, "B")) throughSeen = true;
      if (!has(d, "co") && (has(d, "A") || has(d, "B"))) boxesSeen = true;
    }
    // the countries' boxes overlap until they are forced open: the cities show through the open continent before that
    expect(throughSeen).toBe(true);
    expect(boxesSeen || throughSeen).toBe(true);
  });

  /**
   * A country of two multi-scale areas (area inside area inside the country, long names like "Marrakesh region" > "Marrakesh area"), 50 km apart:
   * the areas' boxes are small and their labels long, so neither box fits next to the other, but the places inside do.
   */
  const nested = (): LodNodeInput[] => [
    g("co", "continent", undefined, 31, -8, 2500, 90),
    g("ct", "country", "co", 31, -8, 600, 70),
    g("north-region-of-the-country", "area", "ct", 31.6, -8, 60, 57),
    g("north-area-of-the-country", "area", "north-region-of-the-country", 31.6, -8.1, 25, 55),
    pl("n1", "north-area-of-the-country", 31.65, -8.15, 40),
    pl("n2", "north-area-of-the-country", 31.55, -8.05, 34),
    pl("n3", "north-region-of-the-country", 31.9, -7.6, 36),
    g("south-region-of-the-country", "area", "ct", 31.1, -7.4, 60, 57),
    g("south-area-of-the-country", "area", "south-region-of-the-country", 31.1, -7.4, 25, 55),
    pl("s1", "south-area-of-the-country", 31.15, -7.45, 38),
    pl("s2", "south-area-of-the-country", 31.05, -7.35, 34),
    pl("s3", "south-region-of-the-country", 30.8, -7.9, 35),
    pl("e1", "ct", 29.5, -9.5, 41),
  ];

  it("nested areas: a group opens through an area whose box and long label do not fit, into the places inside it, to any depth", () => {
    const nodes = nested();
    const now = openingOf(nodes, { slug: "ct", lon: -8, lat: 31 }, true, 2, 9, 0.02);
    const before = openingOf(nodes, { slug: "ct", lon: -8, lat: 31 }, false, 2, 9, 0.02);
    expect(now.zoom).toBeGreaterThan(0);
    expect(before.zoom - now.zoom, `${now.zoom} vs ${before.zoom}`).toBeGreaterThanOrEqual(0.5);
    expect(now.shown).toBeGreaterThanOrEqual(2);
    const tree = new LodTree(nodes);
    let throughSeen = false;
    let last: Drawn[] = [];
    for (const z of sweepZooms(2.5, 9, 0.01)) {
      const d = drawnAt(tree, camera(-8, 31, z));
      // the strict invariant, to any depth: no node under a drawn ancestor
      for (const n of d) for (let a = tree.parent[tree.indexOf(n.slug)]!; a >= 0; a = tree.parent[a]!) expect(has(d, tree.slug[a]!), `${n.slug} under ${tree.slug[a]} at ${z}`).toBe(false);
      // an area open through its places, its own box not drawn, a place of it drawn
      for (const area of ["north-region-of-the-country", "south-region-of-the-country", "north-area-of-the-country", "south-area-of-the-country"]) {
        if (tree.isOpen(tree.indexOf(area)) && !has(d, area) && belowGroup(tree, d, area).length === 1) throughSeen = true;
      }
      // a zoom-in never takes a drawn node away except by opening its group
      for (const n of last) {
        if (has(d, n.slug)) continue;
        const i = tree.indexOf(n.slug);
        expect(tree.isGroup[i] === 1 && tree.isOpen(i), `${n.slug} gone at ${z}`).toBe(true);
      }
      last = d;
    }
    expect(throughSeen).toBe(true);
  });

  it("every kind of group opens early; early:false is the size rule alone", () => {
    for (const kind of ["continent", "subregion", "region", "country", "area"] as const) {
      const nodes = country(kind);
      const early = opensAt(nodes, "xx", 5, 46, true, 2, 9, 0.02);
      const sizeOnly = opensAt(nodes, "xx", 5, 46, false, 2, 9, 0.02);
      expect(early, kind).toBeGreaterThan(0);
      expect(sizeOnly - early, kind).toBeGreaterThan(0.5);
    }
  });

  it("the size rule still opens a group with ALL its places: a box covering boxMaxTo of the screen is open whatever the room, and so is every group from street scale", () => {
    const tree = new LodTree(country());
    for (const z of sweepZooms(3, 12, 0.05)) {
      const d = drawnAt(tree, camera(5, 46, z));
      const i = tree.indexOf("xx");
      const frac = Math.max(tree.boxX1[i]! - tree.boxX0[i]!, tree.boxY1[i]! - tree.boxY0[i]!) / SWEEP.height;
      if (frac >= LOD.boxMaxTo) {
        expect(has(d, "xx"), `z ${z}`).toBe(false);
        // every place that is on the screen is drawn (the size rule shows them all)
        expect(placesOf(d).length, `z ${z}`).toBe(tree.members[i]);
      }
    }
    const same = new LodTree([g("s", "area", undefined, 0, 0, 5), pl("x", "s", 0, 0, 40, 0.5), pl("y", "s", 0, 0, 40, 0.5)]);
    expect(has(drawnAt(same, camera(0, 0, LOD.forceOpenZoom + 0.1)), "s")).toBe(false);
  });
});

describe("hysteresis: no flapping, and a drawn node stays", () => {
  it("a camera that jitters around any threshold changes each node at most once (zoom and position)", () => {
    const tree = new LodTree(country());
    let worst = 0;
    for (const z of sweepZooms(2.8, 6.5, 0.01)) {
      drawnAt(tree, camera(5, 46, z));
      const toggles = new Map<string, number>();
      let last = new Set(slugs(drawnAt(tree, camera(5, 46, z))));
      for (const [dz, dl] of [[0.004, 0], [-0.004, 0.01], [0.008, -0.01], [-0.008, 0], [0.002, 0.02], [-0.002, -0.02]] as const) {
        const now = new Set(slugs(drawnAt(tree, camera(5 + dl, 46 + dl, z + dz))));
        for (const s of new Set([...last, ...now])) if (last.has(s) !== now.has(s)) toggles.set(s, (toggles.get(s) ?? 0) + 1);
        last = now;
      }
      for (const [s, n] of toggles) {
        worst = Math.max(worst, n);
        expect(n, `${s} at ${z}`).toBeLessThanOrEqual(1);
      }
    }
    expect(worst).toBeLessThanOrEqual(1);
  });

  it("it closes later than it opens: zooming out keeps an open group open for `stickyZoom` more levels, then it merges back", () => {
    const tree = new LodTree(country());
    const open = opensAt(country(), "xx", 5, 46);
    for (const z of sweepZooms(2.5, open + 0.5, 0.05)) drawnAt(tree, camera(5, 46, z));
    expect(has(drawnAt(tree, camera(5, 46, open + 0.5)), "xx")).toBe(false);
    // down to stickyZoom below the opening: still open
    expect(has(drawnAt(tree, camera(5, 46, open - LOD.open.stickyZoom * 0.9)), "xx")).toBe(false);
    // well below: closed again (its places fit no more)
    let closed = -1;
    for (let z = open; z >= 2.5; z -= 0.01) {
      if (has(drawnAt(tree, camera(5, 46, z)), "xx")) {
        closed = z;
        break;
      }
    }
    expect(closed).toBeGreaterThan(0);
    expect(closed).toBeLessThan(open - 0.2);
  });

  it("a zoom-in never takes a node away: a drawn place stays (or is replaced by its own group's descendants), a group box goes only by opening", () => {
    const tree = new LodTree(country());
    let last: Drawn[] = [];
    for (const z of sweepZooms(2.8, 9, 0.01)) {
      const d = drawnAt(tree, camera(5, 46, z));
      for (const n of last) {
        if (has(d, n.slug)) continue;
        // gone: it is a group that opened (its places are drawn), nothing else
        const i = tree.indexOf(n.slug);
        expect(tree.isGroup[i], `${n.slug} at ${z}`).toBe(1);
        expect(tree.isOpen(i), `${n.slug} at ${z}`).toBe(true);
      }
      last = d;
    }
  });
});

describe("the screen budget", () => {
  // 24 countries of three places on a lattice, all in view
  const lattice = (): LodNodeInput[] => {
    const nodes: LodNodeInput[] = [g("w", "continent", undefined, 20, 20, 5000, 90)];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 8; c++) {
        const lat = 14 + r * 5;
        const lon = 8 + c * 6;
        const slug = `k${r}-${c}`;
        nodes.push(g(slug, "country", "w", lat, lon, 120, 70), pl(`${slug}a`, slug, lat + 1.2, lon - 1.5, 44), pl(`${slug}b`, slug, lat - 1.3, lon + 1.6, 40), pl(`${slug}c`, slug, lat, lon, 36));
      }
    }
    return nodes;
  };
  it("the boxes the early opening adds stop at the budget, and it scales with the free area (the detail panel open leaves less)", () => {
    const run = (free: number) => {
      const early = new LodTree(lattice());
      const sizeOnly = new LodTree(lattice(), { early: false });
      const budget = Math.max(LOD.open.budgetMin, Math.min(LOD.open.budgetMax, Math.round((LOD.open.budget * free * SWEEP.height) / LOD.open.budgetRefArea)));
      let maxEarly = 0;
      let maxSize = 0;
      for (const z of sweepZooms(3, 5.4, 0.05)) {
        const after = measure(drawnAt(early, camera(30, 20, z, free)), free).boxes;
        const before = measure(drawnAt(sizeOnly, camera(30, 20, z, free)), free).boxes;
        // (the size rule opens its groups with all their places, budget or not: the early opening adds nothing above it)
        expect(after, `free ${free} z ${z}`).toBeLessThanOrEqual(Math.max(before, budget + LOD.open.budgetKeep));
        maxEarly = Math.max(maxEarly, after);
        maxSize = Math.max(maxSize, before);
      }
      return { budget, maxEarly, maxSize };
    };
    const big = run(SWEEP.width);
    expect(big.budget).toBe(LOD.open.budget);
    expect(big.maxEarly).toBeGreaterThan(big.maxSize);
    expect(big.maxEarly).toBeGreaterThanOrEqual(big.budget - 4);
    const narrow = run(500);
    expect(narrow.budget).toBeLessThan(big.budget);
  });
});

describe("the cross-fade: a group and the children it opens into run in lockstep", () => {
  const FRAME = 16;
  const alphaMap = (t: LodTree) => {
    const m = new Map<number, number>();
    for (let k = 0; k < t.count; k++) m.set(t.visible[k]!, t.alpha[t.visible[k]!]!);
    return m;
  };
  /** Every (ancestor, descendant) pair drawn together in this frame: the sum of their opacities. */
  const worstSum = (t: LodTree) => {
    const a = alphaMap(t);
    let worst = 0;
    let who = "";
    for (const [i, ai] of a) {
      for (let p = t.parent[i]!; p >= 0; p = t.parent[p]!) {
        const ap = a.get(p);
        if (ap !== undefined && ap + ai > worst) {
          worst = ap + ai;
          who = `${t.slug[p]} ${ap.toFixed(3)} + ${t.slug[i]} ${ai.toFixed(3)}`;
        }
      }
    }
    return { worst, who };
  };

  /** A tree resting on a closed country, then the camera jumps to where it opens: the clock reading of the switch. */
  function openingTree(reduced = false) {
    const t = new LodTree(country());
    const z = opensAt(country(), "xx", 5, 46) + 0.05;
    t.alphas(camera(5, 46, 3));
    t.advance(1000);
    t.update(camera(5, 46, z), -1, -1, reduced);
    return { t, z };
  }

  it("the group goes 1 -> 0 exactly as its children go 0 -> 1: same start, same duration, the opacities of the group and of any child sum to 1 all along, never more", () => {
    const { t } = openingTree();
    const xx = t.indexOf("xx");
    expect(t.life.target[xx]).toBe(0);
    let now = 1000;
    let frames = 0;
    let started = -1;
    let ended = -1;
    while (t.animating && frames++ < 100) {
      now += FRAME;
      t.advance(now);
      const a = alphaMap(t);
      const parent = a.get(xx) ?? 0;
      const kids = [...a].filter(([i]) => i !== xx && t.parent[i] === xx);
      const kidMax = Math.max(0, ...kids.map(([, v]) => v));
      // never both at full opacity, never more than 1 together
      expect(parent + kidMax, `t ${now - 1000}`).toBeLessThanOrEqual(1 + 1e-6);
      expect(worstSum(t).worst, worstSum(t).who).toBeLessThanOrEqual(1 + 1e-6);
      // while both are drawn they sum to 1 (a node below alphaMin is not drawn at all)
      if (parent > 0 && kidMax > 0) expect(parent + kidMax, `t ${now - 1000}`).toBeGreaterThanOrEqual(1 - 2 * LOD.alphaMin);
      // every child is at the same opacity (they all began together)
      for (const [, v] of kids) expect(v).toBeCloseTo(kidMax, 6);
      if (kidMax > 0 && started < 0) started = now;
      if (parent === 0 && kidMax === 1 && ended < 0) ended = now;
      if (parent > 0 && parent < 1 - 2 * LOD.alphaMin) expect(kidMax).toBeGreaterThan(0);
    }
    // (a child below alphaMin is not drawn yet: the first frames of the ease)
    expect(started).toBeGreaterThanOrEqual(1000 + FRAME);
    expect(started).toBeLessThanOrEqual(1000 + 3 * FRAME);
    expect(ended - 1000).toBeLessThanOrEqual(FADE_MS + FRAME);
    expect(ended - 1000).toBeGreaterThanOrEqual(FADE_MS - FRAME);
    const end = alphaMap(t);
    expect(end.has(xx)).toBe(false);
    expect([...end.values()].every((v) => v === 1)).toBe(true);
  });

  it("a reversal mid-way keeps the pair in step: the group comes back as the children go, the sum stays 1", () => {
    const { t, z } = openingTree();
    const xx = t.indexOf("xx");
    let now = 1000;
    for (let k = 0; k < 5; k++) {
      now += FRAME;
      t.advance(now);
    }
    t.update(camera(5, 46, 3), -1, -1, false);
    // (the stickiness keeps it open: zoom out far enough to close)
    t.update(camera(5, 46, z - 3), -1, -1, false);
    let guard = 0;
    while (t.animating && guard++ < 100) {
      now += FRAME;
      t.advance(now);
      expect(worstSum(t).worst, worstSum(t).who).toBeLessThanOrEqual(1 + 1e-6);
    }
    const end = alphaMap(t);
    expect(end.get(xx)).toBe(1);
    expect(end.size).toBe(1);
  });

  it("reduced motion: the swap is instant, the next frame is the resting frame", () => {
    const { t } = openingTree(true);
    t.advance(1016);
    expect(t.animating).toBe(false);
    const a = alphaMap(t);
    expect(a.has(t.indexOf("xx"))).toBe(false);
    expect([...a.values()].every((v) => v === 1)).toBe(true);
    expect(a.size).toBeGreaterThanOrEqual(2);
  });

  it("negative control: the checker does see a group and a child drawn at full opacity together", () => {
    const t = new LodTree(country());
    t.alphas(camera(5, 46, 3));
    expect(t.life.target[t.indexOf("xx")]).toBe(1);
    t.advance(1000);
    t.life.set(t.indexOf("a1"), true); // a child that comes in while its group stays: the bug the lockstep rule excludes
    for (let now = 1016; t.animating && now < 2000; now += FRAME) t.advance(now);
    expect(worstSum(t).worst).toBeGreaterThan(1.9);
  });

  it("over a random camera path and random frame times the sum of an ancestor's and a descendant's opacity never exceeds 1 (a deep tree, nothing forced)", () => {
    const nodes: LodNodeInput[] = [g("r", "continent", undefined, 46, 6, 2500, 90)];
    for (let c = 0; c < 3; c++) {
      const cl = 46 + (c - 1) * 3;
      nodes.push(g(`c${c}`, "region", "r", cl, 6, 600, 80));
      for (let k = 0; k < 3; k++) {
        const kl = cl + (k - 1) * 0.9;
        nodes.push(g(`c${c}k${k}`, "country", `c${c}`, kl, 6 + k, 150, 70));
        for (let q = 0; q < 4; q++) nodes.push(pl(`c${c}k${k}q${q}`, `c${c}k${k}`, kl + ((q % 2) - 0.5) * 0.4, 6 + k + (Math.floor(q / 2) - 0.5) * 0.5, 30 + q * 3 + c));
      }
    }
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const tree = new LodTree(nodes);
    let now = 1000;
    let lon = 6;
    let lat = 46;
    let zoom = 3;
    let worst = 0;
    let frames = 0;
    for (let step = 0; step < 4000; step++) {
      // a jittery zoom walk with pans, frames of 4 to 70 ms (a pause counts as one frame)
      zoom = Math.min(9.5, Math.max(2.5, zoom + (rnd() - 0.47) * 0.06));
      lon += (rnd() - 0.5) * 0.2;
      lat += (rnd() - 0.5) * 0.2;
      tree.update(camera(lon, lat, zoom), -1, -1, false);
      now += 4 + rnd() * 66;
      tree.advance(now);
      const w = worstSum(tree);
      worst = Math.max(worst, w.worst);
      expect(w.worst, `step ${step}: ${w.who}`).toBeLessThanOrEqual(1 + 1e-6);
      frames++;
    }
    expect(frames).toBe(4000);
    expect(worst).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------------------------- the owner's preview */

const previewUrl = new URL("../../../../../packages/published/data/preview.projection.json", import.meta.url);
const havePreview = existsSync(previewUrl);

const previewNodes = (): LodNodeInput[] => nodesFromProjection(JSON.parse(readFileSync(previewUrl, "utf8")));

describe.skipIf(!havePreview)("the owner's preview projection (sweeps)", () => {
  const nodes = havePreview ? previewNodes() : [];
  const rows: SweepRow[] = havePreview ? runSweep(nodes, SWEEP_CENTRES, sweepZooms(2, 9, 0.25)) : [];
  const mean = (r: SweepRow[], f: (x: SweepRow) => number) => r.reduce((a, x) => a + f(x), 0) / Math.max(1, r.length);

  it("zoom 2 to 9 over six view centres: never more boxes than the budget allows, fewer overlapping pairs than the size rule alone (a label is planned clear of every box it can)", () => {
    expect(rows.length).toBe(SWEEP_CENTRES.length * sweepZooms(2, 9, 0.25).length);
    let more = 0;
    for (const r of rows) {
      expect(r.after.boxes, `${r.centre} ${r.zoom}`).toBeLessThanOrEqual(Math.max(r.before.boxes, LOD.open.budget + LOD.open.budgetKeep));
      expect(r.after.planOverlaps, `${r.centre} ${r.zoom}`).toBeLessThanOrEqual(r.before.planOverlaps);
      // a few views have a pair more: two incumbents whose true boxes have grown into each other since they came in, or a label that had no box-clear position
      expect(r.after.overlaps, `${r.centre} ${r.zoom}: ${r.after.pairs.join("; ")}`).toBeLessThanOrEqual(r.before.overlaps + 3);
      if (r.after.overlaps > r.before.overlaps) more++;
    }
    expect(more).toBeLessThanOrEqual(Math.ceil(rows.length * 0.05));
    expect(rows.reduce((a, r) => a + r.after.overlaps, 0)).toBeLessThan(rows.reduce((a, r) => a + r.before.overlaps, 0));
    for (const c of SWEEP_CENTRES) {
      const r = rows.filter((x) => x.centre === c.name);
      expect(mean(r, (x) => x.after.overlaps), c.name).toBeLessThanOrEqual(mean(r, (x) => x.before.overlaps));
      expect(mean(r, (x) => x.before.freeRoom) - mean(r, (x) => x.after.freeRoom), c.name).toBeLessThan(0.03);
      expect(mean(r, (x) => x.after.boxes), c.name).toBeGreaterThan(mean(r, (x) => x.before.boxes));
    }
    expect(Math.max(...rows.map((r) => r.after.boxes))).toBeLessThanOrEqual(LOD.open.budget + LOD.open.budgetKeep);
  });

  it("the groups of the complaint open at least half a zoom level before the size rule did, with two or more of their places drawn", () => {
    for (const grp of SWEEP_GROUPS) {
      const now = openingOf(nodes, grp, true);
      const before = openingOf(nodes, grp, false);
      expect(now.zoom, grp.slug).toBeGreaterThan(0);
      expect(before.zoom - now.zoom, `${grp.slug}: ${now.zoom} vs ${before.zoom}`).toBeGreaterThanOrEqual(0.5);
      expect(now.shown, grp.slug).toBeGreaterThanOrEqual(2);
      expect(now.overlaps, `${grp.slug} at its opening`).toBeLessThanOrEqual(before.overlaps + 1);
    }
  });

  it("the Moroccan areas (area inside area inside a country) open before the size rule did, through their most important place when their box does not fit", () => {
    for (const grp of SWEEP_AREAS) {
      const now = openingOf(nodes, grp, true);
      const before = openingOf(nodes, grp, false);
      expect(now.zoom, grp.slug).toBeGreaterThan(0);
      expect(before.zoom - now.zoom, `${grp.slug}: ${now.zoom} vs ${before.zoom}`).toBeGreaterThanOrEqual(0.5);
      expect(now.shown, grp.slug).toBeGreaterThanOrEqual(1);
      expect(now.overlaps, `${grp.slug} at its opening`).toBeLessThanOrEqual(before.overlaps + 2);
    }
  });

  it("the complaint: Western Europe is never drawn together with a place of it, and as soon as its box is gone at least two of its places are drawn", () => {
    const tree = new LodTree(nodes);
    const we = tree.indexOf("western-europe");
    let seenOpen = false;
    for (const z of sweepZooms(2, 7, 0.01)) {
      const d = drawnAt(tree, camera(5, 46, z));
      const below = belowGroup(tree, d, "western-europe");
      if (has(d, "western-europe")) expect(below, `z ${z}`).toEqual([]);
      if (tree.isOpen(we)) {
        seenOpen = true;
        expect(has(d, "western-europe")).toBe(false);
        expect(below.length, `z ${z}`).toBeGreaterThanOrEqual(2);
      }
    }
    expect(seenOpen).toBe(true);
  });

  it("at rest no node is ever drawn together with a drawn ancestor, and every node is fully drawn or not at all (all centres, every 0.05 of zoom)", () => {
    let views = 0;
    for (const c of SWEEP_CENTRES) {
      const tree = new LodTree(nodes);
      for (const z of sweepZooms(2, 10, 0.05)) {
        const a = tree.alphas(camera(c.lon, c.lat, z));
        views++;
        for (const [slug, alpha] of a) {
          expect(alpha, `${slug} at ${c.name} ${z}`).toBe(1);
          expect(tree.hasDrawnAncestor(tree.indexOf(slug)), `${slug} at ${c.name} ${z}`).toBe(false);
        }
      }
    }
    expect(views).toBeGreaterThan(300);
  });

  it("zooming in never closes a group that is on the screen, and never takes a place away (all centres and groups, steps of 0.01)", () => {
    const centres = [...SWEEP_CENTRES, ...SWEEP_GROUPS.map((x) => ({ name: x.slug, lon: x.lon, lat: x.lat }))];
    for (const c of centres) {
      const tree = new LodTree(nodes);
      let last = new Map<string, boolean>();
      let lastPlaces = new Set<string>();
      for (const z of sweepZooms(2, 8.5, 0.01)) {
        const d = drawnAt(tree, camera(c.lon, c.lat, z));
        const open = new Map<string, boolean>();
        for (let i = 0; i < tree.size; i++) {
          if (!tree.isGroup[i]) continue;
          const on = tree.boxX1[i]! > 0 && tree.boxX0[i]! < SWEEP.width && tree.boxY1[i]! > 0 && tree.boxY0[i]! < SWEEP.height;
          open.set(tree.slug[i]!, tree.isOpen(i));
          // reached by its ancestors, on the screen, and closed after having been open: a group that closed on a zoom-in
          let reached = true;
          for (let a = tree.parent[i]!; a >= 0; a = tree.parent[a]!) if (!tree.isOpen(a)) reached = false;
          if (reached && on && tree.members[i]! > 0 && last.get(tree.slug[i]!) && !tree.isOpen(i)) throw new Error(`${tree.slug[i]} closes at ${z} on the way in (${c.name})`);
        }
        const places = new Set(placesOf(d));
        for (const s of lastPlaces) {
          if (places.has(s)) continue;
          // gone: only off the screen or over the limb
          const i = tree.indexOf(s);
          const onScreen = tree.boxX1[i]! > 0 && tree.boxX0[i]! < SWEEP.width && tree.boxY1[i]! > 0 && tree.boxY0[i]! < SWEEP.height;
          expect(onScreen && tree.shown[i] === 1 && (tree.boxX1[i]! - tree.boxX0[i]!) / SWEEP.height < LOD.sizeFadeFrom, `${s} gone at ${z} (${c.name})`).toBe(false);
        }
        last = open;
        lastPlaces = places;
      }
    }
  });

  it("is deterministic: the same nodes drawn whatever the order of the input", () => {
    const shuffled = [...nodes].reverse();
    const mid = Math.floor(shuffled.length / 2);
    const other = [...shuffled.slice(mid), ...shuffled.slice(0, mid)];
    for (const c of SWEEP_CENTRES.slice(0, 4)) {
      const a = new LodTree(nodes);
      const b = new LodTree(other);
      for (const z of sweepZooms(3, 7, 0.25)) {
        const da = slugs(drawnAt(a, camera(c.lon, c.lat, z))).sort();
        const db = slugs(drawnAt(b, camera(c.lon, c.lat, z))).sort();
        expect(db, `${c.name} ${z}`).toEqual(da);
      }
    }
  });

  it("is stable under small camera moves: over every sweep view, no node changes more than once in a jitter of a pixel or two", () => {
    let views = 0;
    for (const c of SWEEP_CENTRES) {
      const tree = new LodTree(nodes);
      for (const z of sweepZooms(2.5, 8, process.env.OPEN_STRESS ? 0.0078125 : 0.125)) {
        drawnAt(tree, camera(c.lon, c.lat, z));
        const toggles = new Map<string, number>();
        const shownAt: Uint8Array[] = [];
        let last = new Set(slugs(drawnAt(tree, camera(c.lon, c.lat, z))));
        for (const [dz, dx, dy] of [[0.0015, 0, 0], [-0.0015, 0.005, 0], [0.003, 0, 0.005], [0, -0.005, -0.005], [-0.003, 0.01, 0], [0.001, -0.01, 0.01], [0, 0, 0]] as const) {
          const now = new Set(slugs(drawnAt(tree, camera(c.lon + dx, c.lat + dy, z + dz))));
          shownAt.push(Uint8Array.from(tree.shown));
          for (const s of new Set([...last, ...now])) if (last.has(s) !== now.has(s)) toggles.set(s, (toggles.get(s) ?? 0) + 1);
          last = now;
        }
        views++;
        // A place on the limb of the globe is shown or not as the camera moves by a hair (the visibility rule has no memory): the group above it
        // sees one visible child or two, which is another rule (a group with one visible child is that child's rectangle). Those groups, and what is
        // below them, are the visibility rule's business.
        const exempt = new Set<number>();
        const below = (g: number, i: number) => {
          for (let a = i; a >= 0; a = tree.parent[a]!) if (a === g) return true;
          return false;
        };
        for (let i = 0; i < tree.size; i++) {
          if (tree.isGroup[i] || shownAt.every((sh) => sh[i] === shownAt[0]![i])) continue;
          const g = tree.parent[i]!;
          for (let j = 0; j < tree.size; j++) if (g >= 0 && below(g, j)) exempt.add(j);
        }
        for (const [s, n] of toggles) {
          const i = tree.indexOf(s);
          // (a box at the very edge of the free area has its own rules too)
          const edge = tree.boxX1[i]! < 4 || tree.boxX0[i]! > SWEEP.width - 4 || tree.boxY1[i]! < 4 || tree.boxY0[i]! > SWEEP.height - 4 || !tree.shown[i];
          if (!edge && !exempt.has(i)) expect(n, `${c.name} ${z} ${s}`).toBeLessThanOrEqual(1);
        }
      }
    }
    expect(views).toBeGreaterThan(100);
  });

  it("over a random camera path with random frame times, on the real tree, a group and its descendants never sum above 1", () => {
    let seed = 11;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (const c of SWEEP_CENTRES.slice(0, 4)) {
      const tree = new LodTree(nodes);
      let lon = c.lon;
      let lat = c.lat;
      let zoom = 3;
      let now = 1000;
      for (let step = 0; step < 1500; step++) {
        zoom = Math.min(9, Math.max(2.5, zoom + (rnd() - 0.46) * 0.08));
        lon += (rnd() - 0.5) * 0.25;
        lat += (rnd() - 0.5) * 0.25;
        tree.update(camera(lon, lat, zoom), -1, -1, false);
        now += 4 + rnd() * 60;
        tree.advance(now);
        const a = new Map<number, number>();
        for (let k = 0; k < tree.count; k++) a.set(tree.visible[k]!, tree.alpha[tree.visible[k]!]!);
        for (const [i, ai] of a) for (let p = tree.parent[i]!; p >= 0; p = tree.parent[p]!) {
          const ap = a.get(p);
          if (ap !== undefined) expect(ap + ai, `${c.name} step ${step}: ${tree.slug[p]} ${ap} + ${tree.slug[i]} ${ai}`).toBeLessThanOrEqual(1 + 1e-6);
        }
      }
    }
  });

  if (process.env.OPEN_REPORT) {
    it("report", () => {
      const f = (x: number, n = 2) => x.toFixed(n);
      const lines = ["", "centre            boxes (mean size rule -> early, max)   free room (mean)   overlapping pairs (mean, max)"];
      for (const c of SWEEP_CENTRES) {
        const r = rows.filter((x) => x.centre === c.name);
        lines.push(
          `${c.name.padEnd(16)}  ${f(mean(r, (x) => x.before.boxes))} -> ${f(mean(r, (x) => x.after.boxes))}  (max ${Math.max(...r.map((x) => x.before.boxes))} -> ${Math.max(...r.map((x) => x.after.boxes))})   ${f(mean(r, (x) => x.before.freeRoom), 3)} -> ${f(mean(r, (x) => x.after.freeRoom), 3)}   ${f(mean(r, (x) => x.before.overlaps))} -> ${f(mean(r, (x) => x.after.overlaps))}  (max ${Math.max(...r.map((x) => x.before.overlaps))} -> ${Math.max(...r.map((x) => x.after.overlaps))})`,
        );
      }
      lines.push("", "group             opens at zoom (size rule -> early)   places shown at the opening (of the total)   boxes on screen then   overlapping pairs then");
      for (const grp of [...SWEEP_GROUPS, ...SWEEP_AREAS]) {
        const now = openingOf(nodes, grp, true);
        const before = openingOf(nodes, grp, false);
        lines.push(`${grp.slug.padEnd(16)}  ${f(before.zoom)} -> ${f(now.zoom)}                      ${before.shown} -> ${now.shown} of ${now.total}                          ${before.boxes} -> ${now.boxes}              ${before.overlaps} -> ${now.overlaps}`);
      }
      console.log(lines.join("\n"));
    });
  }
});

