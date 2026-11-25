import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownLink } from "./markdown-link";

describe("MarkdownLink", () => {
  const html = renderToStaticMarkup(createElement(MarkdownLink, { path: "/articles/a-b" }));

  it("is a real, server-rendered link to the page's Markdown twin, announced as its alternate, never printed", () => {
    expect(html).toMatch(/^<a href="\/articles\/a-b\.md" rel="alternate" type="text\/markdown" data-slot="markdown-link" class="file-link print:hidden"/);
  });

  it("keeps its words as visible text (what an HTML-to-text tool keeps), the tile out of the name", () => {
    const visible = html.replace(/<span aria-hidden="true".*?<\/span>/, "").replace(/<[^>]+>/g, "");
    expect(visible).toBe("Read as Markdown");
    expect(html).not.toMatch(/sr-only/);
  });
});
