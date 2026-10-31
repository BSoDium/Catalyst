import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadDemoProjection } from "@catalyst/published/dev";
import { EMPTY_PROJECTION, type PublishedProjection } from "@catalyst/schemas";

let projection: PublishedProjection = EMPTY_PROJECTION;
vi.mock("~/lib/content.server", () => ({ getProjection: async () => projection, getContentMode: () => "published" }));

const { loader } = await import("./career");

describe("/career loader", () => {
  beforeEach(() => {
    projection = EMPTY_PROJECTION;
  });

  it("is a 404 while the projection has no career document", async () => {
    let thrown: unknown;
    try {
      await loader();
    } catch (e) {
      thrown = e;
    }
    expect((thrown as { init?: { status?: number } })?.init?.status).toBe(404);
  });

  it("answers with the career and the places it names that exist", async () => {
    projection = loadDemoProjection();
    const data = await loader();
    expect(data.career.title).toBe("Career");
    expect(data.places).toContain("paris");
    expect(new Set(data.places).size).toBe(data.places.length);
  });

  it("does not link a place the projection does not have", async () => {
    const demo = loadDemoProjection();
    projection = { ...demo, places: demo.places.filter((p) => p.slug !== "paris") };
    expect((await loader()).places).not.toContain("paris");
  });
});
