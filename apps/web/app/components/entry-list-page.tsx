import { useId, useState } from "react";
import { Link, useLocation } from "react-router";
import type { ContentKind } from "@catalyst/schemas";
import { ArtworkWall } from "~/components/entry/artwork-wall";
import { GalleryEnd } from "~/components/entry/gallery-end";
import { ARTWORK_FILLER, GALLERY_FILLER } from "~/lib/gallery-filler";
import { ActivityPanel } from "~/components/activity-panel";
import { EntryRow } from "~/components/entry/entry-list-card";
import { Button, ScrollRow, StatePanel } from "~/components/ui";
import { cn } from "~/lib/utils";
import { KIND_NOUNS, KIND_PLURALS, kindCount, listBackState, type EntrySummary } from "~/lib/entries";
import { collectTags, filterByTag, groupByYear, listStats, parseTagFilter, shouldGroupByYear, tagSearch, type TagCount } from "~/lib/entry-list";

/** Tags shown before "more": the rest sit one press away (the selected tag is always shown). */
const TAGS_SHOWN = 10;

/** What continues a wall under its banner: the photographs' and the artworks' have one, the other lists none. */
function wallEnd(kind: ContentKind) {
  if (kind === "photograph") return { filler: GALLERY_FILLER, end: <GalleryEnd /> };
  if (kind === "artwork") return { filler: ARTWORK_FILLER, end: <GalleryEnd kind="artwork" /> };
  return {};
}

/**
 * `/software`, `/articles`, `/artworks`, `/poetry`, `/photography`: the section's front page, set as the contents page of a journal (docs/design-system.md,
 * "Entry pages", "Lists"): a running head (the journal's name, the owner's, at the left; the folio, the plain count, at the right) over ONE
 * hairline, the section's name at the headline scale in a lighter weight, the tag filter in plain space, then the entries as hairline rows (`EntryRow`: date and places in
 * mono, the title heavy over a thin summary, the image where there is one), grouped by year (newest first) when a year holds more than
 * one. The filter is the URL (`?tag=rail`: a link, a reload, the back button; works without scripts) and each choice is a link. An empty
 * collection is one muted line. Each row keeps the entry's slug as its anchor id (`/articles#slug`).
 *
 * Three sections are set differently: `/artworks` and `/photography` are ONE brick wall of pictures (`ArtworkWall`, no year headings: the year is in each caption) and
 * `/poetry` sets the poems in two columns from 44 rem of the page's width. All five pages are the same width (100 rem), so the titles and the content keep their left edge from tab to tab, with the summary in the reading face at a larger size.
 */
