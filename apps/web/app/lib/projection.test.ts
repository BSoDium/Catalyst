import { describe, expect, it } from "vitest";
import { loadDemoProjection } from "@catalyst/published";
import { EMPTY_PROJECTION, type PublishedProjection } from "@catalyst/schemas";
import { buildPlaceIndex, getPlaceDetail, imageSize, listContent, relatedHref, resolveRoutes } from "./projection";

const demo = loadDemoProjection();

describe("buildPlaceIndex", () => {
  it("derives globe places and summaries", () => {
    const index = buildPlaceIndex(demo);
    expect(index.places).toHaveLength(demo.places.length);
    expect(index.globePlaces.find((p) => p.slug === "lisbon")).toEqual({
      slug: "lisbon",
      name: "Lisbon",
      lat: 38.72,
      lon: -9.14,
      labelPriority: 60,
      viewRadiusKm: 10,
      groupSlug: "europe",
    });
    // The radius is passed to the globe only when published; Kyoto has none.
    expect(index.globePlaces.find((p) => p.slug === "kyoto")).not.toHaveProperty("viewRadiusKm");
    // The group slug is passed on only when the place is in a group (Cape Town is in none).
    expect(index.globePlaces.find((p) => p.slug === "cape-town")).not.toHaveProperty("groupSlug");
    expect(index.groups).toEqual(demo.groups);
    expect(index.groups.length).toBeGreaterThan(0);
    // Summaries never carry body text.
    expect(index.places[0]).not.toHaveProperty("body");
  });
  it("is empty for an empty projection", () => {
    expect(buildPlaceIndex(EMPTY_PROJECTION)).toEqual({ places: [], globePlaces: [], groups: [], routes: [] });
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
