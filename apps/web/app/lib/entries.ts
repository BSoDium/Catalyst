/**
 * Pure selectors for ENTRIES (articles, projects, artworks, poems): the lists, one entry with everything its view needs, the
 * entries linked to a place, previous/next. No I/O. Lists carry no body (summaries); only `getEntryDetail` returns it, so a
 * list page or the shell never pays for the text of entries it does not show.
 *
 * The link between entries and places has two directions in the contract (an entry's `placeSlugs`, a place's `related`);
 * every function here merges them and lists each entry once.
 */
import type {
  ContentKind,
  PublishedBodyBlock,
  PublishedContentItem,
  PublishedCover,
  PublishedMetaEntry,
  PublishedPlace,
  PublishedProjection,
} from "@catalyst/schemas";

/** The order kinds are listed in wherever they are grouped (the design system's order of kinds). */
export const CONTENT_KINDS = ["article", "project", "artwork", "poem"] as const satisfies readonly ContentKind[];

export const COLLECTIONS = { project: "projects", article: "articles", artwork: "artworks", poem: "poems" } as const satisfies Record<ContentKind, string>;

export const KIND_PATHS: Record<ContentKind, string> = {
  project: "/projects",
  article: "/articles",
  artwork: "/artworks",
  poem: "/poems",
};

export const KIND_LABELS: Record<ContentKind, string> = {
  project: "Project",
  article: "Article",
  artwork: "Artwork",
  poem: "Poem",
};

export const KIND_PLURALS: Record<ContentKind, string> = {
  project: "Projects",
  article: "Articles",
  artwork: "Artworks",
  poem: "Poems",
};

export const placePath = (slug: string) => `/locations/${slug}`;
export const entryPath = (kind: ContentKind, slug: string) => `${KIND_PATHS[kind]}/${slug}`;

export function isContentKind(value: unknown): value is ContentKind {
  return typeof value === "string" && (CONTENT_KINDS as readonly string[]).includes(value);
}

// --- Shapes ---------------------------------------------------------------------------------------------------------------------

export interface EntryPlaceLink {
  slug: string;
  name: string;
  region?: string;
  href: string;
}

/** An entry as the lists need it: no body. */
export interface EntrySummary {
  kind: ContentKind;
  slug: string;
  /** `/articles/<slug>`: the entry's own route (the panel opens on it). */
  href: string;
  /** Position in the kind's collection, authored order, 1-based: the `0004` of `ARTICLE / 0004`. Decoration, not an id (the slug is the id). */
  index: number;
  title: string;
  summary?: string;
  /** Partial ISO date as authored. */
  date?: string;
  url?: string;
  cover?: PublishedCover;
  tags: string[];
  meta: PublishedMetaEntry[];
  places: EntryPlaceLink[];
}

/** A pointer to another entry (previous/next, related). */
export interface EntryRef {
  kind: ContentKind;
  slug: string;
  title: string;
  href: string;
  index: number;
  /** What a tile of the entry shows (related entries, neighbours): optional, a ref stays valid without them. */
  summary?: string;
  date?: string;
  cover?: PublishedCover;
}

export interface EntryDetail extends EntrySummary {
  body: PublishedBodyBlock[];
  /** Other entries that share a place or a tag with this one, the most related first (`relatedScore`), at most `RELATED_LIMIT`. */
  related: EntryRef[];
  /** Previous and next in the same kind, authored order. */
  prev: EntryRef | null;
  next: EntryRef | null;
}

/** What an entry route's loader returns. */
export interface EntryLoaderData {
  entry: EntryDetail;
  /** The site's origin (`CATALYST_SITE_URL`, not the request's host): what absolute URLs in the head tags are built on (see `pageMeta`). */
  origin: string;
}

export interface EntryGroup {
  kind: ContentKind;
  label: string;
  entries: EntrySummary[];
}

export const RELATED_LIMIT = 6;

// --- Links between entries and places -----------------------------------------------------------------------------------------

