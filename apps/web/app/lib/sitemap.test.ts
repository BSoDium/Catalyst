import { describe, expect, it } from "vitest";
import { loadDemoProjection } from "@catalyst/published/dev";
import { EMPTY_PROJECTION, type PublishedProjection } from "@catalyst/schemas";
import { robotsTxt, sitemapUrls, sitemapXml } from "./sitemap";

const ORIGIN = "https://v2.bsodium.fr";

describe("sitemapUrls", () => {
  it("lists the home page and the five lists, even for an empty projection", () => {
    expect(sitemapUrls(EMPTY_PROJECTION, ORIGIN).map((u) => u.loc)).toEqual([`${ORIGIN}/`, `${ORIGIN}/articles`, `${ORIGIN}/software`, `${ORIGIN}/artworks`, `${ORIGIN}/poetry`, `${ORIGIN}/photography`]);
  });
  it("lists /career only when the projection has a career document, dated by the month it was reviewed", () => {
    expect(sitemapUrls(EMPTY_PROJECTION, ORIGIN).map((u) => u.loc)).not.toContain(`${ORIGIN}/career`);
    const withCareer = loadDemoProjection();
    expect(sitemapUrls(withCareer, ORIGIN)).toContainEqual({ loc: `${ORIGIN}/career`, lastmod: withCareer.career!.updated });
  });
  it("lists the projects' section and entries under /software, and nothing under the old /projects", () => {
    const projection = { ...EMPTY_PROJECTION, projects: [{ slug: "s", title: "S", placeSlugs: [] }] } as PublishedProjection;
    const locs = sitemapUrls(projection, ORIGIN).map((u) => u.loc);
    expect(locs).toContain(`${ORIGIN}/software`);
    expect(locs).toContain(`${ORIGIN}/software/s`);
    expect(locs.filter((l) => /\/projects(\/|$)/.test(l))).toEqual([]);
    expect(sitemapXml(sitemapUrls(projection, ORIGIN))).not.toContain("/projects");
  });
  it("lists the poems' section and entries under /poetry, and nothing under the old /poems", () => {
    const projection = { ...EMPTY_PROJECTION, poems: [{ slug: "p", title: "P", placeSlugs: [] }] } as PublishedProjection;
    const locs = sitemapUrls(projection, ORIGIN).map((u) => u.loc);
    expect(locs).toContain(`${ORIGIN}/poetry`);
    expect(locs).toContain(`${ORIGIN}/poetry/p`);
    expect(locs.filter((l) => /\/poems(\/|$)/.test(l))).toEqual([]);
    expect(sitemapXml(sitemapUrls(projection, ORIGIN))).not.toContain("/poems");
  });
  it("adds every entry and every place, absolute, with the authored date as lastmod", () => {
    const projection: PublishedProjection = {
      ...EMPTY_PROJECTION,
      places: [
        { slug: "lisbon", name: "Lisbon", coordinates: { lat: 38.7, lon: -9.1 }, labelPriority: 50, body: [], images: [], related: [], dates: { start: "2023-05", end: "2023-06-02" } },
        { slug: "paris", name: "Paris", coordinates: { lat: 48.8, lon: 2.3 }, labelPriority: 50, body: [], images: [], related: [] },
      ],
      articles: [{ slug: "a", title: "A", date: "2024-04-02", placeSlugs: [] }],
      poems: [{ slug: "p", title: "P", placeSlugs: [] }],
    };
    const urls = sitemapUrls(projection, ORIGIN);
    expect(urls).toContainEqual({ loc: `${ORIGIN}/articles/a`, lastmod: "2024-04-02" });
    expect(urls).toContainEqual({ loc: `${ORIGIN}/poetry/p` });
    expect(urls).toContainEqual({ loc: `${ORIGIN}/locations/lisbon`, lastmod: "2023-06-02" });
    expect(urls).toContainEqual({ loc: `${ORIGIN}/locations/paris` });
    expect(new Set(urls.map((u) => u.loc)).size).toBe(urls.length);
  });
  it("covers the whole demo projection", () => {
    const projection = loadDemoProjection();
    const total = 6 + projection.places.length + projection.articles.length + projection.projects.length + projection.artworks.length + projection.poems.length + projection.photographs.length + (projection.career ? 1 : 0);
    expect(sitemapUrls(projection, ORIGIN)).toHaveLength(total);
  });
  it("percent-encodes a slug in the URL and escapes XML in the document", () => {
    const projection = { ...EMPTY_PROJECTION, articles: [{ slug: "a b&c", title: "A", placeSlugs: [] }] } as PublishedProjection;
    const [, , , , , , item] = sitemapUrls(projection, ORIGIN);
    expect(item?.loc).toBe(`${ORIGIN}/articles/a%20b%26c`);
    expect(sitemapXml([{ loc: "https://x.test/?a=1&b=2" }])).toContain("<loc>https://x.test/?a=1&amp;b=2</loc>");
  });
});

describe("sitemapXml", () => {
  it("is a sitemaps.org urlset with an XML declaration", () => {
    const xml = sitemapXml([{ loc: `${ORIGIN}/` }, { loc: `${ORIGIN}/articles/a`, lastmod: "2024-04-02" }]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')).toBe(true);
    expect(xml).toContain(`<url><loc>${ORIGIN}/articles/a</loc><lastmod>2024-04-02</lastmod></url>`);
    expect(xml).toContain(`<url><loc>${ORIGIN}/</loc></url>`);
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
  });
});

describe("robotsTxt", () => {
  it("allows everything and links the sitemap on the production host", () => {
    expect(robotsTxt({ siteUrl: ORIGIN, indexable: true })).toBe(`User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);
  });
  it("disallows everything, and names no sitemap, anywhere else", () => {
    const txt = robotsTxt({ siteUrl: ORIGIN, indexable: false });
    expect(txt).toContain("User-agent: *\nDisallow: /\n");
    expect(txt).not.toContain("Allow:");
    expect(txt).not.toContain("Sitemap");
  });
});
