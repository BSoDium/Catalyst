import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GalleryEnd, GALLERY_END_LINES, PEXELS_URL } from "./gallery-end";

describe("GalleryEnd", () => {
  const html = renderToStaticMarkup(createElement(GalleryEnd));
  it("hides the illustration and links to Pexels", () => {
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain(`href="${PEXELS_URL}"`);
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it("only blinks when motion is welcome", () => {
    expect(html).toContain("motion-safe:animate-pulse");
  });
  it("has a few lines to pick from", () => {
    expect(GALLERY_END_LINES.length).toBeGreaterThanOrEqual(3);
  });
});
