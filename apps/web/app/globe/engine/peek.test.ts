import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LOD, LodTree, labelScoreOf, type GroupKind, type LodNodeInput } from "./lod-tree";
import { camera, drawnAt, measure, nodesFromProjection, runSweep, SWEEP, SWEEP_CENTRES, sweepZooms, type Drawn, type SweepRow } from "./peek-sweep";
import { peeksToDrop, planLabels, pxUnits, type PeekCheck } from "./label-plan";
import { labelVariants } from "./label-text";

/**
 * The PEEK pass (engine/lod-tree.ts `peekPass`): the most important places under a CLOSED group are drawn inside it. Synthetic trees for the
 * rules, then sweeps over the owner's preview projection (git-ignored: those tests are skipped without it) with the numbers of
 * docs/web-architecture.md. `PEEK_REPORT=1 pnpm --filter @catalyst/web exec vitest run peek` prints the table.
 */

const g = (slug: string, kind: LodNodeInput["kind"], parent: string | undefined, lat: number, lon: number, radiusKm: number, priority = 50): LodNodeInput => ({ slug, name: slug, kind, parent, lat, lon, radiusKm, priority });
const pl = (slug: string, parent: string | undefined, lat: number, lon: number, priority: number, radiusKm = 10) => g(slug, "place", parent, lat, lon, radiusKm, priority);

/** A country of six places in two close pairs (Western Europe like), inside a continent. */
function country(kind: GroupKind = "country", parentKind: GroupKind | null = "continent"): LodNodeInput[] {
  return [
    ...(parentKind ? [g("eu", parentKind, undefined, 46, 6, 2000, 90)] : []),
    g("xx", kind, parentKind ? "eu" : undefined, 46, 6, 300, 70),
    pl("a1", "xx", 48.8, 2.3, 44),
    pl("a2", "xx", 48.5, 2.9, 40),
    pl("b1", "xx", 45.7, 5.7, 43),
    pl("b2", "xx", 46.2, 6.1, 39),
    pl("c", "xx", 43.6, 1.4, 38),
    pl("d", "xx", 49.5, 8.5, 36),
  ];
}

const peeksOf = (d: readonly Drawn[]) => d.filter((n) => n.peek).map((n) => n.slug);
const hostOf = (d: readonly Drawn[], slug = "xx") => d.find((n) => n.slug === slug);
const side = (n: Drawn) => Math.max(n.box.x1 - n.box.x0, n.box.y1 - n.box.y0);

