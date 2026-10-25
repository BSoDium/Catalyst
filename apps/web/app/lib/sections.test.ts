import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CONTENT_KINDS, COLLECTIONS, KIND_LABELS, KIND_NOUNS, KIND_PATHS, KIND_PLURALS, entryPath, kindCount, parsePanelPath } from "./entries";
import { ENTRY_KIND_LABEL } from "./entry-kind";
import { ENTRY_KINDS as LABEL_KINDS } from "~/globe/engine/label-sub";
import { SEARCH_LABELS, SEARCH_SINGULAR } from "./search";
import { SECTIONS } from "./sections";

const appDir = fileURLToPath(new URL("..", import.meta.url));
const webDir = join(appDir, "..");

describe("the sections' table (the section's name is not the contract's kind id)", () => {
  it("pins each kind's address, names and count nouns", () => {
    expect(
      Object.fromEntries(CONTENT_KINDS.map((k) => [k, { path: KIND_PATHS[k], label: KIND_LABELS[k], name: KIND_PLURALS[k], noun: KIND_NOUNS[k] }])),
    ).toEqual({
      project: { path: "/software", label: "Software", name: "Software", noun: { one: "software", many: "software" } },
      article: { path: "/articles", label: "Article", name: "Articles", noun: { one: "article", many: "articles" } },
      artwork: { path: "/artworks", label: "Artwork", name: "Artworks", noun: { one: "artwork", many: "artworks" } },
      poem: { path: "/poetry", label: "Poem", name: "Poetry", noun: { one: "poem", many: "poems" } },
      photograph: { path: "/photography", label: "Photograph", name: "Photography", noun: { one: "photograph", many: "photographs" } },
    });
  });
  it("keeps the contract's ids: the kind is still `project`, the collection still `projects`, and the former addresses are recorded", () => {
    expect([...CONTENT_KINDS]).toEqual(["article", "project", "artwork", "poem", "photograph"]);
    expect(COLLECTIONS.project).toBe("projects");
    expect(COLLECTIONS.poem).toBe("poems");
    expect(COLLECTIONS.photograph).toBe("photographs");
    expect(SECTIONS.photograph.formerSlugs).toEqual([]);
    expect(SECTIONS.project.formerSlugs).toEqual(["projects"]);
    expect(SECTIONS.poem.formerSlugs).toEqual(["poems"]);
  });
  it("says counts without a plural for software, and with one for the others", () => {
    expect([kindCount("project", 0), kindCount("project", 1), kindCount("project", 33)]).toEqual(["0 software", "1 software", "33 software"]);
    expect([kindCount("article", 1), kindCount("article", 2)]).toEqual(["1 article", "2 articles"]);
  });
  it("gives every kind its own address, none of them a former address, and routes the entry paths back to the kind", () => {
    const slugs = CONTENT_KINDS.map((k) => SECTIONS[k].slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const former = CONTENT_KINDS.flatMap((k) => SECTIONS[k].formerSlugs);
    for (const slug of slugs) expect(former, slug).not.toContain(slug);
    for (const kind of CONTENT_KINDS) expect(parsePanelPath(entryPath(kind, "x"))).toEqual({ type: "entry", kind, slug: "x" });
  });
  it("is the one source of every reader-facing name", () => {
    for (const kind of CONTENT_KINDS) {
      expect(ENTRY_KIND_LABEL[kind], kind).toBe(SECTIONS[kind].label);
      expect(SEARCH_LABELS[kind], kind).toBe(SECTIONS[kind].name);
      expect(SEARCH_SINGULAR[kind], kind).toBe(SECTIONS[kind].label);
    }
  });
  it("is what the globe's label table says for the kinds it counts (the engine imports nothing from the app)", () => {
    for (const row of LABEL_KINDS) {
      const kind = row.kind as keyof typeof SECTIONS;
      expect(SECTIONS[kind], row.kind).toBeDefined();
      expect({ one: row.one, many: row.many }, row.kind).toEqual(SECTIONS[kind].noun);
    }
  });
  it("is declared in routes.ts: a list route and an entry route per section, and a redirect per former address", () => {
    const routes = readFileSync(join(appDir, "routes.ts"), "utf8");
    for (const kind of CONTENT_KINDS) {
      const { slug, formerSlugs } = SECTIONS[kind];
      expect(routes, slug).toContain(`route("${slug}", `);
      expect(routes, slug).toContain(`route("${slug}/:slug", `);
      for (const old of formerSlugs) {
        expect(routes, old).toContain(`route("${old}", "routes/legacy-`);
        expect(routes, old).toContain(`route("${old}/:slug", "routes/legacy-`);
      }
    }
  });
});

/**
 * "Every place that used the old plural now goes through the table": the web app's sources and browser scripts name the section's
 * address, label and count words nowhere on their own. A hard-coded `/projects` or "Projects" is a failure here, unless the file is one
 * of the few that are ABOUT the old name (the table, the redirects, and this check).
 */
function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".react-router" || entry.name === "build") continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx|mjs)$/.test(entry.name)) yield p;
  }
}

const OLD_NAME_FILES = new Set([
  "app/lib/sections.ts",
  "app/lib/legacy-paths.ts",
  "app/lib/legacy-paths.test.ts",
  "app/lib/sections.test.ts",
  // these assert that the old address is NOT a panel route / not in the sitemap
  "app/lib/entries.test.ts",
  "app/lib/sitemap.test.ts",
  "app/routes.ts",
  "app/routes/legacy-projects.ts",
  // the browser check asserts the redirects of the old addresses (and that the list says Software)
  "scripts/entries/check.mjs",
  // the production check asserts the redirects and that the sitemap lists nothing under the old address
  "scripts/prod/check.mjs",
]);

function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");
}

describe("no hard-coded old section name", () => {
  const files = [...walk(join(webDir, "app")), ...walk(join(webDir, "scripts"))].map((p) => [relative(webDir, p).split("\\").join("/"), p] as const);
  it("finds sources to scan", () => {
    expect(files.length).toBeGreaterThan(100);
  });
  it("has no /projects address and no \"Project(s)\" label outside the table, the redirects and the contract's own fields", () => {
    const offenders: string[] = [];
    for (const [name, path] of files) {
      if (OLD_NAME_FILES.has(name)) continue;
      const text = code(readFileSync(path, "utf8"));
      // an address (`"/projects"`, `/projects/x`, `href="/projects"`) or a title-case label inside a string or JSX text
      const address = /["'`(=]\/projects\b/.test(text);
      const label = /["'`>]\s*Projects?\b/.test(text);
      if (address || label) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });
});