const refKey = (kind: ContentKind, slug: string) => `${kind}\u0000${slug}`;

/** For each (kind, entry slug): the places that name the entry in their `related`. */
function placesRelating(projection: PublishedProjection): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const place of projection.places) {
    for (const r of place.related) {
      const key = refKey(r.kind, r.slug);
      const list = out.get(key) ?? [];
      if (!list.includes(place.slug)) list.push(place.slug);
      out.set(key, list);
    }
  }
  return out;
}

/** The places of an entry, both directions merged, each once: first its own `placeSlugs` (authored order), then the places that name it. Unknown slugs are dropped. */
function placeLinks(kind: ContentKind, item: PublishedContentItem, byPlace: Map<string, PublishedPlace>, relating: Map<string, string[]>): EntryPlaceLink[] {
  const slugs = [...new Set([...item.placeSlugs, ...(relating.get(refKey(kind, item.slug)) ?? [])])];
  return slugs.flatMap((slug) => {
    const place = byPlace.get(slug);
    return place ? [{ slug, name: place.name, ...(place.region ? { region: place.region } : {}), href: placePath(slug) }] : [];
  });
}

interface Lookups {
  byPlace: Map<string, PublishedPlace>;
  relating: Map<string, string[]>;
}

function lookups(projection: PublishedProjection): Lookups {
  return { byPlace: new Map(projection.places.map((p) => [p.slug, p])), relating: placesRelating(projection) };
}

function toSummary(kind: ContentKind, item: PublishedContentItem, position: number, l: Lookups): EntrySummary {
  return {
    kind,
    slug: item.slug,
    href: entryPath(kind, item.slug),
    index: position + 1,
    title: item.title,
    ...(item.summary !== undefined ? { summary: item.summary } : {}),
    ...(item.date !== undefined ? { date: item.date } : {}),
    ...(item.url !== undefined ? { url: item.url } : {}),
    ...(item.cover !== undefined ? { cover: item.cover } : {}),
    tags: item.tags ?? [],
    meta: item.meta ?? [],
    places: placeLinks(kind, item, l.byPlace, l.relating),
  };
}

const toRef = (kind: ContentKind, item: PublishedContentItem, position: number): EntryRef => ({
  kind,
  slug: item.slug,
  title: item.title,
  href: entryPath(kind, item.slug),
  index: position + 1,
  ...(item.summary !== undefined ? { summary: item.summary } : {}),
  ...(item.date !== undefined ? { date: item.date } : {}),
  ...(item.cover !== undefined ? { cover: item.cover } : {}),
});

/** Weights of `relatedScore`: a shared place says more than a shared tag; the same kind only breaks a tie. */
export const RELATED_WEIGHTS = { place: 4, tag: 2, kind: 1 } as const;

/**
 * How related two entries are: 4 per shared place, 2 per shared tag (tags compare case-insensitively), plus 1 when they are of
 * the same kind, but only when something else is shared (the kind alone relates nothing). 0 means unrelated.
 */
export function relatedScore(
  a: { kind: ContentKind; places: Iterable<string>; tags: readonly string[] },
  b: { kind: ContentKind; places: Iterable<string>; tags: readonly string[] },
): number {
  const places = new Set(a.places);
  const sharedPlaces = new Set([...b.places].filter((p) => places.has(p))).size;
  const tags = new Set(a.tags.map((t) => t.trim().toLowerCase()));
  const sharedTags = new Set(b.tags.map((t) => t.trim().toLowerCase()).filter((t) => t !== "" && tags.has(t))).size;
  const base = sharedPlaces * RELATED_WEIGHTS.place + sharedTags * RELATED_WEIGHTS.tag;
  return base > 0 && a.kind === b.kind ? base + RELATED_WEIGHTS.kind : base;
}

// --- Selectors ------------------------------------------------------------------------------------------------------------------

