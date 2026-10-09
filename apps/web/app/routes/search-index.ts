import { getProjection } from "~/lib/content.server";
import { buildSearchIndex } from "~/lib/search";
import { STATIC_SECURITY_HEADERS } from "~/lib/security-headers";

/** `/search-index.json` (a resource route: no UI): titles, kinds, tags and one-line summaries of the places and entries, for the quick search. Fetched once, when the palette first opens. */
export async function loader() {
  return new Response(JSON.stringify(buildSearchIndex(await getProjection())), {
    headers: {
      ...STATIC_SECURITY_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
