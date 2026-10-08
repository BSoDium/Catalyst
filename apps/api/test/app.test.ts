import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  contentKindSchema,
  groupKindSchema,
  parsePublishedProjection,
  publishedGroupSchema,
  publishedContentItemSchema,
  publishedPlaceSchema,
  toContentSummary,
  publishedRouteSchema,
  slugSchema,
  EMPTY_PROJECTION,
  type PublishedProjection,
} from "@catalyst/schemas";
import { loadDemoProjection, loadPublishedProjection } from "@catalyst/published";
import { CACHE_CONTROL, createApp } from "../src/app";
import { buildSnapshot } from "../src/snapshot";
import { loadContent } from "../src/content";
import type {
  ApiError,
  ContentDetailResponse,
  HealthResponse,
  HealthUnavailableResponse,
  PlaceDetailResponse,
} from "../src/contract";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const demoApp = () => createApp(loadContent({ CATALYST_CONTENT: "demo" }));
const emptyApp = () => createApp(loadContent({}));

const STATIC = ["/v1/projection", "/v1/places", "/v1/groups", "/v1/routes", "/v1/projects", "/v1/articles", "/v1/artworks", "/v1/poems"];
const LISTS = ["projects", "articles", "artworks", "poems"] as const;
/** One detail path per kind, plus the place detail. */
const DETAILS = ["/v1/places/lisbon", "/v1/projects/demo-project", "/v1/articles/demo-article", "/v1/artworks/demo-artwork", "/v1/poems/demo-poem"];
const KNOWN = ["/health", ...STATIC, ...DETAILS];

// Strict response schemas, independent of the server code, to assert that
// nothing outside the contract allowlist can appear in a response.
const placeSummarySchema = publishedPlaceSchema
  .pick({ slug: true, name: true, region: true, coordinates: true, labelPriority: true, summary: true, bbox: true, viewRadiusKm: true, group: true, countryCode: true })
  .strict();
const placeDetailSchema = publishedPlaceSchema
  .extend({
    related: z.array(z.object({ kind: contentKindSchema, slug: slugSchema, title: z.string().min(1) }).strict()),
    groupChain: z.array(z.object({ slug: slugSchema, name: z.string().min(1), kind: groupKindSchema }).strict()),
  })
  .strict();

const contentSummarySchema = publishedContentItemSchema.omit({ body: true }).strict();
const contentDetailSchema = publishedContentItemSchema
  .extend({
    kind: contentKindSchema,
    places: z.array(z.object({ slug: slugSchema, name: z.string().min(1) }).strict()),
  })
  .strict();

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe("strict schemas used by these tests", () => {
  it("reject unknown keys (negative control)", () => {
    expect(placeSummarySchema.safeParse({ ...demoSummary(), leaked: 1 }).success).toBe(false);
    expect(placeDetailSchema.safeParse({ ...demoDetailFixture(), leaked: 1 }).success).toBe(false);
  });
});
function demoSummary() {
  const p = loadDemoProjection().places[0]!;
  return { slug: p.slug, name: p.name, coordinates: p.coordinates, labelPriority: p.labelPriority };
}
function demoDetailFixture() {
  return { ...loadDemoProjection().places[0]!, related: [], groupChain: [] };
}

