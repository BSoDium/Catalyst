import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PublishedBodyBlock } from "@catalyst/schemas";
import { BlockRenderer } from "./blocks";

const render = (blocks: PublishedBodyBlock[], lang?: string) => renderToStaticMarkup(createElement(BlockRenderer, { blocks, lang }));

describe("BlockRenderer", () => {
  it("renders paragraphs with hard line breaks and escapes everything", () => {
    const html = render([{ type: "paragraph", text: "one\ntwo <b>x</b> & \"q\"" }]);
    expect(html).toContain("<p class=\"m-0\">one<br/>two &lt;b&gt;x&lt;/b&gt; &amp; &quot;q&quot;</p>");
    expect(html).not.toContain("<b>");
  });
  it("maps headings to h2/h3 with numbering and unique ids", () => {
    const html = render([
      { type: "heading", level: 2, text: "Notes" },
      { type: "heading", level: 3, text: "Sub" },
      { type: "heading", level: 2, text: "Notes" },
    ]);
    expect(html).toMatch(/<h2 id="body-notes"/);
    expect(html).toMatch(/<h3 id="body-sub"/);
    expect(html).toMatch(/<h2 id="body-notes-2"/);
    expect(html).toContain("1.1");
    expect(html).not.toContain("<h1");
  });
  it("renders ordered and unordered lists", () => {
    expect(render([{ type: "list", ordered: true, items: ["a", "b"] }])).toMatch(/<ol[^>]*><li[^>]*>a<\/li><li[^>]*>b<\/li><\/ol>/);
    expect(render([{ type: "list", ordered: false, items: ["a"] }])).toContain("<ul");
  });
  it("renders a quote with its cite", () => {
    const html = render([{ type: "quote", text: "Said", cite: "Someone" }]);
    expect(html).toContain("<blockquote");
    expect(html).toContain("<figcaption");
    expect(html).toContain("Someone");
  });
  it("renders an image with dimensions, lazy loading and a caption; drops an unsafe source", () => {
    const html = render([{ type: "image", src: "/media/a/b.svg", alt: "Alt", width: 960, height: 600, caption: "Cap" }]);
    expect(html).toContain('src="/media/a/b.svg"');
    expect(html).toContain('width="960"');
    expect(html).toContain('height="600"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('alt="Alt"');
    expect(html).toContain("Cap");
    expect(render([{ type: "image", src: "https://evil.test/x.png", alt: "x" } as PublishedBodyBlock])).not.toContain("<img");
    expect(render([{ type: "image", src: "/media/../x.png", alt: "x" } as PublishedBodyBlock])).not.toContain("<img");
  });
  it("keeps verse stanzas, lines and indentation, and sets the language", () => {
    const html = render([{ type: "verse", stanzas: [["first,", "    indented"], ["second"]] }], "fr");
    expect(html).toContain('lang="fr"');
    expect((html.match(/<p class="m-0 flex flex-col">/g) ?? []).length).toBe(2);
    expect(html).toContain("padding-left:2ch");
    expect(html).toContain("padding-left:6ch");
    expect(html).toContain(">indented<");
  });
  it("renders code in a scrollable, focusable pre with its language label", () => {
    const html = render([{ type: "code", language: "ts", code: "const a = 1;\n  if (a < 2) {}" }]);
    expect(html).toContain("<pre tabindex=\"0\"");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("ts");
    expect(html).toContain("a &lt; 2");
  });
  it("renders https link cards with rel and a new-tab note; a bad URL is plain text, never a link", () => {
    const html = render([{ type: "link", title: "Site", url: "https://example.org/x", description: "d" }]);
    expect(html).toContain('href="https://example.org/x"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("opens in a new tab");
    expect(html).toContain("<ul");
    const bad = render([{ type: "link", title: "Evil", url: "javascript:alert(1)" } as PublishedBodyBlock]);
    expect(bad).not.toContain("<a ");
    expect(bad).not.toContain("javascript:");
    expect(bad).toContain("Evil");
  });
  it("renders a divider as a thematic break, but not at the edges", () => {
    expect(render([{ type: "paragraph", text: "a" }, { type: "divider" }, { type: "paragraph", text: "b" }])).toContain("<hr");
    expect(render([{ type: "divider" }])).toBe("");
  });
  it("renders nothing for an empty body", () => {
    expect(render([])).toBe("");
  });
});

describe("no raw HTML sink", () => {
  it("no component of the entry views or the lists uses dangerouslySetInnerHTML or innerHTML", () => {
    const dirs = [new URL("./", import.meta.url), new URL("../", import.meta.url), new URL("../ui/", import.meta.url)];
    for (const dir of dirs) {
      for (const file of readdirSync(dir).filter((f) => f.endsWith(".tsx"))) {
        const source = readFileSync(new URL(file, dir), "utf8");
        expect(source, file).not.toMatch(/dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML/);
      }
    }
  });
});
