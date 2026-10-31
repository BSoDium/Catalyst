import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { listEntries, type EntrySummary } from "~/lib/entries";
import { loadDemoProjection } from "@catalyst/published/dev";
import { EntryListPage } from "./entry-list-page";

const demo = loadDemoProjection();
const articles = listEntries(demo, "article");
const render = (items: EntrySummary[], search = "", kind: "article" | "poem" = "article") =>
  renderToStaticMarkup(createElement(StaticRouter, { location: `/articles${search}` }, createElement(EntryListPage, { kind, items })));

const make = (slug: string, date: string | undefined, tags: string[]): EntrySummary => ({ ...articles[0]!, slug, href: `/articles/${slug}`, title: `T ${slug}`, date, tags });

describe("EntryListPage", () => {
  it("lists every entry flat when each year holds one (no timeline of single cards)", () => {
    const html = render(articles);
    expect((html.match(/<article/g) ?? []).length).toBe(articles.length);
    expect(html).not.toContain("data-year=\"2026\"");
    expect(html).toContain('aria-label="Filter articles by tag"');
    expect(html).toContain(">5 articles<");
    expect(html).not.toMatch(/Article \/ Index|005|№/i);
  });
  it("carries no copyright notice (it belongs to an entry's page)", () => {
    for (const kind of ["article", "poem"] as const) expect(render(listEntries(demo, kind), "", kind)).not.toMatch(/©|entry-copyright|All rights reserved/);
  });
  it("groups by year, newest first, when the years hold several entries", () => {
    const items = [make("a", "2022-01", ["x"]), make("b", "2024-05", ["x"]), make("c", "2024-02", ["y"]), make("d", "2022-09", ["y"])];
    const html = render(items);
    expect(html.indexOf('data-year="2024"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-year="2024"')).toBeLessThan(html.indexOf('data-year="2022"'));
    // inside a year the newest first: b (2024-05) before c (2024-02)
    expect(html.indexOf("T b")).toBeLessThan(html.indexOf("T c"));
    expect(html).toMatch(/<h2[^>]*id="year-2024"/);
    // the cards are level 3 under the year headings
    expect(html).toMatch(/<h3[^>]*>.*T b/s);
  });
  it("filters by the tag in the URL, marks it current and says how many of how many", () => {
    const items = [make("a", "2022", ["rail"]), make("b", "2023", ["bus"]), make("c", "2024", ["Rail", "bus"])];
    const html = render(items, "?tag=rail");
    expect((html.match(/<article/g) ?? []).length).toBe(2);
    expect(html).toContain(">2 of 3 articles<");
    // case variants are one tag (the first spelling is kept), and exactly one chip is current
    expect(html).toMatch(/aria-current="true"[^>]*data-filter="rail"/);
    expect((html.match(/aria-current="true"/g) ?? []).length).toBe(1);
    expect(html).toContain("Showing 2 of 3 articles tagged rail");
  });
  it("calls the poems' section \"Poetry\" (title, list, filter) and counts its entries as poems", () => {
    const poems = listEntries(demo, "poem");
    const at = (items: EntrySummary[], search = "") =>
      renderToStaticMarkup(createElement(StaticRouter, { location: `/poetry${search}` }, createElement(EntryListPage, { kind: "poem", items })));
    const html = at(poems);
    expect(html).toMatch(/<h1[^>]*>Poetry<\/h1>/);
    expect(html).toContain(`>${poems.length} poems<`);
    expect(html).toContain('aria-label="Filter poetry by tag"');
    expect(html).toContain('role="list" aria-label="Poetry"');
    expect(html).not.toMatch(/<h1[^>]*>Poems<\/h1>/);
    // one poem is "1 poem", never "1 poetry"
    expect(at(poems.slice(0, 1))).toContain(">1 poem<");
    expect(at(poems.slice(0, 1))).not.toMatch(/\bPoems\b|1 poetry/);
    // the filter says how many of how many, in poems
    const tag = poems.find((p) => p.tags.length > 0)?.tags[0];
    expect(tag).toBeTruthy();
    expect(at(poems, `?tag=${encodeURIComponent(tag!)}`)).toMatch(new RegExp(`Showing \\d+ of ${poems.length} poems tagged`));
    // the entry's own kicker (singular) is not the list's business
    expect(html).not.toContain("Poetry /");
  });
  it("calls the projects' section \"Software\" (title, list, filter) and counts it as software, which has no plural", () => {
    const software = listEntries(demo, "project");
    const at = (items: EntrySummary[], search = "") =>
      renderToStaticMarkup(createElement(StaticRouter, { location: `/software${search}` }, createElement(EntryListPage, { kind: "project", items })));
    const html = at(software);
    expect(html).toMatch(/<h1[^>]*>Software<\/h1>/);
    expect(html).toContain(`>${software.length} software<`);
    expect(html).toContain('aria-label="Filter software by tag"');
    expect(html).toContain('role="list" aria-label="Software"');
    expect(html).not.toMatch(/Projects?\b|projects\b|softwares/);
    expect(at(software.slice(0, 1))).toContain(">1 software<");
    const tag = software.find((p) => p.tags.length > 0)?.tags[0];
    expect(tag).toBeTruthy();
    expect(at(software, `?tag=${encodeURIComponent(tag!)}`)).toMatch(new RegExp(`Showing \\d+ of ${software.length} software tagged`));
  });
  it("ignores an unknown tag", () => {
    expect((render(articles, "?tag=nope").match(/<article/g) ?? []).length).toBe(articles.length);
  });
  it("shows the empty state and no filter for no entries", () => {
    const html = render([]);
    expect(html).toContain("Nothing here yet");
    expect(html).toContain(">0 articles<");
    expect(html).not.toContain('data-slot="tag-filter"');
  });
  it("sets the entries as hairline rows of type: a mono dateline, the title in the display role, no card, box or generated cover for an article", () => {
    const html = render(articles);
    expect(html).toContain('data-surface="reading"');
    // the head is a journal's: a running head over one hairline, then the title; no masthead double rule, no standfirst
    expect(html).toMatch(/<h1[^>]*class="list-title"/);
    expect(html).toMatch(/<p class="list-running[^"]*">.*?Elliot N\u00E9grel-Jerzy.*?data-slot="list-count"/s);
    expect(html).not.toContain("list-standfirst");
    expect(html).not.toContain("entry-rule");
    expect((html.match(/<h1/g) ?? []).length).toBe(1);
    expect((html.match(/entry-row/g) ?? []).length).toBe(articles.length);
    expect(html).toMatch(/<h2[^>]*class="type-display-md[^"]*"/);
    expect(html).toContain("type-meta");
    expect(html).not.toMatch(/ds-grid|ds-col|border-border-strong|rounded/);
    // an article has no generated cover (type is the page); an authored one stays
    const withoutImage = articles.map((a) => ({ ...a, cover: undefined }));
    expect(render(withoutImage)).not.toContain('data-slot="cover-art"');
    expect(html).toContain("<img");
  });
  it("gives an artwork without an image its generated cover (the image is the artwork)", () => {
    const artworks = listEntries(demo, "artwork").map((a) => ({ ...a, cover: undefined }));
    const html = renderToStaticMarkup(createElement(StaticRouter, { location: "/artworks" }, createElement(EntryListPage, { kind: "artwork", items: artworks })));
    expect((html.match(/data-slot="cover-art"/g) ?? []).length).toBe(artworks.length);
  });
  it("says the year as a thin display numeral when years group entries", () => {
    const items = [make("a", "2022-01", ["x"]), make("b", "2024-05", ["x"]), make("c", "2024-02", ["y"]), make("d", "2022-09", ["y"])];
    expect(render(items)).toMatch(/<h2[^>]*class="ds-year type-display-lg type-thin[^"]*"/);
  });
});

