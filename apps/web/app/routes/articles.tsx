import type { Route } from "./+types/articles";
import { EntryListPage } from "~/components/entry-list-page";
import { getProjection } from "~/lib/content.server";
import { listEntries } from "~/lib/entries";
import { listMeta } from "~/lib/entry-meta";
import { metaBase } from "~/lib/meta";

// `/articles`: the list of articles, summaries only (no body, so the page stays cheap however long the texts are).
export async function loader() {
  return { items: listEntries(await getProjection(), "article") };
}

export function meta(args: Route.MetaArgs) {
  return listMeta("article", metaBase(args));
}

export default function ArticlesRoute({ loaderData }: Route.ComponentProps) {
  return <EntryListPage kind="article" items={loaderData.items} />;
}
