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
  it("maps headings to h2/h3 with unique ids and no decorative numbering", () => {
    const html = render([
      { type: "heading", level: 2, text: "Notes" },
      { type: "heading", level: 3, text: "Sub" },
      { type: "heading", level: 2, text: "Notes" },
    ]);
    expect(html).toMatch(/<h2 id="body-notes"/);
    expect(html).toMatch(/<h3 id="body-sub"/);
    expect(html).toMatch(/<h2 id="body-notes-2"/);
    expect(html).not.toContain("1.1");
    expect(html).not.toContain("&sect;");
    expect(html).not.toContain("§");
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

describe("BlockRenderer typography", () => {
  const long = "I did not plan to take the night train four times in one week. The first was a question of arithmetic: a late meeting in Ljubljana, a morning one in Zagreb, and a bed that moved at 120 kilometres an hour was cheaper than a hotel and a taxi.";
  const renderWith = (blocks: PublishedBodyBlock[], dropCap: boolean) => renderToStaticMarkup(createElement(BlockRenderer, { blocks, dropCap }));

  it("opens the body with a drop cap only when asked, and only the first block, and only a long paragraph", () => {
    const blocks: PublishedBodyBlock[] = [{ type: "paragraph", text: long }, { type: "paragraph", text: long }];
    const html = renderWith(blocks, true);
    expect((html.match(/class="[^"]*\bdrop-cap\b/g) ?? []).length).toBe(1);
    expect(html).toContain('data-drop-cap="plain"');
    expect(html.indexOf("drop-cap")).toBeLessThan(html.indexOf("<p", html.indexOf("drop-cap") + 1));
    expect(renderWith(blocks, false)).not.toContain("drop-cap");
    expect(renderWith([{ type: "paragraph", text: "Short." }], true)).not.toContain("drop-cap");
    // a paragraph that opens with a quote, a lowercase letter or an elision is left plain (the cap would not sit on its lines)
    for (const lead of ["\u00AB Il", "\u201CA", "quand", "L'exil"]) {
      expect(renderWith([{ type: "paragraph", text: `${lead} ${long}` }], true), lead).not.toContain("drop-cap");
    }
    // an accented capital is given room for its mark
    expect(renderWith([{ type: "paragraph", text: `\u00C9crit ${long}` }], true)).toContain('data-drop-cap="accent"');
    // a paragraph that is not first in the body never takes one
    expect(renderWith([{ type: "heading", level: 2, text: "H" }, { type: "paragraph", text: long }], true)).not.toContain("drop-cap");
  });
  it("sets a quote as the pull quote role, its cite as a mono caption, and carries no size of its own", () => {
    const html = render([{ type: "quote", text: "Said", cite: "Someone" }]);
    expect(html).toContain('class="type-pullquote');
    expect(html).toMatch(/<figcaption class="ds-caption[^"]*">&mdash;|<figcaption class="ds-caption[^"]*">\u2014/);
    expect(html).not.toMatch(/text-xl|border-l/);
  });
  it("leaves the measure, the weights and the sizes of the body to the reading role (no utility on headings, paragraphs or lists)", () => {
    const html = render([
      { type: "heading", level: 2, text: "Notes" },
      { type: "paragraph", text: "a" },
      { type: "list", ordered: false, items: ["x"] },
    ]);
    expect(html).not.toMatch(/max-w-\[60ch\]|font-semibold|tracking-tight|text-2xl|text-xl/);
  });
  it("numbers the images in the order they appear and says the number before the caption (not before a bare image)", () => {
    const html = render([
      { type: "image", src: "/media/a/one.svg", alt: "One", width: 10, height: 10, caption: "First" },
      { type: "paragraph", text: "between" },
      { type: "image", src: "/media/a/two.svg", alt: "Two", width: 10, height: 10 },
      { type: "image", src: "/media/a/three.svg", alt: "Three", width: 10, height: 10, caption: "Third" },
    ]);
    expect(html).toContain("Fig. 1 ");
    expect(html).toContain("Fig. 3 ");
    expect(html).not.toContain("Fig. 2");
    // the figure is set under a rule, the picture is not boxed
    expect(html).toContain("entry-figure");
    expect(html).not.toMatch(/border border-border/);
    // an artwork's or a poem's image is not a flow figure: no id, no cross reference
    expect(html).not.toContain('id="fig-');
  });
  it("keeps one block per verse line and the stanza gap in em (a poem's lines are the page's type)", () => {
    const html = render([{ type: "verse", stanzas: [["a", "b"], ["c"]] }]);
    expect(html).toContain("gap-[1.4em]");
    expect((html.match(/<span class="block text-pretty"/g) ?? []).length).toBe(3);
  });
});

const renderFigures = (blocks: PublishedBodyBlock[]) => renderToStaticMarkup(createElement(BlockRenderer, { blocks, figures: true }));
const image = (n: number, caption?: string): PublishedBodyBlock => ({ type: "image", src: `/media/a/${n}.svg`, alt: `Alt ${n}`, width: 960, height: 600, ...(caption ? { caption } : {}) });

describe("BlockRenderer, figures in the flow (articles and projects)", () => {
  const blocks: PublishedBodyBlock[] = [
    { type: "paragraph", text: "First paragraph." },
    image(1, "A lamp. (Source: the author)"),
    { type: "paragraph", text: "Second, citing the lamp (Fig. 1) and a bare image (Fig. 2) and a missing one (Fig. 7)." },
    image(2),
    image(3, "The board"),
    { type: "list", ordered: false, items: ["see Figure 3", "none"] },
    { type: "quote", text: "As in Fig. 1.", cite: "Fig. 3 says" },
    { type: "code", language: "text", code: "Fig. 1" },
    { type: "link", title: "Fig. 1", url: "https://example.org/x" },
    { type: "heading", level: 2, text: "Fig. 1 in a heading" },
  ];
  const html = renderFigures(blocks);
  it("keeps each image where it is authored: right after the paragraph that precedes it in the source", () => {
    const at = (needle: string) => html.indexOf(needle);
    expect(at("First paragraph.")).toBeLessThan(at('src="/media/a/1.svg"'));
    expect(at('src="/media/a/1.svg"')).toBeLessThan(at("Second, citing"));
    expect(at("Second, citing")).toBeLessThan(at('src="/media/a/2.svg"'));
    expect(at('src="/media/a/2.svg"')).toBeLessThan(at('src="/media/a/3.svg"'));
    expect(html).not.toContain('data-slot="entry-figures"');
  });
  it("gives a captioned figure its number and its id, a bare one neither, and carries the natural width", () => {
    expect(html).toContain('id="fig-1"');
    expect(html).toContain('id="fig-3"');
    expect(html).not.toContain('id="fig-2"');
    expect((html.match(/tabindex="-1"/g) ?? []).length).toBe(2);
    expect(html).toContain("--fig-natural:960px");
    expect(html).toContain('<span class="entry-caption-label">Fig. 1</span>');
    expect(html).toContain('<span class="entry-caption-label">Fig. 3</span>');
    expect(html).not.toContain(">Fig. 2<");
  });
  it("splits the credit from the caption, and keeps the authored words", () => {
    expect(html).toContain('<span class="entry-caption-text">A lamp.</span>');
    expect(html).toContain('data-slot="entry-credit"');
    expect(html).toContain("(Source: the author)");
  });
  it("links the mentions of a figure that has an id, in paragraphs, lists and quotes, with the text unchanged", () => {
    expect(html).toContain('(<a href="#fig-1" data-slot="figure-mention" class="entry-figref">Fig. 1</a>)');
    expect(html).toContain('<a href="#fig-3" data-slot="figure-mention" class="entry-figref">Figure 3</a>');
    expect(html).toContain('As in <a href="#fig-1"');
  });
  it("leaves the mention of a bare or a missing figure, a quote's cite, a code block, a link card and a heading as text", () => {
    expect(html).toContain("(Fig. 2)");
    expect(html).toContain("(Fig. 7)");
    expect(html).toContain("— Fig. 3 says");
    expect(html).toContain("<code>Fig. 1</code>");
    expect(html).not.toMatch(/<a [^>]*href="#fig-1"[^>]*>Fig\. 1 in a heading/);
    expect((html.match(/href="#fig-/g) ?? []).length).toBe(3);
  });
  it("does not link without the flow figures (an artwork, a poem)", () => {
    expect(render(blocks.slice(0, 3))).not.toContain("#fig-");
  });
  it("has no link when no figure carries a number, and no figure for an image that cannot be drawn", () => {
    expect(renderFigures([para("See Fig. 1."), { type: "image", src: "/media/a/x.svg", alt: "x", width: 10, height: 10 }])).not.toContain("<a ");
    expect(renderFigures([{ type: "image", src: "https://evil.test/x.png", alt: "x", caption: "c" } as never])).not.toContain("<figure");
  });
  it("has no button to open a figure in the server render (the control exists once hydrated and measured)", () => {
    expect(html).not.toContain("entry-fig-zoom");
    expect(html).not.toContain("<dialog");
  });
});

const para = (text: string): PublishedBodyBlock => ({ type: "paragraph", text });

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
