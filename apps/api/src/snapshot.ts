import { createHash } from "node:crypto";
import { toPlaceSummary, type ContentKind, type PublishedProjection } from "@catalyst/schemas";
import type { ContentCounts, PlaceDetailResponse } from "./contract";

export interface Entry {
  body: string;
  etag: string;
}

/** Strong validator derived from the response bytes (a content hash). */
export function etagFor(body: string): string {
  return `"${createHash("sha256").update(body).digest("hex").slice(0, 32)}"`;
}

function entry(value: unknown): Entry {
  const body = JSON.stringify(value);
  return { body, etag: etagFor(body) };
}

export interface Snapshot {
  /** Pre-serialised responses keyed by exact request path. */
  entries: ReadonlyMap<string, Entry>;
  counts: ContentCounts;
}

export const STATIC_PATHS = [
  "/v1/projection",
  "/v1/places",
  "/v1/routes",
  "/v1/projects",
  "/v1/articles",
  "/v1/artworks",
] as const;

export const HEALTH_PATH = "/health";

/**
 * Everything the API can ever return is serialised here, once, at startup.
 * Request handling is then a map lookup: there is no per-request projection
 * logic that could leak a field outside the validated allowlist.
 */
export function buildSnapshot(p: PublishedProjection): Snapshot {
  const titles: Record<ContentKind, Map<string, string>> = {
    project: new Map(p.projects.map((i) => [i.slug, i.title])),
    article: new Map(p.articles.map((i) => [i.slug, i.title])),
    artwork: new Map(p.artworks.map((i) => [i.slug, i.title])),
  };

  const entries = new Map<string, Entry>();
  entries.set("/v1/projection", entry(p));
  entries.set(
    "/v1/places",
    entry([...p.places].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)).map(toPlaceSummary)),
  );
  entries.set("/v1/routes", entry(p.routes));
  entries.set("/v1/projects", entry(p.projects));
  entries.set("/v1/articles", entry(p.articles));
  entries.set("/v1/artworks", entry(p.artworks));

  for (const place of p.places) {
    const detail: PlaceDetailResponse = {
      ...place,
      related: place.related.map((r) => ({
        kind: r.kind,
        slug: r.slug,
        // Referential integrity is guaranteed by projection validation.
        title: titles[r.kind].get(r.slug) ?? r.slug,
      })),
    };
    entries.set(`/v1/places/${place.slug}`, entry(detail));
  }

  return {
    entries,
    counts: {
      places: p.places.length,
      routes: p.routes.length,
      projects: p.projects.length,
      articles: p.articles.length,
      artworks: p.artworks.length,
    },
  };
}