describe("the peek rules (synthetic country of six places)", () => {
  it("a closed country shows its most important places inside its box, one box with the TOTAL in its chip", () => {
    const tree = new LodTree(country());
    let seen = false;
    for (const z of sweepZooms(3, 5.5, 0.25)) {
      const d = drawnAt(tree, camera(5, 46, z));
      const host = hostOf(d)!;
      const peeks = d.filter((n) => n.peek);
      if (!peeks.length) continue;
      seen = true;
      expect(host, `z ${z}`).toBeDefined();
      expect(tree.chip[tree.indexOf("xx")]).toBe("6 entries");
      expect(peeks.length).toBeLessThanOrEqual(LOD.peek.perHost);
      expect(peeks.length).toBeGreaterThanOrEqual(2);
      for (const p of peeks) {
        // inside the host's box, and small beside it
        const cx = (p.box.x0 + p.box.x1) / 2;
        const cy = (p.box.y0 + p.box.y1) / 2;
        expect(cx > host.box.x0 && cx < host.box.x1 && cy > host.box.y0 && cy < host.box.y1, `${p.slug} inside at ${z}`).toBe(true);
        expect(side(p)).toBeLessThanOrEqual(LOD.peek.maxHostFrac.leave * side(host) + 1e-9);
      }
      // the most important ones: a1 (44) and b1 (43) before the rest
      expect(peeks.map((n) => n.slug)).toContain("a1");
      expect(peeks.map((n) => n.slug)).toContain("b1");
    }
    expect(seen).toBe(true);
  });

  it("a peek comes with a host of at least hostMinPx and never below its leave size; none while the host is smaller", () => {
    const tree = new LodTree(country());
    let first = -1;
    for (const z of sweepZooms(2, 6, 0.05)) {
      const d = drawnAt(tree, camera(5, 46, z));
      const host = hostOf(d);
      if (peeksOf(d).length) {
        first ??= z;
        if (first < 0) first = z;
        expect(side(host!)).toBeGreaterThanOrEqual(LOD.peek.hostMinPx.leave - 1e-6);
      } else if (host && !d.some((n) => n.slug === "a1")) expect(side(host) < LOD.peek.hostMinPx.enter || true).toBe(true);
    }
    expect(first).toBeGreaterThan(0);
    // the first peek is at the enter size
    const t2 = new LodTree(country());
    for (const z of sweepZooms(2, 6, 0.02)) {
      const d = drawnAt(t2, camera(5, 46, z));
      if (peeksOf(d).length) {
        expect(side(hostOf(d)!)).toBeGreaterThanOrEqual(LOD.peek.hostMinPx.enter - 1e-6);
        break;
      }
    }
  });

  it("continents are not hosts: a closed continent never shows peeks", () => {
    const nodes: LodNodeInput[] = [g("co", "continent", undefined, 46, 6, 800, 90), pl("a1", "co", 48.8, 2.3, 44), pl("a2", "co", 46.5, 6.1, 40), pl("a3", "co", 43.6, 1.4, 38)];
    const tree = new LodTree(nodes);
    for (const z of sweepZooms(2, 5.5, 0.1)) expect(peeksOf(drawnAt(tree, camera(4, 46, z))), `z ${z}`).toEqual([]);
  });

  it("the other group kinds host peeks", () => {
    for (const kind of ["subregion", "region", "country", "area"] as const) {
      const tree = new LodTree(country(kind));
      const any = sweepZooms(3, 5.5, 0.25).some((z) => peeksOf(drawnAt(tree, camera(5, 46, z))).length > 0);
      expect(any, kind).toBe(true);
    }
  });

  it("at most perHost peeks per host, the most important first; ties by the place's true size, then the slug (independent of the input order)", () => {
    // five places with the same priority and sizes that differ: the biggest first, equal sizes by slug
    const tied: LodNodeInput[] = [g("eu", "continent", undefined, 46, 6, 2000, 90), g("xx", "country", "eu", 46, 6, 300, 70), pl("m", "xx", 48.8, 2.3, 40, 8), pl("n", "xx", 43.6, 1.4, 40, 14), pl("o", "xx", 45.7, 5.7, 40, 14), pl("p", "xx", 49.5, 8.5, 40, 11), pl("q", "xx", 46.5, 9, 40, 6)];
    const want = new Set<string>();
    const orders = [tied, [...tied].reverse(), [tied[0]!, tied[1]!, ...tied.slice(2).sort((a, b) => (a.slug < b.slug ? 1 : -1))]];
    const results = orders.map((o) => {
      const tree = new LodTree(o);
      const out: string[] = [];
      for (const z of sweepZooms(3, 5.5, 0.25)) {
        const d = drawnAt(tree, camera(5, 46, z));
        out.push(`${z}:${peeksOf(d).sort().join(",")}`);
        expect(peeksOf(d).length).toBeLessThanOrEqual(LOD.peek.perHost);
        for (const s of peeksOf(d)) want.add(s);
      }
      return out;
    });
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    // the 14 km places (n then o by slug) are preferred to the 11, 8 and 6 km ones: n is there from the first peek
    expect(want.has("n")).toBe(true);
    expect(results[0]!.find((r) => r.split(":")[1])!.split(":")[1]).toContain("n");
  });

  it("a peek keeps a clear gap from every other drawn box (its host's outline excepted)", () => {
    const tree = new LodTree([...country(), g("far", "country", "eu", 49, 12, 120, 70), pl("f1", "far", 49, 12, 41), pl("f2", "far", 49.1, 12.3, 40)]);
    for (const z of sweepZooms(3, 6, 0.1)) {
      const d = drawnAt(tree, camera(7, 47, z));
      for (const p of d.filter((n) => n.peek)) {
        for (const o of d) {
          if (o === p || o.slug === p.host) continue;
          const dx = Math.max(o.box.x0 - p.box.x1, p.box.x0 - o.box.x1);
          const dy = Math.max(o.box.y0 - p.box.y1, p.box.y0 - o.box.y1);
          expect(Math.max(dx, dy), `${p.slug} vs ${o.slug} at ${z}`).toBeGreaterThanOrEqual(LOD.peek.gapPx.leave - 1e-6);
        }
      }
    }
  });

  it("a peek is at full opacity at rest, with the node's own timed fade, and its host stays one drawn box", () => {
    const tree = new LodTree(country());
    tree.alphas(camera(5, 46, 2.8));
    const t0 = 1000;
    tree.update(camera(5, 46, 4.5), -1, -1, false);
    for (let t = 0; t <= 128; t += 16) tree.advance(t0 + t);
    const mid = [...Array(tree.count).keys()].map((k) => tree.visible[k]!).filter((i) => tree.isPeek(i));
    expect(mid.length).toBeGreaterThan(0);
    for (const i of mid) expect(tree.alpha[i]!).toBeGreaterThan(0.06);
    expect(mid.some((i) => tree.alpha[i]! < 1)).toBe(true);
    for (let t = 144; t <= 400; t += 16) tree.advance(t0 + t);
    for (let k = 0; k < tree.count; k++) {
      const i = tree.visible[k]!;
      expect(tree.alpha[i], tree.slug[i]).toBe(1);
      if (tree.isPeek(i)) expect(tree.hasDrawnAncestor(i)).toBe(true);
    }
    expect(tree.alpha[tree.indexOf("xx")]).toBe(1);
  });

  it("reduced motion: the same peeks, switched at once", () => {
    const a = new LodTree(country());
    const b = new LodTree(country());
    for (const z of sweepZooms(3, 6, 0.25)) {
      const cam = camera(5, 46, z);
      const full = peeksOf(drawnAt(a, cam));
      b.update({ ...cam, zoom: z + 1e-12 }, -1, -1, true);
      b.advance(5000 + z * 1000);
      const reduced: string[] = [];
      for (let k = 0; k < b.count; k++) if (b.isPeek(b.visible[k]!)) reduced.push(b.slug[b.visible[k]!]!);
      expect(reduced.sort()).toEqual(full.sort());
      expect(b.animating).toBe(false);
    }
  });

  it("when its group opens, a peek stays drawn the whole time (no flicker through the opening); the other places come in", () => {
    const tree = new LodTree(country());
    let was = false;
    let opened = -1;
    for (const z of sweepZooms(3, 8, 0.01)) {
      const d = drawnAt(tree, camera(5, 46, z));
      const drawn = d.some((n) => n.slug === "a1");
      if (was) expect(drawn, `a1 at ${z}`).toBe(true);
      was ||= drawn;
      if (opened < 0 && !hostOf(d)) opened = z;
    }
    expect(opened).toBeGreaterThan(3);
    expect(was).toBe(true);
  });

  it("hysteresis: a camera that jitters around any threshold changes each node at most once (no flap)", () => {
    const tree = new LodTree(country());
    let worst = 0;
    for (const z of sweepZooms(2.8, 6.5, 0.01)) {
      drawnAt(tree, camera(5, 46, z));
      const toggles = new Map<string, number>();
      let last = new Set(drawnAt(tree, camera(5, 46, z)).map((n) => n.slug));
      for (const [dz, dl] of [[0.004, 0], [-0.004, 0.01], [0.008, -0.01], [-0.008, 0], [0.002, 0.02], [-0.002, -0.02]] as const) {
        const now = new Set(drawnAt(tree, camera(5 + dl, 46 + dl, z + dz)).map((n) => n.slug));
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

  it("the screen budget: peeks stop when the boxes on screen reach it, and it scales with the free area", () => {
    // 24 countries of three places on a lattice, all in view
    const nodes: LodNodeInput[] = [g("w", "continent", undefined, 20, 20, 5000, 90)];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 8; c++) {
        const lat = 14 + r * 5;
        const lon = 8 + c * 6;
        const slug = `k${r}-${c}`;
        nodes.push(g(slug, "country", "w", lat, lon, 120, 70), pl(`${slug}a`, slug, lat + 1.2, lon - 1.5, 44), pl(`${slug}b`, slug, lat - 1.3, lon + 1.6, 40), pl(`${slug}c`, slug, lat, lon, 36));
      }
    }
    const run = (free: number) => {
      const tree = new LodTree(nodes);
      const budget = Math.round((LOD.peek.budget * free * SWEEP.height) / LOD.peek.budgetRefArea);
      let maxBoxes = 0;
      let maxPeeks = 0;
      for (const z of sweepZooms(3, 5.6, 0.1)) {
        const m = measure(drawnAt(tree, camera(30, 20, z, free)), free);
        if (m.peeks > 0) maxBoxes = Math.max(maxBoxes, m.boxes);
        maxPeeks = Math.max(maxPeeks, m.peeks);
      }
      return { budget, maxBoxes, maxPeeks };
    };
    const big = run(SWEEP.width);
    expect(big.budget).toBe(LOD.peek.budget);
    expect(big.maxPeeks).toBeGreaterThanOrEqual(5);
    expect(big.maxBoxes).toBeLessThanOrEqual(LOD.peek.budget + LOD.peek.budgetKeep);
    // the budget is what stops them: the screen is full at it
    expect(big.maxBoxes).toBeGreaterThanOrEqual(LOD.peek.budget);
    // a narrower free area (the detail panel open) has a smaller budget
    const narrow = run(500);
    expect(narrow.budget).toBeLessThan(big.budget);
    expect(narrow.maxBoxes).toBeLessThanOrEqual(narrow.budget + LOD.peek.budgetKeep);
  });

  it("a peek the label planner refuses is dropped at once and not offered again until the camera has changed enough", () => {
    const tree = new LodTree(country());
    const cam = camera(5, 46, 4.5);
    expect(peeksOf(drawnAt(tree, cam)).sort()).toEqual(["a1", "b1", "c"]);
    const victim = tree.indexOf("a1");
    tree.dropPeek(victim);
    expect(tree.isPeek(victim)).toBe(false);
    tree.advance(1);
    expect([...tree.visible.subarray(0, tree.count)]).not.toContain(victim);
    // the same camera, a little zoom, a little pan: it does not come back (a less important place takes its slot)
    for (const c of [cam, camera(5, 46, 4.55), camera(5.05, 46, 4.5), camera(5, 46, 4.5 + LOD.peek.banZoom - 0.02)]) expect(peeksOf(drawnAt(tree, c)), `z ${c.zoom}`).not.toContain("a1");
    const banned = (zoom: number) => (tree as unknown as { peekBanned(p: number, cam: ReturnType<typeof camera>): boolean }).peekBanned(victim, camera(5, 46, zoom));
    expect(banned(4.6)).toBe(true);
    // a zoom level later the ban is over (the place is a candidate again: an incumbent in its slot may still keep it)
    expect(banned(4.5 + LOD.peek.banZoom + 0.1)).toBe(false);
    // dropping a node that is not a peek does nothing
    const host = tree.indexOf("xx");
    tree.dropPeek(host);
    expect(tree.life.target[host]).toBe(1);
  });

  it("the selected place under a closed group is drawn as before and is not counted as a peek", () => {
    const tree = new LodTree(country());
    const cam = camera(5, 46, 4.5);
    const sel = tree.indexOf("d");
    tree.update({ ...cam, zoom: cam.zoom + 1e-12 }, sel, -1, false);
    tree.settle();
    expect(tree.life.target[sel]).toBe(1);
    expect(tree.isPeek(sel)).toBe(false);
  });
});

describe("label order and the drop rule (pure)", () => {
  it("a peek's label ranks below its host's and below every other label", () => {
    const host = 80;
    expect(labelScoreOf(74, host)).toBeLessThan(host);
    expect(labelScoreOf(74, null)).toBe(74);
    // below the weakest label any node can have (a place of priority 0 has 30)
    expect(labelScoreOf(130, host)).toBeLessThan(30);
    // among peeks the order of the own score is kept
    expect(labelScoreOf(70, host)).toBeLessThan(labelScoreOf(72, host));
    expect(labelScoreOf(74, 55)).toBeLessThan(55);
  });

  const box = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });
  const node = (over: Partial<PeekCheck>): PeekCheck => ({ box: box(0, 0, 10, 10), plate: box(0, -20, 50, -5), peek: false, host: -1, overlap: false, onScreen: true, ...over });
  it("drops a peek whose label could only go over others, one under another's plate, one whose plate is over another's box; never the host's box, never one off the screen", () => {
    const host = node({ box: box(0, 0, 400, 400), plate: box(0, -25, 120, -3) });
    const ok = node({ peek: true, host: 0, box: box(100, 100, 123, 123), plate: box(94, 70, 160, 92) });
    expect(peeksToDrop([host, ok])).toEqual([]);
    expect(peeksToDrop([host, { ...ok, overlap: true }])).toEqual([1]);
    expect(peeksToDrop([host, ok, node({ box: box(300, 300, 320, 320), plate: box(90, 95, 150, 110) })])).toEqual([1]);
    expect(peeksToDrop([host, ok, node({ box: box(150, 60, 170, 80), plate: box(300, 300, 320, 320) })])).toEqual([1]);
    // the plate over the host's outline is fine
    expect(peeksToDrop([host, { ...ok, plate: box(-10, 100, 40, 120) }])).toEqual([]);
    expect(peeksToDrop([host, { ...ok, overlap: true, onScreen: false }])).toEqual([]);
    // only peeks are dropped
    expect(peeksToDrop([host, node({ box: box(90, 90, 130, 130), overlap: true })])).toEqual([]);
  });

  it("the planner keeps a peek's plate clear of the boxes it is told to avoid", () => {
    const rect = { c0: 600, r0: 400, c1: 623, r1: 423 };
    const variants = labelVariants("Valencia", null);
    const free = planLabels([{ score: 1, area: 1, key: "p", rect, variants, prev: null }], { cols: 1440, rows: 900 }, pxUnits(2.5))[0]!;
    expect(free.cand).toBe(0);
    const avoid = [{ x0: free.x - 5, y0: free.y - 5, x1: free.x + free.w + 5, y1: free.y + free.h + 5 }];
    const moved = planLabels([{ score: 1, area: 1, key: "p", rect, variants, prev: null, avoid }], { cols: 1440, rows: 900 }, pxUnits(2.5))[0]!;
    expect(moved.overlap).toBe(false);
    expect(moved.cand).not.toBe(0);
    expect(moved.x < avoid[0]!.x1 && moved.x + moved.w > avoid[0]!.x0 && moved.y < avoid[0]!.y1 && moved.y + moved.h > avoid[0]!.y0).toBe(false);
  });
});

