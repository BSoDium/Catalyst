import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadDemoProjection } from "@catalyst/published/dev";
import { COLLECTIONS, CONTENT_KINDS, entriesOfPlace, getEntryDetail, listEntries, type EntryDetail } from "./entries";
import { entryMeta } from "./entry-meta";
import { entryJsonLd } from "./json-ld";
import { pageMeta } from "./meta";
import { isSensitive, SENSITIVE_COPY, shareableCover } from "./sensitive";
import { sitemapUrls, sitemapXml } from "./sitemap";
import { buildSearchIndex } from "./search";
import { DEFAULT_SHARE_IMAGE } from "./site";

const ORIGIN = "https://x.test";
const entry = (over: Partial<EntryDetail> = {}): EntryDetail => ({
  kind: "artwork", slug: "a", href: "/artworks/a", index: 1, title: "A title", tags: [], meta: [], places: [], body: [], related: [], prev: null, next: null, ...over,
});
const COVER = { src: "/media/demo/c.jpg", alt: "Alt", width: 10, height: 5 };
const find = (tags: ReturnType<typeof pageMeta>, key: "name" | "property", value: string) =>
  tags.find((t) => key in t && (t as Record<string, string>)[key] === value) as { content: string } | undefined;
const ldOf = (tags: ReturnType<typeof pageMeta>) => (tags.find((t) => "script:ld+json" in t) as { "script:ld+json": Record<string, unknown> })["script:ld+json"];

describe("isSensitive and shareableCover (the pure decisions)", () => {
  it("only a literal true counts: absent, false, and anything else are not sensitive", () => {
    expect(isSensitive({ sensitive: true })).toBe(true);
    for (const value of [undefined, false]) expect(isSensitive({ sensitive: value })).toBe(false);
    expect(isSensitive({})).toBe(false);
    expect(isSensitive(null)).toBe(false);
    expect(isSensitive(undefined)).toBe(false);
    expect(isSensitive({ sensitive: "true" as unknown as boolean })).toBe(false);
  });
  it("lends the cover to the share image and the structured data unless the entry is sensitive", () => {
    expect(shareableCover({ cover: COVER })).toBe(COVER);
    expect(shareableCover({ cover: COVER, sensitive: false })).toBe(COVER);
    expect(shareableCover({ cover: COVER, sensitive: true })).toBeUndefined();
    expect(shareableCover({ sensitive: true })).toBeUndefined();
    expect(shareableCover({})).toBeUndefined();
  });
  it("the interface words are the ones the spec names", () => {
    expect(SENSITIVE_COPY.label).toBe("Mature content");
    expect(SENSITIVE_COPY.show).toBe("Show image");
  });
});

describe("head tags of a sensitive entry", () => {
  const sensitive = entry({ sensitive: true, cover: COVER, summary: "About it" });

  it("shares the site's default image, never the cover, in Open Graph and Twitter tags", () => {
    const tags = entryMeta({ entry: sensitive }, { origin: ORIGIN });
    expect(find(tags, "property", "og:image")?.content).toBe(`${ORIGIN}${DEFAULT_SHARE_IMAGE.path}`);
    expect(find(tags, "name", "twitter:image")?.content).toBe(`${ORIGIN}${DEFAULT_SHARE_IMAGE.path}`);
    expect(find(tags, "property", "og:image:alt")?.content).toBe(DEFAULT_SHARE_IMAGE.alt);
    expect(find(tags, "name", "twitter:image:alt")?.content).toBe(DEFAULT_SHARE_IMAGE.alt);
    expect(find(tags, "property", "og:image:type")?.content).toBe(DEFAULT_SHARE_IMAGE.type);
    // nothing in the whole head mentions the cover's path or its alt text
    expect(JSON.stringify(tags)).not.toContain(COVER.src);
    expect(JSON.stringify(tags)).not.toContain('"Alt"');
  });
  it("has no image in its JSON-LD (the entry is still described: name, url, keywords...)", () => {
    const tags = entryMeta({ entry: { ...sensitive, tags: ["a"], date: "2025" } }, { origin: ORIGIN });
    const ld = ldOf(tags);
    expect(ld).not.toHaveProperty("image");
    expect(ld).toMatchObject({ "@type": "CreativeWork", name: "A title", url: `${ORIGIN}/artworks/a`, datePublished: "2025", keywords: "a" });
    expect(entryJsonLd(sensitive, ORIGIN)).not.toHaveProperty("image");
  });
  it("asks search engines not to index the page's images, and stays indexable otherwise", () => {
    const tags = entryMeta({ entry: sensitive }, { origin: ORIGIN });
    expect(find(tags, "name", "robots")?.content).toBe("noimageindex");
    // an ordinary entry has no robots tag at all, as before
    expect(find(entryMeta({ entry: entry({ cover: COVER }) }, { origin: ORIGIN }), "name", "robots")).toBeUndefined();
    // noindex (a not-found page) already says more, and wins
    expect(find(pageMeta({ noindex: true, noImageIndex: true }), "name", "robots")?.content).toBe("noindex");
  });
  it("leaves every other entry as it was: the cover is shared, and sensitive false is the same as absent", () => {
    for (const sensitiveValue of [undefined, false]) {
      const tags = entryMeta({ entry: entry({ cover: COVER, ...(sensitiveValue === undefined ? {} : { sensitive: sensitiveValue as true }) }) }, { origin: ORIGIN });
      expect(find(tags, "property", "og:image")?.content).toBe(`${ORIGIN}${COVER.src}`);
      expect(ldOf(tags)["image"]).toBe(`${ORIGIN}${COVER.src}`);
    }
  });
});

