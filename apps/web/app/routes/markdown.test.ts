import { describe, expect, it, vi } from "vitest";
import { loadDemoProjection } from "@catalyst/published/dev";

const projection = loadDemoProjection();
vi.mock("~/lib/content.server", () => ({ getProjection: async () => projection, getContentMode: () => "published" }));

const { loader } = await import("./markdown");

const get = (path: string) => loader({ request: new Request(`https://site.test${path}`) } as Parameters<typeof loader>[0]);
const status = async (path: string) => {
  try {
    return (await get(path)).status;
  } catch (e) {
    return (e as { init?: { status?: number } }).init?.status;
  }
};

describe("Markdown twin loader", () => {
  it("answers each kind of address with Markdown", async () => {
    const article = projection.articles[0]!.slug;
    const place = projection.places[0]!.slug;
    for (const path of ["/career.md", "/articles.md", `/articles/${article}.md`, `/locations/${place}.md`]) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
      expect((await res.text()).startsWith("# ")).toBe(true);
    }
  });

  it("is not indexed and names the HTML page as canonical", async () => {
    const res = await get(`/articles/${projection.articles[0]!.slug}.md`);
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(res.headers.get("Link")).toMatch(/^<https?:\/\/[^>]+\/articles\/[^>.]+>; rel="canonical"$/);
  });

  it("is a 404 for an unknown entry, place, section or depth", async () => {
    for (const path of ["/articles/nope.md", "/locations/nope.md", "/nope.md", "/articles/a/b.md", "/career/x.md"]) expect(await status(path), path).toBe(404);
  });
});
