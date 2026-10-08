import type { Route } from "./+types/artworks";
import { EntryListPage } from "~/components/entry-list-page";
import { getProjection } from "~/lib/content.server";
import { listEntries } from "~/lib/entries";
import { listMeta } from "~/lib/entry-meta";

// `/artworks`: the list of artworks, summaries only (no body, so the page stays cheap however long the texts are).
export async function loader() {
  return { items: listEntries(await getProjection(), "artwork") };
}

export function meta(_args: Route.MetaArgs) {
  return listMeta("artwork");
}

export default function ArtworksRoute({ loaderData }: Route.ComponentProps) {
  return <EntryListPage kind="artwork" items={loaderData.items} />;
}
