import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ARTSTATION_URL, ARTWORK_END_LINES, ARTWORK_END_TITLE, GalleryEnd, GALLERY_END_LINES, GALLERY_END_TITLE, PEXELS_URL } from "./gallery-end";

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

describe("GalleryEnd, for the artworks", () => {
  const html = renderToStaticMarkup(createElement(GalleryEnd, { kind: "artwork" }));
  it("says it is the end of the wall and links to ArtStation in a new tab, not to Pexels", () => {
    expect(html).toContain(ARTWORK_END_TITLE.replace("'", "&#x27;"));
    expect(html).toContain(`href="${ARTSTATION_URL}"`);
    expect(html).not.toContain(PEXELS_URL);
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("(opens in a new tab)");
  });
  it("has a few lines to pick from", () => {
    expect(ARTWORK_END_LINES.length).toBeGreaterThanOrEqual(3);
  });
});

