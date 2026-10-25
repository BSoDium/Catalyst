import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider, type StaticHandlerContext } from "react-router";
import { describe, expect, it } from "vitest";
import { SITE_NAME } from "~/lib/site";
import { GESTURE_GUARD_MS, Navbar } from "./navbar";

/** The header's inline row: everything before the Sections button's sheet (which repeats the sections as a list, for the narrow form). */
const inline = (html: string) => html.slice(0, html.indexOf('data-slot="sections-menu"'));

/** The navbar server-rendered at `url`; `shell` stands for the route that owns the globe (`routes/shell`). */
async function render(url: string, { shell = true, heroResting, hasCareer }: { shell?: boolean; heroResting?: boolean; hasCareer?: boolean } = {}): Promise<string> {
  const routes = [{ id: shell ? "routes/shell" : "routes/list", path: "*", Component: () => createElement(Navbar, { heroResting, hasCareer }) }];
  const handler = createStaticHandler(routes);
  const context = (await handler.query(new Request(`http://localhost${url}`))) as StaticHandlerContext;
  const router = createStaticRouter(handler.dataRoutes, context);
  return renderToStaticMarkup(createElement(StaticRouterProvider, { router, context, hydrate: false }));
}

describe("Navbar", () => {
  it("has no logo: the first item is \"Globe\" as plain text, a link home; then the five sections, in order, then the search", async () => {
    const html = await render("/articles", { shell: false });
    // the only drawing in the header is the search icon (before its word), after the links: no mark, no icon in front of the name
    expect(html.indexOf("<svg")).toBeGreaterThan(html.indexOf('href="/photography"'));
    // (the Sections button's chevron is the other: it is drawn only where the row has no room)
    expect(inline(html).match(/<svg/g) ?? []).toHaveLength(0);
    expect(html.match(/<svg/g)).toHaveLength(2);
    const links = [...inline(html).matchAll(/<a [^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => [m[1], m[2]]);
    expect(links).toEqual([
      ["/", "Globe"],
      ["/software", "Software"],
      ["/articles", "Articles"],
      ["/artworks", "Artworks"],
      ["/poetry", "Poetry"],
      ["/photography", "Photography"],
    ]);
    // the accessible name starts with the visible word and says what it is
    expect(html).toContain(`aria-label="Globe, ${SITE_NAME} home"`);
    expect(html.match(/aria-label="Primary"/g)).toHaveLength(1);
    // the search trigger follows the links in the DOM (so in the focus order)
    expect(html.indexOf('data-slot="search-trigger"')).toBeGreaterThan(html.indexOf('href="/photography"'));
  });

  it("adds \"Career\" after the five sections when the projection has a career document, and says so on the header for the tighter tiers", async () => {
    const html = await render("/articles", { shell: false, hasCareer: true });
    const links = [...inline(html).matchAll(/<a [^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => [m[1], m[2]]);
    expect(links).toEqual([["/", "Globe"], ["/software", "Software"], ["/articles", "Articles"], ["/artworks", "Artworks"], ["/poetry", "Poetry"], ["/photography", "Photography"], ["/career", "Career"]]);
    expect(html).toContain("data-career");
    expect(html.indexOf('data-slot="search-trigger"')).toBeGreaterThan(html.indexOf('href="/career"'));
    // the current page is marked
    const current = await render("/career", { shell: false, hasCareer: true });
    expect(current).toMatch(/<a [^>]*aria-current="page"[^>]*href="\/career"|<a [^>]*href="\/career"[^>]*aria-current="page"/);
  });

  it("has no career link, and no data-career, without a career document", async () => {
    const html = await render("/articles", { shell: false });
    expect(html).not.toContain("/career");
    expect(html).not.toContain("data-career");
  });

  it("on the home page, while the hero is at rest, renders no header at all: its rows are the sections and its search line is the search", async () => {
    const html = await render("/");
    // nothing visible: no bar, no links, no search trigger, no landmark (the palette itself is closed until opened)
    expect(html).not.toContain("<header");
    expect(html).not.toContain("<nav");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("search-trigger");
    expect(html).not.toContain("nav-fade");
  });

  it("on the home page, once the hero has stepped back (its rows are hidden), brings the sections back", async () => {
    const html = await render("/", { heroResting: false });
    const links = [...inline(html).matchAll(/<a [^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => m[1]);
    expect(links).toEqual(["/", "/software", "/articles", "/artworks", "/poetry", "/photography"]);
    expect(html.match(/aria-label="Primary"/g)).toHaveLength(1);
    // the key hint is plain muted text: the command key's name in a kbd with no box, no border, no background
    const kbd = html.slice(html.indexOf("<kbd"), html.indexOf("</kbd>"));
    expect(kbd).toContain('class="ds-kbd');
    expect(kbd).not.toMatch(/border|bg-|data-boxed|outline|ring/);
  });

  it("is unchanged on every other route, whatever the hero's state (it is not on the page there)", async () => {
    for (const url of ["/articles", "/poetry", "/locations/x", "/articles/x"]) {
      const html = await render(url, { shell: url.startsWith("/locations") || url.startsWith("/articles/"), heroResting: true });
      expect([...inline(html).matchAll(/<a [^>]*href="([^"]*)"/g)].map((m) => m[1]), url).toEqual(["/", "/software", "/articles", "/artworks", "/poetry", "/photography"]);
      expect(html, url).toContain('aria-label="Primary"');
    }
  });

  it("offers the search as one control at every width: the icon, the word \"Search\" and the key hint, in the type of the other items, after the links", async () => {
    const html = await render("/articles", { shell: false });
    const at = html.indexOf('data-slot="search-trigger"');
    expect(at).toBeGreaterThan(html.indexOf('href="/photography"'));
    expect(html.match(/data-slot="search-trigger/g)).toHaveLength(1);
    const button = html.slice(at, html.indexOf("</button>", at));
    // the icon, then the word, then the hint (empty until hydrated: its place is held), as one run of the nav type
    expect(button.indexOf("<svg")).toBeGreaterThan(-1);
    expect(button.indexOf("<svg")).toBeLessThan(button.indexOf("<span>Search</span>"));
    expect(button.indexOf("<span>Search</span>")).toBeLessThan(button.indexOf("<kbd"));
    // the glyph is an inline icon (1.1 em of the nav type), like the command key it sits beside: one size, not 20 px against 14 px
    expect(button).toContain('data-size="inline"');
    expect(button).not.toContain('data-size="control"');
    const opening = html.slice(html.lastIndexOf("<button", at), at + 400);
    expect(opening).toMatch(/class="nav-link nav-search[^"]*min-h-11 min-w-11/);
    expect(opening).toContain('aria-keyshortcuts="Control+K Meta+K"');
  });

  it("marks the search trigger as needing a script (not drawn without one: a dead control), keeps the links, and gives every item a 44 px target", async () => {
    const html = await render("/articles", { shell: false });
    expect(html.match(/data-needs-script=""/g)).toHaveLength(1);
    expect(html).toMatch(/data-slot="search-trigger"[^>]*data-needs-script=""/);
    // the shortest word ("Globe") is as wide as it is tall at the smallest phone, and the trigger is the same height as the links
    expect(html.match(/class="nav-link[^"]*min-h-11 min-w-11[^"]*"/g)?.length).toBeGreaterThanOrEqual(6);
  });

  it("marks the current page with aria-current on the name (when it is shown) or the section", async () => {
    expect(await render("/", { heroResting: false })).toMatch(/<a [^>]*aria-current="page"[^>]*href="\/"|<a [^>]*href="\/"[^>]*aria-current="page"/);
    const articles = await render("/articles", { shell: false });
    expect(articles).toMatch(/<a [^>]*aria-current="page"[^>]*>Articles<\/a>/);
    expect(articles).not.toMatch(/<a [^>]*aria-current="page"[^>]*>Software<\/a>/);
  });

  it("is centred over the whole viewport, except beside the place and entry panels where it is centred over the map", async () => {
    for (const url of ["/", "/articles", "/articles/x?view=full", "/poetry/x?view=full&tag=y"]) {
      expect(await render(url), url).not.toContain("md:right-1/2");
    }
    // (a place has no full-screen view: `?view=full` on a place is still the side panel)
    for (const url of ["/locations/x", "/locations/x?view=full", "/articles/x", "/software/x?view=panel", "/poetry/x?tag=y"]) {
      expect(await render(url), url).toContain("md:right-1/2");
    }
  });

  it("carries its own fade over the globe and the map only (the lists have the page scrim, the full-screen view the panel's)", async () => {
    expect(await render("/", { heroResting: false })).toContain("nav-fade");
    expect(await render("/locations/x")).toContain("nav-fade");
    expect(await render("/articles", { shell: false })).not.toContain("nav-fade");
    expect(await render("/articles/x?view=full")).not.toContain("nav-fade");
  });
});

describe("the Sections button (phone header)", () => {
  const css = readFileSync(new URL("../app.css", import.meta.url), "utf8");

  it("is one disclosure after the inline row and before the search, with a sheet that lists every section, each with its count, and Career", async () => {
    const html = await render("/articles", { shell: false, hasCareer: true });
    const at = html.indexOf('data-slot="sections-menu"');
    expect(at).toBeGreaterThan(html.indexOf('href="/career"'));
    expect(at).toBeLessThan(html.indexOf('data-slot="search-trigger"'));
    const details = html.slice(html.lastIndexOf("<details", at), html.indexOf("</details>", at));
    expect(details).toContain("<summary");
    expect(details).toMatch(/<summary[^>]*class="[^"]*min-h-11 min-w-11/);
    expect(details).toContain("<span>Sections</span>");
    const sheet = [...details.matchAll(/<a [^>]*href="([^"]*)"/g)].map((m) => m[1]);
    expect(sheet).toEqual(["/software", "/articles", "/artworks", "/poetry", "/photography", "/career"]);
    // without a data router there are no counts to say: the rows are the names alone
    expect(details).not.toContain('data-slot="sections-count"');
    // the current page is marked in the sheet as well
    expect(details).toMatch(/<a [^>]*aria-current="page"[^>]*href="\/articles"|<a [^>]*href="\/articles"[^>]*aria-current="page"/);
  });

  it("swaps with the inline row by the header's own width (56 rem), never by the viewport's: beside the panel the row has half the viewport", () => {
    expect(css).toMatch(/\.nav-sections \{\s*display: none;/);
    expect(css).toMatch(/@container \(max-width: 55\.99rem\) \{\s*\.nav-inline \{\s*display: none;\s*\}\s*\.nav-sections \{\s*display: block;/);
  });
});

describe(".nav-fade (app.css)", () => {
  const css = readFileSync(new URL("../app.css", import.meta.url), "utf8");
  const block = (() => {
    const from = css.indexOf("  .nav-fade {");
    return css.slice(from, css.indexOf("\n  }", from));
  })();
  const stops = [...(/background: linear-gradient\(\s*to bottom,([\s\S]*?)\);/.exec(block)?.[1] ?? "").matchAll(/(?:color-mix\(in srgb, var\(--background\) (\d+)%, transparent\)|(transparent)) (\d+)%/g)].map((m) => ({
    alpha: m[2] ? 0 : Number(m[1]),
    at: Number(m[3]),
  }));

  it("is the page colour at 85 % at the top edge, flat past the row's text, and falls monotonically to nothing", () => {
    expect(stops[0]).toEqual({ alpha: 85, at: 0 });
    expect(stops.at(-1)).toEqual({ alpha: 0, at: 100 });
    for (let i = 1; i < stops.length; i++) expect(stops[i]!.alpha).toBeLessThanOrEqual(stops[i - 1]!.alpha);
    // the row's text is centred at navbar-height / 2 of navbar-height + 3.5rem = 56 / 112 = 25 %: the fade there stays at 80 % or more,
    // the figure globe/engine/readability.test.ts assumes for the nav links
    const at = (p: number) => {
      const hi = stops.findIndex((s) => s.at >= p);
      const a = stops[hi - 1]!, b = stops[hi]!;
      return a.alpha + ((b.alpha - a.alpha) * (p - a.at)) / (b.at - a.at);
    };
    expect(at(25)).toBeGreaterThanOrEqual(80);
    // an eased fall: no step taller than 16 points between two stops after the plateau
    for (let i = 1; i < stops.length; i++) expect(stops[i - 1]!.alpha - stops[i]!.alpha).toBeLessThanOrEqual(16);
  });

  it("never catches the pointer, sits behind the links, has no blur and melts into the map at both ends", () => {
    expect(block).toContain("pointer-events: none");
    expect(block).toContain("z-index: -1");
    expect(block).not.toContain("backdrop-filter");
    expect(block).toMatch(/mask-image: linear-gradient\(\s*to right,\s*transparent 0,/);
    expect(block).toContain("height: var(--fade-height)");
    expect(css).toMatch(/--fade-height: calc\(var\(--navbar-height\) \+ 3\.5rem\)/);
  });

  it("has its own states for reduced transparency and forced colours", () => {
    expect(css).toMatch(/prefers-reduced-transparency: reduce\)[\s\S]*\.nav-fade \{/);
    expect(css).toMatch(/forced-colors: active\)[\s\S]*\.nav-fade \{[^}]*Canvas/);
    // a solid band (forced colours drop gradients and the mask would hide it), as tall as the row
    expect(css).toMatch(/forced-colors: active\)\s*\{[^@]*\.nav-fade \{[^}]*height: var\(--navbar-height\);[^}]*background: Canvas;[^}]*background-image: none;[^}]*mask-image: none;/);
  });
});

describe("the header that a gesture brings", () => {
  const css = readFileSync(new URL("../app.css", import.meta.url), "utf8");

  it("ignores the pointer while guarded (the tap's click must not reach a link that was not there when the finger went down), and only the pointer", () => {
    const at = css.indexOf('[data-slot="site-header"][data-guard]');
    expect(at).toBeGreaterThan(0);
    const rule = css.slice(at, css.indexOf("}", at));
    expect(rule).toContain('[data-slot="site-header"][data-guard] *');
    expect(rule).toMatch(/pointer-events: none !important;/);
    // visible and readable throughout: the guard changes nothing else
    expect(rule).not.toMatch(/opacity|visibility|display|inert/);
  });

  it("is a short guard, not rendered on the server (a server page has no gesture)", async () => {
    expect(GESTURE_GUARD_MS).toBeGreaterThanOrEqual(250);
    expect(GESTURE_GUARD_MS).toBeLessThanOrEqual(500);
    expect(await render("/articles", { shell: false })).not.toContain("data-guard");
    expect(await render("/", { heroResting: false })).not.toContain("data-guard");
  });
});
