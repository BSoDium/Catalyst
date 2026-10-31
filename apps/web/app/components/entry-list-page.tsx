import { useState } from "react";
import { Link, useLocation } from "react-router";
import type { ContentKind } from "@catalyst/schemas";
import { ArtworkWall } from "~/components/entry/artwork-wall";
import { GalleryEnd } from "~/components/entry/gallery-end";
import { EntryRow } from "~/components/entry/entry-list-card";
import { Button, ScrollRow, StatePanel } from "~/components/ui";
import { KIND_PLURALS, kindCount, listBackState, type EntrySummary } from "~/lib/entries";
import { collectTags, filterByTag, groupByYear, parseTagFilter, shouldGroupByYear, tagSearch, type TagCount } from "~/lib/entry-list";
import { SITE_NAME } from "~/lib/site";

/** Tags shown before "more": the rest sit one press away (the selected tag is always shown). */
const TAGS_SHOWN = 10;

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
export function EntryListPage({ kind, items }: { kind: ContentKind; items: EntrySummary[] }) {
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
        <p className="list-running type-meta">
          <span>{SITE_NAME}</span>
          <span data-slot="list-count">
            {tag ? `${shown.length} of ${total}` : total}
          </span>
        </p>
        <h1 className="list-title">{KIND_PLURALS[kind]}</h1>
      </header>

      {tags.length > 0 && items.length > 1 && <TagFilter tags={tags} selected={tag} search={search} label={`Filter ${section} by tag`} />}
      <p role="status" className="sr-only">
        {tag ? `Showing ${shown.length} of ${total} tagged ${tag}` : ""}
      </p>

      <div className="mt-8 flex flex-col gap-14">
        {items.length === 0 ? (
          <StatePanel state="empty" headingLevel={2} title="Nothing here yet." />
        ) : wall ? (
          // One wall for every year, newest first: the year is in each caption, and a heading would cut the bricks.
          <>
            <ArtworkWall items={groups.flatMap((g) => g.items)} headingLevel={2} label={KIND_PLURALS[kind]} kind={kind} linkState={listBackState(kind, search)} />
            {kind === "photograph" && <GalleryEnd />}
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
 * The tag filter: one text link per tag (and "All"), each to the same page with `?tag=`; the selected one is heavier, underlined and `aria-current`.
 * Links, not buttons: the state is the URL. More than `TAGS_SHOWN` tags fold behind a "more" button (the selected tag stays visible).
 */
function TagFilter({ tags, selected, search, label }: { tags: TagCount[]; selected: string | null; search: string; label: string }) {
  const [open, setOpen] = useState(false);
  const folded = tags.length > TAGS_SHOWN + 2 && !open;
  const visible = folded ? tags.filter((t, i) => i < TAGS_SHOWN || t.tag === selected) : tags;
  const hidden = tags.length - visible.length;
  const link = (to: string | null, text: string, current: boolean, key: string) => (
    <li key={key}>
      <Link to={{ search: tagSearch(search, to) }} preventScrollReset replace aria-current={current ? "true" : undefined} className="ds-filter" data-filter={to ?? "all"}>
        <span>{text}</span>
      </Link>
    </li>
  );
  return (
    <nav aria-label={label} data-slot="tag-filter" className="list-filter">
      <ScrollRow noun="tags">
        <ul className="ds-filter-row flex list-none gap-0">
        {link(null, "All", selected === null, "all")}
        {visible.map((t) => link(t.tag, t.tag, selected === t.tag, t.tag))}
        {(hidden > 0 || (open && tags.length > TAGS_SHOWN + 2)) && (
          <li>
            <Button variant="link" size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              {open ? "Fewer tags" : `+${hidden} more`}
            </Button>
          </li>
        )}
        </ul>
      </ScrollRow>
    </nav>
  );
}
