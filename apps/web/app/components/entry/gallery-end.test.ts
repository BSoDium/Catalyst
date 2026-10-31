import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GalleryEnd, GALLERY_END_LINES, GALLERY_END_TITLE, PEXELS_URL } from "./gallery-end";

describe("GalleryEnd", () => {
  const html = renderToStaticMarkup(createElement(GalleryEnd));
  it("says it is the end and links to Pexels in a new tab", () => {
    expect(html).toContain(GALLERY_END_TITLE.replace("'", "&#x27;"));
    expect(html).toContain(`href="${PEXELS_URL}"`);
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("(opens in a new tab)");
  });
  it("draws no illustration of its own: the photographs above it are the picture", () => {
    expect(html).not.toContain("<img");
  });
  it("has a few lines to pick from", () => {
    expect(GALLERY_END_LINES.length).toBeGreaterThanOrEqual(3);
  });
});
