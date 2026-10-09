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
    expect(html).toMatch(/datetime="2026-03-14"/i);
    expect(html).toContain("Publication");
    expect(html).toContain('aria-label="Tags"');
    expect(html).toContain("/locations/ljubljana");
    expect(html).toContain("/locations/split");
    // entries that share a place with it: the timetable tool (Belgrade, Zagreb) and the night platform (Zagreb, Split)
    expect(html).toContain("/projects/timetable-diff");
    expect(html).toContain("/artworks/night-platform-split");
  });
  it("uses the authored cover when there is one", () => {
    const html = render("article", "demo-article", "panel");
    expect(html).toContain('src="/media/demo/cover-night-trains.svg"');
    expect(html).toContain('width="1200"');
  });
  it("draws generative cover art, seeded by the slug, when there is no cover", () => {
    const entry = { ...getEntryDetail(demo, "article", "demo-article")!, cover: undefined };
    const html = renderToStaticMarkup(createElement(StaticRouter, { location: "/" }, createElement(EntryView, { entry, layout: "panel" })));
    expect(html).toContain('data-slot="cover-art"');
    expect(html).not.toContain("cover-night-trains.svg");
  });
  it("takes a project's Status fact as its status tag and its external link as a safe, labelled button", () => {
    const html = render("project", "demo-project", "panel");
    expect(html).toContain('data-slot="status-tag"');
    expect(html).toContain("ACTIVE");
    expect(html).toContain('href="https://example.org/pixel-globe"');
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
  it("links the neighbours of the kind: the first has a next one only, the last a previous one only, the middle both", () => {
    const first = render("poem", "demo-poem", "panel");
    expect(first).toContain("More poems");
    expect(first).toContain('rel="next"');
    expect(first).not.toContain('rel="prev"');
    expect(first).toContain("/poems/citadel-rain");
    const last = render("poem", "quai-de-nuit", "panel");
    expect(last).toContain('rel="prev"');
    expect(last).not.toContain('rel="next"');
    const middle = render("poem", "citadel-rain", "panel");
    expect(middle).toContain('rel="prev"');
    expect(middle).toContain('rel="next"');
    expect(render("article", "demo-article", "panel")).toContain('id="entry-places"');
  });
  it("sets the language of French and Spanish poems on their text", () => {
    expect(render("poem", "quai-de-nuit", "panel")).toContain('lang="fr"');
    expect(render("poem", "cuesta-arriba", "panel")).toContain('lang="es"');
  });
  it("renders every demo entry in both layouts without throwing, with its covers and images from /media/", () => {
    for (const [kind, key] of [["article", "articles"], ["project", "projects"], ["artwork", "artworks"], ["poem", "poems"]] as const) {
      for (const item of demo[key]) {
        for (const layout of ["panel", "full"] as const) {
          const html = render(kind, item.slug, layout);
          expect(html, `${kind}/${item.slug}/${layout}`).toContain("<h1");
          if (item.cover) expect(html).toContain(`src="${item.cover.src}"`);
          else expect(html).toContain('data-slot="cover-art"');
        }
      }
    }
  });
});
