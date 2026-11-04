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
  it("says the name, the country once and the coordinates at the stored precision in the facts strip, with no 'Place' label", () => {
    const html = render("lisbon");
    expect(html).toContain("<h1");
    expect(html).toContain('data-slot="place-facts"');
    expect(html).toContain("38.72° N");
    expect(html).toContain("9.14° W");
    expect(html).not.toContain("38.7200");
    expect(html.match(/Portugal/g)?.length).toBe(1); // region and country are the same word: said once
    expect(html).not.toMatch(/PLACE|Place\s*<\/(span|p)>/);
    expect(html).not.toMatch(/Entries \/ 000|№/);
  });
  it("tells a home from the present one: 'Lived here' for a place lived in, 'Lives here' where the owner lives now", () => {
    const html = (extra: object) => renderToStaticMarkup(createElement(StaticRouter, { location: "/" }, createElement(PlaceDetail, { place: { ...getPlaceDetail(demo, "lisbon")!, ...extra } })));
    expect(html({})).not.toMatch(/Lived here|Lives here/);
    expect(html({ lived: true })).toContain("Lived here");
    expect(html({ lived: true, living: true })).toContain("Lives here");
    expect(html({ lived: true, living: true })).not.toContain("Lived here");
  });
  it("counts the entries by kind at the right end of the facts strip, hidden until the browser has measured whether they fit beside the coordinates", () => {
    const html = render("lisbon");
    expect(html).toMatch(/<dl[^>]*data-measuring[^>]*class="[^"]*invisible/);
    expect(html).toMatch(/<dt[^>]*>Articles<\/dt>/);
    expect(html).toMatch(/<dt[^>]*>Software<\/dt>/);
    expect(html).toContain("<noscript>");
  });
  it("inks each count of entries by how many there are: the secondary grey for one, the full ink for the most", () => {
    const base = getPlaceDetail(demo, "lisbon")!;
    const entry = base.entries[0]!.entries[0]!;
    const place = { ...base, entries: [{ kind: "article" as const, label: "Articles", entries: [entry] }, { kind: "project" as const, label: "Software", entries: [{ ...entry, slug: "a" }, { ...entry, slug: "b" }, { ...entry, slug: "c" }] }] };
    const html = renderToStaticMarkup(createElement(StaticRouter, { location: "/" }, createElement(PlaceDetail, { place })));
    expect(html).toContain("var(--foreground) 0%");
    expect(html).toContain("var(--foreground) 100%");
  });
  it("a place with only `living` is a home too: tagged and its trips do not count visits", () => {
    const place = { ...getPlaceDetail(demo, "lisbon")!, living: true as const };
    expect(renderToStaticMarkup(createElement(StaticRouter, { location: "/" }, createElement(PlaceDetail, { place })))).toContain("Lives here");
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
  it("blurs the picture of a sensitive entry in the place's gallery, with no control, and not its neighbour", () => {
    const html = render("kyoto");
    expect((html.match(/data-slot="sensitive-media"/g) ?? []).length).toBe(1);
    expect(html).toContain("Mature content");
    expect(html).not.toContain("<button");
    // it is in the gallery with the others, not a card apart from it
    const items = html.split("<a ").filter((chunk) => chunk.includes("place-gallery-item"));
    const blurred = items.filter((chunk) => chunk.slice(0, chunk.indexOf("</a>")).includes('data-state="hidden"'));
    expect(items.length).toBeGreaterThan(1);
    expect(blurred).toHaveLength(1);
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
    expect(html.match(/<figure/g)?.length).toBe(2); // (its first picture heads the panel)
    expect(html).toContain('data-slot="place-cover"');
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
  it("leads with the photographs taken at the step as a gallery under one 'Photography' title, not as cards that put the story second", () => {
    const html = render("lisbon");
    expect(html).toMatch(/<h2[^>]*>Photography<\/h2>/);
    const gallery = html.slice(html.indexOf('data-slot="place-gallery"'), html.indexOf('data-slot="place-story"'));
    expect(gallery).toContain('href="/photography/sea-wall"');
    expect(gallery).toContain("Sea Wall");
    expect(html.indexOf('data-slot="place-gallery"')).toBeLessThan(html.indexOf('<h2 class="m-0 font-display text-[2rem] leading-none font-extrabold tracking-[-0.03em]">Articles'));
  });
  it("draws a picture on a stage (issue #448): never wider than its own pixels, never taller than 80 % of the window, a blurred copy for the sides", () => {
    const html = render("bangkok");
    const stages = html.match(/<div data-slot="place-stage"[\s\S]*?<\/div>/g) ?? [];
    expect(stages.length).toBeGreaterThan(0);
    for (const stage of stages) {
      const width = /<img[^>]*\swidth="(\d+)"/.exec(stage)?.[1];
      expect(stage, "the picture is capped at its own width").toContain(`max-width:${width}px`);
      expect(stage).toContain("max-h-[80dvh]");
      expect(stage).toContain("object-contain");
      // the backdrop is decorative: no name, hidden from assistive technology, never a second picture to a reader
      expect(stage).toMatch(/<img[^>]*alt=""[^>]*aria-hidden="true"[^>]*class="entry-stage-backdrop"/);
    }
  });
  it("keeps a step with many pictures to a page: four shown, the rest behind a disclosure", () => {
    const images = Array.from({ length: 9 }, (_, i) => ({ src: `/media/demo/fig-coast-road.svg?${i}`.replace("?", "-"), alt: `Picture ${i}`, width: 960, height: 600 }));
    const html = route("b", { images });
    const open = html.slice(0, html.indexOf("<details"));
    expect(open.match(/<figure/g)?.length).toBe(4);
    expect(html).toContain("Show 4 more pictures"); // (the first of the nine heads the panel)
  });
});
