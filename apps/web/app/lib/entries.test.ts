import { describe, expect, it } from "vitest";
import { loadDemoProjection } from "@catalyst/published";
import { EMPTY_PROJECTION, type PublishedContentItem, type PublishedProjection } from "@catalyst/schemas";
import {
  CONTENT_KINDS,
  entriesOfPlace,
  entryLanguage,
  entryPath,
  getEntryDetail,
  isContentKind,
  KIND_PATHS,
  listEntries,
  parsePanelPath,
  parseView,
  RELATED_LIMIT,
  resolveBackTarget,
  splitMeta,
  viewSearch,
} from "./entries";

const demo = loadDemoProjection();

const item = (slug: string, placeSlugs: string[] = [], extra: Partial<PublishedContentItem> = {}): PublishedContentItem => ({ slug, title: `Title ${slug}`, placeSlugs, ...extra });
const place = (slug: string, related: { kind: "article" | "project" | "artwork" | "poem"; slug: string }[] = []) => ({ ...demo.places[0]!, slug, name: `Place ${slug}`, region: undefined, group: undefined, related });
const world = (over: Partial<PublishedProjection>): PublishedProjection => ({ ...EMPTY_PROJECTION, ...over });

describe("kinds", () => {
  it("has a path, in the same order, for each of the four kinds, poems included", () => {
    expect(CONTENT_KINDS).toEqual(["article", "project", "artwork", "poem"]);
    expect(KIND_PATHS.poem).toBe("/poems");
    expect(entryPath("poem", "demo-poem")).toBe("/poems/demo-poem");
    expect(isContentKind("poem")).toBe(true);
    expect(isContentKind("place")).toBe(false);
  });
});

describe("listEntries", () => {
  it("passes the cover, tags, meta and places through and never carries a body", () => {
    const [article] = listEntries(demo, "article");
    expect(article).toMatchObject({
      kind: "article",
      slug: "demo-article",
      href: "/articles/demo-article",
      index: 1,
      title: "Night trains through the Balkans",
      date: "2026-03-14",
      tags: ["night-trains", "balkans", "rail", "slow-travel", "field-notes"],
      cover: { src: "/media/demo/cover-night-trains.svg", width: 1200, height: 630 },
      meta: [
        { label: "Publication", value: "Marginalia, issue 12" },
        { label: "Reading time", value: "6 min" },
        { label: "Written", value: "On board, March 2026" },
      ],
      places: [
        { slug: "ljubljana", name: "Ljubljana", href: "/locations/ljubljana" },
        { slug: "zagreb", name: "Zagreb", href: "/locations/zagreb" },
        { slug: "belgrade", name: "Belgrade", href: "/locations/belgrade" },
        { slug: "split", name: "Split", href: "/locations/split" },
      ],
    });
    expect(article).not.toHaveProperty("body");
  });
  it("lists poems, and nothing for an empty collection", () => {
    expect(listEntries(demo, "poem").map((e) => e.slug)).toEqual(["demo-poem", "citadel-rain", "cuesta-arriba", "quai-de-nuit"]);
    for (const kind of CONTENT_KINDS) expect(listEntries(EMPTY_PROJECTION, kind)).toEqual([]);
  });
  it("numbers entries by their position in the kind, from 1, in authored order", () => {
    const list = listEntries(world({ articles: [item("a"), item("b"), item("c")] }), "article");
    expect(list.map((e) => e.index)).toEqual([1, 2, 3]);
  });
  it("merges both directions of the place link, once, and drops unknown places", () => {
    const projection = world({
      places: [place("p1", [{ kind: "article", slug: "a" }]), place("p2"), place("p3", [{ kind: "article", slug: "a" }])],
      articles: [item("a", ["p2", "p1", "ghost"])],
    });
    // own placeSlugs first (authored order), then the places that name it; p1 once although it is on both sides
    expect(listEntries(projection, "article")[0]!.places.map((p) => p.slug)).toEqual(["p2", "p1", "p3"]);
  });
});

