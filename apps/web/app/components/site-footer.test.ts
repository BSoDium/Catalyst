import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { KIND_PATHS } from "~/lib/entries";
import { ARCHIVED_V1, SITE } from "~/lib/site";
import { SiteFooter, type SiteFooterProps } from "./site-footer";

const render = (props: SiteFooterProps) => renderToStaticMarkup(createElement(StaticRouter, { location: props.path }, createElement(SiteFooter, props)));

describe("SiteFooter", () => {
  const html = render({ path: "/articles", hasCareer: true });

  it("is one footer, with the page's Markdown twin and the site index as real, visible links", () => {
    expect(html.match(/<footer[ >]/g)).toHaveLength(1);
    expect(html).toMatch(/<a href="\/articles\.md" rel="alternate" type="text\/markdown" data-slot="markdown-link"[^>]*>.*?Read as Markdown<\/span><\/a>/);
    expect(html).toMatch(/<a href="\/llms\.txt" type="text\/plain"[^>]*>.*?Site index for agents<\/span><\/a>/);
    expect(render({ path: "/locations/lisbon" })).toContain('href="/locations/lisbon.md"');
  });

  it("says the sections again, after the globe, in the header's order, with the career page while there is one", () => {
    const nav = /<nav aria-label="Sections".*?<\/nav>/.exec(html)![0];
    const hrefs = [...nav.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(["/", KIND_PATHS.project, KIND_PATHS.article, KIND_PATHS.artwork, KIND_PATHS.poem, KIND_PATHS.photograph, "/career"]);
    expect(render({ path: "/articles", hasCareer: false })).not.toContain('href="/career"');
  });

  it("says only what the site's own tables say: the owner, the first version; no copyright line, never the code name", () => {
    expect(html).toContain(SITE.name);
    expect(html).toContain(`href="${ARCHIVED_V1.url}"`);
    // (a list carries no notice and software is under the repository's licence: an entry's own notice is the only one)
    expect(html).not.toContain("©");
    expect(html).not.toMatch(/catalyst/i);
  });
});
