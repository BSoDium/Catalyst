import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { devBadgeLabel } from "~/lib/dev-badge";
import { DevContentBadge } from "./dev-content-badge";

describe("dev content badge", () => {
  it("labels preview and demo in dev builds only", () => {
    expect(devBadgeLabel("preview", true)).toBe("PREVIEW · local data · not published");
    expect(devBadgeLabel("demo", true)).toBe("DEMO · placeholder data");
    expect(devBadgeLabel("published", true)).toBeNull();
    expect(devBadgeLabel(null, true)).toBeNull();
    expect(devBadgeLabel(undefined, true)).toBeNull();
    expect(devBadgeLabel("preview", false)).toBeNull();
    expect(devBadgeLabel("demo", false)).toBeNull();
  });

  it("renders a hidden, non-interactive, bottom-left mono badge for preview and demo, nothing for published", () => {
    const html = renderToStaticMarkup(createElement(DevContentBadge, { mode: "preview" }));
    expect(html).toContain("PREVIEW · local data · not published");
    expect(html).toContain('aria-hidden="true"');
    for (const cls of ["pointer-events-none", "fixed", "bottom-2", "left-2", "font-mono"]) expect(html).toContain(cls);
    expect(renderToStaticMarkup(createElement(DevContentBadge, { mode: "demo" }))).toContain("DEMO · placeholder data");
    expect(renderToStaticMarkup(createElement(DevContentBadge, { mode: "published" }))).toBe("");
  });
});
