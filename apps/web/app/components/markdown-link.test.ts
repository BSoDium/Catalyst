import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownLink } from "./markdown-link";

describe("MarkdownLink", () => {
  const html = renderToStaticMarkup(createElement(MarkdownLink, { path: "/articles/a-b" }));

  it("is a real, server-rendered link to the page's Markdown twin, announced as its alternate", () => {
    expect(html).toMatch(/^<a href="\/articles\/a-b\.md" rel="alternate" type="text\/markdown" data-slot="markdown-link"/);
  });

  it("says what it is in plain visible words, which are its whole name (what an HTML-to-text tool keeps)", () => {
    expect(html.replace(/<[^>]+>/g, "")).toBe("This page in Markdown");
    expect(html).not.toMatch(/sr-only|aria-label|aria-hidden/);
  });
});
