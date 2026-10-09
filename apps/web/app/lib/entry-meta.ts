import { KIND_LABELS, KIND_PLURALS, type EntryDetail } from "./entries";
import { safeMediaSrc } from "./entry-blocks";
import { entryJsonLd } from "./json-ld";
import { pageMeta } from "./meta";

interface Base {
  origin?: string | undefined;
  path?: string | undefined;
}

/**
 * Head tags of an entry route: title, summary as the description, canonical, Open Graph and Twitter tags, JSON-LD and the share image
 * (the entry's authored cover when it sits on a safe `/media/` path and is a format scrapers read, else the site's default). `base` is
 * `metaBase(args)`: the site origin and the page path.
 */
export function entryMeta(data: { entry: EntryDetail; origin?: string } | undefined, base: Base = {}) {
  if (!data) return pageMeta({ title: "Not found", description: "There is nothing at this address.", noindex: true });
  const { entry } = data;
  const origin = base.origin ?? data.origin;
  const cover = entry.cover && safeMediaSrc(entry.cover.src) ? entry.cover : undefined;
  return pageMeta({
    title: entry.title,
    description: entry.summary ?? `${KIND_LABELS[entry.kind]} from the Catalyst archive.`,
    type: entry.kind === "article" ? "article" : "website",
    image: cover ? { src: cover.src, alt: cover.alt, width: cover.width, height: cover.height } : undefined,
    origin,
    path: entry.href,
    publishedTime: entry.date,
    tags: entry.tags,
    jsonLd: origin ? entryJsonLd(entry, origin) : undefined,
  });
}

/** Head tags of a list route (`/articles`, ...). */
export function listMeta(kind: keyof typeof KIND_PLURALS, base: Base = {}) {
  return pageMeta({ title: KIND_PLURALS[kind], description: `${KIND_PLURALS[kind]} from the Catalyst archive.`, origin: base.origin, path: base.path });
}
