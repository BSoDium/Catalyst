import { describe, expect, it } from "vitest";
import type { EntryDetail } from "./entries";
import { entryMeta, listMeta } from "./entry-meta";
import { absoluteUrl, isScrapableImage, metaBase, pageMeta } from "./meta";

const find = (tags: ReturnType<typeof pageMeta>, key: "name" | "property", value: string) =>
  tags.find((t) => key in t && (t as Record<string, string>)[key] === value) as { content: string } | undefined;

describe("pageMeta", () => {
  const ORIGIN = "https://v2.bsodium.fr";
  it("uses the title template, and the home title when there is no page name", () => {
    expect(pageMeta({ title: "Demo" })[0]).toEqual({ title: "Demo · Elliot Négrel-Jerzy" });
    expect(pageMeta()[0]).toEqual({ title: "Elliot Négrel-Jerzy · Design engineer" });
    expect(find(pageMeta({ title: "Demo" }), "property", "og:title")?.content).toBe("Demo · Elliot Négrel-Jerzy");
    expect(find(pageMeta({ title: "Demo" }), "name", "twitter:title")?.content).toBe("Demo · Elliot Négrel-Jerzy");
  });
  it("has a description, with the site's as the default", () => {
    expect(find(pageMeta({ title: "Demo", description: "About it" }), "name", "description")?.content).toBe("About it");
    expect(find(pageMeta(), "name", "description")?.content).toBe("Design engineer in Warsaw. Data visualisation, geospatial and cartography interfaces, design systems, computer graphics.");
    expect(find(pageMeta(), "property", "og:description")?.content).toBe("Design engineer in Warsaw. Data visualisation, geospatial and cartography interfaces, design systems, computer graphics.");
  });
  it("makes the canonical URL and og:url from the origin and the path only (no query, no hash)", () => {
    const tags = pageMeta({ origin: ORIGIN, path: "/articles/a?view=full#x" });
    expect(tags).toContainEqual({ tagName: "link", rel: "canonical", href: `${ORIGIN}/articles/a` });
    expect(find(tags, "property", "og:url")?.content).toBe(`${ORIGIN}/articles/a`);
    expect(pageMeta({ origin: ORIGIN, path: "/" })).toContainEqual({ tagName: "link", rel: "canonical", href: `${ORIGIN}/` });
  });
  it("has no canonical without an origin or a path (a relative one is worse than none)", () => {
    expect(pageMeta({ path: "/x" }).some((t) => "rel" in t)).toBe(false);
    expect(pageMeta({ origin: ORIGIN }).some((t) => "rel" in t)).toBe(false);
  });
  it("always has a share image: the default 1200x630 PNG, absolute, with its size and alt", () => {
    const tags = pageMeta({ title: "Demo", origin: ORIGIN });
    expect(find(tags, "property", "og:image")?.content).toBe(`${ORIGIN}/og-default.png`);
    expect(find(tags, "property", "og:image:width")?.content).toBe("1200");
    expect(find(tags, "property", "og:image:height")?.content).toBe("630");
    expect(find(tags, "property", "og:image:type")?.content).toBe("image/png");
    expect(find(tags, "property", "og:image:alt")?.content).toBeTruthy();
    expect(find(tags, "name", "twitter:card")?.content).toBe("summary_large_image");
    expect(find(tags, "name", "twitter:image")?.content).toBe(`${ORIGIN}/og-default.png`);
  });
  it("uses a cover when scrapers can read its format, absolute when the origin is known", () => {
    const tags = pageMeta({ title: "Demo", image: { src: "/media/demo/cover.jpg", alt: "A cover", width: 800, height: 400 }, origin: ORIGIN });
    expect(find(tags, "property", "og:image")?.content).toBe(`${ORIGIN}/media/demo/cover.jpg`);
    expect(find(tags, "property", "og:image:alt")?.content).toBe("A cover");
    expect(find(tags, "property", "og:image:width")?.content).toBe("800");
    expect(find(tags, "name", "twitter:image")?.content).toBe(`${ORIGIN}/media/demo/cover.jpg`);
  });
  it("falls back to the default image for an SVG cover (link-preview scrapers do not render SVG)", () => {
    const tags = pageMeta({ title: "Demo", image: { src: "/media/demo/cover.svg", alt: "A cover" }, origin: ORIGIN });
    expect(find(tags, "property", "og:image")?.content).toBe(`${ORIGIN}/og-default.png`);
    expect(isScrapableImage("/media/a.PNG")).toBe(true);
    expect(isScrapableImage("/media/a.svg")).toBe(false);
  });
  it("sets the Open Graph type, and for an article its date and tags", () => {
    expect(find(pageMeta({ title: "T" }), "property", "og:type")?.content).toBe("website");
    const tags = pageMeta({ title: "T", type: "article", publishedTime: "2024-04", tags: ["a", "b"] });
    expect(find(tags, "property", "og:type")?.content).toBe("article");
    expect(find(tags, "property", "article:published_time")?.content).toBe("2024-04");
    expect(tags.filter((t) => "property" in t && t.property === "article:tag")).toHaveLength(2);
    expect(find(pageMeta({ title: "T", publishedTime: "2024" }), "property", "article:published_time")).toBeUndefined();
  });
  it("adds robots noindex and JSON-LD only when asked", () => {
    expect(find(pageMeta(), "name", "robots")).toBeUndefined();
    expect(find(pageMeta({ noindex: true }), "name", "robots")?.content).toBe("noindex");
    expect(pageMeta({ jsonLd: { "@type": "X" } })).toContainEqual({ "script:ld+json": { "@type": "X" } });
    expect(pageMeta().some((t) => "script:ld+json" in t)).toBe(false);
  });
  it("without a usable origin the path stays as it is", () => {
    expect(absoluteUrl("/media/x.svg", undefined)).toBe("/media/x.svg");
    expect(absoluteUrl("/media/x.svg", "not an origin")).toBe("/media/x.svg");
  });
  it("reads the origin from the root loader data and the path from the location", () => {
    const base = metaBase({ location: { pathname: "/poetry" }, matches: [undefined, { id: "root", loaderData: { siteUrl: ORIGIN } }, { id: "routes/poetry" }] });
    expect(base).toEqual({ origin: ORIGIN, path: "/poetry" });
    expect(metaBase({ location: { pathname: "/" }, matches: [{ id: "root", loaderData: undefined }] })).toEqual({ origin: undefined, path: "/" });
  });
});

