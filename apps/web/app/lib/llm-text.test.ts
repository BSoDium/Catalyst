import { describe, expect, it } from "vitest";
import { loadDemoProjection } from "@catalyst/published/dev";
import type { PublishedBodyBlock } from "@catalyst/schemas";
import { getEntryDetail } from "./entries";
import { careerMarkdown, entryMarkdown, listMarkdown, llmsTxt, markdownPath, placeMarkdown } from "./llm-text";
import { getPlaceDetail } from "./projection";

const ORIGIN = "https://example.test";
const projection = loadDemoProjection();

describe("markdownPath", () => {
  it("adds .md to a page path", () => {
    expect(markdownPath("/articles")).toBe("/articles.md");
    expect(markdownPath("/articles/a-b")).toBe("/articles/a-b.md");
    expect(markdownPath("/career/")).toBe("/career.md");
  });
});

describe("llmsTxt", () => {
  const txt = llmsTxt(projection, ORIGIN);
  it("follows the llms.txt shape: an H1, a blockquote, then H2 sections of links", () => {
    const lines = txt.split("\n");
    expect(lines[0]).toMatch(/^# \S/);
    expect(lines[2]).toMatch(/^> /);
    expect(txt).toMatch(/\n## About\n/);
    expect(txt).toMatch(/\n## Optional\n/);
  });
  it("links every place and every entry to its Markdown twin, absolute, once", () => {
    for (const p of projection.places) expect(txt).toContain(`(${ORIGIN}/locations/${p.slug}.md)`);
    for (const e of projection.articles) expect(txt.split(`(${ORIGIN}/articles/${e.slug}.md)`).length - 1).toBe(1);
    expect(txt).toContain(`(${ORIGIN}/career.md)`);
  });
  it("says nothing of coordinates", () => {
    expect(txt).not.toMatch(/-?\d{1,3}\.\d{2,}, ?-?\d{1,3}\.\d{2,}/);
  });
  it("is just the site's header for an empty projection", () => {
    const empty = llmsTxt({ ...projection, places: [], articles: [], projects: [], artworks: [], poems: [], photographs: [], career: undefined }, ORIGIN);
    expect(empty).not.toContain("## ");
    expect(empty.startsWith("# ")).toBe(true);
  });
});

describe("entryMarkdown", () => {
  it("renders every body block type of the demo content, and states the copyright of writing", () => {
    const article = projection.articles.find((a) => a.body?.some((b) => b.type === "quote")) ?? projection.articles[0]!;
    const md = entryMarkdown(getEntryDetail(projection, "article", article.slug)!, ORIGIN);
    expect(md.startsWith(`# ${article.title}\n`)).toBe(true);
    expect(md).toContain(`- Page: ${ORIGIN}/articles/${article.slug}`);
    expect(md).toMatch(/All rights reserved/);
  });
  it("covers each block type", () => {
    const blocks: PublishedBodyBlock[] = [
      { type: "paragraph", text: "P" },
      { type: "heading", level: 3, text: "H" },
      { type: "list", ordered: true, items: ["a", "b"] },
      { type: "quote", text: "Q", cite: "C" },
      { type: "image", src: "/media/x.webp", alt: "Alt [1]", caption: "Cap" },
      { type: "verse", stanzas: [["one", "two"], ["three"]] },
      { type: "code", language: "ts", code: "const a = ```x```;" },
      { type: "link", title: "L1", url: "https://a.test/" },
      { type: "link", title: "L2", url: "https://b.test/", description: "d" },
      { type: "divider" },
    ];
    const base = getEntryDetail(projection, "article", projection.articles[0]!.slug)!;
    const md = entryMarkdown({ ...base, body: blocks }, ORIGIN);
    expect(md).toContain("\n\n### H\n\n");
    expect(md).toContain("1. a\n2. b");
    expect(md).toContain("> Q\n> — C");
    expect(md).toContain(`![Alt \\[1\\]](${ORIGIN}/media/x.webp)\n*Cap*`);
    expect(md).toContain("one  \ntwo\n\nthree");
    // the code cannot close its own fence
    expect(md).toContain("````ts\nconst a = ```x```;\n````");
    // consecutive links are one list
    expect(md).toContain("- [L1](https://a.test/)\n- [L2](https://b.test/): d");
    expect(md).toContain("\n\n---\n\n");
  });
  it("leaves the images of a sensitive entry out, alt text included, and says so", () => {
    const base = getEntryDetail(projection, "article", projection.articles[0]!.slug)!;
    const md = entryMarkdown({ ...base, sensitive: true, body: [{ type: "image", src: "/media/x.webp", alt: "A secret", caption: "C" }, { type: "paragraph", text: "Text stays" }] }, ORIGIN);
    expect(md).not.toContain("secret");
    expect(md).not.toContain("/media/x.webp");
    expect(md).toContain("Text stays");
    expect(md).toMatch(/blurred/);
  });
});

describe("entryMarkdown: cover, related, neighbours", () => {
  const base = () => getEntryDetail(projection, "article", projection.articles[0]!.slug)!;
  const cover = { src: "/media/c.webp", alt: "A cover" };
  const ref = (slug: string) => ({ kind: "article" as const, slug, title: `T ${slug}`, href: `/articles/${slug}`, index: 1 });
  it("shows the cover, once, and not when the entry is sensitive or the body already has it", () => {
    expect(entryMarkdown({ ...base(), cover, body: [] }, ORIGIN)).toContain(`![A cover](${ORIGIN}/media/c.webp)`);
    const inBody = entryMarkdown({ ...base(), cover, body: [{ type: "image", src: cover.src, alt: "A cover" }] }, ORIGIN);
    expect(inBody.split("/media/c.webp").length - 1).toBe(1);
    expect(entryMarkdown({ ...base(), cover, sensitive: true, body: [] }, ORIGIN)).not.toContain("/media/c.webp");
  });
  it("links related, previous and next entries to their twins", () => {
    const md = entryMarkdown({ ...base(), related: [ref("r")], prev: ref("p"), next: ref("n") }, ORIGIN);
    expect(md).toContain(`## Related\n\n- [T r](${ORIGIN}/articles/r.md)`);
    expect(md).toContain(`Previous: [T p](${ORIGIN}/articles/p.md)  \nNext: [T n](${ORIGIN}/articles/n.md)`);
  });
});

describe("placeMarkdown", () => {
  it("has the name, its entries as links to their twins, and no coordinates", () => {
    const place = projection.places.find((p) => getPlaceDetail(projection, p.slug)!.entries.length > 0)!;
    const detail = getPlaceDetail(projection, place.slug)!;
    const md = placeMarkdown(detail, ORIGIN);
    expect(md.startsWith("# ")).toBe(true);
    expect(md).toContain(`${ORIGIN}/locations/${place.slug}`);
    expect(md).toMatch(/\]\(https:\/\/example\.test\/[a-z]+\/[a-z0-9-]+\.md\)/);
    expect(md).not.toContain(String(place.coordinates.lat));
    expect(md).not.toMatch(/\blat(itude)?\b/i);
  });
});

describe("listMarkdown and careerMarkdown", () => {
  it("lists a section's entries as links to their twins", () => {
    const md = listMarkdown("article", projection.articles.map((a, i) => ({ kind: "article" as const, slug: a.slug, href: `/articles/${a.slug}`, index: i + 1, title: a.title, tags: [], meta: [], places: [] })), ORIGIN);
    expect(md).toContain("# Articles");
    expect(md).toContain(`(${ORIGIN}/articles/${projection.articles[0]!.slug}.md)`);
  });
  it("says so when a section is empty", () => {
    expect(listMarkdown("poem", [], ORIGIN)).toContain("Nothing here yet.");
  });
  it("renders the career document without any contact detail", () => {
    const md = careerMarkdown(projection.career!, ORIGIN);
    expect(md).toContain("## Experience");
    expect(md).not.toMatch(/@|mailto:|tel:/);
  });
});
