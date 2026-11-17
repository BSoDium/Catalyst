import { describe, expect, it } from "vitest";
import { loadProjection } from "@catalyst/published/dev";
import { prerenderPaths } from "./prerender-paths";

describe("the paths built to static files", () => {
  const projection = loadProjection("published");
  const paths = prerenderPaths(projection);
  it("are the home page, the lists, every entry and every place, once each, plus the routes' file", () => {
    expect(paths).toContain("/");
    for (const list of ["/software", "/articles", "/artworks", "/poetry", "/photography"]) expect(paths).toContain(list);
    expect(paths).toContain("/globe-routes.json");
    for (const a of projection.articles) expect(paths).toContain(`/articles/${a.slug}`);
    for (const p of projection.places) expect(paths).toContain(`/locations/${p.slug}`);
    expect(new Set(paths).size).toBe(paths.length);
  });
  it("are paths (no origin, no query)", () => {
    for (const p of paths) expect(p).toMatch(/^\/[^?#]*$/);
  });
});
