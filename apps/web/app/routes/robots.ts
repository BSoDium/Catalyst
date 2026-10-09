import { robotsTxt } from "~/lib/sitemap";
import { STATIC_SECURITY_HEADERS } from "~/lib/security-headers";
import { getSiteUrl, isIndexableRequest } from "~/lib/site.server";

/** `/robots.txt` (a resource route): allow everything on the production host, disallow everything anywhere else (previews, `*.vercel.app`, localhost). */
export function loader({ request }: { request: Request }) {
  return new Response(robotsTxt({ siteUrl: getSiteUrl(), indexable: isIndexableRequest(request) }), {
    headers: {
      ...STATIC_SECURITY_HEADERS,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
