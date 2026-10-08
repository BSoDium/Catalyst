import { describe, expect, it } from "vitest";
import { loadDemoProjection } from "@catalyst/published";
import { EMPTY_PROJECTION, type PublishedProjection } from "@catalyst/schemas";
import { bboxFitRadiusKm } from "~/globe/engine/framing";
import { buildPlaceIndex, getPlaceDetail, imageSize, listContent, placeEntries, relatedHref, resolveRoutes } from "./projection";

const demo = loadDemoProjection();

describe("buildPlaceIndex", () => {
  it("derives globe places and summaries", () => {
    const index = buildPlaceIndex(demo);
    expect(index.places).toHaveLength(demo.places.length);
    const lisbon = demo.places.find((p) => p.slug === "lisbon")!;
    const globeLisbon = index.globePlaces.find((p) => p.slug === "lisbon")!;
    expect(globeLisbon).toEqual({
      slug: "lisbon",
      name: "Lisbon",
      lat: 38.72,
      lon: -9.14,
      labelPriority: 60,
      viewRadiusKm: bboxFitRadiusKm(lisbon.bbox),
      groupSlug: "europe",
      countryCode: "PT",
      // the entries linked to it, for the second line of its label (the demo's project and article)
      entries: [{ kind: "project", slug: "demo-project" }, { kind: "article", slug: "demo-article" }],
      // the demo's Lisbon has a published box: it is passed on, and the view radius frames it
      bbox: lisbon.bbox,
    });
    // Without a published radius or box the globe gets neither (Kyoto has none): its default radius applies.
    expect(index.globePlaces.find((p) => p.slug === "kyoto")).not.toHaveProperty("viewRadiusKm");
    expect(index.globePlaces.find((p) => p.slug === "kyoto")).not.toHaveProperty("bbox");
    // A published radius without a box is passed on as it is.
    expect(index.globePlaces.find((p) => p.slug === "paris")?.viewRadiusKm).toBe(14);
    // The group slug is passed on only when the place is in a group (Cape Town is in none).
    expect(index.globePlaces.find((p) => p.slug === "cape-town")).not.toHaveProperty("groupSlug");
    // The country code is passed on when published and left out when not.
    expect(index.globePlaces.every((p) => /^[A-Z]{2}$/.test(p.countryCode ?? ""))).toBe(true);
    const { countryCode: _drop, ...noCountry } = demo.places[0]!;
    expect(buildPlaceIndex({ ...demo, places: [noCountry] }).globePlaces[0]).not.toHaveProperty("countryCode");
    expect(index.groups).toEqual(demo.groups);
    expect(index.groups.length).toBeGreaterThan(0);
    // Summaries never carry body text.
    expect(index.places[0]).not.toHaveProperty("body");
  });
  it("passes a published bounding box on and frames it; without one nothing changes", () => {
    const lisbon = demo.places.find((p) => p.slug === "lisbon")!;
    // the contract's optional `bbox` [west, south, east, north]; anything invalid must be dropped, hence `unknown`
    const withBox = (bbox: unknown) => buildPlaceIndex({ ...demo, places: [{ ...lisbon, bbox } as typeof lisbon] }).globePlaces[0]!;
    const box = [-9.3, 38.69, -9.09, 38.8] as const;
    const placed = withBox(box);
    expect(placed.bbox).toEqual(box);
    // the view radius frames the box around its centre (its larger half extent), not the author's radius; the point stays the anchor
    expect(placed.viewRadiusKm).toBeCloseTo(bboxFitRadiusKm(box)!, 9);
    expect([placed.lat, placed.lon]).toEqual([lisbon.coordinates.lat, lisbon.coordinates.lon]);
    expect(placed.viewRadiusKm).not.toBe(lisbon.viewRadiusKm);
    // an invalid box is dropped and the old radius stays
    for (const bad of [undefined, [1, 2, 3], [-9.09, 38.69, -9.3, 38.8], "x", [Number.NaN, 0, 1, 1]]) {
      const g = withBox(bad);
      expect(g, JSON.stringify(bad)).not.toHaveProperty("bbox");
      expect(g.viewRadiusKm).toBe(lisbon.viewRadiusKm);
    }
  });
  it("the globe's name drops a trailing ', <own country>' (display only) and never anything else", () => {
    const paris = demo.places.find((p) => p.slug === "paris")!;
    const named = (name: string, countryCode: string | undefined) => buildPlaceIndex({ ...demo, places: [{ ...paris, name, countryCode } as typeof paris] });
    const a = named("Paris, France", "FR");
    expect(a.globePlaces[0]!.name).toBe("Paris");
    expect(a.places[0]!.name).toBe("Paris, France"); // the list and the page keep the stored name
    expect(named("Paris, Texas", "FR").globePlaces[0]!.name).toBe("Paris, Texas");
    expect(named("Paris, France", undefined).globePlaces[0]!.name).toBe("Paris, France");
    expect(named("Paris", "FR").globePlaces[0]!.name).toBe("Paris");
  });
  it("is empty for an empty projection", () => {
    expect(buildPlaceIndex(EMPTY_PROJECTION)).toEqual({ places: [], globePlaces: [], groups: [], routes: [] });
  });
});