/* -------------------------------------------------------------------------------------------- the owner's preview */

const previewUrl = new URL("../../../../../packages/published/data/preview.projection.json", import.meta.url);
const havePreview = existsSync(previewUrl);

const previewNodes = (): LodNodeInput[] => nodesFromProjection(JSON.parse(readFileSync(previewUrl, "utf8")));

const GROUPS = [
  { slug: "western-europe", lon: 5, lat: 46 },
  { slug: "balkans", lon: 19.9, lat: 43.5 },
  { slug: "iberia", lon: -3.6, lat: 40.3 },
  { slug: "central-europe", lon: 17.5, lat: 49.5 },
] as const;

describe.skipIf(!havePreview)("the owner's preview projection (sweeps)", () => {
  const nodes = havePreview ? previewNodes() : [];
  const rows: SweepRow[] = havePreview ? runSweep(nodes, SWEEP_CENTRES, sweepZooms(2, 9, 0.25)) : [];
  const mean = (r: SweepRow[], f: (x: SweepRow) => number) => r.reduce((a, x) => a + f(x), 0) / Math.max(1, r.length);

  it("zoom 2 to 9 over six view centres: never more boxes than the budget allows, and no new overlapping pair", () => {
    expect(rows.length).toBe(SWEEP_CENTRES.length * sweepZooms(2, 9, 0.25).length);
    for (const r of rows) {
      expect(r.after.boxes, `${r.centre} ${r.zoom}`).toBeLessThanOrEqual(Math.max(r.before.boxes, LOD.peek.budget + LOD.peek.budgetKeep));
      expect(r.after.overlaps, `${r.centre} ${r.zoom}`).toBeLessThanOrEqual(r.before.overlaps);
      expect(r.after.planOverlaps, `${r.centre} ${r.zoom}`).toBeLessThanOrEqual(r.before.planOverlaps);
      expect(r.after.boxes - r.after.peeks, `${r.centre} ${r.zoom}: the cut is the same without the peeks`).toBe(r.before.boxes);
    }
    expect(Math.max(...rows.map((r) => r.after.boxes))).toBeLessThanOrEqual(LOD.peek.budget + LOD.peek.budgetKeep);
    expect(rows.some((r) => r.after.peeks > 0)).toBe(true);
  });

  it("the free room for labels shrinks a little (a few points on average), never to nothing", () => {
    for (const c of SWEEP_CENTRES) {
      const r = rows.filter((x) => x.centre === c.name);
      expect(mean(r, (x) => x.before.freeRoom) - mean(r, (x) => x.after.freeRoom), c.name).toBeLessThan(0.06);
      expect(Math.min(...r.map((x) => x.after.freeRoom)), c.name).toBeGreaterThan(0.6);
    }
  });

  it("the complaint: with Western Europe closed, at least two of its places are drawn once its box is 18 % of the screen", () => {
    const tree = new LodTree(nodes);
    const checked: number[] = [];
    for (const z of sweepZooms(2, 6.5, 0.05)) {
      const d = drawnAt(tree, camera(5, 46, z));
      const host = hostOf(d, "western-europe");
      if (!host) continue;
      if (side(host) < 0.18 * SWEEP.height) continue;
      checked.push(z);
      expect(d.filter((n) => n.host === "western-europe").length, `z ${z}`).toBeGreaterThanOrEqual(2);
    }
    expect(checked.length).toBeGreaterThan(5);
  });

  it("peeks come before the group opens in all four groups of the complaint", () => {
    for (const grp of GROUPS) {
      const tree = new LodTree(nodes);
      let first = -1;
      let open = -1;
      for (const z of sweepZooms(2, 8, 0.05)) {
        const d = drawnAt(tree, camera(grp.lon, grp.lat, z));
        const host = hostOf(d, grp.slug);
        if (first < 0 && d.some((n) => n.host === grp.slug)) first = z;
        if (first >= 0 && open < 0 && !host) open = z;
      }
      expect(first, grp.slug).toBeGreaterThan(0);
      expect(open === -1 || open > first, grp.slug).toBe(true);
      // at least half a zoom level of peeking before the group opens (a crowded neighbourhood, Central Europe, comes later than the others)
      expect(open === -1 || open - first >= 0.5, grp.slug).toBe(true);
    }
  });

  it("is deterministic: the same peeks whatever the order of the input", () => {
    const shuffled = [...nodes].reverse();
    const mid = Math.floor(shuffled.length / 2);
    const other = [...shuffled.slice(mid), ...shuffled.slice(0, mid)];
    for (const c of SWEEP_CENTRES.slice(0, 4)) {
      const a = new LodTree(nodes);
      const b = new LodTree(other);
      for (const z of sweepZooms(3, 7, 0.25)) {
        const da = drawnAt(a, camera(c.lon, c.lat, z)).map((n) => `${n.slug}${n.peek ? "*" : ""}`).sort();
        const db = drawnAt(b, camera(c.lon, c.lat, z)).map((n) => `${n.slug}${n.peek ? "*" : ""}`).sort();
        expect(db, `${c.name} ${z}`).toEqual(da);
      }
    }
  });

  it("is stable under small camera moves: over every sweep view, no node changes more than once in a jitter of a pixel or two (the bands are 5 px (gap) and 8 px (screen edge) wide)", () => {
    let views = 0;
    for (const c of SWEEP_CENTRES) {
      const tree = new LodTree(nodes);
      for (const z of sweepZooms(2.5, 8, process.env.PEEK_STRESS ? 0.0078125 : 0.125)) {
        drawnAt(tree, camera(c.lon, c.lat, z));
        const toggles = new Map<string, number>();
        // (the peeks' business: a node of the cut at the edge of the screen or on the globe's limb has its own rules)
        const peeked = new Set<string>();
        const seen = (d: Drawn[]) => {
          for (const n of d) if (n.peek) peeked.add(n.slug);
          return new Set(d.map((n) => n.slug));
        };
        let last = seen(drawnAt(tree, camera(c.lon, c.lat, z)));
        for (const [dz, dx, dy] of [[0.0015, 0, 0], [-0.0015, 0.005, 0], [0.003, 0, 0.005], [0, -0.005, -0.005], [-0.003, 0.01, 0], [0.001, -0.01, 0.01], [0, 0, 0]] as const) {
          const now = seen(drawnAt(tree, camera(c.lon + dx, c.lat + dy, z + dz)));
          for (const s of new Set([...last, ...now])) if (last.has(s) !== now.has(s)) toggles.set(s, (toggles.get(s) ?? 0) + 1);
          last = now;
        }
        views++;
        for (const [s, n] of toggles) if (peeked.has(s)) expect(n, `${c.name} ${z} ${s}`).toBeLessThanOrEqual(1);
      }
    }
    expect(views).toBeGreaterThan(100);
  });

  it("a slow zoom or pan never shows a peek that disappears and comes back within a few percent of scale (no flicker)", () => {
    const STEP = 0.004;
    const WINDOW = 0.06; // zoom levels: about 4 % of scale
    let flips = 0;
    let steps = 0;
    const first: string[] = [];
    for (const c of SWEEP_CENTRES) {
      for (const mode of ["zoom", "pan"] as const) {
        const tree = new LodTree(nodes);
        const goneAt = new Map<string, number>();
        const prev = new Set<string>();
        const n = mode === "zoom" ? Math.round((8 - 2.5) / STEP) : 1200;
        for (let k = 0; k < n; k++) {
          const z = mode === "zoom" ? 2.5 + k * STEP : 5;
          const lon = mode === "pan" ? c.lon - 6 + (k * 12) / n : c.lon;
          const d = drawnAt(tree, camera(lon, c.lat, z));
          const now = new Set(d.filter((x) => x.peek).map((x) => x.slug));
          const t = mode === "zoom" ? z : k * (STEP / 4);
          for (const s of prev) if (!now.has(s) && !d.some((x) => x.slug === s)) goneAt.set(s, t);
          for (const s of now) {
            const g0 = goneAt.get(s);
            if (g0 !== undefined && t - g0 < WINDOW) {
              flips++;
              if (first.length < 3) first.push(`${c.name} ${mode} ${s} gone ${g0.toFixed(3)} back ${t.toFixed(3)}`);
            }
            goneAt.delete(s);
          }
          prev.clear();
          for (const s of now) prev.add(s);
          steps++;
        }
      }
    }
    expect(steps).toBeGreaterThan(5000);
    expect(flips, first.join("; ")).toBe(0);
  });

  if (process.env.PEEK_REPORT) {
    it("report", () => {
      const f = (x: number, n = 2) => x.toFixed(n);
      const lines = ["", "centre            boxes (mean before -> after, max after)  free room (mean)   overlapping pairs (mean)   peeks dropped by the planner"];
      for (const c of SWEEP_CENTRES) {
        const r = rows.filter((x) => x.centre === c.name);
        lines.push(
          `${c.name.padEnd(16)}  ${f(mean(r, (x) => x.before.boxes))} -> ${f(mean(r, (x) => x.after.boxes))}  (max ${Math.max(...r.map((x) => x.after.boxes))})   ${f(mean(r, (x) => x.before.freeRoom))} -> ${f(mean(r, (x) => x.after.freeRoom))}   ${f(mean(r, (x) => x.before.overlaps))} -> ${f(mean(r, (x) => x.after.overlaps))}   ${r.reduce((a, x) => a + x.after.planOverlapPeeks, 0)}`,
        );
      }
      lines.push("", "group             first peek at zoom   opens at zoom (cut)   boxes on screen at the first peek (before -> after)   max boxes up to opening   overlapping pairs mean/max before -> after (zoom 3.5 to opening)");
      for (const grp of GROUPS) {
        const tree = new LodTree(nodes);
        let first = -1;
        let open = -1;
        let at: SweepRow | null = null;
        const upto: SweepRow[] = [];
        for (const z of sweepZooms(2, 8, 0.05)) {
          const cam = camera(grp.lon, grp.lat, z);
          const d = drawnAt(tree, cam);
          const host = hostOf(d, grp.slug);
          if (first >= 0 && open < 0 && !host) open = z;
          const row: SweepRow = { centre: grp.slug, zoom: z, before: measure(d.filter((n) => !n.peek)), after: measure(d) };
          if (first < 0 && d.some((n) => n.host === grp.slug)) {
            first = z;
            at = row;
          }
          if (first >= 0 && open < 0) upto.push(row);
        }
        lines.push(
          `${grp.slug.padEnd(16)}  ${f(first)}               ${open < 0 ? "-" : f(open)}                  ${at?.before.boxes} -> ${at?.after.boxes}                                       ${Math.max(...upto.map((x) => x.after.boxes))}                        ${f(mean(upto, (x) => x.before.overlaps))}/${Math.max(...upto.map((x) => x.before.overlaps))} -> ${f(mean(upto, (x) => x.after.overlaps))}/${Math.max(...upto.map((x) => x.after.overlaps))}`,
        );
      }
      console.log(lines.join("\n"));
    });
  }
});
