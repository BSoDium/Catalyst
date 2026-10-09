import type { Route } from "./+types/entry-artwork";
import { EntryRoute } from "~/components/entry/entry-route";
import { entryMeta } from "~/lib/entry-meta";
import { metaBase } from "~/lib/meta";
import { entryShouldRevalidate } from "~/lib/entry-revalidate";
import { loadEntry } from "~/lib/entry-loader.server";

// `/artworks/:slug`: a artwork in the shell's detail panel (or full screen with `?view=full`). No error boundary on purpose: an unknown
// slug is a real 404 that the root boundary draws with the site's not-found page.
export async function loader({ params }: Route.LoaderArgs) {
  return loadEntry("artwork", params.slug);
}

export const shouldRevalidate = entryShouldRevalidate;

export function meta(args: Route.MetaArgs) {
  return entryMeta(args.loaderData, metaBase(args));
}

export default function ArtworksEntryRoute({ loaderData }: Route.ComponentProps) {
  return <EntryRoute data={loaderData} />;
}