describe("getEntryDetail", () => {
  it("is null for an unknown slug or a slug under the wrong kind", () => {
    expect(getEntryDetail(demo, "article", "nope")).toBeNull();
    expect(getEntryDetail(demo, "project", "demo-poem")).toBeNull();
    expect(getEntryDetail(demo, "poem", "demo-poem")).not.toBeNull();
  });
  it("carries the body blocks as authored, the places resolved and the code index", () => {
    const poem = getEntryDetail(demo, "poem", "demo-poem")!;
    expect(poem.body[0]).toMatchObject({ type: "verse" });
    // its own place first, then the place that only names it in `related` (Vancouver)
    expect(poem.places).toEqual([expect.objectContaining({ slug: "reykjavik", href: "/locations/reykjavik" }), expect.objectContaining({ slug: "vancouver", href: "/locations/vancouver" })]);
    expect(poem.index).toBe(1);
    expect(poem.tags).toEqual(["layover", "airports", "travel", "free-verse"]);
  });
  it("gives an entry without a body an empty one", () => {
    expect(getEntryDetail(world({ projects: [item("p")] }), "project", "p")!.body).toEqual([]);
  });
  it("links the previous and next entry of the same kind only", () => {
    const projection = world({ articles: [item("a"), item("b"), item("c")], projects: [item("z")] });
    const b = getEntryDetail(projection, "article", "b")!;
    expect(b.prev).toMatchObject({ slug: "a", href: "/articles/a", index: 1 });
    expect(b.next).toMatchObject({ slug: "c", index: 3 });
    expect(getEntryDetail(projection, "article", "a")!.prev).toBeNull();
    expect(getEntryDetail(projection, "article", "c")!.next).toBeNull();
    expect(getEntryDetail(projection, "project", "z")).toMatchObject({ prev: null, next: null });
  });
  it("relates the entries that share a place, never itself, across kinds, capped", () => {
    const many = Array.from({ length: RELATED_LIMIT + 3 }, (_, i) => item(`x${i}`, ["p1"]));
    const projection = world({ places: [place("p1"), place("p2")], articles: [item("a", ["p1"]), ...many], poems: [item("v", ["p1"]), item("w", ["p2"])] });
    const related = getEntryDetail(projection, "article", "a")!.related;
    expect(related).toHaveLength(RELATED_LIMIT);
    expect(related.some((r) => r.kind === "article" && r.slug === "a")).toBe(false);
    expect(related.every((r) => r.href.startsWith("/articles/x"))).toBe(true);
    // the poem comes after the articles in the group order, and the poem of the other place never shows
    const small = getEntryDetail(world({ places: [place("p1"), place("p2")], articles: [item("a", ["p1"])], poems: [item("v", ["p1"]), item("w", ["p2"])] }), "article", "a")!;
    expect(small.related.map((r) => `${r.kind}:${r.slug}`)).toEqual(["poem:v"]);
  });
  it("an entry without a place relates nothing", () => {
    expect(getEntryDetail(world({ articles: [item("a"), item("b")] }), "article", "a")!.related).toEqual([]);
  });
});

describe("entriesOfPlace", () => {
  it("groups by kind in the system order, each entry once, from both directions", () => {
    const projection = world({
      places: [place("p1", [{ kind: "project", slug: "pr" }, { kind: "article", slug: "a" }]), place("p2")],
      articles: [item("a", ["p1"]), item("b", ["p2"]), item("c", ["p1"])],
      projects: [item("pr", [])],
      poems: [item("v", ["p1"])],
    });
    const groups = entriesOfPlace(projection, "p1");
    expect(groups.map((g) => [g.kind, g.label, g.entries.map((e) => e.slug)])).toEqual([
      ["article", "Articles", ["a", "c"]],
      ["project", "Projects", ["pr"]],
      ["poem", "Poems", ["v"]],
    ]);
  });
  it("skips references to entries that do not exist, and answers nothing for a place that does not exist", () => {
    expect(entriesOfPlace(world({ places: [place("p1", [{ kind: "article", slug: "ghost" }])] }), "p1")).toEqual([]);
    expect(entriesOfPlace(demo, "nope")).toEqual([]);
  });
});

