import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LOD, LodTree } from "./lod-tree";
import { SWEEP, SWEEP_CENTRES, camera, nodesFromProjection, sweepZooms } from "./open-sweep";

/**
 * Groups of ONE place and what is inside it (`LodTree.loneHost`, #647): swept over the owner's preview projection (git-ignored: skipped without it), at every zoom and over the views that matter, for what the
 * owner saw (2026-11-05): "2 places" for one city, a box bigger than the city's and filled, two boxes about one place when zoomed in, a box that jumps when the group gives way to the place.
 */
const previewUrl = new URL("../../../../../packages/published/data/preview.projection.json", import.meta.url);
const havePreview = existsSync(previewUrl);

const ZOOMS = sweepZooms(2.5, 14, 0.05);
const FLOOR = LOD.floorCells * SWEEP.cell;
const PAD = LOD.padCells * SWEEP.cell;

/** The drawn size of node `i` (its rectangle's longer side). */
const drawnSide = (t: LodTree, i: number) => Math.max(t.drawX1[i]! - t.drawX0[i]!, t.drawY1[i]! - t.drawY0[i]!);
const isDrawn = (t: LodTree, i: number) => t.life.target[i] === 1 && (t.isGroup[i] ? t.members[i]! > 0 : t.shown[i] === 1);
const rest = (t: LodTree, cam: ReturnType<typeof camera>) => {
  t.alphas({ ...cam, zoom: cam.zoom + 1e-12 * Math.random() });
};

describe.skipIf(!havePreview)("groups of one place, on the owner's preview projection", () => {
  const tree = () => new LodTree(nodesFromProjection(JSON.parse(readFileSync(previewUrl, "utf8"))));
  const lones = () => {
    const t = tree();
    return [...(t as unknown as { groups: Int32Array }).groups].filter((g) => t.loneHost[g]! >= 0).map((g) => ({ slug: t.slug[g]!, host: t.slug[t.loneHost[g]!]!, lon: t.lon[t.loneHost[g]!]!, lat: t.lat[t.loneHost[g]!]! }));
  };

  it("there are some (Denmark and Poland at the time of writing), each is labelled as its place, and counts one", () => {
    const t = tree();
    const found = lones();
    expect(found.length).toBeGreaterThanOrEqual(1);
    for (const l of found) {
      const g = t.indexOf(l.slug);
      expect(t.total[g], l.slug).toBe(1);
      expect(t.text[g], l.slug).toBe(t.name[t.indexOf(l.host)]);
      expect(JSON.stringify(t.sub[g]), l.slug).not.toMatch(/places/);
    }
  });

  it("never the group and its place together, and never a ghost of the place inside the group's box, at any zoom", () => {
    const t = tree();
    for (const l of lones()) {
      const g = t.indexOf(l.slug);
      const h = t.indexOf(l.host);
      for (const z of ZOOMS) {
        rest(t, camera(l.lon, l.lat, z));
        expect(isDrawn(t, g) && isDrawn(t, h), `${l.slug} z ${z}`).toBe(false);
        if (isDrawn(t, g)) expect(t.ghosts().some((x) => x.i === h), `${l.slug} z ${z}: ghost of ${l.host}`).toBe(false);
      }
    }
  });

  /** What stands for the place at a camera: its group's box (g), its own (h), or neither (an ancestor of the group is drawn instead, or the place is off the screen or too big to be drawn: `n`). */
  const standing = (t: LodTree, g: number, h: number): "g" | "h" | "n" => (isDrawn(t, g) ? "g" : isDrawn(t, h) ? "h" : "n");

  it("the place's box is the group's, to the pixel, at every camera: the one gives way to the other without a jump (in and out)", () => {
    const t = tree();
    for (const l of lones()) {
      const g = t.indexOf(l.slug);
      const h = t.indexOf(l.host);
      for (const z of ZOOMS) {
        rest(t, camera(l.lon, l.lat, z));
        if (!t.shown[h]) continue;
        const same = (a: Float64Array, b: Float64Array) => Math.abs(a[g]! - b[h]!);
        expect(same(t.drawX0, t.drawX0), `${l.slug} z ${z} x0`).toBeLessThan(0.01);
        expect(same(t.drawX1, t.drawX1), `${l.slug} z ${z} x1`).toBeLessThan(0.01);
        expect(same(t.drawY0, t.drawY0), `${l.slug} z ${z} y0`).toBeLessThan(0.01);
        expect(same(t.drawY1, t.drawY1), `${l.slug} z ${z} y1`).toBeLessThan(0.01);
      }
    }
  });

  it("the order in is its ancestor, the group, the place (and out the other way): no flapping between them", () => {
    const t = tree();
    for (const l of lones()) {
      const g = t.indexOf(l.slug);
      const h = t.indexOf(l.host);
      const states = (order: number[]) => {
        const out: string[] = [];
        for (const z of order) {
          rest(t, camera(l.lon, l.lat, z));
          const s = standing(t, g, h);
          if (s !== "n" && out[out.length - 1] !== s) out.push(s);
        }
        return out.join("");
      };
      expect(["", "g", "h", "gh"], `${l.slug} in`).toContain(states(ZOOMS));
      expect(["", "g", "h", "hg"], `${l.slug} out`).toContain(states([...ZOOMS].reverse()));
    }
  });

  it("a box with its interior masked is as big as a small place's, whatever the group: over every view of the sweep, every node drawn", () => {
    const t = tree();
    const centres = [...SWEEP_CENTRES, ...lones().map((l) => ({ name: l.slug, lon: l.lon, lat: l.lat })), { name: "Lisbon", lon: -9.3, lat: 38.75 }];
    let masked = 0;
    for (const c of centres) {
      for (const z of sweepZooms(2.5, 10, 0.25)) {
        rest(t, camera(c.lon, c.lat, z));
        for (let k = 0; k < t.count; k++) {
          const i = t.visible[k]!;
          if (!isDrawn(t, i) || t.fillAlpha[i]! < 0.5) continue;
          masked++;
          // the true size, at least the floor, and (a group) a share of its room that is the share of the mask already gone: at most 3/4 of it
          const allowed = Math.max(t.side[i]!, FLOOR) + (t.isGroup[i] ? 2 * PAD * 0.75 : 0) + 0.01;
          expect(drawnSide(t, i), `${t.slug[i]} masked at ${c.name} z ${z}`).toBeLessThanOrEqual(allowed);
        }
      }
    }
    expect(masked).toBeGreaterThan(100);
  });
});

