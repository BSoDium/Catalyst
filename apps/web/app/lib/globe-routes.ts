import type { PublishedProjection } from "@catalyst/schemas";

/** Where the globe's routes are served from (`routes/globe-routes.ts`; prerendered at build, a static file on the CDN). */
export const GLOBE_ROUTES_PATH = "/globe-routes.json";

/**
 * The address the globe fetches its routes from: the file's path, keyed by the content's version so a browser's cached copy is never of another
 * deploy's content (the file itself is a static file: revalidated at the CDN by its etag). Without a version (a local or demo projection) the key is `dev`.
 */
export function globeRoutesSrc(version: PublishedProjection["dataVersion"] | null | undefined): string {
  return `${GLOBE_ROUTES_PATH}?v=${version?.commit.slice(0, 12) ?? "dev"}`;
}
