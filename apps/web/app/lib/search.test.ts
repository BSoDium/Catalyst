import { describe, expect, it } from "vitest";
import { loadDemoProjection } from "@catalyst/published";
import { buildSearchIndex, foldText, groupResults, searchItems, SEARCH_TYPES, type SearchItem } from "./search";

const demo = loadDemoProjection();
const index = buildSearchIndex(demo);
const titles = (items: SearchItem[]) => items.map((i) => i.title);

describe("foldText", () => {
  it("lowercases, strips accents and punctuation", () => {
    expect(foldText("Hué, Reykjavík!")).toBe("hue reykjavik");
    expect(foldText("  Rain   at the  citadel ")).toBe("rain at the citadel");
    expect(foldText("Citadel, rain")).toBe("citadel rain");
    expect(foldText("")).toBe("");
  });
});

describe("buildSearchIndex", () => {
  it("has every place and every entry, places first, with their hrefs", () => {
    const entries = demo.articles.length + demo.projects.length + demo.artworks.length + demo.poems.length;
    expect(index).toHaveLength(demo.places.length + entries);
    expect(index.slice(0, demo.places.length).every((i) => i.type === "place" && i.href.startsWith("/locations/"))).toBe(true);
    const article = index.find((i) => i.href === "/articles/demo-article");
    expect(article).toMatchObject({ type: "article", title: "Night trains through the Balkans" });
    expect(article!.sub).toContain("ARTICLE / 0001");
    expect(article!.keywords).toContain("night-trains");
  });
  it("carries no body text", () => {
    const body = demo.articles[0]!.body!.find((b) => b.type === "paragraph")! as { text: string };
    expect(JSON.stringify(index)).not.toContain(body.text.slice(0, 40));
  });
  it("is empty for an empty projection", () => {
    expect(buildSearchIndex({ ...demo, places: [], articles: [], projects: [], artworks: [], poems: [] })).toEqual([]);
  });
});

describe("searchItems", () => {
  it("gives nothing for a blank query", () => {
    expect(searchItems(index, "")).toEqual([]);
    expect(searchItems(index, "  ,, ")).toEqual([]);
  });
  it("finds places by name without accents or case", () => {
    expect(titles(searchItems(index, "hue"))[0]).toBe("Huế");
    expect(searchItems(index, "LISB")[0]).toMatchObject({ type: "place", title: "Lisbon" });
  });
  it("matches the start of a word before the inside of one, and the title before the tags", () => {
    const r = searchItems(index, "rain");
    expect(r.length).toBeGreaterThan(1);
    expect(foldText(r[0]!.title)).toMatch(/\brain/);
    expect(r.findIndex((i) => foldText(i.title).includes("rain"))).toBeLessThan(r.length);
  });
  it("requires every word", () => {
    expect(titles(searchItems(index, "night platform"))).toEqual(["Night Platform, Split"]);
    expect(searchItems(index, "night zzzz")).toEqual([]);
  });
  it("finds entries by their tags", () => {
    expect(searchItems(index, "plotter").some((i) => i.type === "artwork")).toBe(true);
  });
  it("puts an exact title first and respects the limit", () => {
    expect(searchItems(index, "Layover")[0]).toMatchObject({ type: "poem", title: "Layover" });
    expect(searchItems(index, "a", 3)).toHaveLength(3);
    expect(searchItems(index, "a", 0)).toEqual([]);
  });
  it("breaks ties by the group order", () => {
    const items: SearchItem[] = [
      { type: "poem", title: "Alpha", href: "/poems/a" },
      { type: "place", title: "Alpha", href: "/locations/a" },
      { type: "article", title: "Alpha", href: "/articles/a" },
    ];
    expect(searchItems(items, "alpha").map((i) => i.type)).toEqual(["place", "article", "poem"]);
  });
});

describe("groupResults", () => {
  it("groups in the system order and keeps a flat order for the arrow keys", () => {
    const { groups, flat } = groupResults([
      { type: "poem", title: "P", href: "/p" },
      { type: "place", title: "L", href: "/l" },
      { type: "poem", title: "Q", href: "/q" },
    ]);
    expect(groups.map((g) => [g.type, g.label, g.items.length])).toEqual([["place", "Places", 1], ["poem", "Poems", 2]]);
    expect(flat.map((i) => i.title)).toEqual(["L", "P", "Q"]);
    expect(SEARCH_TYPES[0]).toBe("place");
  });
});
