import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { loadDemoProjection } from "@catalyst/published";
import { getEntryDetail } from "~/lib/entries";
import { EntryView } from "./entry-view";

const demo = loadDemoProjection();
const render = (kind: "article" | "poem" | "project" | "artwork", slug: string, layout: "panel" | "full", backTo?: { slug: string; name: string; href: string }) =>
  renderToStaticMarkup(createElement(StaticRouter, { location: "/" }, createElement(EntryView, { entry: getEntryDetail(demo, kind, slug)!, layout, backTo })));

describe("EntryView", () => {
  it("has one h1 (the title, the focus target), the code, the date and the metadata", () => {
    const html = render("article", "demo-article", "panel");
    expect((html.match(/<h1/g) ?? []).length).toBe(1);
    expect(html).toContain('id="panel-heading"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("ARTICLE / 0001");
    expect(html).toMatch(/datetime="2024-04-02"/i);
    expect(html).toContain("Publication");
    expect(html).toContain('aria-label="Tags"');
    expect(html).toContain("/locations/lisbon");
    expect(html).toContain("/projects/demo-project");
  });
  it("uses the authored cover when there is one", () => {
    const html = render("article", "demo-article", "panel");
    expect(html).toContain('src="/media/demo/cover-article.svg"');
    expect(html).toContain('width="960"');
  });
  it("draws generative cover art, seeded by the slug, when there is no cover", () => {
    const entry = { ...getEntryDetail(demo, "article", "demo-article")!, cover: undefined };
    const html = renderToStaticMarkup(createElement(StaticRouter, { location: "/" }, createElement(EntryView, { entry, layout: "panel" })));
    expect(html).toContain('data-slot="cover-art"');
    expect(html).not.toContain("cover-article.svg");
  });
  it("takes a project's Status fact as its status tag and its external link as a safe, labelled button", () => {
    const html = render("project", "demo-project", "panel");
    expect(html).toContain('data-slot="status-tag"');
    expect(html).toContain("DEMO FIXTURE");
    expect(html).toContain('href="https://example.org/demo-project"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("opens in a new tab");
  });
  it("sets the poem's language on the body", () => {
    expect(render("poem", "demo-poem", "panel")).toContain('lang="en"');
  });
  it("lays the same content out on the 12-column grid when full", () => {
    const panel = render("article", "demo-article", "panel");
    const full = render("article", "demo-article", "full");
    expect(panel).toContain('data-layout="panel"');
    expect(full).toContain('data-layout="full"');
    expect(full).toContain("--span-md:8");
    expect(full).toContain("--span-md:4");
    expect(panel).not.toContain("--span-md:8");
    // same text, same order
    const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    expect(text(full)).toBe(text(panel));
  });
  it("offers a way back to the place the visitor came from", () => {
    const html = render("article", "demo-article", "panel", { slug: "lisbon", name: "Lisbon", href: "/locations/lisbon" });
    expect(html).toContain("Back to");
    expect(html.indexOf("Back to")).toBeLessThan(html.indexOf("<h1"));
  });
  it("links the related entries and has no previous/next for a single entry per kind", () => {
    const html = render("poem", "demo-poem", "panel");
    expect(html).not.toContain("More poems");
    expect(render("article", "demo-article", "panel")).toContain('id="entry-places"');
  });
});
