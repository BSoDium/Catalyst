import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadDemoProjection, loadPreviewProjection, loadProjection, loadPublishedProjection, previewCandidates } from "./index";

describe("published package", () => {
  it("loads and validates the committed projection", () => {
    expect(loadPublishedProjection().schemaVersion).toBe(1);
  });
  it("loads and validates the demo fixture", () => {
    const demo = loadDemoProjection();
    expect(demo.places.length).toBeGreaterThan(5);
    expect(demo.groups.length).toBeGreaterThan(0);
    expect(demo.routes[0]?.stops.length).toBeGreaterThan(1);
  });
  it("the demo hierarchy exercises every group kind, with collapsed levels and an ungrouped place", () => {
    const demo = loadDemoProjection();
    expect(new Set(demo.groups.map((g) => g.kind))).toEqual(new Set(["continent", "subregion", "region", "country", "area"]));
    // Every group has at least two children (collapse rule), so no square repeats its only child.
    const children = new Map<string, number>();
    for (const g of demo.groups) if (g.parent) children.set(g.parent, (children.get(g.parent) ?? 0) + 1);
    for (const p of demo.places) if (p.group) children.set(p.group, (children.get(p.group) ?? 0) + 1);
    for (const g of demo.groups) expect(children.get(g.slug) ?? 0, g.slug).toBeGreaterThanOrEqual(2);
    expect(demo.places.filter((p) => p.group === undefined).map((p) => p.slug)).toEqual(["cape-town", "wellington"]);
  });
  it("the committed (empty) projection has no groups and no poems", () => {
    expect(loadPublishedProjection().groups).toEqual([]);
    expect(loadPublishedProjection().poems).toEqual([]);
  });
  it("the demo has entries of all four kinds that together use every body block type, cover, tags and meta", () => {
    const demo = loadDemoProjection();
    const all = [...demo.projects, ...demo.articles, ...demo.artworks, ...demo.poems];
    expect([demo.projects.length, demo.articles.length, demo.artworks.length, demo.poems.length].every((n) => n >= 1)).toBe(true);
    expect(new Set(all.flatMap((e) => (e.body ?? []).map((b) => b.type)))).toEqual(
      new Set(["paragraph", "heading", "list", "quote", "image", "verse", "code", "link", "divider"]),
    );
    expect(demo.poems[0]!.body?.some((b) => b.type === "verse")).toBe(true);
    for (const e of all) {
      expect(e.cover, e.slug).toBeDefined();
      expect(e.tags?.length, e.slug).toBeGreaterThan(0);
      expect(e.meta?.length, e.slug).toBeGreaterThan(0);
      expect(e.placeSlugs.length, e.slug).toBeGreaterThan(0);
    }
    expect(demo.places.flatMap((p) => p.related).some((r) => r.kind === "poem")).toBe(true);
  });
  it("every demo media path (place images, covers, image blocks) is a file shipped by the web app", () => {
    const demo = loadDemoProjection();
    const srcs = new Set<string>();
    for (const p of demo.places) for (const i of p.images) srcs.add(i.src);
    for (const e of [...demo.projects, ...demo.articles, ...demo.artworks, ...demo.poems]) {
      if (e.cover) srcs.add(e.cover.src);
      for (const b of e.body ?? []) if (b.type === "image") srcs.add(b.src);
    }
    expect(srcs.size).toBeGreaterThanOrEqual(6);
    for (const src of srcs) {
      expect(src.startsWith("/media/demo/"), src).toBe(true);
      expect(existsSync(new URL(`../../../apps/web/public${src}`, import.meta.url)), src).toBe(true);
    }
  });
  it("the demo text says it is placeholder content", () => {
    const demo = loadDemoProjection();
    for (const e of [...demo.projects, ...demo.articles, ...demo.artworks, ...demo.poems]) {
      expect(JSON.stringify(e.summary), e.slug).toMatch(/Demo fixture/);
      const first = e.body?.[0];
      expect(first && "text" in first ? first.text : JSON.stringify(first), e.slug).toMatch(/Demo fixture|made up|placeholder/i);
    }
  });
});

describe("loadPreviewProjection", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });
  const tmpFile = (content: unknown) => {
    const d = mkdtempSync(join(tmpdir(), "catalyst-preview-"));
    dirs.push(d);
    const f = join(d, "preview.projection.json");
    writeFileSync(f, typeof content === "string" ? content : JSON.stringify(content));
    return f;
  };
  const tiny = {
    schemaVersion: 1,
    places: [{ slug: "somewhere", name: "Somewhere", coordinates: { lat: 1, lon: 2 }, labelPriority: 50, body: [], images: [], related: [] }],
    groups: [],
    routes: [],
    projects: [],
    articles: [],
    artworks: [],
  };

  it("reads and validates the file at call time", () => {
    const f = tmpFile(tiny);
    expect(loadPreviewProjection({ path: f, env: {} }).places.map((p) => p.slug)).toEqual(["somewhere"]);
    writeFileSync(f, JSON.stringify({ ...tiny, places: [] }));
    expect(loadPreviewProjection({ path: f, env: {} }).places).toEqual([]);
  });

  it("is reachable through loadProjection('preview') and leaves the other modes alone", () => {
    expect(loadProjection("published")).toEqual(loadPublishedProjection());
    expect(loadProjection("demo")).toEqual(loadDemoProjection());
    // The real file may or may not exist on this machine: either it validates or the error says how to create it.
    try {
      expect(loadProjection("preview").schemaVersion).toBe(1);
    } catch (e) {
      expect((e as Error).message).toContain("pnpm export:preview");
    }
  });

  it("explains how to create the file when it is missing", () => {
    expect(() => loadPreviewProjection({ path: join(tmpdir(), "definitely-missing", "preview.projection.json"), env: {} })).toThrow(
      /run `pnpm export:preview --out <this repo>` in the private content repo/,
    );
  });

  it("rejects a file that breaks the contract", () => {
    expect(() => loadPreviewProjection({ path: tmpFile({ ...tiny, places: [{ ...tiny.places[0], coordinates: { lat: 999, lon: 0 } }] }), env: {} })).toThrow();
    expect(() => loadPreviewProjection({ path: tmpFile("not json"), env: {} })).toThrow();
  });

  it("refuses in production, even when the file exists, unless CATALYST_ALLOW_PREVIEW=1", () => {
    const f = tmpFile(tiny);
    expect(() => loadPreviewProjection({ path: f, env: { NODE_ENV: "production" } })).toThrow(/refused in production/);
    expect(() => loadPreviewProjection({ path: f, env: { NODE_ENV: "production", CATALYST_ALLOW_PREVIEW: "0" } })).toThrow(/refused in production/);
    expect(loadPreviewProjection({ path: f, env: { NODE_ENV: "production", CATALYST_ALLOW_PREVIEW: "1" } }).places).toHaveLength(1);
    expect(loadPreviewProjection({ path: f, env: { NODE_ENV: "development" } }).places).toHaveLength(1);
  });

  it("looks for the file in this package's data dir first, then upward from the working directory", () => {
    const c = previewCandidates();
    expect(c[0]!.endsWith(join("packages", "published", "data", "preview.projection.json"))).toBe(true);
    expect(c.every((p) => p.endsWith("preview.projection.json"))).toBe(true);
  });

  it("is never statically imported: no module in src imports the preview file", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const dir = new URL(".", import.meta.url);
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))) {
      const text = readFileSync(new URL(f, dir), "utf8");
      expect(text, f).not.toMatch(/(import|from)\s+[^;\n]*preview\.projection/);
    }
  });
});
