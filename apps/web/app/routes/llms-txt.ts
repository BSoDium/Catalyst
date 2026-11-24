import { getProjection } from "~/lib/content.server";
import { llmsTxt } from "~/lib/llm-text";
import { STATIC_SECURITY_HEADERS } from "~/lib/security-headers";
import { getSiteUrl } from "~/lib/site.server";

/** `/llms.txt` (a resource route: no UI): the site in a few lines and a link to the Markdown twin of every page, for language models (https://llmstxt.org). */
export async function loader() {
  return new Response(llmsTxt(await getProjection(), getSiteUrl()), {
    headers: {
      ...STATIC_SECURITY_HEADERS,
      // plain text, not markdown: a browser shows it instead of downloading it, and agents read it the same
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