describe("endpoints (demo content)", () => {
  it("GET /health", async () => {
    const res = await demoApp().request("/health");
    expect(res.status).toBe(200);
    expect(await json<HealthResponse>(res)).toEqual({
      ok: true,
      schemaVersion: 1,
      content: "demo",
      counts: { places: 18, groups: 8, routes: 1, projects: 1, articles: 1, artworks: 1, poems: 1 },
    });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("GET /v1/projection returns exactly the validated projection", async () => {
    const res = await demoApp().request("/v1/projection");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    const body = await res.json();
    expect(parsePublishedProjection(body)).toEqual(loadDemoProjection());
  });

  it("GET /v1/places returns strict summaries sorted by slug", async () => {
    const res = await demoApp().request("/v1/places");
    const body = await json<{ slug: string }[]>(res);
    const parsed = z.array(placeSummarySchema).parse(body);
    const slugs = parsed.map((p) => p.slug);
    expect(slugs).toEqual([...slugs].sort());
    expect(slugs).toHaveLength(18);
    // Summaries must not carry detail-only fields.
    for (const p of body) expect(Object.keys(p)).not.toContain("body");
    // The optional view radius passes through when set and is omitted when absent.
    const radius = Object.fromEntries((body as { slug: string; viewRadiusKm?: number }[]).map((p) => [p.slug, p.viewRadiusKm]));
    expect(radius["lisbon"]).toBe(10);
    expect(radius["kyoto"]).toBeUndefined();
    expect(Object.keys(body.find((p) => p.slug === "kyoto")!)).not.toContain("viewRadiusKm");
    // The optional bounding box passes through unchanged when set and is omitted when absent.
    const bbox = Object.fromEntries((body as { slug: string; bbox?: number[] }[]).map((p) => [p.slug, p.bbox]));
    expect(bbox["lisbon"]).toEqual([-9.25, 38.664, -9.07, 38.776]);
    expect(bbox["kyoto"]).toBeUndefined();
    expect(Object.keys(body.find((p) => p.slug === "kyoto")!)).not.toContain("bbox");
    // The group slug passes through when the place is in a group and is omitted when it is in none.
    const group = Object.fromEntries((body as { slug: string; group?: string }[]).map((p) => [p.slug, p.group]));
    expect(group["zagreb"]).toBe("croatia");
    expect(group["cape-town"]).toBeUndefined();
    expect(Object.keys(body.find((p) => p.slug === "cape-town")!)).not.toContain("group");
    // The derived country code passes through on every demo place.
    const country = Object.fromEntries((body as { slug: string; countryCode?: string }[]).map((p) => [p.slug, p.countryCode]));
    expect(country["lisbon"]).toBe("PT");
    expect(country["cape-town"]).toBe("ZA");
    expect(Object.values(country).every((c) => /^[A-Z]{2}$/.test(c ?? ""))).toBe(true);
  });

  it("GET /v1/groups returns the hierarchy sorted by slug, strictly", async () => {
    const res = await demoApp().request("/v1/groups");
    expect(res.status).toBe(200);
    const groups = z.array(publishedGroupSchema).parse(await res.json());
    const slugs = groups.map((g) => g.slug);
    expect(slugs).toEqual([...slugs].sort());
    expect(slugs).toEqual(["americas", "asia", "balkans", "croatia", "da-nang-area", "europe", "south-eastern-asia", "vietnam"]);
    expect(groups.map((g) => g.kind)).toEqual(expect.arrayContaining(["continent", "subregion", "region", "country", "area"]));
    expect(groups.find((g) => g.slug === "balkans")).toMatchObject({ kind: "region", parent: "europe" });
    expect(groups.find((g) => g.slug === "europe")).not.toHaveProperty("parent");
    expect(groups).toEqual([...loadDemoProjection().groups].sort((a, b) => (a.slug < b.slug ? -1 : 1)));
  });

  it("GET /v1/projection carries the groups and each place's group", async () => {
    const body = (await (await demoApp().request("/v1/projection")).json()) as PublishedProjection;
    expect(body.groups).toHaveLength(8);
    expect(body.places.find((p) => p.slug === "split")?.group).toBe("croatia");
  });

  it("GET /v1/places/:slug returns the full place with resolved related items", async () => {
    const res = await demoApp().request("/v1/places/lisbon");
    expect(res.status).toBe(200);
    const place = placeDetailSchema.parse(await res.json()) as PlaceDetailResponse;
    expect(place.name).toBe("Lisbon");
    expect(place.viewRadiusKm).toBe(10);
    expect(place.bbox).toEqual([-9.25, 38.664, -9.07, 38.776]);
    expect(place.body.length).toBeGreaterThan(0);
    expect(place.related).toEqual([
      { kind: "article", slug: "demo-article", title: "Demo article" },
      { kind: "project", slug: "demo-project", title: "Demo project" },
    ]);
    expect(place.group).toBe("europe");
    expect(place.countryCode).toBe("PT");
    expect(place.groupChain).toEqual([{ slug: "europe", name: "Europe", kind: "continent" }]);
    const kyoto = placeDetailSchema.parse(await (await demoApp().request("/v1/places/kyoto")).json());
    expect(kyoto.related).toEqual([{ kind: "artwork", slug: "demo-artwork", title: "Demo artwork" }]);
  });

  it("GET /v1/places/:slug resolves the group chain from the innermost group to the root", async () => {
    const detail = async (slug: string) => placeDetailSchema.parse(await (await demoApp().request(`/v1/places/${slug}`)).json());
    expect((await detail("zagreb")).groupChain).toEqual([
      { slug: "croatia", name: "Croatia", kind: "country" },
      { slug: "balkans", name: "Balkans", kind: "region" },
      { slug: "europe", name: "Europe", kind: "continent" },
    ]);
    expect((await detail("hoi-an")).groupChain.map((g) => `${g.kind}:${g.slug}`)).toEqual([
      "area:da-nang-area",
      "country:vietnam",
      "subregion:south-eastern-asia",
      "continent:asia",
    ]);
    // A place in no group has an empty chain and no `group`.
    const capeTown = await detail("cape-town");
    expect(capeTown.groupChain).toEqual([]);
    expect(capeTown).not.toHaveProperty("group");
  });

  it("every place in the projection has a detail endpoint that parses strictly", async () => {
    const app = demoApp();
    for (const place of loadDemoProjection().places) {
      const res = await app.request(`/v1/places/${place.slug}`);
      expect(res.status, place.slug).toBe(200);
      placeDetailSchema.parse(await res.json());
    }
  });

  it("GET /v1/routes", async () => {
    const demo = loadDemoProjection();
    expect(z.array(publishedRouteSchema).parse(await (await demoApp().request("/v1/routes")).json())).toEqual(demo.routes);
  });

  it("GET /v1/projects, /v1/articles, /v1/artworks, /v1/poems return strict SUMMARIES (no body), in authored order", async () => {
    const app = demoApp();
    const demo = loadDemoProjection();
    for (const key of LISTS) {
      const res = await app.request(`/v1/${key}`);
      expect(res.status, key).toBe(200);
      const raw = await json<Record<string, unknown>[]>(res);
      expect(raw.length, key).toBeGreaterThan(0);
      for (const item of raw) expect(Object.keys(item), key).not.toContain("body");
      const summaries = z.array(contentSummarySchema).parse(raw);
      expect(summaries, key).toEqual(demo[key].map(toContentSummary));
      // The summary carries what a list needs: cover, tags and the kind-specific meta.
      for (const s of summaries) {
        expect(s.cover, `${key}/${s.slug}`).toBeDefined();
        expect(s.tags?.length, `${key}/${s.slug}`).toBeGreaterThan(0);
        expect(s.meta?.length, `${key}/${s.slug}`).toBeGreaterThan(0);
      }
    }
    // The summaries are much smaller than the full entries they stand for.
    const sizes = async (path: string) => (await (await app.request(path)).text()).length;
    expect(await sizes("/v1/articles")).toBeLessThan(JSON.stringify(demo.articles).length);
  });

  it("GET /v1/<kind>/:slug returns the complete entry with its kind and its places resolved", async () => {
    const app = demoApp();
    const demo = loadDemoProjection();
    const names = new Map(demo.places.map((p) => [p.slug, p.name]));
    const kinds = { projects: "project", articles: "article", artworks: "artwork", poems: "poem" } as const;
    for (const key of LISTS) {
      for (const item of demo[key]) {
        const res = await app.request(`/v1/${key}/${item.slug}`);
        expect(res.status, `${key}/${item.slug}`).toBe(200);
        const detail = contentDetailSchema.parse(await res.json()) as ContentDetailResponse;
        expect(detail.kind).toBe(kinds[key]);
        const { kind: _kind, places, ...entry } = detail;
        expect(entry).toEqual(item);
        expect(entry.body?.length).toBeGreaterThan(0);
        expect(places).toEqual(item.placeSlugs.map((slug) => ({ slug, name: names.get(slug) })));
      }
    }
    // An entry with two places keeps the order of placeSlugs.
    const article = contentDetailSchema.parse(await (await app.request("/v1/articles/demo-article")).json());
    expect(article.places).toEqual([
      { slug: "lisbon", name: "Lisbon" },
      { slug: "paris", name: "Paris" },
    ]);
  });

  it("the demo poem is served as verse blocks, line breaks and stanzas intact", async () => {
    const poem = contentDetailSchema.parse(await (await demoApp().request("/v1/poems/demo-poem")).json());
    const verse = poem.body?.find((b) => b.type === "verse");
    expect(verse && verse.type === "verse" ? verse.stanzas.map((s) => s.length) : []).toEqual([4, 3]);
    expect(poem.places).toEqual([{ slug: "hue", name: "Huế" }]);
  });

  it("GET /v1/projection carries the complete entries, bodies included", async () => {
    const body = (await (await demoApp().request("/v1/projection")).json()) as PublishedProjection;
    expect(body.poems.map((p) => p.slug)).toEqual(["demo-poem"]);
    for (const key of LISTS) for (const item of body[key]) expect(item.body?.length, `${key}/${item.slug}`).toBeGreaterThan(0);
  });

  it("resolves a place's related poem", async () => {
    const hue = placeDetailSchema.parse(await (await demoApp().request("/v1/places/hue")).json());
    expect(hue.related).toEqual([{ kind: "poem", slug: "demo-poem", title: "Demo poem" }]);
  });
});

describe("committed (published) content", () => {
  it("is served and, being empty today, yields empty collections", async () => {
    const app = emptyApp();
    expect(loadPublishedProjection()).toEqual(EMPTY_PROJECTION);

    const health = await json<HealthResponse>(await app.request("/health"));
    expect(health.content).toBe("published");
    expect(health.counts).toEqual({ places: 0, groups: 0, routes: 0, projects: 0, articles: 0, artworks: 0, poems: 0 });

    expect(await (await app.request("/v1/projection")).json()).toEqual(EMPTY_PROJECTION);
    for (const path of ["/v1/places", "/v1/groups", "/v1/routes", "/v1/projects", "/v1/articles", "/v1/artworks", "/v1/poems"]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(200);
      expect(await res.json(), path).toEqual([]);
    }
    for (const path of ["/v1/places/lisbon", ...DETAILS.slice(1)]) expect((await app.request(path)).status, path).toBe(404);
  });

  it("defaults to published when CATALYST_CONTENT is unset or empty", async () => {
    for (const env of [{}, { CATALYST_CONTENT: "" }, { CATALYST_CONTENT: "published" }]) {
      const health = await json<HealthResponse>(await createApp(loadContent(env)).request("/health"));
      expect(health.content).toBe("published");
    }
  });
});

describe("404 and 405", () => {
  it("returns a JSON error envelope for unknown paths and slugs", async () => {
    const app = demoApp();
    for (const path of ["/", "/nope", "/v1", "/v1/", "/v2/places", "/v1/places/", "/v1/places/atlantis", "/v1/places/Lisbon", "/v1/places/lisbon/", "/v1/places/a/b", "/health/", "/admin", "/v1/import",
      "/v1/poems/", "/v1/poems/atlantis", "/v1/poems/Demo-Poem", "/v1/poems/demo-poem/", "/v1/poems/demo-poem/body", "/v1/projects/", "/v1/projects/atlantis",
      "/v1/articles/atlantis", "/v1/artworks/atlantis", "/v1/poem", "/v1/poem/demo-poem", "/v1/routes/demo-route-vietnam", "/v1/groups/europe", "/v1/projection/x",
      // A slug of another kind is not found under this kind.
      "/v1/projects/demo-poem", "/v1/poems/demo-project", "/v1/articles/demo-artwork"]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(404);
      expect(res.headers.get("content-type")).toMatch(/^application\/json/);
      const body = await json<ApiError>(res);
      expect(body.error.code).toBe("not_found");
      expect(typeof body.error.message).toBe("string");
      expect(Object.keys(body)).toEqual(["error"]);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("does not choke on malformed percent-encoding or prototype-ish slugs", async () => {
    const app = demoApp();
    for (const path of ["/v1/places/%E0%A4%A", "/v1/places/__proto__", "/v1/places/constructor", "/v1/places/%2e%2e%2fhealth", "/v1/poems/%E0%A4%A", "/v1/poems/__proto__", "/v1/projects/constructor", "/v1/articles/toString", "/v1/artworks/%2e%2e%2fhealth", "/v1/poems/%2e%2e%2fv1%2fplaces"]) {
      expect((await app.request(path)).status, path).toBe(404);
    }
  });

  it("never lets a write verb succeed on any path", async () => {
    for (const app of [demoApp(), emptyApp(), createApp({ status: "invalid", reason: "x" })]) {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        for (const path of [...KNOWN, "/v1/places/atlantis", "/", "/v1/import", "/admin"]) {
          const res = await app.request(path, { method, body: method === "DELETE" ? undefined : "{}" });
          expect([404, 405], `${method} ${path}`).toContain(res.status);
          expect(res.ok).toBe(false);
        }
      }
    }
  });

  it("answers 405 with Allow on known paths and 404 on unknown ones", async () => {
    const app = demoApp();
    for (const path of KNOWN) {
      const res = await app.request(path, { method: "POST", body: "{}" });
      expect(res.status, path).toBe(405);
      expect(res.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
      expect((await json<ApiError>(res)).error.code).toBe("method_not_allowed");
    }
    expect((await app.request("/v1/places/atlantis", { method: "POST" })).status).toBe(404);
  });
});

describe("headers", () => {
  it("sets caching, CORS and nosniff on data responses, and no cookies", async () => {
    const app = demoApp();
    for (const path of [...STATIC, ...DETAILS]) {
      const res = await app.request(path);
      expect(res.headers.get("cache-control"), path).toBe(CACHE_CONTROL);
      expect(CACHE_CONTROL).toBe("public, s-maxage=300, stale-while-revalidate=86400");
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(res.headers.get("access-control-allow-credentials")).toBeNull();
      expect(res.headers.get("etag")).toMatch(/^"[0-9a-f]{32}"$/);
    }
  });

  it("sets CORS and nosniff on errors too", async () => {
    const app = demoApp();
    for (const res of [await app.request("/nope"), await app.request("/health", { method: "POST" })]) {
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });

  it("answers OPTIONS preflight on known paths with read-only methods", async () => {
    const res = await demoApp().request("/v1/places", {
      method: "OPTIONS",
      headers: { Origin: "https://example.org", "Access-Control-Request-Method": "GET" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, HEAD, OPTIONS");
    expect(res.headers.get("access-control-allow-methods")).not.toMatch(/POST|PUT|PATCH|DELETE/);
    expect(res.headers.get("access-control-allow-headers")).toContain("If-None-Match");
    expect(await res.text()).toBe("");
    expect((await demoApp().request("/nope", { method: "OPTIONS" })).status).toBe(404);
  });

  it("handles HEAD like GET without a body", async () => {
    const app = demoApp();
    const get = await app.request("/v1/places");
    const head = await app.request("/v1/places", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("etag")).toBe(get.headers.get("etag"));
    expect(head.headers.get("cache-control")).toBe(CACHE_CONTROL);
    expect(await head.text()).toBe("");
    expect((await app.request("/nope", { method: "HEAD" })).status).toBe(404);
  });
});

describe("ETag and conditional requests", () => {
  it("returns 304 with validators and no body on a matching If-None-Match", async () => {
    const app = demoApp();
    const first = await app.request("/v1/projection");
    const etag = first.headers.get("etag")!;
    const res = await app.request("/v1/projection", { headers: { "If-None-Match": etag } });
    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
    expect(res.headers.get("etag")).toBe(etag);
    expect(res.headers.get("cache-control")).toBe(CACHE_CONTROL);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("supports weak, list and wildcard forms; mismatches get a full 200", async () => {
    const app = demoApp();
    const etag = (await app.request("/v1/places")).headers.get("etag")!;
    for (const header of [`W/${etag}`, `"zzz", ${etag}`, "*"]) {
      expect((await app.request("/v1/places", { headers: { "If-None-Match": header } })).status, header).toBe(304);
    }
    const miss = await app.request("/v1/places", { headers: { "If-None-Match": '"stale"' } });
    expect(miss.status).toBe(200);
    expect((await miss.json()) as unknown[]).toHaveLength(18);
  });

  it("is a content hash: stable across instances, different per resource and per content", async () => {
    const a = (await demoApp().request("/v1/places")).headers.get("etag");
    const b = (await demoApp().request("/v1/places")).headers.get("etag");
    expect(a).toBe(b);
    expect((await demoApp().request("/v1/routes")).headers.get("etag")).not.toBe(a);
    expect((await emptyApp().request("/v1/places")).headers.get("etag")).not.toBe(a);
  });

  it("is not applied to errors", async () => {
    const res = await demoApp().request("/v1/places/atlantis", { headers: { "If-None-Match": "*" } });
    expect(res.status).toBe(404);
    expect(res.headers.get("etag")).toBeNull();
  });
});

describe("startup failure", () => {
  const invalidProjection = (): PublishedProjection =>
    parsePublishedProjection({
      ...EMPTY_PROJECTION,
      routes: [{ id: "r", title: "R", stops: ["ghost", "ghost-2"] }],
    });

  it("reports an invalid projection instead of throwing", () => {
    const state = loadContent({}, invalidProjection);
    expect(state.status).toBe("invalid");
    if (state.status === "invalid") expect(state.reason).toContain('unknown place "ghost"');
  });

  it("rejects an unrecognised CATALYST_CONTENT rather than silently defaulting", () => {
    const state = loadContent({ CATALYST_CONTENT: "staging" });
    expect(state.status).toBe("invalid");
    if (state.status === "invalid") expect(state.reason).toContain("CATALYST_CONTENT");
  });

  it("does not support the web app's local preview mode: published or demo only", () => {
    const state = loadContent({ CATALYST_CONTENT: "preview" });
    expect(state.status).toBe("invalid");
    if (state.status === "invalid") expect(state.reason).toContain('expected "published" or "demo"');
  });

  it("serves 503 on /health and every data endpoint, without leaking details", async () => {
    const state = loadContent({}, invalidProjection);
    const app = createApp(state);
    const health = await app.request("/health");
    expect(health.status).toBe(503);
    const body = await json<HealthUnavailableResponse>(health);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("content_unavailable");
    expect(JSON.stringify(body)).not.toContain("ghost");
    for (const path of [...STATIC, ...DETAILS, "/v1/poems/anything"]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(503);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect((await json<ApiError>(res)).error.code).toBe("content_unavailable");
    }
    expect((await app.request("/nope")).status).toBe(404);
    expect((await app.request("/v1/places", { method: "POST" })).status).toBe(405);
  });

  it("src/index.ts (the Vercel entry) default-exports a 503 app on invalid content and logs loudly", async () => {
    vi.resetModules();
    vi.stubEnv("CATALYST_CONTENT", "bogus");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mod = await import("../src/index");
    expect((await mod.default.request("/health")).status).toBe(503);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("FATAL"));
  });

  it("src/server.ts refuses to start (exit 1) on invalid content", () => {
    const run = spawnSync(process.execPath, ["--import", "tsx", "src/server.ts"], {
      cwd: new URL("..", import.meta.url).pathname,
      env: { ...process.env, CATALYST_CONTENT: "bogus", PORT: "0" },
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("refusing to start");
  });
});

describe("deploy entry", () => {
  it("src/index.ts honours CATALYST_CONTENT=demo", async () => {
    vi.resetModules();
    vi.stubEnv("CATALYST_CONTENT", "demo");
    const mod = await import("../src/index");
    const health = await json<HealthResponse>(await mod.default.request("/health"));
    expect(health.content).toBe("demo");
  });

  it("converts unexpected errors to a generic JSON 500 with the common headers", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const app = demoApp();
    app.get("/boom", () => {
      throw new Error("secret internal detail");
    });
    const res = await app.request("/boom");
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("secret");
    expect((JSON.parse(text) as ApiError).error.code).toBe("internal_error");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});

// docs/api-cost-and-abuse.md builds its cost model on these invariants: the
// response to a path never depends on the query string or on request noise, so
// a cache-busting client can only ever get the same bytes (and the same cheap,
// allocation-free handler) back, and a prebuilt static equivalent would be
// byte-identical.
describe("abuse invariants", () => {
  it("ignores the query string: same status, body, ETag and Cache-Control on every known path", async () => {
    const app = demoApp();
    for (const path of KNOWN) {
      const base = await app.request(path);
      for (const qs of ["?cb=1", "?cb=2&x=%00", "?", "?" + "a".repeat(4000)]) {
        const res = await app.request(path + qs);
        expect(res.status, path + qs).toBe(base.status);
        expect(await res.text(), path + qs).toBe(await base.clone().text());
        expect(res.headers.get("etag"), path + qs).toBe(base.headers.get("etag"));
        expect(res.headers.get("cache-control"), path + qs).toBe(base.headers.get("cache-control"));
      }
    }
  });

  it("answers an unknown path the same way with or without a query string (404, no-store, no ETag)", async () => {
    const app = demoApp();
    for (const path of ["/wp-login.php?x=1", "/.env", "/v1/places/atlantis?cb=2", "/v1?cb=3"]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(404);
      expect(res.headers.get("cache-control"), path).toBe("no-store");
      expect(res.headers.get("etag"), path).toBeNull();
    }
  });

  it("copes with a pathological If-None-Match (thousands of candidates) without erroring or slowing down", async () => {
    const app = demoApp();
    const etag = (await app.request("/v1/places")).headers.get("etag")!;
    const noise = Array.from({ length: 2000 }, (_, i) => `"${i.toString(16).padStart(32, "0")}"`).join(", ");
    const started = performance.now();
    const miss = await app.request("/v1/places", { headers: { "If-None-Match": noise } });
    const hit = await app.request("/v1/places", { headers: { "If-None-Match": `${noise}, ${etag}` } });
    expect(performance.now() - started).toBeLessThan(500);
    expect(miss.status).toBe(200);
    expect(hit.status).toBe(304);
  });
});

describe("entry details: conditional requests and ETags", () => {
  it("answers 304 on a matching If-None-Match, and the ETag changes with the content of that entry only", async () => {
    const app = demoApp();
    const first = await app.request("/v1/poems/demo-poem");
    const etag = first.headers.get("etag")!;
    expect(etag).toMatch(/^"[0-9a-f]{32}"$/);
    const hit = await app.request("/v1/poems/demo-poem", { headers: { "If-None-Match": etag } });
    expect(hit.status).toBe(304);
    expect(await hit.text()).toBe("");
    expect(hit.headers.get("etag")).toBe(etag);
    expect(hit.headers.get("cache-control")).toBe(CACHE_CONTROL);
    expect((await app.request("/v1/poems/demo-poem", { headers: { "If-None-Match": '"stale"' } })).status).toBe(200);
    // The detail and the list of the same entry are different resources.
    expect((await app.request("/v1/poems")).headers.get("etag")).not.toBe(etag);

    const projection = loadDemoProjection();
    const edited: PublishedProjection = { ...projection, poems: projection.poems.map((p) => ({ ...p, body: [{ type: "divider" as const }] })) };
    const other = createApp({ status: "ready", mode: "demo", projection: edited });
    expect((await other.request("/v1/poems/demo-poem")).headers.get("etag")).not.toBe(etag);
    expect((await other.request("/v1/articles/demo-article")).headers.get("etag")).toBe((await app.request("/v1/articles/demo-article")).headers.get("etag"));
  });

  it("treats HEAD on a detail like GET without a body", async () => {
    const app = demoApp();
    const get = await app.request("/v1/projects/demo-project");
    const head = await app.request("/v1/projects/demo-project", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("etag")).toBe(get.headers.get("etag"));
    expect(await head.text()).toBe("");
  });

  it("answers OPTIONS preflight on a detail path", async () => {
    const res = await demoApp().request("/v1/articles/demo-article", { method: "OPTIONS", headers: { Origin: "https://example.org", "Access-Control-Request-Method": "GET" } });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, HEAD, OPTIONS");
    expect((await demoApp().request("/v1/articles/atlantis", { method: "OPTIONS" })).status).toBe(404);
  });
});

describe("snapshot", () => {
  it("serialises one entry per list and per item, and nothing else beyond places, groups, routes and health", () => {
    const demo = loadDemoProjection();
    const { entries, counts } = buildSnapshot(demo);
    const expected = [
      "/v1/projection",
      "/v1/places",
      "/v1/groups",
      "/v1/routes",
      ...LISTS.map((k) => `/v1/${k}`),
      ...demo.places.map((p) => `/v1/places/${p.slug}`),
      ...LISTS.flatMap((k) => demo[k].map((i) => `/v1/${k}/${i.slug}`)),
    ];
    expect([...entries.keys()].sort()).toEqual([...expected].sort());
    expect(counts).toEqual({ places: 18, groups: 8, routes: 1, projects: 1, articles: 1, artworks: 1, poems: 1 });
  });

  it("an entry with no optional field serialises to exactly its required fields (no null, no undefined keys)", () => {
    const projection = parsePublishedProjection({ ...EMPTY_PROJECTION, poems: [{ slug: "bare", title: "Bare", placeSlugs: [] }] });
    const { entries } = buildSnapshot(projection);
    expect(entries.get("/v1/poems")!.body).toBe('[{"slug":"bare","title":"Bare","placeSlugs":[]}]');
    expect(entries.get("/v1/poems/bare")!.body).toBe('{"kind":"poem","slug":"bare","title":"Bare","placeSlugs":[],"places":[]}');
  });
});

// The live Vercel firewall rule `api-allowlist` (docs/api-cost-and-abuse.md) denies every path that does not match this
// regular expression. The docs and the app must agree: a route the app serves but the rule denies is unreachable in
// production, and a rule broader than the routes widens the attack surface.
describe("firewall allowlist (docs/api-cost-and-abuse.md)", () => {
  const doc = readFileSync(new URL("../../../docs/api-cost-and-abuse.md", import.meta.url), "utf8");
  const documented = /"type":"path","op":"re","value":"([^"]+)","neg":true/.exec(doc)?.[1];

  it("is documented", () => {
    expect(documented).toBeDefined();
  });

  it("matches every path the app can serve, for every demo item, and nothing else", () => {
    const allow = new RegExp(documented!);
    const demo = loadDemoProjection();
    const served = [...buildSnapshot(demo).entries.keys(), "/health"];
    expect(served.length).toBe(31);
    for (const path of served) expect(allow.test(path), path).toBe(true);
    for (const path of [
      "/",
      "/v1",
      "/v1/",
      "/v1/places/",
      "/v1/poems/",
      "/v1/poems/Demo",
      "/v1/poems/a/b",
      "/v1/poems/-a",
      "/v1/poems/a--b",
      "/v1/poems/a_b",
      "/v1/poem",
      "/v1/groups/europe",
      "/v1/routes/x",
      "/v1/projection/x",
      "/v1/places/../health",
      "/health/",
      "/v1/poems/demo-poem/",
      "/v1/poems/demo-poem%0a",
      "/v1/import",
      "/v2/poems",
    ]) {
      expect(allow.test(path), path).toBe(false);
    }
  });
});
