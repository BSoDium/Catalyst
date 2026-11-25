import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownLink } from "./markdown-link";

describe("MarkdownLink", () => {
  const html = renderToStaticMarkup(createElement(MarkdownLink, { path: "/articles/a-b" }));

  it("is a real, server-rendered link to the page's Markdown twin, announced as its alternate", () => {
    expect(html).toMatch(/<a href="\/articles\/a-b\.md" rel="alternate" type="text\/markdown"/);
  });

  it("keeps its words as visible text (what an HTML-to-text tool keeps), the tile out of the name", () => {
    const anchor = html.match(/<a [^>]*>(.*?)<\/a>/)![1]!;
    const visible = anchor.replace(/<span aria-hidden="true".*?<\/span>/, "").replace(/<[^>]+>/g, "");
    expect(visible).toBe("Read as Markdown");
    expect(anchor).not.toMatch(/sr-only/);
  });

  it("is a line of its own by default and a span inside a row, never printed", () => {
    expect(html).toMatch(/^<p data-slot="markdown-link" data-placement="foot" class="markdown-link print:hidden"/);
    const inline = renderToStaticMarkup(createElement(MarkdownLink, { path: "/career", placement: "inline" }));
    expect(inline).toMatch(/^<span data-slot="markdown-link" data-placement="inline" class="markdown-link print:hidden"/);
    const end = renderToStaticMarkup(createElement(MarkdownLink, { path: "/articles", placement: "end" }));
    expect(end).toMatch(/^<p data-slot="markdown-link" data-placement="end" class="markdown-link print:hidden"/);
  });
});
