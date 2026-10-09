import { getProjection } from "~/lib/content.server";
import { STATIC_SECURITY_HEADERS } from "~/lib/security-headers";
import { getSiteUrl } from "~/lib/site.server";
import { sitemapUrls, sitemapXml } from "~/lib/sitemap";

/** `/sitemap.xml` (a resource route: no UI): the home page, the lists, every entry and every place of the projection, absolute on `CATALYST_SITE_URL`. */
export async function loader() {
  const body = sitemapXml(sitemapUrls(await getProjection(), getSiteUrl()));
  return new Response(body, {
    headers: {
      ...STATIC_SECURITY_HEADERS,
      "Content-Type": "application/xml; charset=utf-8",
      // Content changes at deploys (bundled projection) or within a minute (API): an hour at the CDN, then revalidated in the background.
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