describe("entryMeta", () => {
  const ORIGIN = "https://x.test";
  const entry = (over: Partial<EntryDetail>): EntryDetail => ({
    kind: "article", slug: "a", href: "/articles/a", index: 1, title: "A title", tags: [], meta: [], places: [], body: [], related: [], prev: null, next: null, ...over,
  });
  it("uses the summary as the description and a kind-based fallback", () => {
    expect(find(entryMeta({ entry: entry({ summary: "About it" }) }), "name", "description")?.content).toBe("About it");
    expect(find(entryMeta({ entry: entry({ kind: "poem" }) }), "name", "description")?.content).toBe("Poem from the archive of Elliot Négrel-Jerzy.");
  });
  it("is canonical on the entry's own path and carries JSON-LD when the origin is known", () => {
    const tags = entryMeta({ entry: entry({ date: "2024-04-02" }) }, { origin: ORIGIN });
    expect(tags).toContainEqual({ tagName: "link", rel: "canonical", href: `${ORIGIN}/articles/a` });
    expect(find(tags, "property", "article:published_time")?.content).toBe("2024-04-02");
    const ld = tags.find((t) => "script:ld+json" in t) as { "script:ld+json": { "@type": string } } | undefined;
    expect(ld?.["script:ld+json"]["@type"]).toBe("Article");
    expect(entryMeta({ entry: entry({}) }).some((t) => "script:ld+json" in t)).toBe(false);
  });
  it("carries <meta name=copyright> for writing and artwork, and not for software", () => {
    const notice = find(entryMeta({ entry: entry({ kind: "poem", date: "2024-04-02" }) }), "name", "copyright")?.content;
    expect(notice).toBe("© 2024 Elliot Négrel-Jerzy. All rights reserved. Please do not reproduce this poem without permission; short quotations with attribution are welcome.");
    expect(find(entryMeta({ entry: entry({ kind: "artwork" }) }), "name", "copyright")?.content).toMatch(/^© Elliot Négrel-Jerzy\. All rights reserved/);
    expect(find(entryMeta({ entry: entry({ kind: "project" }) }), "name", "copyright")).toBeUndefined();
    expect(find(listMeta("poem"), "name", "copyright")).toBeUndefined();
    expect(find(pageMeta(), "name", "copyright")).toBeUndefined();
  });
  it("uses the loader's origin when the page's own is not known", () => {
    expect(find(entryMeta({ entry: entry({}), origin: ORIGIN }), "property", "og:url")?.content).toBe(`${ORIGIN}/articles/a`);
    expect(find(entryMeta({ entry: entry({}), origin: ORIGIN }), "property", "og:image")?.content).toBe(`${ORIGIN}/og-default.png`);
  });
  it("shares an authored cover on a safe /media/ path in a scrapable format, else the default image", () => {
    const cover = { src: "/media/demo/c.jpg", alt: "Alt", width: 10, height: 5 };
    expect(find(entryMeta({ entry: entry({}) }, { origin: ORIGIN }), "property", "og:image")?.content).toBe(`${ORIGIN}/og-default.png`);
    expect(find(entryMeta({ entry: entry({ cover }) }, { origin: ORIGIN }), "property", "og:image")?.content).toBe(`${ORIGIN}/media/demo/c.jpg`);
    expect(find(entryMeta({ entry: entry({ cover: { ...cover, src: "/media/demo/c.svg" } }) }, { origin: ORIGIN }), "property", "og:image")?.content).toBe(`${ORIGIN}/og-default.png`);
    expect(find(entryMeta({ entry: entry({ cover: { ...cover, src: "/media/../x.jpg" } }) }, { origin: ORIGIN }), "property", "og:image")?.content).toBe(`${ORIGIN}/og-default.png`);
  });
  it("types an article as an article and the rest as a website", () => {
    expect(find(entryMeta({ entry: entry({}) }), "property", "og:type")?.content).toBe("article");
    expect(find(entryMeta({ entry: entry({ kind: "project" }) }), "property", "og:type")?.content).toBe("website");
  });
  it("is a neutral, noindex not-found head without data", () => {
    const tags = entryMeta(undefined);
    expect(tags[0]).toEqual({ title: "Not found · Elliot Négrel-Jerzy" });
    expect(find(tags, "name", "robots")?.content).toBe("noindex");
  });
});

describe("listMeta", () => {
  it("names the collection and is canonical on its path", () => {
    const tags = listMeta("poem", { origin: "https://x.test", path: "/poetry" });
    expect(tags[0]).toEqual({ title: "Poetry · Elliot Négrel-Jerzy" });
    expect(tags).toContainEqual({ tagName: "link", rel: "canonical", href: "https://x.test/poetry" });
  });
});
