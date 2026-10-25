/**
 * Structured data (schema.org JSON-LD) of the pages, built ONLY from what the projection publishes: nothing is invented (no author, no
 * publisher, no dates other than the authored one). Minimal on purpose; every property below is valid for its type.
 */
import { copyrightNotice } from "./copyright";
import type { EntryDetail } from "./entries";
import { isScrapableImage, absoluteUrl } from "./meta";
import { shareableCover } from "./sensitive";
import { SITE_DESCRIPTION, SITE_NAME } from "./site";

type Json = Record<string, unknown>;

const CODE_HOSTS = new Set(["github.com", "gitlab.com", "codeberg.org", "bitbucket.org", "sr.ht", "git.sr.ht"]);

/** Whether an entry's external link is a source repository (then the project is `SoftwareSourceCode`, else a plain `CreativeWork`). */
export function isCodeRepository(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return CODE_HOSTS.has(new URL(url).hostname.replace(/^www\./, ""));
  } catch {
    return false;
  }
}

/** The home page: the site as a `WebSite`. */
export function websiteJsonLd(origin: string): Json {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: `${origin}/`,
    inLanguage: "en",
  };
}

/** An entry as a schema.org creative work: an article is an `Article`, a poem a `CreativeWork` of genre Poem, a photograph a `Photograph`, a project `SoftwareSourceCode` when it points at a repository. */
export function entryJsonLd(entry: EntryDetail, origin: string): Json {
  const url = absoluteUrl(entry.href, origin);
  const type = entry.kind === "article" ? "Article" : entry.kind === "photograph" ? "Photograph" : entry.kind === "project" && isCodeRepository(entry.url) ? "SoftwareSourceCode" : "CreativeWork";
  // a sensitive entry has no `image` at all: structured data is what a search result is built from
  const shareable = shareableCover(entry);
  const cover = shareable && isScrapableImage(shareable.src) ? absoluteUrl(shareable.src, origin) : undefined;
  // writing and artwork carry the owner's notice; software is code under the repository's licence (no notice, no license URL either way)
  const notice = copyrightNotice(entry);
  return {
    "@context": "https://schema.org",
    "@type": type,
    name: entry.title,
    ...(type === "Article" ? { headline: entry.title.slice(0, 110) } : {}),
    ...(entry.summary ? { description: entry.summary } : {}),
    url,
    mainEntityOfPage: url,
    ...(entry.date ? { datePublished: entry.date } : {}),
    ...(cover ? { image: cover } : {}),
    ...(entry.tags.length ? { keywords: entry.tags.join(", ") } : {}),
    ...(entry.kind === "poem" ? { genre: "Poem" } : {}),
    ...(type === "SoftwareSourceCode" && entry.url ? { codeRepository: entry.url } : {}),
    ...(entry.places.length ? { contentLocation: entry.places.map((p) => ({ "@type": "Place", name: p.name, url: absoluteUrl(p.href, origin) })) } : {}),
    ...(notice
      ? {
          copyrightHolder: { "@type": "Person", name: notice.holder },
          ...(notice.year !== undefined ? { copyrightYear: notice.year } : {}),
          copyrightNotice: notice.text,
        }
      : {}),
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: `${origin}/` },
  };
}