/** The entries of one kind, authored order, without bodies. */
export function listEntries(projection: PublishedProjection, kind: ContentKind): EntrySummary[] {
  const l = lookups(projection);
  return projection[COLLECTIONS[kind]].map((item, position) => toSummary(kind, item, position, l));
}

/** How many entries each kind has (the archive's size, whatever their places): the empty home page says it. */
export function countEntries(projection: PublishedProjection): Record<ContentKind, number> {
  return Object.fromEntries(CONTENT_KINDS.map((kind) => [kind, projection[COLLECTIONS[kind]].length])) as Record<ContentKind, number>;
}

/** One entry with its body, its places, the entries that share a place with it and its neighbours in the kind. Null when the slug does not exist under that kind. */
export function getEntryDetail(projection: PublishedProjection, kind: ContentKind, slug: string): EntryDetail | null {
  const items = projection[COLLECTIONS[kind]];
  const position = items.findIndex((i) => i.slug === slug);
  const item = items[position];
  if (!item) return null;
  const l = lookups(projection);
  const summary = toSummary(kind, item, position, l);
  const mine = new Set(summary.places.map((p) => p.slug));

  // Every other entry, scored by what it shares (places, tags); the best first, ties in the system order (kind, then authored position).
  const scored: { ref: EntryRef; score: number }[] = [];
  for (const k of CONTENT_KINDS) {
    projection[COLLECTIONS[k]].forEach((other, i) => {
      if (k === kind && other.slug === slug) return;
      const score = relatedScore(
        { kind, places: mine, tags: summary.tags },
        { kind: k, places: placeLinks(k, other, l.byPlace, l.relating).map((p) => p.slug), tags: other.tags ?? [] },
      );
      if (score > 0) scored.push({ ref: toRef(k, other, i), score });
    });
  }
  const related = scored
    .map((entry, order) => ({ ...entry, order }))
    .sort((x, y) => y.score - x.score || x.order - y.order)
    .slice(0, RELATED_LIMIT)
    .map((entry) => entry.ref);
  const before = items[position - 1];
  const after = items[position + 1];
  return {
    ...summary,
    body: item.body ?? [],
    related,
    prev: before ? toRef(kind, before, position - 1) : null,
    next: after ? toRef(kind, after, position + 1) : null,
  };
}

/** The entries linked to a place (its `related` and the entries' `placeSlugs`, each once), grouped by kind in the design system's order; empty kinds are absent. */
export function entriesOfPlace(projection: PublishedProjection, placeSlug: string): EntryGroup[] {
  const place = projection.places.find((p) => p.slug === placeSlug);
  if (!place) return [];
  const l = lookups(projection);
  const named = new Set(place.related.map((r) => refKey(r.kind, r.slug)));
  return CONTENT_KINDS.flatMap((kind): EntryGroup[] => {
    const entries = projection[COLLECTIONS[kind]].flatMap((item, position) =>
      item.placeSlugs.includes(placeSlug) || named.has(refKey(kind, item.slug)) ? [toSummary(kind, item, position, l)] : [],
    );
    return entries.length > 0 ? [{ kind, label: KIND_PLURALS[kind], entries }] : [];
  });
}

// --- Facts, status, language ----------------------------------------------------------------------------------------------

/** The project's `Status` fact is the entry's status (drawn as `[ ACTIVE ]`); every other fact stays a data row. */
export function splitMeta(meta: readonly PublishedMetaEntry[]): { status?: string; facts: PublishedMetaEntry[] } {
  const status = meta.find((m) => m.label.trim().toLowerCase() === "status");
  return { ...(status ? { status: status.value } : {}), facts: meta.filter((m) => m !== status) };
}

