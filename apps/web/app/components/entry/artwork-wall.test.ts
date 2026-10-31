import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { loadDemoProjection } from "@catalyst/published/dev";
import { listEntries, type EntrySummary } from "~/lib/entries";
import { ArtworkWall, artworkCaption } from "./artwork-wall";

const demo = listEntries(loadDemoProjection(), "artwork");
const render = (items: EntrySummary[]) => renderToStaticMarkup(createElement(StaticRouter, { location: "/artworks" }, createElement(ArtworkWall, { items, label: "Artworks" })));
const make = (slug: string, size?: { width: number; height: number }, extra: Partial<EntrySummary> = {}): EntrySummary => ({
  ...demo[0]!,
  slug,
  href: `/artworks/${slug}`,
  title: `T ${slug}`,
  cover: size ? { src: `/media/x/${slug}.jpg`, alt: `Alt ${slug}`, ...size } : undefined,
  ...extra,
});

describe("ArtworkWall", () => {
  it("is one list in reading order with one card, one link and one anchor per artwork", () => {
    const items = [make("a", { width: 1920, height: 2560 }), make("b", { width: 1920, height: 1080 }), make("c", { width: 900, height: 900 })];
    const html = render(items);
    expect(html).toContain('role="list" aria-label="Artworks"');
    expect((html.match(/<article/g) ?? []).length).toBe(3);
    expect(html.indexOf('id="a"')).toBeLessThan(html.indexOf('id="b"'));
    expect(html.indexOf('id="b"')).toBeLessThan(html.indexOf('id="c"'));
    for (const slug of ["a", "b", "c"]) expect(html).toContain(`href="/artworks/${slug}"`);
    expect((html.match(/<a /g) ?? []).length).toBe(3);
  });
  it("reserves each picture's space from the contract (ratio, width and height attributes) so nothing shifts", () => {
    const html = render([make("a", { width: 1920, height: 2560 }), make("b", { width: 1920, height: 1080 })]);
    expect(html).toContain("--ratio:1.3333");
    expect(html).toContain("--ratio:0.5625");
    expect(html).toContain('width="1920" height="2560"');
    for (const tier of [1, 2, 3, 4]) expect(html).toContain(`--c${tier}:`);
    expect(html).toContain("--h3:calc(max(");
  });
  it("loads the first four images at once and the rest lazily", () => {
    const html = render(Array.from({ length: 6 }, (_, i) => make(`s${i}`, { width: 100, height: 100 })));
    expect((html.match(/loading="eager"/g) ?? []).length).toBe(4);
    expect((html.match(/loading="lazy"/g) ?? []).length).toBe(2);
  });
  it("draws a generated 4:3 cover for an artwork without one", () => {
    const html = render([make("none")]);
    expect(html).toContain('data-slot="cover-art"');
    expect(html).toContain("--ratio:0.75");
  });
  it("keeps a sensitive artwork blurred (the frame is hidden in the server render)", () => {
    const html = render([make("s", { width: 100, height: 100 }, { sensitive: true })]);
    expect(html).toContain('data-state="hidden"');
    expect(html).toContain("Mature content");
  });
  it("captions with the title (the heading's link), the medium and the year", () => {
    const html = render([make("a", { width: 100, height: 100 }, { meta: [{ label: "Medium", value: "Procreate" }, { label: "Year", value: "2025" }] })]);
    expect(html).toMatch(/<h2[^>]*><a [^>]*href="\/artworks\/a"[^>]*>T a<\/a><\/h2>/);
    expect(html).toContain("Procreate");
    expect(html).toContain(">2025<");
  });
  it("has no rounded corners of its own", () => {
    expect(render([make("a", { width: 1, height: 1 })])).not.toMatch(/rounded/);
  });
});

describe("artworkCaption", () => {
  it("reads the Medium and Year facts, else the year of the date", () => {
    expect(artworkCaption({ meta: [{ label: "medium", value: " Ink " }, { label: "Year", value: "2020" }], date: "2024" })).toEqual({ medium: "Ink", year: "2020" });
    expect(artworkCaption({ meta: [], date: "2024-05" })).toEqual({ year: "2024" });
    expect(artworkCaption({ meta: [] })).toEqual({});
  });
});
