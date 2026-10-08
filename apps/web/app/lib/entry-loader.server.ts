import { data } from "react-router";
import type { ContentKind } from "@catalyst/schemas";
import { getProjection } from "./content.server";
import { getEntryDetail, type EntryLoaderData } from "./entries";

/**
 * The loader of the four entry routes (`/articles/:slug`, ...): the entry with its body, its places, related entries and
 * neighbours, or a real 404 (unknown slug, or a slug that belongs to another kind) that the root error boundary draws with the
 * site's not-found page. Only this one entry's body leaves the server; lists never carry bodies.
 */
export async function loadEntry(kind: ContentKind, slug: string | undefined, request: Request): Promise<EntryLoaderData> {
  const entry = slug ? getEntryDetail(await getProjection(), kind, slug) : null;
  if (!entry) throw data({ message: "Entry not found" }, { status: 404 });
  return { entry, origin: new URL(request.url).origin };
}
