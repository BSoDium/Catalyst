import { KIND_LABELS, KIND_PLURALS, type EntryDetail } from "./entries";
import { copyrightNotice } from "./copyright";
import { safeMediaSrc } from "./entry-blocks";
import { entryJsonLd } from "./json-ld";
import { pageMeta } from "./meta";
import { isSensitive, shareableCover } from "./sensitive";
import { archiveLine } from "./site";

interface Base {
  origin?: string | undefined;
  path?: string | undefined;
}

/**
 * Head tags of an entry route: title, summary as the description, canonical, Open Graph and Twitter tags, JSON-LD and the share image
 * (the entry's authored cover when it sits on a safe `/media/` path and is a format scrapers read, else the site's default; never
 * the cover of a sensitive entry, which also asks search engines not to index the page's images). `base` is `metaBase(args)`: the
 * site origin and the page path.
 */
export function entryMeta(data: { entry: EntryDetail; origin?: string } | undefined, base: Base = {}) {
  if (!data) return pageMeta({ title: "Not found", description: "There is nothing at this address.", noindex: true });
  const { entry } = data;
  const origin = base.origin ?? data.origin;
  const shareable = shareableCover(entry);
  const cover = shareable && safeMediaSrc(shareable.src) ? shareable : undefined;
  return pageMeta({
    title: entry.title,
    description: entry.summary ?? archiveLine(KIND_LABELS[entry.kind]),
    type: entry.kind === "article" ? "article" : "website",
    image: cover ? { src: cover.src, alt: cover.alt, width: cover.width, height: cover.height } : undefined,
    origin,
    path: entry.href,
    markdown: true,
    publishedTime: entry.date,
    tags: entry.tags,
    noImageIndex: isSensitive(entry),
    copyright: copyrightNotice(entry)?.text,
    jsonLd: origin ? entryJsonLd(entry, origin) : undefined,
  });
}

/** Head tags of a list route (`/articles`, ...). */
export function listMeta(kind: keyof typeof KIND_PLURALS, base: Base = {}) {
  return pageMeta({ title: KIND_PLURALS[kind], description: archiveLine(KIND_PLURALS[kind]), origin: base.origin, path: base.path, markdown: true });
}
