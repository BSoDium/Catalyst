import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { Button, ScrollRow } from "~/components/ui";
import { foldTags, matchTags, tagSearch, type TagCount } from "~/lib/entry-list";

/** Tags shown before "more": the rest sit one press away (the selected tag is always shown). */
export const TAGS_SHOWN = 10;

/**
 * The tag filter of a list: one link per tag (and "All"), each to the same page with `?tag=`, the state being the URL (a link, a reload, the back button; it works without scripts). The chosen tag is a filled plate (and `aria-current`)
 * and each tag shows how many entries it holds. More than `limit` tags fold; "+N more" does not open anything else: THE SAME ROW opens out, a search field slides in above it and the rest of the tags follow on, wrapped; typing narrows
 * them, Escape (or "Fewer tags") folds it back. Every chip has the same box whether chosen or not, so choosing one moves nothing. `search` is the page's current query string; it is only carried, never read.
 */
export function TagFilter({ tags, selected, search, label, limit = TAGS_SHOWN }: { tags: TagCount[]; selected: string | null; search: string; label: string; limit?: number }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const { visible, hidden, foldable } = foldTags(tags, selected, limit);
  const shown = open ? matchTags(tags, query) : visible;
  // (the field takes focus when the row opens out, without moving the page)
  useEffect(() => {
    if (open) input.current?.focus({ preventScroll: true });
  }, [open]);
  const close = () => {
    setOpen(false);
    setQuery("");
    toggle.current?.focus({ preventScroll: true });
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
        <div className="tag-search" data-open={open ? "true" : undefined}>
          <div className="tag-search-inner">
            <label htmlFor={`${id}-q`} className="sr-only">
              Search {tags.length} tags
            </label>
            <input ref={input} id={`${id}-q`} type="search" inert={!open} autoComplete="off" spellCheck={false} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${tags.length} tags`} className="tag-search-input" />
          </div>
        </div>
      )}
      <ScrollRow noun="tags">
        <ul className="ds-filter-row flex list-none gap-0">
          {chip(null, "All")}
          {shown.map((t) => chip(t.tag, t.tag, t.count))}
          {foldable && (
            <li>
              <Button ref={toggle} variant="link" size="sm" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}>
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
