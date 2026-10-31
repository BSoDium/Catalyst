import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { loadDemoProjection } from "@catalyst/published/dev";
import { getPlaceDetail } from "~/lib/projection";
import { PlaceDetail } from "./place-detail";

const demo = loadDemoProjection();
const render = (slug: string) => renderToStaticMarkup(createElement(StaticRouter, { location: "/" }, createElement(PlaceDetail, { place: getPlaceDetail(demo, slug)! })));

describe("PlaceDetail", () => {
  it("says the name, the country once and the coordinates at the stored precision on one quiet line, with no 'Place' label", () => {
    const html = render("lisbon");
    expect(html).toContain("<h1");
    expect(html).toContain("38.72° N, 9.14° W");
    expect(html).not.toContain("38.7200");
    expect(html.match(/Portugal/g)?.length).toBe(1); // region and country are the same word: said once
    expect(html).not.toMatch(/PLACE|Place\s*<\/(span|p)>/);
    expect(html).not.toMatch(/Entries \/ 000|№/);
  });
  it("groups the entries under the kinds' own headings, without numbering or brackets", () => {
    const html = render("lisbon");
    expect(html).toMatch(/<h2[^>]*>Articles<\/h2>/);
    expect(html).toMatch(/<h2[^>]*>Software<\/h2>/);
    expect(html).not.toMatch(/>0\d<|ds-frame|Entries<\/h2>/);
    // cards in kind groups do not repeat the kind
    expect(html).not.toContain('data-slot="kind-tag"');
  });
  it("renders no entries section at all when nothing is linked, and no empty-state box", () => {
    const html = render("bangkok");
    expect(html).not.toContain('data-slot="place-entries"');
    expect(html).not.toMatch(/Nothing is linked|Entries/);
    expect(html).not.toContain("ds-frame");
  });
  it("blurs the card of a sensitive entry in the place's list, with no control, and not its neighbour", () => {
    const html = render("kyoto");
    expect((html.match(/data-slot="sensitive-media"/g) ?? []).length).toBe(1);
    expect(html).toContain("Mature content");
    expect(html).not.toContain("<button");
    const sensitive = html.slice(html.indexOf('id="figure-study-two"'));
    expect(sensitive.slice(0, sensitive.indexOf("</article>"))).toContain('data-state="hidden"');
    // the other card of the same place is an ordinary one
    const ordinary = html.slice(html.indexOf('id="demo-artwork"'));
    expect(ordinary.slice(0, ordinary.indexOf("</article>"))).not.toContain("sensitive-media");
    expect(render("lisbon")).not.toContain("sensitive-media");
  });
  const route = (slug: string, extra: Record<string, unknown> = {}) => {
    const p = (s: string, lon: number) => ({ slug: s, name: s, coordinates: { lat: 10, lon }, labelPriority: 0, body: [], images: [], related: [], ...(s === slug ? extra : {}) });
    const projection = { ...demo, places: [p("a", 10), p("b", 11), p("c", 12)], entries: [], routes: [{ id: "r", title: "Round", stops: ["a", "b", "c"] }] };
    return renderToStaticMarkup(createElement(StaticRouter, { location: "/" }, createElement(PlaceDetail, { place: getPlaceDetail(projection as typeof demo, "b")! })));
  };
  it("shows the trip as a small card: its map, its name, the stop before and the stop after, no timeline", () => {
    const html = route("b");
    expect(html).toContain('data-slot="trip-card"');
    expect(html).toContain("Stop 2 of 3");
    expect(html).toContain('href="/locations/a"');
    expect(html).toContain('href="/locations/c"');
    expect(html).not.toContain('data-slot="trip-here"');
    expect(html).not.toContain('data-slot="trip"');
  });
  it("links the trip's own page from its card when the route has one, and shows no link when it has none", () => {
    expect(render("hanoi")).toContain('data-slot="trip-link"');
    expect(render("hanoi")).toContain('href="https://example.org/demo-trip-vietnam"');
    expect(render("hanoi")).toContain('rel="noopener noreferrer"');
    expect(route("b")).not.toContain('data-slot="trip-link"');
  });
  it("a step with no entries is its story, open: the words, the pictures, the trip card", () => {
    const html = render("bangkok");
    expect(html).not.toContain('data-slot="place-story"');
    expect(html).toContain("We arrived at five in the morning");
    expect(html).toContain('data-slot="place-photos"');
    expect(html.match(/<figure/g)?.length).toBe(3);
    expect(html).toContain('data-slot="trip-card"');
    expect(html.indexOf("We arrived")).toBeLessThan(html.indexOf('data-slot="trip-card"'));
  });
  it("a step with entries leads with them, and its story and trip wait in one closed disclosure after", () => {
    const html = render("lisbon");
    const story = html.indexOf('data-slot="place-story"');
    expect(story).toBeGreaterThan(html.indexOf('data-slot="place-entries"'));
    expect(html.slice(story - 1, story + 60)).not.toContain(" open");
    expect(html).toContain("On the road here");
    expect(html.slice(0, story)).not.toContain("Lisbon is the city I keep returning to");
    expect(html.slice(story)).toContain("Lisbon is the city I keep returning to");
    expect(html.slice(story)).toContain('data-slot="trip-card"');
  });
  it("counts a photograph taken at the step as one of its pictures, not as an entry that puts the story second", () => {
    const html = render("lisbon");
    expect(html).not.toMatch(/<h2[^>]*>Photography<\/h2>/);
    const story = html.slice(html.indexOf('data-slot="place-story"'));
    expect(story).toContain('data-slot="place-photos"');
    expect(story).toContain('href="/photography/sea-wall"');
    expect(story).toContain("Sea Wall");
  });
  it("keeps a step with many pictures to a page: four shown, the rest behind a disclosure", () => {
    const images = Array.from({ length: 9 }, (_, i) => ({ src: `/media/demo/fig-coast-road.svg?${i}`.replace("?", "-"), alt: `Picture ${i}`, width: 960, height: 600 }));
    const html = route("b", { images });
    const open = html.slice(0, html.indexOf("<details"));
    expect(open.match(/<figure/g)?.length).toBe(4);
    expect(html).toContain("Show 5 more pictures");
  });
});
