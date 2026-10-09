import type { Route } from "./+types/entry-poem";
import { EntryRoute } from "~/components/entry/entry-route";
import { entryMeta } from "~/lib/entry-meta";
import { entryShouldRevalidate } from "~/lib/entry-revalidate";
import { loadEntry } from "~/lib/entry-loader.server";

// `/poems/:slug`: a poem in the shell's detail panel (or full screen with `?view=full`). No error boundary on purpose: an unknown
// slug is a real 404 that the root boundary draws with the site's not-found page.
export async function loader({ params, request }: Route.LoaderArgs) {
  return loadEntry("poem", params.slug, request);
}

export const shouldRevalidate = entryShouldRevalidate;

export function meta({ loaderData }: Route.MetaArgs) {
  return entryMeta(loaderData);
}

export default function PoemsEntryRoute({ loaderData }: Route.ComponentProps) {
  return <EntryRoute data={loaderData} />;
}
