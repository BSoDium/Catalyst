import type { Route } from "./+types/photography";
import { EntryListPage } from "~/components/entry-list-page";
import { getProjection } from "~/lib/content.server";
import { listEntries } from "~/lib/entries";
import { listMeta } from "~/lib/entry-meta";
import { metaBase } from "~/lib/meta";

// `/photography`: the list of photographs, summaries only (no body, so the page stays cheap however many there are).
export async function loader() {
  return { items: listEntries(await getProjection(), "photograph") };
}

export function meta(args: Route.MetaArgs) {
  return listMeta("photograph", metaBase(args));
}

export default function PhotographyRoute({ loaderData }: Route.ComponentProps) {
  return <EntryListPage kind="photograph" items={loaderData.items} />;
}
