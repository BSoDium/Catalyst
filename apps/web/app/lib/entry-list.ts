/**
 * Pure helpers of the list pages (`/articles`, ...): the tag filter (one tag, in the URL as `?tag=`) and the grouping by year.
 * The URL is the state, so a filtered list can be linked, reloaded and read without scripts.
 */
import type { EntrySummary } from "./entries";

export const TAG_PARAM = "tag";

export interface TagCount {
  tag: string;
  count: number;
}

const norm = (tag: string) => tag.trim().toLowerCase();

/** Every tag used by the entries with how many entries carry it (an entry counts once per tag), most used first, then A to Z. Tags that differ only in case are one (the first spelling is kept). */
export function collectTags(items: readonly Pick<EntrySummary, "tags">[]): TagCount[] {
  const counts = new Map<string, TagCount>();
  for (const item of items) {
    const seen = new Set<string>();
    for (const raw of item.tags) {
      const key = norm(raw);
      if (key === "" || seen.has(key)) continue;
      seen.add(key);
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { tag: raw.trim(), count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "en"));
}

/** The tag a query string selects, as spelled by the entries, or null when there is none or it is not one of `known` (a stale or hand-written link shows the whole list). */
export function parseTagFilter(search: string | URLSearchParams, known: readonly TagCount[]): string | null {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const wanted = params.get(TAG_PARAM);
  if (wanted === null) return null;
  return known.find((k) => norm(k.tag) === norm(wanted))?.tag ?? null;
}

/** The query string that selects a tag (null clears it), merged into the existing one: other parameters are kept. */
export function tagSearch(search: string | URLSearchParams, tag: string | null): string {
  const params = new URLSearchParams(typeof search === "string" ? search : search.toString());
  if (tag === null) params.delete(TAG_PARAM);
  else params.set(TAG_PARAM, tag);
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** The entries that carry the tag (all of them for null), authored order kept. */
export function filterByTag<T extends Pick<EntrySummary, "tags">>(items: readonly T[], tag: string | null): T[] {
  if (tag === null) return [...items];
  const key = norm(tag);
  return items.filter((item) => item.tags.some((t) => norm(t) === key));
}

export interface YearGroup<T> {
  /** `2026`, or `undated`. */
  key: string;
  year: number | null;
  items: T[];
}

/** The four-digit year of a partial ISO date (`2024`, `2024-06`, `2024-06-19`), or null. */
export function yearOf(date: string | undefined): number | null {
  const match = date ? /^(\d{4})(?:-\d{2}(?:-\d{2})?)?$/.exec(date) : null;
  return match ? Number(match[1]) : null;
}

/** Groups entries by year, newest year first; inside a year the newest first (by the date string, which sorts as written), authored order breaking ties; undated entries last. */
export function groupByYear<T extends Pick<EntrySummary, "date">>(items: readonly T[]): YearGroup<T>[] {
  const byYear = new Map<number | null, { item: T; order: number }[]>();
  items.forEach((item, order) => {
    const year = yearOf(item.date);
    const list = byYear.get(year) ?? [];
    list.push({ item, order });
    byYear.set(year, list);
  });
  const years = [...byYear.keys()].sort((a, b) => (a === null ? 1 : b === null ? -1 : b - a));
  return years.map((year) => ({
    key: year === null ? "undated" : String(year),
    year,
    items: byYear
      .get(year)!
      .sort((a, b) => (yearOf(b.item.date) === null ? "" : b.item.date!).localeCompare(yearOf(a.item.date) === null ? "" : a.item.date!) || a.order - b.order)
      .map((e) => e.item),
  }));
}

/** Year headings need company: grouped only when at least two years are present and the groups average two entries or more (a heading over every single card is a timeline, not a grouping). */
export function shouldGroupByYear(groups: readonly YearGroup<unknown>[]): boolean {
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  return groups.length >= 2 && total >= groups.length * 2;
}
