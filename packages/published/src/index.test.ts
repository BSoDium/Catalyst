import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getCareer, loadDemoProjection, loadPreviewProjection, loadProjection, loadPublishedProjection, previewCandidates } from "./index";
import { parsePublishedProjection } from "@catalyst/schemas";
import { MAX_SVG_BYTES, MEDIA, MEDIA_DIR, mediaSrc, renderImage, STOCK } from "../scripts/demo/generate-media.mjs";

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
  it("the committed projection is internally consistent whatever it holds (empty or published)", () => {
    const p = loadPublishedProjection();
    const places = new Set(p.places.map((x) => x.slug));
    const groups = new Set(p.groups.map((g) => g.slug));
    for (const g of p.groups) if (g.parent) expect(groups.has(g.parent), `parent of ${g.slug}`).toBe(true);
    for (const pl of p.places) if (pl.group) expect(groups.has(pl.group), `group of ${pl.slug}`).toBe(true);
    for (const e of [...p.projects, ...p.articles, ...p.artworks, ...p.poems, ...p.photographs]) {
      for (const s of e.placeSlugs ?? []) expect(places.has(s), `${e.slug} -> ${s}`).toBe(true);
    }
  });
  it("the demo has 18 entries (5 articles, 4 projects, 5 artworks, 4 poems) that together use every body block type", () => {
    const demo = loadDemoProjection();
    expect([demo.articles.length, demo.projects.length, demo.artworks.length, demo.poems.length]).toEqual([5, 4, 5, 4]);
    const all = [...demo.projects, ...demo.articles, ...demo.artworks, ...demo.poems];
    expect(new Set(all.flatMap((e) => (e.body ?? []).map((b) => b.type)))).toEqual(
      new Set(["paragraph", "heading", "list", "quote", "image", "verse", "code", "link", "divider"]),
    );
    for (const e of all) {
      expect(e.summary?.length, e.slug).toBeGreaterThanOrEqual(80);
      expect(e.summary?.length, e.slug).toBeLessThanOrEqual(220);
      expect(e.tags?.length, e.slug).toBeGreaterThanOrEqual(2);
      expect(e.tags?.length, e.slug).toBeLessThanOrEqual(6);
      expect(e.meta?.length, e.slug).toBeGreaterThan(0);
      expect(e.body?.length, e.slug).toBeGreaterThan(0);
      expect(e.placeSlugs.length, e.slug).toBeGreaterThanOrEqual(1);
      expect(e.placeSlugs.length, e.slug).toBeLessThanOrEqual(4);
      expect(e.date, e.slug).toBeDefined();
    }
    // the legacy slugs that tests and docs rely on stay, and are the first entry of their kind
    expect([demo.articles[0], demo.projects[0], demo.artworks[0], demo.poems[0]].map((e) => e?.slug)).toEqual(["demo-article", "demo-project", "demo-artwork", "demo-poem"]);
    expect(demo.places.flatMap((p) => p.related).some((r) => r.kind === "poem")).toBe(true);
  });
  it("the demo has exactly one sensitive (mature content) entry, a made-up artwork with a cover and an image block, and never writes `sensitive: false`", () => {
    const demo = loadDemoProjection();
    const all = [...demo.projects, ...demo.articles, ...demo.artworks, ...demo.poems];
    expect(all.filter((e) => e.sensitive !== undefined).map((e) => [e.slug, e.sensitive])).toEqual([["figure-study-two", true]]);
    const entry = demo.artworks.find((e) => e.sensitive)!;
    expect(entry.cover?.src).toMatch(/^\/media\/demo\/.*\.svg$/);
    expect((entry.body ?? []).some((b) => b.type === "image")).toBe(true);
    // the other artworks keep their order: the sensitive one is added last
    expect(demo.artworks.map((e) => e.slug)).toEqual(["demo-artwork", "night-platform-split", "monsoon-index", "altiplano-sediment", "figure-study-two"]);
  });
  it("the demo exercises every layout path: a long and a very short article, a long title, covers and generated art, three date precisions", () => {
    const demo = loadDemoProjection();
    const all = [...demo.projects, ...demo.articles, ...demo.artworks, ...demo.poems];
    const sizes = demo.articles.map((a) => a.body?.length ?? 0);
    expect(Math.max(...sizes)).toBeGreaterThanOrEqual(12);
    expect(Math.min(...sizes)).toBeLessThanOrEqual(2);
    expect(Math.max(...all.map((e) => e.title.length))).toBeGreaterThanOrEqual(100);
    const covered = all.filter((e) => e.cover).length;
    expect(covered / all.length).toBeGreaterThanOrEqual(0.5);
    expect(covered / all.length).toBeLessThanOrEqual(0.7);
    const precision = new Set(all.map((e) => e.date?.length));
    expect(precision).toEqual(new Set([4, 7, 10]));
    const years = all.map((e) => Number(e.date?.slice(0, 4)));
    expect(Math.min(...years)).toBe(2021);
    expect(Math.max(...years)).toBe(2026);
    expect(all.every((e) => (e.tags ?? []).every((t) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(t)))).toBe(true);
  });
  it("each kind carries its own facts: project stack, status and repository; artwork medium, year, dimensions and edition; poem language", () => {
    const demo = loadDemoProjection();
    const labels = (e: { meta?: { label: string }[] }) => (e.meta ?? []).map((m) => m.label);
    const value = (e: { meta?: { label: string; value: string }[] }, label: string) => e.meta?.find((m) => m.label === label)?.value;
    for (const p of demo.projects) expect(labels(p), p.slug).toEqual(expect.arrayContaining(["Stack", "Status", "Repository"]));
    expect(new Set(demo.projects.map((p) => value(p, "Status")))).toEqual(new Set(["Active", "Archived", "Paused"]));
    for (const a of demo.artworks) expect(labels(a), a.slug).toEqual(expect.arrayContaining(["Medium", "Year", "Dimensions", "Edition"]));
    expect(demo.poems.map((p) => value(p, "Language"))).toEqual(["English", "English", "Spanish", "French"]);
    const languages = new Set(demo.projects.flatMap((p) => (p.body ?? []).flatMap((b) => (b.type === "code" ? [b.language] : []))));
    for (const l of ["ts", "glsl", "rust", "python"]) expect(languages.has(l), l).toBe(true);
    // verse: a haiku-like poem (one stanza of three lines) and a long one (six stanzas)
    const stanzas = demo.poems.map((p) => p.body?.flatMap((b) => (b.type === "verse" ? [b.stanzas] : []))[0]?.length);
    expect(Math.min(...(stanzas as number[]))).toBe(1);
    expect(Math.max(...(stanzas as number[]))).toBe(6);
  });
  it("the demo has four photographs (a landscape, a portrait and a square, one without a place), each with a cover that has dimensions and alt text", () => {
    const demo = loadDemoProjection();
    expect(demo.photographs.map((e) => e.slug)).toEqual(["demo-photograph", "rain-at-the-gate", "sea-wall", "platform-nine"]);
    const ratios = demo.photographs.map((e) => Math.round((e.cover!.width! / e.cover!.height!) * 100) / 100);
    expect(ratios).toEqual([1.5, 0.8, 1.5, 1]);
    for (const e of demo.photographs) {
      expect(e.cover?.alt.length, e.slug).toBeGreaterThan(20);
      expect(e.placeSlugs.length, e.slug).toBeLessThanOrEqual(1);
    }
    expect(demo.photographs.filter((e) => e.placeSlugs.length === 0).map((e) => e.slug)).toEqual(["platform-nine"]);
    expect(demo.places.flatMap((p) => p.related).filter((r) => r.kind === "photograph").length).toBe(3);
  });
  it("every demo media path (place images, covers, image blocks) is a file shipped by the web app", () => {
    const demo = loadDemoProjection();
    const srcs = new Set<string>();
    for (const p of demo.places) for (const i of p.images) srcs.add(i.src);
    for (const e of [...demo.projects, ...demo.articles, ...demo.artworks, ...demo.poems, ...demo.photographs]) {
      if (e.cover) srcs.add(e.cover.src);
      for (const b of e.body ?? []) if (b.type === "image") srcs.add(b.src);
    }
    // the career's portrait is a demo file too (a hand-drawn SVG kept by the generator, not one of its images)
    if (demo.career?.portrait) srcs.add(demo.career.portrait.src);
    if (demo.career?.portrait?.dark) srcs.add(demo.career.portrait.dark.src);
    for (const item of [...(demo.career?.roles ?? []), ...(demo.career?.education ?? [])]) if (item.logo) srcs.add(item.logo.src);
    expect(srcs.size).toBeGreaterThanOrEqual(30);
    for (const src of srcs) {
      expect(src.startsWith("/media/demo/"), src).toBe(true);
      expect(existsSync(new URL(`../../../apps/web/public${src}`, import.meta.url)), src).toBe(true);
    }
    // nothing in the demo media folder is orphaned
    const shipped = readdirSync(MEDIA_DIR).map((f) => `/media/demo/${f}`);
    expect(shipped.filter((f) => !srcs.has(f))).toEqual([]);
  });
  it("the demo's stock photographs are on disk, credited (here and in the notice file), small, and not generated", () => {
    const notice = readFileSync(new URL("../../../apps/web/public/media/demo-stock.NOTICE.txt", import.meta.url), "utf8");
    for (const photo of STOCK) {
      const file = join(MEDIA_DIR, photo.file);
      expect(existsSync(file), photo.file).toBe(true);
      expect(statSync(file).size, photo.file).toBeLessThan(250 * 1024);
      expect(photo.source, photo.name).toMatch(/^https:\/\/www\.pexels\.com\/photo\//);
      expect(notice, photo.name).toContain(photo.file);
      expect(notice, photo.name).toContain(photo.source);
      expect(MEDIA.some((m) => m.name === photo.name)).toBe(false);
    }
  });
  it("the demo images are the ones the generator writes (deterministic, each under 12 KB), sized as the fixture says", () => {
    const demo = loadDemoProjection();
    for (const image of MEDIA) {
      const svg = renderImage(image);
      expect(renderImage(image), image.name).toBe(svg);
      expect(Buffer.byteLength(svg), image.name).toBeLessThanOrEqual(MAX_SVG_BYTES);
      expect(readFileSync(join(MEDIA_DIR, `${image.name}.svg`), "utf8"), image.name).toBe(svg);
      expect(svg).toContain(`viewBox="0 0 ${image.size[0]} ${image.size[1]}"`);
    }
    // the fixture declares the generator's alt text and size for each image it uses
    const byName = new Map<string, { size: readonly [number, number]; alt: string }>([...MEDIA.map((m) => [mediaSrc(m.name), m] as const), ...STOCK.map((m) => [`/media/demo/${m.file}`, m] as const)]);
    for (const e of [...demo.projects, ...demo.articles, ...demo.artworks, ...demo.poems, ...demo.photographs]) {
      const used = [...(e.cover ? [e.cover] : []), ...(e.body ?? []).flatMap((b) => (b.type === "image" ? [b] : []))];
      for (const u of used) {
        const m = byName.get(u.src);
        expect(m, u.src).toBeDefined();
        expect([u.width, u.height], u.src).toEqual([...m!.size]);
        expect(u.alt, u.src).toBe(m!.alt);
      }
    }
  });
  it("the demo is plainly made up: every external address is on an example domain and no entry link is a real site", () => {
    const demo = loadDemoProjection();
    const urls: string[] = [];
    for (const e of [...demo.projects, ...demo.articles, ...demo.artworks, ...demo.poems, ...demo.photographs]) {
      if (e.url) urls.push(e.url);
      for (const b of e.body ?? []) if (b.type === "link") urls.push(b.url);
    }
    expect(urls.length).toBeGreaterThan(15);
    for (const u of urls) expect(new URL(u).hostname, u).toMatch(/^(?:[a-z0-9-]+\.)*example\.(?:org|com)$/);
    // no stray placeholder wording in the copy
    const text = JSON.stringify([demo.projects, demo.articles, demo.artworks, demo.poems]);
    expect(text).not.toMatch(/lorem|ipsum|demo fixture|placeholder/i);
  });
});