const LANGUAGES: Record<string, string> = {
  arabic: "ar", bosnian: "bs", bulgarian: "bg", catalan: "ca", chinese: "zh", croatian: "hr", czech: "cs", danish: "da", dutch: "nl",
  english: "en", finnish: "fi", french: "fr", francais: "fr", german: "de", deutsch: "de", greek: "el", hebrew: "he", hindi: "hi",
  hungarian: "hu", icelandic: "is", indonesian: "id", italian: "it", japanese: "ja", korean: "ko", latin: "la", mandarin: "zh",
  norwegian: "no", polish: "pl", portuguese: "pt", romanian: "ro", russian: "ru", serbian: "sr", slovak: "sk", slovenian: "sl",
  spanish: "es", espanol: "es", swedish: "sv", thai: "th", turkish: "tr", ukrainian: "uk", vietnamese: "vi",
};

/**
 * The BCP 47 tag of an entry's `Language` fact, for the `lang` attribute of its text: a language name in English or in its own
 * language (`English (placeholder)` -> `en`, `Français` -> `fr`) or a tag already (`pt-BR`). Several languages, an unknown name
 * or no `Language` fact give undefined: the page language applies, which is better than a wrong claim.
 */
export function entryLanguage(meta: readonly PublishedMetaEntry[]): string | undefined {
  const fact = meta.find((m) => m.label.trim().toLowerCase() === "language");
  if (!fact) return undefined;
  const value = fact.value
    .replace(/\([^)]*\)/g, " ")
    .trim()
    .toLowerCase();
  if (!value || /[,;/&+]|\band\b|\bet\b/.test(value)) return undefined;
  if (/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(value)) {
    const [language, ...subtags] = value.split("-");
    return [language, ...subtags.map((t) => (t.length === 2 ? t.toUpperCase() : t.length === 4 ? t[0]!.toUpperCase() + t.slice(1) : t))].join("-");
  }
  const folded = value.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  return LANGUAGES[folded];
}

// --- Routes of the panel ----------------------------------------------------------------------------------------------------------

export type PanelRoute = { type: "place"; slug: string } | { type: "entry"; kind: ContentKind; slug: string };

const PATH_KIND = Object.fromEntries(CONTENT_KINDS.map((k) => [KIND_PATHS[k].slice(1), k])) as Record<string, ContentKind>;

/** What the detail panel shows for a pathname: `/locations/:slug` a place, `/<kind>/:slug` an entry, anything else (including the lists) nothing. */
export function parsePanelPath(pathname: string): PanelRoute | null {
  const parts = pathname.split("/").filter((part, i) => part !== "" || i === 0);
  if (parts[0] !== "" || parts.length !== 3 || !parts[1] || !parts[2]) return null;
  let slug: string;
  try {
    slug = decodeURIComponent(parts[2]);
  } catch {
    return null;
  }
  if (parts[1] === "locations") return { type: "place", slug };
  const kind = PATH_KIND[parts[1]];
  return kind ? { type: "entry", kind, slug } : null;
}

export type EntryView = "panel" | "full";

/** The entry's container, from the query (`?view=full`); anything else is the side panel. */
export function parseView(search: string | URLSearchParams): EntryView {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  return params.get("view") === "full" ? "full" : "panel";
}

/** The query string that selects a container, merged into the existing one (other parameters are kept). `panel` removes the parameter. */
export function viewSearch(search: string | URLSearchParams, view: EntryView): string {
  const params = new URLSearchParams(typeof search === "string" ? search : search.toString());
  if (view === "full") params.set("view", "full");
  else params.delete("view");
  const text = params.toString();
  return text ? `?${text}` : "";
}

/**
 * The place a visitor came from inside the panel, read from the navigation state (`{ from: "<place slug>" }`, set by the links on
 * the place panel). State comes from history and can be anything: only a string that names a known place counts.
 */
export function resolveBackTarget(state: unknown, places: readonly { slug: string; name: string }[]): { slug: string; name: string; href: string } | null {
  const from = typeof state === "object" && state !== null ? (state as { from?: unknown }).from : undefined;
  if (typeof from !== "string") return null;
  const place = places.find((p) => p.slug === from);
  return place ? { slug: place.slug, name: place.name, href: placePath(place.slug) } : null;
}