describe("the demo's sensitive entry, end to end", () => {
  const demo = loadDemoProjection();
  const slug = "figure-study-two";
  const detail = getEntryDetail(demo, "artwork", slug)!;
  const cover = demo.artworks.find((a) => a.slug === slug)!.cover!;
  const figure = detail.body.find((b) => b.type === "image")!;

  it("reaches the summaries, the detail and the refs as true, and only there", () => {
    expect(detail.sensitive).toBe(true);
    expect(listEntries(demo, "artwork").find((e) => e.slug === slug)?.sensitive).toBe(true);
    const flagged = CONTENT_KINDS.flatMap((kind) => listEntries(demo, kind).filter((e) => "sensitive" in e).map((e) => `${kind}/${e.slug}`));
    expect(flagged).toEqual([`artwork/${slug}`]);
    // an entry that shares its place sees it as a related ref, flagged
    const neighbour = getEntryDetail(demo, "artwork", "demo-artwork")!;
    expect(neighbour.related.find((r) => r.slug === slug)?.sensitive).toBe(true);
    expect(neighbour.related.filter((r) => r.slug !== slug).every((r) => !("sensitive" in r))).toBe(true);
    // the place panel's groups carry it too
    const kyoto = entriesOfPlace(demo, "kyoto").flatMap((g) => g.entries);
    expect(kyoto.find((e) => e.slug === slug)?.sensitive).toBe(true);
  });
  it("omits false and unset on every selector (absent keys, not undefined values)", () => {
    const projection = { ...demo, artworks: demo.artworks.map((a) => (a.slug === slug ? { ...a, sensitive: false } : a)) };
    expect(listEntries(projection, "artwork").find((e) => e.slug === slug)).not.toHaveProperty("sensitive");
    expect(getEntryDetail(projection, "artwork", slug)).not.toHaveProperty("sensitive");
    expect(getEntryDetail(projection, "artwork", "demo-artwork")!.related.find((r) => r.slug === slug)).not.toHaveProperty("sensitive");
  });
  it("shares the default image, has no JSON-LD image and nothing else of the head names the cover", () => {
    const tags = entryMeta({ entry: detail }, { origin: ORIGIN, path: detail.href });
    expect(find(tags, "property", "og:image")?.content).toBe(`${ORIGIN}${DEFAULT_SHARE_IMAGE.path}`);
    expect(ldOf(tags)).not.toHaveProperty("image");
    const text = JSON.stringify(tags);
    for (const needle of [cover.src, figure.type === "image" ? figure.src : "?", cover.alt, "cover-figure-study", "fig-figure-study"]) expect(text, needle).not.toContain(needle);
  });
  it("the sitemap and the search index say nothing about any image", () => {
    const xml = sitemapXml(sitemapUrls(demo, ORIGIN));
    expect(xml).not.toMatch(/image:|<image|\/media\//);
    expect(xml).toContain(`${ORIGIN}/artworks/${slug}`);
    expect(JSON.stringify(buildSearchIndex(demo))).not.toContain("/media/");
  });
  it("is the only sensitive entry, and a sensitive entry is in the collection of its kind", () => {
    for (const kind of CONTENT_KINDS) {
      const flagged = demo[COLLECTIONS[kind]].filter((e) => e.sensitive === true).map((e) => e.slug);
      expect(flagged).toEqual(kind === "artwork" ? [slug] : []);
    }
  });
});

describe("the stylesheet keeps the rule (read from app.css, as the design-system tests do)", () => {
  const css = readFileSync(new URL("../app.css", import.meta.url), "utf8");
  /** The body of the rule that starts at `selector`, balanced on braces. */
  const rule = (selector: string, from = 0) => {
    const start = css.indexOf(selector, from);
    expect(start, selector).toBeGreaterThanOrEqual(0);
    const open = css.indexOf("{", start);
    let depth = 0;
    for (let i = open; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
    }
    throw new Error("unbalanced css");
  };

  it("blurs a hidden frame by an attribute (server-rendered, no script), enlarged so that the edge stays outside, and clips it", () => {
    const frame = rule(".sensitive-media {");
    expect(frame).toMatch(/overflow:\s*hidden/);
    expect(frame).toMatch(/container-type:\s*inline-size/);
    expect(frame).toMatch(/--sensitive-blur:\s*clamp\(0\.75rem,\s*6cqi,\s*3rem\)/);
    const hidden = rule('.sensitive-media[data-state="hidden"] .sensitive-media-content');
    expect(hidden).toMatch(/filter:\s*blur\(var\(--sensitive-blur\)\)/);
    expect(hidden).toMatch(/transform:\s*scale\(1\.\d+\)/);
  });
  it("animates the way out of the blur only, and only where the visitor accepts motion (never the way in: no fade from sharp)", () => {
    const media = css.indexOf("@media (prefers-reduced-motion: no-preference)", css.indexOf(".sensitive-media-content {"));
    expect(media).toBeGreaterThan(0);
    expect(rule('.sensitive-media[data-state="revealed"] .sensitive-media-content', media)).toMatch(/transition:[\s\S]*filter/);
    // neither the base rule nor the hidden state has a transition of its own
    expect(rule(".sensitive-media-content {")).not.toMatch(/transition/);
    expect(rule('.sensitive-media[data-state="hidden"] .sensitive-media-content')).not.toMatch(/transition/);
  });
  it("keeps the blur on paper, revealed or not, and prints no control", () => {
    const print = css.slice(css.indexOf("@media print {"));
    const content = rule(".sensitive-media[data-state] .sensitive-media-content", css.indexOf("@media print {"));
    expect(content).toMatch(/filter:\s*blur\(var\(--sensitive-blur\)\)\s*!important/);
    expect(content).toMatch(/transform:\s*scale\(1\.\d+\)\s*!important/);
    expect(print).toMatch(/\.sensitive-media-hide\s*\{[^}]*display:\s*none\s*!important/);
  });
});
