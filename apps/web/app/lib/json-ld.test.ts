import { describe, expect, it } from "vitest";
import { loadDemoProjection } from "@catalyst/published";
import { getEntryDetail, type EntryDetail } from "./entries";
import { entryJsonLd, isCodeRepository, websiteJsonLd } from "./json-ld";

const ORIGIN = "https://v2.bsodium.fr";
const entry = (over: Partial<EntryDetail>): EntryDetail => ({
  kind: "article", slug: "a", href: "/articles/a", index: 1, title: "A title", tags: [], meta: [], places: [], body: [], related: [], prev: null, next: null, ...over,
});

describe("entryJsonLd", () => {
  it("describes an article from published fields only", () => {
    const ld = entryJsonLd(
      entry({ summary: "About it", date: "2024-04", tags: ["a", "b"], cover: { src: "/media/x/c.jpg", alt: "Alt" }, places: [{ slug: "lisbon", name: "Lisbon", href: "/locations/lisbon" }] }),
      ORIGIN,
    );
    expect(ld).toEqual({
      "@context": "https://schema.org",
      "@type": "Article",
      name: "A title",
      headline: "A title",
      description: "About it",
      url: `${ORIGIN}/articles/a`,
      mainEntityOfPage: `${ORIGIN}/articles/a`,
      datePublished: "2024-04",
      image: `${ORIGIN}/media/x/c.jpg`,
      keywords: "a, b",
      contentLocation: [{ "@type": "Place", name: "Lisbon", url: `${ORIGIN}/locations/lisbon` }],
      copyrightHolder: { "@type": "Person", name: "Elliot Négrel-Jerzy" },
      copyrightYear: 2024,
      copyrightNotice:
        "© 2024 Elliot Négrel-Jerzy. All rights reserved. Please do not reproduce this article without permission; short quotations with attribution are welcome.",
      isPartOf: { "@type": "WebSite", name: "Elliot Négrel-Jerzy", url: `${ORIGIN}/` },
    });
  });
  it("invents nothing: no author, publisher or empty value when the data lacks them", () => {
    const ld = entryJsonLd(entry({}), ORIGIN);
    for (const key of ["author", "publisher", "datePublished", "description", "image", "keywords", "contentLocation"]) expect(ld).not.toHaveProperty(key);
    expect(Object.values(ld).every((v) => v !== undefined && v !== null && v !== "")).toBe(true);
  });
  it("states the copyright of writing and artwork (holder, year when known, notice) and of software nothing", () => {
    const poem = entryJsonLd(entry({ kind: "poem", href: "/poetry/a", date: "2021-03", meta: [{ label: "Language", value: "French" }] }), ORIGIN);
    expect(poem).toMatchObject({ copyrightHolder: { "@type": "Person", name: "Elliot Négrel-Jerzy" }, copyrightYear: 2021 });
    expect(poem.copyrightNotice).toContain("Tous droits réservés");
    const undated = entryJsonLd(entry({ kind: "artwork", href: "/artworks/a" }), ORIGIN);
    expect(undated).toHaveProperty("copyrightHolder");
    expect(undated).toHaveProperty("copyrightNotice");
    expect(undated).not.toHaveProperty("copyrightYear");
    expect(undated).not.toHaveProperty("license");
    const code = entryJsonLd(entry({ kind: "project", href: "/software/a", url: "https://github.com/a/b" }), ORIGIN);
    for (const key of ["copyrightHolder", "copyrightYear", "copyrightNotice"]) expect(code).not.toHaveProperty(key);
  });
  it("caps the article headline at 110 characters (schema.org's advice) and keeps the full name", () => {
    const ld = entryJsonLd(entry({ title: "x".repeat(150) }), ORIGIN);
    expect((ld.headline as string).length).toBe(110);
    expect((ld.name as string).length).toBe(150);
  });
  it("types a project as SoftwareSourceCode only when it points at a source repository", () => {
    expect(entryJsonLd(entry({ kind: "project", href: "/software/a", url: "https://github.com/a/b" }), ORIGIN)).toMatchObject({ "@type": "SoftwareSourceCode", codeRepository: "https://github.com/a/b" });
    const plain = entryJsonLd(entry({ kind: "project", href: "/software/a", url: "https://example.org/demo" }), ORIGIN);
    expect(plain["@type"]).toBe("CreativeWork");
    expect(plain).not.toHaveProperty("codeRepository");
    expect(entryJsonLd(entry({ kind: "project", href: "/software/a" }), ORIGIN)["@type"]).toBe("CreativeWork");
  });
  it("gives an entry known only by its country a Country as its location", () => {
    const e = entry({ kind: "photograph", href: "/photography/a", places: [], country: { code: "BR", name: "Brazil", href: "/?country=BR" } });
    expect(entryJsonLd(e, ORIGIN).contentLocation).toEqual([{ "@type": "Country", name: "Brazil" }]);
  });

  it("types a photograph as a schema.org Photograph, with the owner's notice", () => {
    expect(entryJsonLd(entry({ kind: "photograph", href: "/photography/a", date: "2026-03" }), ORIGIN)).toMatchObject({ "@type": "Photograph", copyrightYear: 2026 });
  });

  it("types a poem as a CreativeWork of genre Poem and an artwork as a CreativeWork", () => {
    expect(entryJsonLd(entry({ kind: "poem", href: "/poetry/a" }), ORIGIN)).toMatchObject({ "@type": "CreativeWork", genre: "Poem" });
    const art = entryJsonLd(entry({ kind: "artwork", href: "/artworks/a" }), ORIGIN);
    expect(art["@type"]).toBe("CreativeWork");
    expect(art).not.toHaveProperty("genre");
  });
  it("leaves out a cover that scrapers and rich results cannot use (SVG)", () => {
    expect(entryJsonLd(entry({ cover: { src: "/media/x/c.svg", alt: "Alt" } }), ORIGIN)).not.toHaveProperty("image");
  });
  it("round-trips as JSON for every entry of the demo projection", () => {
    const projection = loadDemoProjection();
    let seen = 0;
    for (const [kind, items] of [["article", projection.articles], ["project", projection.projects], ["artwork", projection.artworks], ["poem", projection.poems], ["photograph", projection.photographs]] as const) {
      for (const item of items) {
        const detail = getEntryDetail(projection, kind, item.slug)!;
        const ld = entryJsonLd(detail, ORIGIN);
        expect(JSON.parse(JSON.stringify(ld))).toEqual(ld);
        expect(ld["@context"]).toBe("https://schema.org");
        expect(ld.url).toBe(`${ORIGIN}${detail.href}`);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe("isCodeRepository", () => {
  it("recognises the usual forges only", () => {
    expect(isCodeRepository("https://github.com/a/b")).toBe(true);
    expect(isCodeRepository("https://www.gitlab.com/a/b")).toBe(true);
    expect(isCodeRepository("https://codeberg.org/a/b")).toBe(true);
    expect(isCodeRepository("https://example.org/github.com")).toBe(false);
    expect(isCodeRepository("nope")).toBe(false);
    expect(isCodeRepository(undefined)).toBe(false);
  });
});

describe("websiteJsonLd", () => {
  it("is a minimal WebSite", () => {
    expect(websiteJsonLd(ORIGIN)).toEqual({ "@context": "https://schema.org", "@type": "WebSite", name: "Elliot Négrel-Jerzy", description: "Design engineer in Warsaw. Data visualisation, geospatial and cartography interfaces, design systems, computer graphics.", url: `${ORIGIN}/`, inLanguage: "en" });
  });
});
