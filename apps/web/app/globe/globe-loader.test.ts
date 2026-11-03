import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GlobeLoader, LOADER } from "./globe-loader";

describe("the world view's loader", () => {
  it("is in the server's HTML (CSS shows it after a delay), with its text as a polite status", () => {
    const html = renderToStaticMarkup(createElement(GlobeLoader, { done: false, insetRight: 120 }));
    expect(html).toContain('data-slot="globe-loader"');
    expect(html).toContain('data-phase="show"');
    expect(html).toContain("Loading world view");
    expect(html).toContain('role="status"');
    expect(html).toContain("right:120px");
    expect((html.match(/<i /g) ?? []).length).toBe(8);
  });

  it("waits before it shows and fades out quickly", () => {
    expect(LOADER.delayMs).toBeGreaterThanOrEqual(300);
    expect(LOADER.leaveMs).toBeLessThan(500);
  });
});
