import { data } from "react-router";
import type { ContentKind } from "@catalyst/schemas";
import type { Route } from "./+types/markdown";
import { getProjection } from "~/lib/content.server";
import { getEntryDetail, listEntries } from "~/lib/entries";
import { careerMarkdown, entryMarkdown, listMarkdown, placeMarkdown } from "~/lib/llm-text";
import { getPlaceDetail } from "~/lib/projection";
import { SECTIONS } from "~/lib/sections";
import { STATIC_SECURITY_HEADERS } from "~/lib/security-headers";
import { getSiteUrl } from "~/lib/site.server";

/**
 * The Markdown twin of a page, for language models and agents (#750): `/locations/<slug>.md`, `/<section>/<slug>.md` for an entry,
 * `/<section>.md` for a list and `/career.md`. One resource route module registered under each address (`routes.ts`). The same content
 * as the HTML page and nothing more (`lib/llm-text.ts`); an unknown address is a plain 404.
 */
const KIND_OF_SECTION = new Map<string, ContentKind>(Object.entries(SECTIONS).map(([kind, section]) => [section.slug, kind as ContentKind]));

const notFound = () => data({ message: "No such page" }, { status: 404 });

export async function loader({ request }: Route.LoaderArgs) {
  const projection = await getProjection();
  const origin = getSiteUrl();
  const segments = new URL(request.url).pathname.replace(/\.md$/, "").split("/").filter(Boolean);
  const [first, slug] = segments;

  let markdown: string | null = null;
  if (first === "career" && segments.length === 1) markdown = projection.career ? careerMarkdown(projection.career, origin) : null;
  else if (first === "locations" && segments.length === 2 && slug) {
    const place = getPlaceDetail(projection, slug);
    markdown = place ? placeMarkdown(place, origin) : null;
  } else if (first && KIND_OF_SECTION.has(first)) {
    const kind = KIND_OF_SECTION.get(first)!;
    if (segments.length === 1) markdown = listMarkdown(kind, listEntries(projection, kind), origin);
    else if (segments.length === 2 && slug) {
      const entry = getEntryDetail(projection, kind, slug);
      markdown = entry ? entryMarkdown(entry, origin) : null;
    }
  }
  if (markdown === null) throw notFound();
  return new Response(markdown, {
    headers: {
      ...STATIC_SECURITY_HEADERS,
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
