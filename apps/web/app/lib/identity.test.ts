import { readdirSync, readFileSync, statSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStaticHandler, createStaticRouter, MemoryRouter, StaticRouter, StaticRouterProvider, type StaticHandlerContext } from "react-router";
import { describe, expect, it } from "vitest";
import { loadDemoProjection } from "@catalyst/published/dev";
import { EntryListPage } from "~/components/entry-list-page";
import { EntryView } from "~/components/entry/entry-view";
import { ErrorPage } from "~/components/error-page";
import { LandingHero } from "~/components/landing-hero";
import { Navbar } from "~/components/navbar";
import { NotFoundPage } from "~/components/not-found-page";
import { SearchPalette } from "~/components/search-palette";
import { createHeroMachine } from "~/lib/hero-machine";
import { getEntryDetail, listEntries, CONTENT_KINDS } from "./entries";
import { SECTIONS } from "./sections";
import { entryMeta, listMeta } from "./entry-meta";
import { entryJsonLd, websiteJsonLd } from "./json-ld";
import { pageMeta } from "./meta";
import { buildSearchIndex } from "./search";
import { DEFAULT_SHARE_IMAGE, ROLE_IN_SENTENCE, SITE, SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, SITE_TITLE } from "./site";
import { sitemapUrls, sitemapXml } from "./sitemap";

/**
 * The project's code name is not the site's name. The site is the owner's: "Elliot Négrel-Jerzy". The code name stays in the repository,
 * the packages and the environment variables, and never in anything a visitor, a crawler, a link preview or an installed app sees.
 *
 * What is checked, and what is not:
 *   - the head tags, JSON-LD, sitemap and search index built from the demo content (the same functions the routes call);
 *   - the markup of the home hero, the header, a list, an entry, the 404 and error pages, the search palette, rendered on the demo content;
 *   - the files in public/ that a visitor can fetch: the manifest, the favicon, the share image's source (`scripts/brand/og.svg`);
 *   - the source of the app: no string, JSX text or attribute that says it (comments, the `CATALYST_*` environment variable names and the
 *     `@catalyst/*` package names are not read by anyone, so they are left alone).
 * Not checked here: the real server's responses (`pnpm check:prod` asserts the same over HTTP on the production build, including the
 * manifest and the sitemap) and the pixels of `public/og-default.png` (its words are in the SVG above, drawn from the same constant).
 * Excluded because it cannot be renamed from here: `public/media/.catalyst-manifest.json`, the content export's own bookkeeping file
 * (the exporter in the content repository writes and checks that name).
 */
const CODE_NAME = /catalyst/i;
const demo = loadDemoProjection();
const APP = new URL("../", import.meta.url);
const WEB = new URL("../../", import.meta.url);

const render = (node: ReturnType<typeof createElement>, location = "/") => renderToStaticMarkup(createElement(StaticRouter, { location }, node));
/** A component that needs a data router (the header reads the route matches). */
async function renderRouted(Component: () => ReturnType<typeof createElement>, url = "/"): Promise<string> {
  const handler = createStaticHandler([{ id: "routes/shell", path: "*", Component }]);
  const context = (await handler.query(new Request(`http://localhost${url}`))) as StaticHandlerContext;
  return renderToStaticMarkup(createElement(StaticRouterProvider, { router: createStaticRouter(handler.dataRoutes, context), context, hydrate: false }));
}
const has = (value: unknown) => CODE_NAME.test(typeof value === "string" ? value : JSON.stringify(value));

describe("the site's identity is one constant", () => {
  it("is the owner's name, with a short form for tight spots, and facts only", () => {
    expect(SITE.name).toBe("Elliot Négrel-Jerzy");
    expect(`${SITE.givenName} ${SITE.familyName}`).toBe(SITE.name);
    expect(SITE.shortName).toBe("Elliot N.-J.");
    expect(SITE.shortName.length).toBeLessThanOrEqual(12);
    expect(SITE_TAGLINE).toBe("Design engineer based in Warsaw. Data visualisation, geospatial and cartography interfaces, design systems, computer graphics.");
    expect(SITE_NAME).toBe(SITE.name);
    expect(SITE_TITLE).toBe("Elliot Négrel-Jerzy · Design engineer");
    expect(SITE_DESCRIPTION).toBe("Design engineer in Warsaw. Data visualisation, geospatial and cartography interfaces, design systems, computer graphics.");
    expect(SITE_DESCRIPTION.length).toBeLessThanOrEqual(160);
    for (const value of [SITE, SITE_TAGLINE, SITE_DESCRIPTION, SITE_TITLE, DEFAULT_SHARE_IMAGE]) expect(has(value)).toBe(false);
  });
});

describe("the role inside a sentence", () => {
  it("is the role in lower case where a clause starts with it: the share image's alt says it that way", () => {
    expect(ROLE_IN_SENTENCE).toBe(SITE.role.toLowerCase());
    expect(DEFAULT_SHARE_IMAGE.alt).toBe(`${SITE.name}, design engineer in Warsaw: a wireframe globe with two places joined by a route.`);
  });
});