export function EntryListPage({ kind, items, activityUrl = null }: { kind: ContentKind; items: EntrySummary[]; activityUrl?: string | null }) {
  const { search } = useLocation();
  const tags = collectTags(items);
  const tag = parseTagFilter(search, tags);
  const shown = filterByTag(items, tag);
  const byYear = groupByYear(shown);
  // Newest first either way; the year headings only when they group something (`shouldGroupByYear`).
  const grouped = shouldGroupByYear(byYear);
  const groups = grouped ? byYear : [{ key: "all", year: null, items: byYear.flatMap((g) => g.items) }];
  const cardLevel = grouped ? 3 : 2;
  // The section's name for labels ("Filter poetry by tag"), the count noun for counts ("4 poems", "33 software").
  const section = KIND_PLURALS[kind].toLowerCase();
  // One implementation of the count noun: `kindCount` ("33 software", "1 poem").
  const total = kindCount(kind, items.length);
  let seen = 0;
  // The software page's head has no "since" (the activity picture sits under it), and from 80 rem its figures join the picture's grid (`ActivityPanel` `lead`).
  const heads = listStats(items, { shown: shown.length, total: items.length, noun: shown.length === 1 ? KIND_NOUNS[kind].one : KIND_NOUNS[kind].many }, { since: kind !== "project" });
  const withPanel = kind === "project" && (import.meta.env.DEV || !!activityUrl);
  const wall = kind === "artwork" || kind === "photograph";
  const poems = kind === "poem";

  return (
    <main
      id="main"
      tabIndex={-1}
      data-surface="reading"
      data-layout="full"
      data-list={kind}
      className="entry mx-auto max-w-[100rem] px-4 pt-[calc(var(--navbar-height)+1.5rem)] min-[56rem]:pt-[calc(var(--navbar-height)+3rem)] pb-24 outline-none md:px-14"
    >
      <header data-slot="list-head" className="list-head">
        <h1 className="list-title">{KIND_PLURALS[kind]}</h1>
        {/* The figures of the list: how many (of how many when a tag filters), since when, how many places. There is no running head above the title any more (the owner's name and the count were said again by the figures: owner, 2026-11-03) */}
        <dl data-slot="list-stats" className={cn("list-stats", withPanel && "min-[80rem]:invisible")}>
          {heads.map((stat) => (
            <div key={stat.label} className="list-stat">
              <dd className="list-stat-value">{stat.value}</dd>
              <dt className="list-stat-label type-meta">{stat.label}</dt>
            </div>
          ))}
        </dl>
      </header>

      {kind === "project" && <ActivityPanel url={activityUrl} lead={heads} />}

      {tags.length > 0 && items.length > 1 && <TagFilter tags={tags} selected={tag} search={search} label={`Filter ${section} by tag`} />}
      <p role="status" className="sr-only">
        {tag ? `Showing ${shown.length} of ${total} tagged ${tag}` : ""}
      </p>

      {/* Close under the filter (owner, 2026-11-03): the filter sits in the angle between the first entry's top and the left edge; a list with YEAR headings keeps a little more room (a big year numeral follows the filter) */}
      <div className={cn("flex flex-col gap-14", grouped ? "mt-8 max-md:mt-4" : "mt-6 max-md:mt-1.5")}>
        {items.length === 0 ? (
          <StatePanel state="empty" headingLevel={2} title="Nothing here yet." />
        ) : wall ? (
          // One wall for every year, newest first: the year is in each caption, and a heading would cut the bricks.
          <>
            <ArtworkWall
              items={groups.flatMap((g) => g.items)}
              headingLevel={2}
              label={KIND_PLURALS[kind]}
              kind={kind}
              linkState={listBackState(kind, search)}
              {...wallEnd(kind)}
            />
          </>
        ) : (
          groups.map((group) => {
            const id = `year-${group.key}`;
            return (
              <section key={group.key} aria-labelledby={grouped ? id : undefined} data-year={group.key}>
                {grouped && (
                  <h2 id={id} className="ds-year type-display-lg type-thin m-0 mb-6">
                    {group.year ?? "Undated"}
                    <span className="sr-only">, {group.items.length === 1 ? "1 entry" : `${group.items.length} entries`}</span>
                  </h2>
                )}
                <div role="list" aria-label={grouped ? `${KIND_PLURALS[kind]} ${group.year ?? "undated"}` : KIND_PLURALS[kind]} className={poems ? "poem-grid" : "flex flex-col"}>
                  {group.items.map((entry) => {
                    const priority = seen++ < 3;
                    return (
                      <div key={entry.slug} role="listitem" className="min-w-0">
                        <EntryRow entry={entry} headingLevel={cardLevel} priority={priority} className="scroll-mt-24" linkState={listBackState(kind, search)} />
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })
        )}
      </div>
    </main>
  );
}

/**
 * The tag filter: one link per tag (and "All"), each to the same page with `?tag=`; the selected one is a filled plate (and `aria-current`), each tag shows how many entries it holds. Links, not buttons: the state is the URL.
 * More than `TAGS_SHOWN` tags fold: the row keeps the most used (and the selected one), and "+N more" opens a search over all of them (typing narrows the list; Escape closes it).
 */
function TagFilter({ tags, selected, search, label }: { tags: TagCount[]; selected: string | null; search: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const id = useId();
  const foldable = tags.length > TAGS_SHOWN + 2;
  const visible = foldable ? tags.filter((t, i) => i < TAGS_SHOWN || t.tag === selected) : tags;
  const hidden = tags.length - visible.length;
  const q = query.trim().toLowerCase();
  const matches = q ? tags.filter((t) => t.tag.toLowerCase().includes(q)) : tags;
  const link = (to: string | null, text: string, current: boolean, key: string, count?: number) => (
    <li key={key}>
      <Link to={{ search: tagSearch(search, to) }} preventScrollReset replace aria-current={current ? "true" : undefined} className="ds-filter" data-filter={to ?? "all"}>
        <span>
          {text}
          {count !== undefined && <span className="ds-filter-count" aria-label={`, ${count} ${count === 1 ? "entry" : "entries"}`}>{count}</span>}
        </span>
      </Link>
    </li>
  );
  return (
    <nav aria-label={label} data-slot="tag-filter" className="list-filter">
      <ScrollRow noun="tags">
        <ul className="ds-filter-row flex list-none gap-0">
          {link(null, "All", selected === null, "all")}
          {visible.map((t) => link(t.tag, t.tag, selected === t.tag, t.tag, t.count))}
          {foldable && (
            <li>
              <Button variant="link" size="sm" aria-expanded={open} aria-controls={`${id}-panel`} onClick={() => setOpen((v) => !v)}>
                {open ? "Fewer tags" : `+${hidden} more`}
              </Button>
            </li>
          )}
        </ul>
      </ScrollRow>
      {foldable && open && (
        <div id={`${id}-panel`} data-slot="tag-search" className="tag-search" onKeyDown={(e) => e.key === "Escape" && (setOpen(false), setQuery(""))}>
          <label htmlFor={`${id}-q`} className="sr-only">
            Search {tags.length} tags
          </label>
          <input id={`${id}-q`} type="search" autoFocus autoComplete="off" spellCheck={false} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${tags.length} tags`} className="tag-search-input" />
          <ul className="ds-filter-row flex list-none flex-wrap gap-0">{matches.map((t) => link(t.tag, t.tag, selected === t.tag, `m-${t.tag}`, t.count))}</ul>
          <p role="status" className={matches.length ? "sr-only" : "tag-search-empty"}>
            {matches.length ? `${matches.length} of ${tags.length} tags` : `No tag matches "${query.trim()}".`}
          </p>
        </div>
      )}
    </nav>
  );
}
