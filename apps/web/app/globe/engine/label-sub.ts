/**
 * The second line of a box label (pure, unit tested): what a place or a group says about itself under its name.
 *
 *   a PLACE:  <country> · <n articles> · <n artworks> · <n software>      "France · 2 articles · 1 artwork · 3 software"
 *   a GROUP:  <N places> · <the entries of the places below it, same split> "12 places · 2 articles"
 *
 * Every part is optional and nothing is invented: the country is there when the place's code is known, a kind is there when at least one entry of
 * that kind is linked (kinds with none are left out, the line itself when nothing is left). The two PARTS matter to the planner
 * (engine/label-text.ts `labelVariants`): when the label has no room the ENTRIES go first, then the lead (the country, or the number of places),
 * and only then is the name shortened.
 *
 * Entries are the content items (articles, projects, artworks; poems later) linked to a place. They come from the web app's own projection
 * (lib/projection.ts `placeEntries`): the items' `placeSlugs` and the place's `related`, de-duplicated. A group counts the DISTINCT entries linked
 * to any place below it (an article about two of its cities counts once), `nodeEntryCounts`.
 */

/** One linked entry: its kind (the contract's `ContentKind`, or a kind that is not in the contract yet) and its slug. */
export interface EntryRef {
  kind: string;
  slug: string;
}

/** Number of entries per kind. */
export type EntryCounts = Readonly<Record<string, number>>;

/**
 * The kinds of entries a label counts, in the order they are written, with their words. A kind that is not in the table is not counted in a label
 * (add its row here when the contract gets it: poems are the next one). The project kind is shown as "software".
 */
export const ENTRY_KINDS: readonly { kind: string; one: string; many: string }[] = [
  { kind: "article", one: "article", many: "articles" },
  { kind: "artwork", one: "artwork", many: "artworks" },
  { kind: "project", one: "software", many: "software" },
];

/** Between the parts of the second line. */
export const SUB_SEPARATOR = " · ";

/** The two parts of a second line; either can be missing. */
export interface LabelSub {
  /** The country of a place, "<N> places" for a group. */
  lead: string | null;
  /** The linked entries split by kind: "2 articles · 1 artwork". */
  entries: string | null;
}

/** "3 software", "1 artwork". */
export function kindPhrase(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The entries split by kind in the table's order, zero kinds left out; null when there are none. */
export function entriesText(counts: EntryCounts | undefined): string | null {
  if (!counts) return null;
  const parts: string[] = [];
  for (const k of ENTRY_KINDS) {
    const n = counts[k.kind] ?? 0;
    if (n > 0) parts.push(kindPhrase(n, k.one, k.many));
  }
  return parts.length ? parts.join(SUB_SEPARATOR) : null;
}

/** "12 places", "1 place". */
export const placesText = (count: number): string => kindPhrase(count, "place", "places");

/** The second line of a place: its country (when known) and its entries; null when it has neither. */
export function placeSub(country: string | null, counts?: EntryCounts): LabelSub | null {
  const entries = entriesText(counts);
  return country || entries ? { lead: country, entries } : null;
}

/** The second line of a group: the number of places below it and their entries. A group always has places. */
export function groupSub(places: number, counts?: EntryCounts): LabelSub | null {
  return places > 0 ? { lead: placesText(places), entries: entriesText(counts) } : null;
}

/** The whole line, or null when it has no part. */
export function subText(sub: LabelSub | null): string | null {
  if (!sub) return null;
  const parts = [sub.lead, sub.entries].filter((p): p is string => !!p);
  return parts.length ? parts.join(SUB_SEPARATOR) : null;
}

/** The ways of writing the line, longest first: the whole, the lead alone (entries dropped), nothing (lead dropped). Each is a different text. */
export function subSteps(sub: LabelSub | null): (string | null)[] {
  const whole = subText(sub);
  if (!sub || !whole) return [null];
  const out: (string | null)[] = [whole];
  if (sub.lead && sub.entries) out.push(sub.lead);
  out.push(null);
  return out;
}

/** An entry's identity across places. */
const refKey = (r: EntryRef): string => `${r.kind}\u0000${r.slug}`;

/** The entries of one list of refs per kind, each distinct entry once. */
export function countEntries(refs: readonly EntryRef[] | undefined): EntryCounts {
  const out: Record<string, number> = {};
  if (!refs) return out;
  const seen = new Set<string>();
  for (const r of refs) {
    const key = refKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    out[r.kind] = (out[r.kind] ?? 0) + 1;
  }
  return out;
}

/**
 * The entries per kind of every node of a tree: a place's own, and for a group the DISTINCT entries of every place below it. `parent[i]` is the
 * index of node i's parent (-1 for a root), `refs[i]` the entries linked to node i (only places have any). Cycles in `parent` are cut at `n` steps.
 */
export function nodeEntryCounts(parent: ArrayLike<number>, refs: readonly (readonly EntryRef[] | undefined)[]): EntryCounts[] {
  const n = refs.length;
  const sets: (Map<string, string> | undefined)[] = Array.from({ length: n });
  for (let i = 0; i < n; i++) {
    const own = refs[i];
    if (!own || own.length === 0) continue;
    for (let a = i, steps = 0; a >= 0 && steps <= n; a = parent[a]!, steps++) {
      const set = (sets[a] ??= new Map<string, string>());
      for (const r of own) set.set(refKey(r), r.kind);
    }
  }
  return Array.from({ length: n }, (_, i) => {
    const out: Record<string, number> = {};
    const set = sets[i];
    if (set) for (const kind of set.values()) out[kind] = (out[kind] ?? 0) + 1;
    return out;
  });
}
