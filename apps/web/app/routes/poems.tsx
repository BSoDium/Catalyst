import type { Route } from "./+types/poems";
import { EntryListPage } from "~/components/entry-list-page";
import { getProjection } from "~/lib/content.server";
import { listEntries } from "~/lib/entries";
import { listMeta } from "~/lib/entry-meta";

// `/poems`: the list of poems, summaries only (no body, so the page stays cheap however long the texts are).
export async function loader() {
  return { items: listEntries(await getProjection(), "poem") };
}

export function meta(_args: Route.MetaArgs) {
  return listMeta("poem");
}

export default function PoemsRoute({ loaderData }: Route.ComponentProps) {
  return <EntryListPage kind="poem" items={loaderData.items} />;
}
