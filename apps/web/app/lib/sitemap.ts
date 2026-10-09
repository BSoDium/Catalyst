/** `sitemap.xml` and `robots.txt` bodies. Pure: the resource routes read the projection and the site URL, these only format. */
import type { PublishedProjection } from "@catalyst/schemas";
import { COLLECTIONS, CONTENT_KINDS, KIND_PATHS, entryPath, placePath } from "./entries";

export interface SitemapUrl {
  /** Absolute URL. */
  loc: string;
  /** W3C date (`YYYY`, `YYYY-MM` or `YYYY-MM-DD`), when the content has one. */
  lastmod?: string;
}

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** `https://host` + `/path` with the path's segments percent-encoded (slugs are plain, but never trust that for a URL). */
const url = (origin: string, path: string) => `${origin}${path === "/" ? "/" : path.split("/").map(encodeURIComponent).join("/")}`;

/**
 * The URLs of the site: the home page, the four list pages, every entry and every place of the projection. `lastmod` is the authored
 * date when there is one (an entry's `date`, a place's latest of `dates.end` / `dates.start`): the content carries no edit time.
 */
export function sitemapUrls(projection: PublishedProjection, origin: string): SitemapUrl[] {
  const out: SitemapUrl[] = [{ loc: url(origin, "/") }];
  for (const kind of CONTENT_KINDS) out.push({ loc: url(origin, KIND_PATHS[kind]) });
  for (const kind of CONTENT_KINDS) {
    for (const item of projection[COLLECTIONS[kind]]) {
      out.push({ loc: url(origin, entryPath(kind, item.slug)), ...(item.date ? { lastmod: item.date } : {}) });
    }
  }
  for (const place of projection.places) {
    const lastmod = place.dates?.end ?? place.dates?.start;
    out.push({ loc: url(origin, placePath(place.slug)), ...(lastmod ? { lastmod } : {}) });
  }
  return out;
}

export function sitemapXml(urls: readonly SitemapUrl[]): string {
  const items = urls.map((u) => `  <url><loc>${xmlEscape(u.loc)}</loc>${u.lastmod ? `<lastmod>${xmlEscape(u.lastmod)}</lastmod>` : ""}</url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items.join("\n")}\n</urlset>\n`;
}

/** Allow everything and point at the sitemap on the production site; on any other host (preview, `*.vercel.app`, localhost) disallow everything. */
export function robotsTxt({ siteUrl, indexable }: { siteUrl: string; indexable: boolean }): string {
  return indexable
    ? `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`
    : `# Not the production site: nothing here is meant to be indexed.\nUser-agent: *\nDisallow: /\n`;
}
