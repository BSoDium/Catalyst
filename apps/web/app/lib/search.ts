/**
 * Quick search over the places and the entries (docs/design-system.md, "Search"): the index is built on the server from the published
 * projection (titles, kinds, tags, one-line summaries; never a body) and filtered in the browser. Pure and tested: accents and case are
 * folded, every word of the query must match, a word that starts a word of the title counts most.
 */
import type { ContentKind, PublishedProjection } from "@catalyst/schemas";
import { CAREER_LABEL, CAREER_PATH } from "./career";
import { COLLECTIONS, CONTENT_KINDS, entryPath, KIND_LABELS, KIND_NOUNS, KIND_PLURALS, placePath } from "./entries";
import { countryName } from "./country";
import { formatEntryDate } from "./dates";
import { SECTIONS } from "./sections";

/** `career` is the one page of the site that is neither a place nor an entry (the curriculum vitae); present only when the projection has it. */
export type SearchType = "place" | ContentKind | "career";

/** The order of the groups of results. */
export const SEARCH_TYPES = ["place", ...CONTENT_KINDS, "career"] as const satisfies readonly SearchType[];

export interface SearchItem {
  type: SearchType;
  title: string;
  /** Where it goes. */
  href: string;
  /** The second line: a place's region, an entry's date (`2022.06`). The kind is the row's glyph and its group, so it is not repeated. */
  sub?: string;
  /** Extra words that match but are not shown: tags and the summary. */
  keywords?: string;
}

export const SEARCH_LABELS: Record<SearchType, string> = { place: "Places", ...KIND_PLURALS, career: CAREER_LABEL };
export const SEARCH_SINGULAR: Record<SearchType, string> = { place: "Place", ...KIND_LABELS, career: CAREER_LABEL };

/** Lowercase, accents removed (`Hué` -> `hue`, `Reykjavík` -> `reykjavik`), runs of other characters as one space. */
export function foldText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Every place and every entry of the projection as a search item, places first, then the kinds in the system order, authored order inside. */
export function buildSearchIndex(projection: PublishedProjection): SearchItem[] {
  const places = projection.places.map(
    (p): SearchItem => ({ type: "place", title: p.name, href: placePath(p.slug), ...(p.region ? { sub: p.region } : {}), ...(p.summary ? { keywords: p.summary } : {}) }),
  );
  const entries = CONTENT_KINDS.flatMap((kind) =>
    projection[COLLECTIONS[kind]].map((item): SearchItem => {
      const date = formatEntryDate(item.date);
      // the kind's words stay findable ("poem", "poems" and the section's name "poetry" list the poems) though the row no longer spells them out;
      // so do the contract's kind id and the section's former names ("project", "projects" still list the software)
      const keywords = [KIND_LABELS[kind], KIND_NOUNS[kind].many, KIND_PLURALS[kind], kind, ...SECTIONS[kind].formerSlugs, ...(item.tags ?? []), countryName(item.countryCode) ?? "", item.summary ?? ""]
        .join(" ")
        .trim();
      return {
        type: kind,
        title: item.title,
        href: entryPath(kind, item.slug),
        ...(date ? { sub: date.text } : {}),
        ...(keywords ? { keywords } : {}),
      };
    }),
  );
  // The curriculum vitae: one row, found by its words (career, CV, resume, experience...), the employers and the skills it names.
  const career = projection.career;
  const careerRow: SearchItem[] = career
    ? [
        {
          type: "career",
          title: career.title,
          href: CAREER_PATH,
          keywords: [
            "career about cv resume curriculum vitae experience education languages skills",
            ...career.roles.map((r) => `${r.org} ${r.title}`),
            ...career.education.map((e) => e.institution),
            ...career.skills.flatMap((g) => g.items),
          ].join(" "),
        },
      ]
    : [];
  return [...places, ...entries, ...careerRow];
}

interface Folded {
  title: string;
  titleWords: string[];
  rest: string;
}

const cache = new WeakMap<SearchItem, Folded>();
function folded(item: SearchItem): Folded {
  let f = cache.get(item);
  if (!f) {
    const title = foldText(item.title);
    f = { title, titleWords: title.split(" "), rest: foldText(`${item.sub ?? ""} ${item.keywords ?? ""}`) };
    cache.set(item, f);
  }
  return f;
}

/** The score of one query word against an item: 4 a word of the title that starts with it, 3 inside the title, 1 anywhere else (tags, summary); 0 no match. */
function wordScore(word: string, f: Folded): number {
  if (f.titleWords.some((w) => w.startsWith(word))) return 4;
  if (f.title.includes(word)) return 3;
  if (f.rest.includes(word)) return 1;
  return 0;
}

/**
 * Every item matching a query, best first (ties: the group order, then the title). Every word of the query must match somewhere; an
 * empty or blank query gives nothing (the palette shows its hint instead). Not capped: `searchItems` caps it for display, and the
 * palette reads the whole length for its count.
 */
export function rankItems(items: readonly SearchItem[], query: string): SearchItem[] {
  const words = foldText(query).split(" ").filter(Boolean);
  if (words.length === 0) return [];
  const scored: { item: SearchItem; score: number; order: number }[] = [];
  items.forEach((item, order) => {
    const f = folded(item);
    let score = 0;
    for (const word of words) {
      const s = wordScore(word, f);
      if (s === 0) return;
      score += s;
    }
    // A title that equals the query, or starts with it, comes first.
    const whole = words.join(" ");
    if (f.title === whole) score += 6;
    else if (f.title.startsWith(whole)) score += 2;
    scored.push({ item, score, order });
  });
  scored.sort((a, b) => b.score - a.score || SEARCH_TYPES.indexOf(a.item.type) - SEARCH_TYPES.indexOf(b.item.type) || a.order - b.order);
  return scored.map((s) => s.item);
}

/** The best `limit` matches of a query (see `rankItems`). */
export function searchItems(items: readonly SearchItem[], query: string, limit = 20): SearchItem[] {
  return rankItems(items, query).slice(0, Math.max(0, limit));
}

/**
 * What the palette says about its list: the real count, and when the list is capped, how much of it is shown ("Showing 24 of 31"):
 * a count that stopped at the cap would pass 24 off as everything there is.
 */
export function resultsStatus(shown: number, total: number): string {
  if (total === 0) return "No results";
  if (shown < total) return `Showing ${shown} of ${total}`;
  return `${total} ${total === 1 ? "result" : "results"}`;
}

/** The results grouped for display (group order, best first inside), the flat order kept in `flat` (what the arrow keys walk). */
export function groupResults(results: readonly SearchItem[]): { groups: { type: SearchType; label: string; items: SearchItem[] }[]; flat: SearchItem[] } {
  const groups = SEARCH_TYPES.flatMap((type) => {
    const items = results.filter((r) => r.type === type);
    return items.length > 0 ? [{ type, label: SEARCH_LABELS[type], items }] : [];
  });
  return { groups, flat: groups.flatMap((g) => g.items) };
}