describe("three levels of nesting (a city, a campus in it, a faculty in the campus)", () => {
  const g = (slug: string, kind: "country", lat: number, lon: number) => ({ slug, name: slug, kind, parent: undefined as string | undefined, lat, lon, radiusKm: 300, priority: 70 });
  const p = (slug: string, lat: number, lon: number, bbox: readonly [number, number, number, number]) => ({ slug, name: slug, kind: "place" as const, parent: "pl", lat, lon, radiusKm: 10, priority: 40, bbox, countryCode: "PL" });
  const nodes = () => [g("pl", "country", 52.2, 21), p("city", 52.23, 21.03, [20.79, 52.09, 21.27, 52.37]), p("campus", 52.22, 21.01, [21.004, 52.217, 21.014, 52.223]), p("faculty", 52.2196, 21.0115, [21.0103, 52.2189, 21.0123, 52.2202])];
  it("both inner ones are details of the city: one place, labelled as the city; at every zoom one box stands for the city, and the inner ones come in inside it", () => {
    const t = new LodTree(nodes());
    expect(t.total[t.indexOf("pl")]).toBe(1);
    expect(t.nested[t.indexOf("campus")]).toBe(1);
    expect(t.nested[t.indexOf("faculty")]).toBe(1);
    expect(t.loneHost[t.indexOf("pl")]).toBe(t.indexOf("city"));
    expect(t.text[t.indexOf("pl")]).toBe("city");
    let seen = new Set<string>();
    for (let z = 2.5; z <= 16; z += 0.1) {
      const c = camera(21.011, 52.22, z);
      t.alphas({ ...c, zoom: c.zoom + 1e-12 * Math.random() });
      const drawn = ["pl", "city", "campus", "faculty"].filter((s) => isDrawn(t, t.indexOf(s)));
      expect(drawn.includes("pl") && drawn.includes("city"), `z ${z}: ${drawn}`).toBe(false);
      for (const d of drawn) seen.add(d);
    }
    expect(seen.has("city") || seen.has("pl")).toBe(true);
    expect(seen.has("faculty")).toBe(true);
  });
  it("a place without a box (a point) inside a city's box is a detail of it too, and two places with the very same box count one", () => {
    const withPoint = new LodTree([...nodes(), { slug: "kiosk", name: "kiosk", kind: "place" as const, parent: "pl", lat: 52.24, lon: 21.05, radiusKm: 1, priority: 30, countryCode: "PL" }]);
    expect(withPoint.nested[withPoint.indexOf("kiosk")]).toBe(1);
    expect(withPoint.total[withPoint.indexOf("pl")]).toBe(1);
    const twin = new LodTree([g("pl", "country", 52.2, 21), p("a", 52.23, 21.03, [20.79, 52.09, 21.27, 52.37]), p("b", 52.23, 21.03, [20.79, 52.09, 21.27, 52.37])]);
    expect(twin.total[twin.indexOf("pl")]).toBe(1);
  });
});
