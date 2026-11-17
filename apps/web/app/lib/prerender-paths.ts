import type { PublishedProjection } from "@catalyst/schemas";
import { GLOBE_ROUTES_ROUTE } from "./globe-routes-file";
import { sitemapUrls } from "./sitemap";

/**
 * The paths built to static files at `pnpm build` (`prerender` in `react-router.config.ts`): every page of the sitemap (the home page, the lists, the career page, every
 * entry and every place: a page that depends on nothing but the published content, which only changes at a deploy) and the routes' file (`lib/globe-routes.ts`).
 * A URL with a query (`?view=full`, `?country=BR`) is another request: it is still rendered per request. The 404 page is too (an unknown address has no path to name).
 */
export function prerenderPaths(projection: PublishedProjection): string[] {
  // (`sitemapUrls` with an empty origin gives the paths, each segment percent-encoded as a URL is)
  const pages = sitemapUrls(projection, "").map((u) => u.loc);
  return [...new Set([...pages, GLOBE_ROUTES_ROUTE])];
}
