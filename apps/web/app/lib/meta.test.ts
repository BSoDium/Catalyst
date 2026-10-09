import { describe, expect, it } from "vitest";
import type { EntryDetail } from "./entries";
import { entryMeta } from "./entry-meta";
import { absoluteUrl, pageMeta } from "./meta";

const find = (tags: ReturnType<typeof pageMeta>, key: "name" | "property", value: string) =>
  tags.find((t) => key in t && (t as Record<string, string>)[key] === value) as { content: string } | undefined;

describe("pageMeta", () => {
  it("keeps the text tags and adds no image tag without a cover", () => {
    const tags = pageMeta({ title: "Demo", description: "About it" });
    expect(tags[0]).toEqual({ title: "Demo · Catalyst" });
    expect(find(tags, "name", "description")?.content).toBe("About it");
    expect(find(tags, "property", "og:type")?.content).toBe("website");
    expect(find(tags, "property", "og:image")).toBeUndefined();
    expect(find(tags, "name", "twitter:card")).toBeUndefined();
  });
  it("adds og:image only when given one, absolute when the origin is known", () => {
    const tags = pageMeta({ title: "Demo", image: { src: "/media/demo/cover.svg", alt: "A cover" }, origin: "https://v2.bsodium.fr" });
    expect(find(tags, "property", "og:image")?.content).toBe("https://v2.bsodium.fr/media/demo/cover.svg");
    expect(find(tags, "property", "og:image:alt")?.content).toBe("A cover");
    expect(find(tags, "name", "twitter:card")?.content).toBe("summary_large_image");
  });
  it("sets the Open Graph type for an article", () => {
    expect(find(pageMeta({ title: "T", type: "article" }), "property", "og:type")?.content).toBe("article");
  });
  it("without a usable origin the path stays as it is", () => {
    expect(absoluteUrl("/media/x.svg", undefined)).toBe("/media/x.svg");
    expect(absoluteUrl("/media/x.svg", "not an origin")).toBe("/media/x.svg");
  });
});

describe("entryMeta", () => {
  const entry = (over: Partial<EntryDetail>): EntryDetail => ({
    kind: "article", slug: "a", href: "/articles/a", index: 1, title: "A title", tags: [], meta: [], places: [], body: [], related: [], prev: null, next: null, ...over,
  });
  it("uses the summary as the description and a kind-based fallback", () => {
    expect(find(entryMeta({ entry: entry({ summary: "About it" }) }), "name", "description")?.content).toBe("About it");
    expect(find(entryMeta({ entry: entry({ kind: "poem" }) }), "name", "description")?.content).toBe("Poem from the Catalyst archive.");
  });
  it("has an image tag only for an authored cover on a safe /media/ path", () => {
    expect(find(entryMeta({ entry: entry({}) }), "property", "og:image")).toBeUndefined();
    const cover = { src: "/media/demo/c.svg", alt: "Alt", width: 10, height: 5 };
    expect(find(entryMeta({ entry: entry({ cover }), origin: "https://x.test" }), "property", "og:image")?.content).toBe("https://x.test/media/demo/c.svg");
    expect(find(entryMeta({ entry: entry({ cover: { ...cover, src: "/media/../x.svg" } }) }), "property", "og:image")).toBeUndefined();
  });
  it("types an article as an article and the rest as a website", () => {
    expect(find(entryMeta({ entry: entry({}) }), "property", "og:type")?.content).toBe("article");
    expect(find(entryMeta({ entry: entry({ kind: "project" }) }), "property", "og:type")?.content).toBe("website");
  });
  it("is a neutral not-found head without data", () => {
    expect(entryMeta(undefined)[0]).toEqual({ title: "Not found · Catalyst" });
  });
});
