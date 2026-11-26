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

  it("is one footer, with the page in Markdown and the site index for agents as real, visible links named by their words", () => {
    expect(html.match(/<footer[ >]/g)).toHaveLength(1);
    expect(html).toMatch(/<a href="\/articles\.md" rel="alternate" type="text\/markdown" data-slot="markdown-link"[^>]*><span aria-hidden="true" class="site-footer-md"><\/span>Read this page as Markdown<\/a>/);
    expect(html).toMatch(/<a href="\/llms\.txt" type="text\/plain"[^>]*><svg[^>]*aria-hidden="true".*?<\/svg>Site index \(llms\.txt\)<\/a>/);
    expect(html).toContain(">For agents</p>");
    expect(render({ path: "/locations/lisbon" })).toContain('href="/locations/lisbon.md"');
  });

  it("says the sections again, after the globe, in the header's order, with the career page while there is one", () => {
    const nav = /<nav aria-labelledby="site-footer-sections".*?<\/nav>/.exec(html)![0];
    expect(nav).toContain(">Sections</p>");
    const hrefs = [...nav.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(["/", KIND_PATHS.project, KIND_PATHS.article, KIND_PATHS.artwork, KIND_PATHS.poem, KIND_PATHS.photograph, "/career"]);
    expect(render({ path: "/articles", hasCareer: false })).not.toContain('href="/career"');
  });

  it("says only what the site's own tables say: the owner, the first version; no copyright line, never the code name", () => {
    expect(html).toContain(SITE.name);
    // the first version explains itself: the words of `ARCHIVED_V1`, then its address as the link's words
    expect(html).toMatch(new RegExp(`${ARCHIVED_V1.sub}: <a href="${ARCHIVED_V1.url}" target="_blank" rel="noopener noreferrer"[^>]*>v1\\.bsodium\\.fr<svg.*?<\/svg><span class="sr-only"> \\(opens in a new tab\\)</span></a>`));
    // (the only link that leaves the site, and the only one in a new tab: the others are same-origin)
    expect(html.match(/target="_blank"/g)).toHaveLength(1);
    expect([...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]).filter((h) => /^https?:/.test(h!))).toEqual([ARCHIVED_V1.url]);
    // (a list carries no notice and software is under the repository's licence: an entry's own notice is the only one)
    expect(html).not.toContain("©");
    // (at the foot of the who column, not a bar of its own)
    expect(/<div class="site-footer-who">.*?<\/div>/.exec(html)![0]).toContain(`href="${ARCHIVED_V1.url}"`);
    expect(html).not.toMatch(/catalyst/i);
  });

  it("takes a page's own closing words as its lead, in place of the name and the line: one title in the ending, the rest unchanged", () => {
    const led = render({ path: "/artworks", hasCareer: true, lead: createElement("p", { className: "lead-probe" }, "That's the whole wall.") });
    expect(led.match(/<footer[ >]/g)).toHaveLength(1);
    expect(led).toContain("data-lead");
    const who = /<div class="site-footer-who">.*?<\/div>/.exec(led)![0];
    expect(who).toContain('class="lead-probe"');
    expect(who).not.toContain(SITE.name);
    expect(who).not.toContain("site-footer-line");
    // (the first version leaves the full column: it is said once, after the two lists)
    expect(who).not.toContain(ARCHIVED_V1.url);
    expect(led.split(ARCHIVED_V1.url)).toHaveLength(2);
    expect(led.indexOf('href="/llms.txt"')).toBeLessThan(led.indexOf(ARCHIVED_V1.url));
    expect(led).toContain('data-slot="markdown-link"');
    expect(led).toContain('href="/llms.txt"');
    expect(html).not.toContain("data-lead");
  });
});
