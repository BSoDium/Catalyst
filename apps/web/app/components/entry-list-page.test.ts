import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { listEntries, type EntrySummary } from "~/lib/entries";
import { loadDemoProjection } from "@catalyst/published";
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
    expect(html).toContain("005 entries");
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
    expect(html).toContain("002 / 003 entries");
    // case variants are one tag (the first spelling is kept), and exactly one chip is current
    expect(html).toMatch(/aria-current="true"[^>]*data-filter="rail"/);
    expect((html.match(/aria-current="true"/g) ?? []).length).toBe(1);
    expect(html).toContain("Showing 2 of 3 articles tagged rail");
  });
  it("ignores an unknown tag", () => {
    expect((render(articles, "?tag=nope").match(/<article/g) ?? []).length).toBe(articles.length);
  });
  it("shows the empty state and no filter for no entries", () => {
    const html = render([]);
    expect(html).toContain("Nothing here yet");
    expect(html).not.toContain('data-slot="tag-filter"');
  });
});
