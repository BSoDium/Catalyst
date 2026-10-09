import { describe, expect, it } from "vitest";
import { loadDemoProjection } from "@catalyst/published";
import { EMPTY_PROJECTION, type PublishedProjection } from "@catalyst/schemas";
import { robotsTxt, sitemapUrls, sitemapXml } from "./sitemap";

const ORIGIN = "https://v2.bsodium.fr";

describe("sitemapUrls", () => {
  it("lists the home page and the four lists, even for an empty projection", () => {
    expect(sitemapUrls(EMPTY_PROJECTION, ORIGIN).map((u) => u.loc)).toEqual([`${ORIGIN}/`, `${ORIGIN}/articles`, `${ORIGIN}/projects`, `${ORIGIN}/artworks`, `${ORIGIN}/poems`]);
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
    expect(urls).toContainEqual({ loc: `${ORIGIN}/poems/p` });
    expect(urls).toContainEqual({ loc: `${ORIGIN}/locations/lisbon`, lastmod: "2023-06-02" });
    expect(urls).toContainEqual({ loc: `${ORIGIN}/locations/paris` });
    expect(new Set(urls.map((u) => u.loc)).size).toBe(urls.length);
  });
  it("covers the whole demo projection", () => {
    const projection = loadDemoProjection();
    const total = 5 + projection.places.length + projection.articles.length + projection.projects.length + projection.artworks.length + projection.poems.length;
    expect(sitemapUrls(projection, ORIGIN)).toHaveLength(total);
  });
  it("percent-encodes a slug in the URL and escapes XML in the document", () => {
    const projection = { ...EMPTY_PROJECTION, articles: [{ slug: "a b&c", title: "A", placeSlugs: [] }] } as PublishedProjection;
    const [, , , , , item] = sitemapUrls(projection, ORIGIN);
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
