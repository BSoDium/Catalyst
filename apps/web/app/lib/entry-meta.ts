import { KIND_LABELS, KIND_PLURALS, type EntryDetail } from "./entries";
import { safeMediaSrc } from "./entry-blocks";
import { pageMeta } from "./meta";

/** Head tags of an entry route: its title, the summary as the description and, only when it has an authored cover, the share image. */
export function entryMeta(data: { entry: EntryDetail; origin?: string } | undefined) {
  if (!data) return pageMeta({ title: "Not found", description: "There is nothing at this address." });
  const { entry, origin } = data;
  const cover = entry.cover && safeMediaSrc(entry.cover.src) ? { src: entry.cover.src, alt: entry.cover.alt } : undefined;
  return pageMeta({
    title: entry.title,
    description: entry.summary ?? `${KIND_LABELS[entry.kind]} from the Catalyst archive.`,
    type: entry.kind === "article" ? "article" : "website",
    image: cover,
    origin,
  });
}

/** Head tags of a list route (`/articles`, ...). */
export function listMeta(kind: keyof typeof KIND_PLURALS) {
  return pageMeta({ title: KIND_PLURALS[kind], description: `${KIND_PLURALS[kind]} from the Catalyst archive.` });
}