describe("head tags, structured data, sitemap and search index (demo content)", () => {
  const origin = "https://v2.bsodium.fr";
  const entries = CONTENT_KINDS.map((kind) => getEntryDetail(demo, kind, listEntries(demo, kind)[0]!.slug)!);

  it("the home page, the lists and every kind of entry say the owner's name and never the code name", () => {
    const tags = [
      pageMeta({ origin, path: "/", jsonLd: websiteJsonLd(origin) }),
      ...CONTENT_KINDS.map((kind) => listMeta(kind, { origin, path: `/${SECTIONS[kind].slug}` })),
      ...entries.map((entry) => entryMeta({ entry }, { origin, path: entry.href })),
      entryMeta(undefined),
    ];
    for (const t of tags) expect(has(t), JSON.stringify(t).slice(0, 200)).toBe(false);
    // the title template and the Open Graph site name come from the constant
    const home = pageMeta({ origin, path: "/" });
    expect(home[0]).toEqual({ title: SITE_TITLE });
    expect(home).toContainEqual({ property: "og:site_name", content: SITE.name });
    expect(entryMeta({ entry: entries[0]! }, { origin, path: entries[0]!.href })[0]).toEqual({ title: `${entries[0]!.title} · ${SITE.name}` });
  });

  it("JSON-LD, sitemap and the search index", () => {
    for (const entry of entries) expect(has(entryJsonLd(entry, origin))).toBe(false);
    expect(has(websiteJsonLd(origin))).toBe(false);
    expect(has(sitemapXml(sitemapUrls(demo, origin)))).toBe(false);
    expect(has(buildSearchIndex(demo))).toBe(false);
  });
});

describe("the markup of the main routes (demo content)", () => {
  it("home: the hero (at rest and with no place), the header with and without the sections, and the palette", async () => {
    const machine = createHeroMachine();
    for (const empty of [false, true]) expect(has(render(createElement(LandingHero, { machine, away: false, empty }))), `hero empty=${empty}`).toBe(false);
    for (const heroResting of [true, false]) expect(has(await renderRouted(() => createElement(Navbar, { heroResting }))), `header resting=${heroResting}`).toBe(false);
    expect(has(render(createElement(SearchPalette)))).toBe(false);
    // the hero's headline and the header's home link carry the name
    const hero = render(createElement(LandingHero, { machine, away: false, empty: false }));
    expect(hero.replace(/<[^>]+>/g, "")).toContain(SITE.name);
    expect(await renderRouted(() => createElement(Navbar, { heroResting: false }))).toContain(`aria-label="Globe, ${SITE.name} home"`);
    machine.stop();
  });

  it("a list and an entry of each kind", () => {
    for (const kind of CONTENT_KINDS) {
      expect(has(render(createElement(EntryListPage, { kind, items: listEntries(demo, kind) }), `/${SECTIONS[kind].slug}`)), `list ${kind}`).toBe(false);
      const entry = getEntryDetail(demo, kind, listEntries(demo, kind)[0]!.slug)!;
      for (const layout of ["panel", "full"] as const) expect(has(render(createElement(EntryView, { entry, layout }))), `${kind} ${layout}`).toBe(false);
    }
  });

  it("the 404 page and the error pages, whose <title> is part of what they render", () => {
    const notFound = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(NotFoundPage)));
    expect(has(notFound)).toBe(false);
    expect(notFound).toContain(`<title>Page not found · ${SITE.name}</title>`);
    for (const error of [new Error("boom"), { status: 405, statusText: "Method Not Allowed", data: "no" }]) {
      const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ErrorPage, { error, showDetail: false })));
      expect(has(html)).toBe(false);
      expect(html).toContain(` · ${SITE.name}</title>`);
    }
  });
});

describe("what a visitor can fetch from public/", () => {
  it("the manifest says the owner's name, not the code name", () => {
    const text = readFileSync(new URL("public/manifest.webmanifest", WEB), "utf8");
    expect(has(text)).toBe(false);
    const manifest = JSON.parse(text) as { name: string; short_name: string; description: string };
    expect([manifest.name, manifest.short_name, manifest.description]).toEqual([SITE.name, SITE.shortName, SITE_DESCRIPTION]);
  });

  it("every text file of public/ (the favicon, the fonts' licences, the demo covers) is free of it, except the content export's own manifest", () => {
    const EXCLUDED = new Set(["media/.catalyst-manifest.json"]);
    const walk = (dir: string): string[] =>
      readdirSync(new URL(`public/${dir}`, WEB)).flatMap((name) => {
        const path = `${dir}${name}`;
        return statSync(new URL(`public/${path}`, WEB)).isDirectory() ? walk(`${path}/`) : [path];
      });
    const offenders = walk("")
      .filter((p) => /\.(svg|json|webmanifest|txt|xml|html)$/.test(p) && !EXCLUDED.has(p))
      .filter((p) => has(readFileSync(new URL(`public/${p}`, WEB), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the share image is drawn from the same words: the SVG it is rendered from has the name and no code name", () => {
    const svg = readFileSync(new URL("scripts/brand/og.svg", WEB), "utf8");
    expect(has(svg)).toBe(false);
    const text = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join(" ");
    expect(text).toContain(SITE.givenName);
    expect(text).toContain(SITE.familyName);
    expect(text).toContain(`${SITE.role}`);
    expect(text).toContain(`based in ${SITE.location}`);
  });
});

describe("the source of the app", () => {
  /** Source with comments blanked, then the names nobody reads removed: environment variables and package names. */
  const visible = (source: string) =>
    source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:\w"'`])\/\/.*$/gm, "$1")
      .replace(/\bCATALYST_[A-Z_]+/g, "")
      .replace(/@catalyst\/[\w-]+/g, "");
  const files = (dir = ""): string[] =>
    readdirSync(new URL(dir, APP)).flatMap((name) => {
      const path = `${dir}${name}`;
      if (statSync(new URL(path, APP)).isDirectory()) return files(`${path}/`);
      return /\.(tsx?|css)$/.test(name) && !/\.test\.ts$/.test(name) && !name.endsWith(".d.ts") ? [path] : [];
    });

  it("says the code name in no string, no JSX text and no attribute", () => {
    const offenders = files().filter((f) => CODE_NAME.test(visible(readFileSync(new URL(f, APP), "utf8"))));
    expect(offenders).toEqual([]);
  });
});