describe("EntryListPage with a sensitive entry", () => {
  const artworks = listEntries(demo, "artwork");
  const html = renderToStaticMarkup(createElement(StaticRouter, { location: "/artworks" }, createElement(EntryListPage, { kind: "artwork", items: artworks })));

  it("blurs the row's image from the server render, labels it and gives it no control", () => {
    const row = html.slice(html.indexOf('id="figure-study-two"'));
    const one = row.slice(0, row.indexOf("</article>"));
    expect(one).toContain('data-slot="sensitive-media"');
    expect(one).toContain('data-state="hidden"');
    expect(one).toContain("Mature content");
    expect(one).not.toContain("<button");
    expect(one).not.toContain("data-interactive");
    expect(one).toContain('href="/artworks/figure-study-two"');
  });
  it("leaves the other rows alone: exactly one frame in the list", () => {
    expect((html.match(/data-slot="sensitive-media"/g) ?? []).length).toBe(1);
    expect((html.match(/Mature content/g) ?? []).length).toBe(1);
  });
  it("sets the artworks as one wall without year headings, and keeps each artwork's anchor and the filter", () => {
    const artworks = listEntries(demo, "artwork");
    const html = renderToStaticMarkup(createElement(StaticRouter, { location: "/artworks" }, createElement(EntryListPage, { kind: "artwork", items: artworks })));
    expect(html).toContain('data-slot="artwork-wall"');
    expect(html).not.toContain("data-year=");
    for (const a of artworks) expect(html).toContain(`id="${a.slug}"`);
    expect(html).toContain(`>${artworks.length} artworks<`);
  });
  it("sets the photographs as one wall of pictures, captioned with the place and the year, and never draws generated art for one", () => {
    const photos = listEntries(demo, "photograph");
    const html = renderToStaticMarkup(createElement(StaticRouter, { location: "/photography" }, createElement(EntryListPage, { kind: "photograph", items: photos })));
    expect(html).toContain('data-slot="artwork-wall" data-kind="photograph"');
    expect(html).not.toContain("data-year=");
    for (const p of photos) expect(html).toContain(`id="${p.slug}"`);
    expect(html).toContain(`>${photos.length} photographs<`);
    expect(html).toContain('href="/photography/demo-photograph"');
    expect(html).toContain("Cusco");
    expect(html).not.toContain("cover-art");
    // a photograph without an image is the caption alone, not a procedural miniature
    const bare = [{ ...photos[0]!, cover: undefined }];
    const none = renderToStaticMarkup(createElement(StaticRouter, { location: "/photography" }, createElement(EntryListPage, { kind: "photograph", items: bare })));
    expect(none).not.toContain("<canvas");
    expect(none).not.toContain("cover-art");
    // the only images are the wall's filler (scenery: no name, no link) under the end banner
    const imgs = none.match(/<img[^>]*>/g) ?? [];
    expect(imgs.length).toBeGreaterThanOrEqual(8);
    for (const img of imgs) expect(img).toContain('alt=""');
    expect(none.match(/data-slot="wall-filler"/g)).toHaveLength(imgs.length);
    expect(none).toContain('data-slot="gallery-end"');
  });
  it("sets the poems in a grid of cells with the summary in the reading face", () => {
    const poems = listEntries(demo, "poem");
    const html = render(poems, "", "poem");
    expect(html).toContain("poem-grid");
    expect(html).toContain("poem-summary");
    expect((html.match(/data-slot="entry-card"/g) ?? []).length).toBe(poems.length);
  });
  it("puts the tag filter in a scroll row", () => {
    expect(render(articles)).toContain('data-slot="scroll-row"');
  });
});