describe("career", () => {
  it("the committed projection may carry the owner's career (it is present once published), and an old projection stays valid without it", () => {
    // (the committed file is written by the publication workflow: with a career once the owner publishes the document, without one before)
    expect(getCareer("published")).toEqual(loadPublishedProjection().career);
    const { career: _omit, ...withoutCareer } = loadDemoProjection();
    expect(parsePublishedProjection(JSON.parse(JSON.stringify(withoutCareer)))).not.toHaveProperty("career");
  });

  it("the demo has a plainly fictional career that uses every field of the contract", () => {
    const career = getCareer("demo")!;
    expect(career).toBeDefined();
    expect(career).toEqual(loadDemoProjection().career);
    const roles = career.roles;
    expect(roles.length).toBeGreaterThanOrEqual(4);
    // an ongoing role, a role with no end, a closed one, a year-only start, a month start
    expect(roles.some((r) => r.end === "present")).toBe(true);
    expect(roles.some((r) => r.end === undefined)).toBe(true);
    expect(roles.some((r) => r.end !== undefined && r.end !== "present")).toBe(true);
    expect(new Set(roles.map((r) => r.start.length))).toEqual(new Set([4, 7]));
    expect(roles.some((r) => r.orgUrl !== undefined) && roles.some((r) => r.orgUrl === undefined)).toBe(true);
    expect(roles.some((r) => r.employment !== undefined) && roles.some((r) => r.employment === undefined)).toBe(true);
    expect(roles.some((r) => r.place !== undefined) && roles.some((r) => r.place === undefined)).toBe(true);
    expect(roles.some((r) => r.highlights.length === 0)).toBe(true);
    expect(career.availability).toEqual({ text: "Open to example opportunities", asOf: "2026-09" });
    // the portrait is the blueprint drawing in the demo's media folder, with its real size
    expect(career.portrait).toMatchObject({ src: "/media/demo/portrait-example.svg", width: 940, height: 640 });
    expect(career.education.length).toBeGreaterThanOrEqual(2);
    expect(career.education.some((e) => e.place !== undefined)).toBe(true);
    expect(career.languages.some((l) => l.label !== undefined) && career.languages.some((l) => l.label === undefined)).toBe(true);
    expect(career.skills.length).toBeGreaterThanOrEqual(3);
    expect(career.links.length).toBeGreaterThanOrEqual(2);
  });

  it("the demo career is plainly made up: every address is on an example domain, every place reference is a place of the demo", () => {
    const demo = loadDemoProjection();
    const career = demo.career!;
    const urls = [...career.links.map((l) => l.url), ...career.roles.flatMap((r) => (r.orgUrl ? [r.orgUrl] : []))];
    expect(urls.length).toBeGreaterThanOrEqual(4);
    for (const u of urls) expect(new URL(u).hostname, u).toMatch(/^(?:[a-z0-9-]+\.)*example\.(?:org|com)$/);
    const places = new Set(demo.places.map((p) => p.slug));
    for (const slug of [...career.roles, ...career.education].flatMap((x) => (x.place ? [x.place] : []))) expect(places.has(slug), slug).toBe(true);
    expect(career.roles.map((r) => r.org)).toContain("Example Studio");
    expect(JSON.stringify(career)).not.toMatch(/lorem|ipsum|@|\+\d{2}|tel:|mailto:/i);
    expect(Object.keys(career)).not.toEqual(expect.arrayContaining(["email", "phone", "address"]));
  });

  it("the demo career is small (a few KB), and the demo projection still validates strictly", () => {
    const bytes = Buffer.byteLength(JSON.stringify(loadDemoProjection().career));
    expect(bytes).toBeGreaterThan(1500);
    expect(bytes).toBeLessThan(8000);
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
