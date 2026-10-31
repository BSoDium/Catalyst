import { describe, expect, it } from "vitest";
import { loadDemoProjection } from "@catalyst/published/dev";
import { EMPTY_PROJECTION } from "@catalyst/schemas";
import { buildSearchIndex, foldText, groupResults, rankItems, resultsStatus, searchItems, SEARCH_LABELS, SEARCH_SINGULAR, SEARCH_TYPES, type SearchItem } from "./search";

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
    const entries = demo.articles.length + demo.projects.length + demo.artworks.length + demo.poems.length + demo.photographs.length;
    // the demo has a career document: one more row, after the entries
    expect(index).toHaveLength(demo.places.length + entries + 1);
    expect(index.at(-1)).toMatchObject({ type: "career", href: "/career" });
    expect(index.slice(0, demo.places.length).every((i) => i.type === "place" && i.href.startsWith("/locations/"))).toBe(true);
    const article = index.find((i) => i.href === "/articles/demo-article");
    expect(article).toMatchObject({ type: "article", title: "Night trains through the Balkans" });
    expect(article!.sub).toBe("2026.03.14");
    expect(article!.sub).not.toMatch(/ARTICLE|\d{4} \/|№/);
    expect(article!.keywords).toContain("Article"); // the kind's word still finds it
    expect(article!.keywords).toContain("night-trains");
  });
  it("carries no body text", () => {
    const body = demo.articles[0]!.body!.find((b) => b.type === "paragraph")! as { text: string };
    expect(JSON.stringify(index)).not.toContain(body.text.slice(0, 40));
  });
  it("is empty for an empty projection", () => {
    expect(buildSearchIndex({ ...demo, places: [], articles: [], projects: [], artworks: [], poems: [], photographs: [], career: undefined })).toEqual([]);
  });
});

describe("the count of results", () => {
  it("ranks the whole list; searchItems is its first part", () => {
    const all = rankItems(index, "a");
    expect(all.length).toBeGreaterThan(3);
    expect(searchItems(index, "a", 3)).toEqual(all.slice(0, 3));
    expect(rankItems(index, "")).toEqual([]);
  });
  it("says the real count, and when the list is capped how much of it is shown", () => {
    expect(resultsStatus(0, 0)).toBe("No results");
    expect(resultsStatus(1, 1)).toBe("1 result");
    expect(resultsStatus(7, 7)).toBe("7 results");
    expect(resultsStatus(24, 24)).toBe("24 results");
    expect(resultsStatus(24, 31)).toBe("Showing 24 of 31");
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
    expect(titles(searchItems(index, "night platform"))).toEqual(["Night Platform, Split", "Platform Nine"]);
    expect(searchItems(index, "night zzzz")).toEqual([]);
  });
  it("finds the poems by the section's name and by the word for one or many", () => {
    const poems = demo.poems.map((p) => p.title);
    for (const word of ["poetry", "poem", "poems"]) {
      const found = searchItems(index, word, 50).filter((i) => i.type === "poem").map((i) => i.title);
      expect(found, word).toEqual(expect.arrayContaining(poems));
    }
  });
  it("finds the software by the section's name and by the words it had before (project, projects)", () => {
    const software = demo.projects.map((p) => p.title);
    for (const word of ["software", "project", "projects"]) {
      const found = searchItems(index, word, 50).filter((i) => i.type === "project").map((i) => i.title);
      expect(found, word).toEqual(expect.arrayContaining(software));
    }
  });
  it("names the projects' group \"Software\" (and its row \"Software\")", () => {
    expect([SEARCH_LABELS.project, SEARCH_SINGULAR.project]).toEqual(["Software", "Software"]);
    expect(index.filter((i) => i.type === "project").every((i) => i.href.startsWith("/software/"))).toBe(true);
  });
  it("names the poems' group \"Poetry\" and its place group \"Places\"", () => {
    expect([SEARCH_LABELS.place, SEARCH_LABELS.poem, SEARCH_SINGULAR.poem]).toEqual(["Places", "Poetry", "Poem"]);
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
      { type: "poem", title: "Alpha", href: "/poetry/a" },
      { type: "place", title: "Alpha", href: "/locations/a" },
      { type: "article", title: "Alpha", href: "/articles/a" },
    ];
    expect(searchItems(items, "alpha").map((i) => i.type)).toEqual(["place", "article", "poem"]);
  });
});

describe("the career page in the index", () => {
  it("is one row, only when the projection has a career, found by its words, an employer or a skill", () => {
    expect(buildSearchIndex(EMPTY_PROJECTION).some((i) => i.type === "career")).toBe(false);
    const index = buildSearchIndex(loadDemoProjection());
    const rows = index.filter((i) => i.type === "career");
    expect(rows).toEqual([expect.objectContaining({ title: "Career", href: "/career" })]);
    for (const q of ["career", "resume", "cv", "example studio", "webgl"]) expect(searchItems(index, q).map((i) => i.href), q).toContain("/career");
  });
  it("comes after the entries in the group order", () => {
    expect(SEARCH_TYPES.at(-1)).toBe("career");
    expect(SEARCH_LABELS.career).toBe("Career");
  });
});

describe("groupResults", () => {
  it("groups in the system order and keeps a flat order for the arrow keys", () => {
    const { groups, flat } = groupResults([
      { type: "poem", title: "P", href: "/p" },
      { type: "place", title: "L", href: "/l" },
      { type: "poem", title: "Q", href: "/q" },
    ]);
    expect(groups.map((g) => [g.type, g.label, g.items.length])).toEqual([["place", "Places", 1], ["poem", "Poetry", 2]]);
    expect(flat.map((i) => i.title)).toEqual(["L", "P", "Q"]);
    expect(SEARCH_TYPES[0]).toBe("place");
  });
});
