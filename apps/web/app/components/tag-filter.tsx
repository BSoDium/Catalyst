import { useId, useState } from "react";
import { Link } from "react-router";
import { Button, ScrollRow } from "~/components/ui";
import { foldTags, matchTags, tagSearch, type TagCount } from "~/lib/entry-list";

/** Tags shown before "more": the rest sit one press away (the selected tag is always shown). */
export const TAGS_SHOWN = 10;

/**
 * The tag filter of a list: one link per tag (and "All"), each to the same page with `?tag=`, the state being the URL (a link, a reload, the back button; it works without scripts). The chosen tag is a filled plate (and `aria-current`)
 * and each tag shows how many entries it holds. More than `limit` tags fold; "+N more" does not open anything else: THE SAME ROW opens out, the rest of the tags follow on, wrapped. A search field is always above the row (a folded list hides tags the reader cannot see, so
 * the way to them is not behind a button); typing opens the row out and narrows it, Escape (or "Fewer tags") folds it back. Every chip has the same box whether chosen or not, so choosing one moves nothing. `search` is the page's current query string; it is only carried, never read.
 */
export function TagFilter({ tags, selected, search, label, limit = TAGS_SHOWN }: { tags: TagCount[]; selected: string | null; search: string; label: string; limit?: number }) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  // (typing opens the row out by itself: a search that left the tags folded would find nothing)
  const open = expanded || query.trim() !== "";
  const id = useId();
  const { visible, hidden, foldable } = foldTags(tags, selected, limit);
  const shown = open ? matchTags(tags, query) : visible;
  const close = () => {
    setExpanded(false);
    setQuery("");
  };
  const chip = (to: string | null, text: string, count?: number) => {
    const current = (to ?? null) === selected;
    return (
      <li key={to ?? "all"}>
        <Link to={{ search: tagSearch(search, to) }} preventScrollReset replace aria-current={current ? "true" : undefined} className="ds-filter" data-filter={to ?? "all"}>
          <span>
            {text}
            {count !== undefined && (
              <span className="ds-filter-count" aria-label={`, ${count} ${count === 1 ? "entry" : "entries"}`}>
                {count}
              </span>
            )}
          </span>
        </Link>
      </li>
    );
  };
  return (
    <nav aria-label={label} data-slot="tag-filter" data-open={open ? "true" : undefined} className="list-filter" onKeyDown={(e) => open && e.key === "Escape" && close()}>
      {foldable && (
        <div className="tag-search">
          <label htmlFor={`${id}-q`} className="sr-only">
            Search {tags.length} tags
          </label>
          <input id={`${id}-q`} type="search" autoComplete="off" spellCheck={false} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${tags.length} tags`} className="tag-search-input" />
        </div>
      )}
      <ScrollRow noun="tags">
        <ul className="ds-filter-row flex list-none gap-0">
          {chip(null, "All")}
          {shown.map((t) => chip(t.tag, t.tag, t.count))}
          {foldable && (
            <li>
              <Button variant="link" size="sm" aria-expanded={open} onClick={() => (open ? close() : setExpanded(true))}>
                {open ? "Fewer tags" : `+${hidden} more`}
              </Button>
            </li>
          )}
        </ul>
      </ScrollRow>
      <p role="status" className={open && query.trim() && shown.length === 0 ? "tag-search-empty" : "sr-only"}>
        {open && query.trim() ? (shown.length ? `${shown.length} of ${tags.length} tags` : `No tag matches "${query.trim()}".`) : ""}
      </p>
    </nav>
  );
}