describe("splitMeta", () => {
  it("takes a Status fact out of the data rows, whatever its case", () => {
    expect(splitMeta([{ label: "Stack", value: "TS" }, { label: "STATUS", value: "Active" }])).toEqual({ status: "Active", facts: [{ label: "Stack", value: "TS" }] });
    expect(splitMeta([{ label: "Medium", value: "Ink" }])).toEqual({ facts: [{ label: "Medium", value: "Ink" }] });
  });
});

describe("entryLanguage", () => {
  const lang = (value: string, label = "Language") => entryLanguage([{ label, value }]);
  it("maps a language name, with or without a note, to its tag", () => {
    expect(lang("English")).toBe("en");
    expect(lang("English (draft)")).toBe("en");
    expect(lang("Français")).toBe("fr");
    expect(lang("espanol")).toBe("es");
  });
  it("accepts a tag as it is, normalised", () => {
    expect(lang("fr")).toBe("fr");
    expect(lang("pt-br")).toBe("pt-BR");
    expect(lang("zh-Hant")).toBe("zh-Hant");
  });
  it("makes no claim for several languages, an unknown one or no Language fact", () => {
    expect(lang("French, English")).toBeUndefined();
    expect(lang("French and English")).toBeUndefined();
    expect(lang("Klingon")).toBeUndefined();
    expect(lang("English", "Medium")).toBeUndefined();
    expect(entryLanguage([])).toBeUndefined();
  });
  it("reads the language of the demo poems", () => {
    const language = (slug: string) => entryLanguage(getEntryDetail(demo, "poem", slug)!.meta);
    expect([language("demo-poem"), language("citadel-rain"), language("cuesta-arriba"), language("quai-de-nuit")]).toEqual(["en", "en", "es", "fr"]);
  });
});

describe("parsePanelPath", () => {
  it("recognises places and the four kinds of entry", () => {
    expect(parsePanelPath("/locations/lisbon")).toEqual({ type: "place", slug: "lisbon" });
    expect(parsePanelPath("/articles/x")).toEqual({ type: "entry", kind: "article", slug: "x" });
    expect(parsePanelPath("/projects/x")).toEqual({ type: "entry", kind: "project", slug: "x" });
    expect(parsePanelPath("/artworks/x")).toEqual({ type: "entry", kind: "artwork", slug: "x" });
    expect(parsePanelPath("/poems/demo-poem/")).toEqual({ type: "entry", kind: "poem", slug: "demo-poem" });
  });
  it("is null for the globe, the lists, other pages and malformed paths", () => {
    for (const path of ["/", "", "/articles", "/poems/", "/dev/design", "/foo/bar", "/articles/a/b", "/articles/%E0%A4%A", "articles/x"]) {
      expect(parsePanelPath(path), path).toBeNull();
    }
  });
  it("decodes the slug", () => {
    expect(parsePanelPath("/articles/a%2Db")).toEqual({ type: "entry", kind: "article", slug: "a-b" });
  });
});

describe("view mode in the URL", () => {
  it("is the panel unless ?view=full", () => {
    expect(parseView("")).toBe("panel");
    expect(parseView("?view=full")).toBe("full");
    expect(parseView("?view=panel")).toBe("panel");
    expect(parseView("?view=FULL")).toBe("panel");
    expect(parseView(new URLSearchParams("a=1&view=full"))).toBe("full");
  });
  it("sets and clears the parameter and keeps the others", () => {
    expect(viewSearch("", "full")).toBe("?view=full");
    expect(viewSearch("?view=full", "panel")).toBe("");
    expect(viewSearch("?a=1", "full")).toBe("?a=1&view=full");
    expect(viewSearch("?a=1&view=full", "panel")).toBe("?a=1");
  });
});

describe("resolveBackTarget", () => {
  const places = [{ slug: "lisbon", name: "Lisbon" }];
  it("names the place the visitor came from", () => {
    expect(resolveBackTarget({ from: "lisbon" }, places)).toEqual({ slug: "lisbon", name: "Lisbon", href: "/locations/lisbon" });
  });
  it("ignores state that is missing, malformed or names an unknown place", () => {
    for (const state of [null, undefined, "lisbon", 3, {}, { from: 3 }, { from: "ghost" }, { from: { slug: "lisbon" } }]) expect(resolveBackTarget(state, places), JSON.stringify(state)).toBeNull();
  });
});