describe("placeEntries: the entries linked to each place, for the second line of its label", () => {
  const place = demo.places[0]!;
  const other = demo.places[1]!;
  const item = (slug: string, placeSlugs: string[]) => ({ slug, title: slug, placeSlugs });
  const base = { ...demo, places: [{ ...place, related: [] }, { ...other, related: [] }], projects: [], articles: [], artworks: [], poems: [] };
  it("a place with nothing linked is absent, nothing is invented", () => {
    expect(placeEntries(base).size).toBe(0);
    expect(buildPlaceIndex(base).globePlaces.every((p) => !("entries" in p))).toBe(true);
  });
  it("counts the items' placeSlugs per kind, each item once per place", () => {
    const p = placeEntries({ ...base, articles: [item("a1", [place.slug, place.slug]), item("a2", [place.slug, other.slug])], artworks: [item("w1", [other.slug])], projects: [item("p1", [place.slug])] });
    expect(p.get(place.slug)).toEqual([{ kind: "project", slug: "p1" }, { kind: "article", slug: "a1" }, { kind: "article", slug: "a2" }]);
    expect(p.get(other.slug)).toEqual([{ kind: "article", slug: "a2" }, { kind: "artwork", slug: "w1" }]);
  });
  it("the place's own `related` links count too, and an entry linked from both sides counts once", () => {
    const p = placeEntries({
      ...base,
      places: [{ ...place, related: [{ kind: "article", slug: "a1" }, { kind: "artwork", slug: "w1" }] }, { ...other, related: [] }],
      articles: [item("a1", [place.slug])],
      artworks: [item("w1", [])],
    });
    expect(p.get(place.slug)).toEqual([{ kind: "article", slug: "a1" }, { kind: "artwork", slug: "w1" }]);
  });
  it("a reference to an entry that does not exist is dropped", () => {
    const p = placeEntries({ ...base, places: [{ ...place, related: [{ kind: "article", slug: "ghost" }] }, { ...other, related: [] }] });
    expect(p.size).toBe(0);
  });
  it("is what the globe gets: `entries` on the place, only when it has some", () => {
    const index = buildPlaceIndex({ ...base, projects: [item("p1", [place.slug])] });
    expect(index.globePlaces[0]!.entries).toEqual([{ kind: "project", slug: "p1" }]);
    expect(index.globePlaces[1]).not.toHaveProperty("entries");
  });
});

describe("resolveRoutes", () => {
  it("resolves stops to ordered points", () => {
    const [route] = resolveRoutes(demo);
    expect(route?.id).toBe("demo-route-vietnam");
    expect(route?.points).toEqual([
      { lat: 21.03, lon: 105.85 },
      { lat: 16.46, lon: 107.59 },
      { lat: 10.82, lon: 106.63 },
    ]);
  });
  it("skips unresolvable stops and drops routes with fewer than two points", () => {
    const broken = {
      ...demo,
      routes: [
        { id: "ok", title: "ok", stops: ["paris", "ghost", "kyoto"] },
        { id: "short", title: "short", stops: ["paris", "ghost"] },
      ],
    } as PublishedProjection;
    const routes = resolveRoutes(broken);
    expect(routes.map((r) => r.id)).toEqual(["ok"]);
    expect(routes[0]?.points).toHaveLength(2);
  });
});

describe("getPlaceDetail", () => {
  it("returns null for unknown slugs", () => {
    expect(getPlaceDetail(demo, "nope")).toBeNull();
  });
  it("resolves related titles and hrefs", () => {
    const place = getPlaceDetail(demo, "lisbon");
    expect(place?.related).toEqual([
      { kind: "article", slug: "demo-article", title: "Demo article", href: "/articles#demo-article" },
      { kind: "project", slug: "demo-project", title: "Demo project", href: "/projects#demo-project" },
    ]);
    expect(place?.dates).toEqual({ text: "Demo dates", dateTime: "2024-03" });
  });
  it("leaves optional sections empty rather than inventing them", () => {
    const place = getPlaceDetail(demo, "reykjavik");
    expect(place).toMatchObject({ summary: undefined, dates: null, body: [], images: [], related: [] });
  });
});

describe("listContent", () => {
  it("resolves place names for each item", () => {
    const [project] = listContent(demo, "project");
    expect(project?.places).toEqual([{ slug: "lisbon", name: "Lisbon", href: "/locations/lisbon" }]);
  });
  it("returns an empty list for empty collections", () => {
    expect(listContent(EMPTY_PROJECTION, "artwork")).toEqual([]);
  });
});

describe("helpers", () => {
  it("builds anchor hrefs from kind and slug", () => {
    expect(relatedHref("artwork", "x")).toBe("/artworks#x");
  });
  it("only reports image size when both dimensions are authored", () => {
    expect(imageSize({ src: "/media/a.svg", alt: "a", width: 10, height: 5 })).toEqual({ width: 10, height: 5 });
    expect(imageSize({ src: "/media/a.svg", alt: "a", width: 10 })).toBeNull();
  });
});
