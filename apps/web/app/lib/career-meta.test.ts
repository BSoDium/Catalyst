import { describe, expect, it } from "vitest";
import { loadDemoProjection } from "@catalyst/published/dev";
import { careerMeta, describe as describeSummary } from "./career-meta";

const demo = loadDemoProjection().career!;
const find = (tags: ReturnType<typeof careerMeta>, key: string, value: string) => tags.find((t) => (t as Record<string, unknown>)[key] === value) as Record<string, string> | undefined;

describe("careerMeta", () => {
  const tags = careerMeta(demo, { origin: "https://v2.bsodium.fr", path: "/career" });
  it("titles the page `Career · <name>`, canonical and indexable", () => {
    expect(tags).toContainEqual({ title: "Career · Elliot Négrel-Jerzy" });
    expect(find(tags, "rel", "canonical")?.href).toBe("https://v2.bsodium.fr/career");
    expect(find(tags, "name", "robots")).toBeUndefined();
  });
  it("describes the page with the profile statement, at most 160 characters", () => {
    const d = find(tags, "name", "description")!.content!;
    expect(d.length).toBeLessThanOrEqual(160);
    expect(demo.summary.startsWith(d.replace(/…$/, ""))).toBe(true);
  });
  it("keeps the site's default share image: the portrait is never the og:image", () => {
    expect(find(tags, "property", "og:image")?.content).toBe("https://v2.bsodium.fr/og-default.png");
    expect(JSON.stringify(tags)).not.toContain(demo.portrait!.src);
  });
  it("carries one JSON-LD object", () => {
    expect(tags.filter((t) => "script:ld+json" in t)).toHaveLength(1);
  });
  it("without a career says not found and asks not to be indexed", () => {
    const none = careerMeta(undefined);
    expect(find(none, "name", "robots")?.content).toBe("noindex");
  });
});

describe("describe", () => {
  it("keeps a short statement as it is and cuts a long one at a word", () => {
    expect(describeSummary("Short.")).toBe("Short.");
    const long = describeSummary("word ".repeat(100));
    expect(long.length).toBeLessThanOrEqual(160);
    expect(long.endsWith("…")).toBe(true);
    expect(long).not.toMatch(/wor…$/);
  });
});
