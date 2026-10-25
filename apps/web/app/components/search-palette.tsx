import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Frame, Icon, KeyHint, KindTag } from "~/components/ui";
import { prepareInterlude, requestInterlude, unlockSound } from "~/globe";
import { matchesSurprise, SURPRISE } from "~/lib/interlude";
import { groupResults, rankItems, resultsStatus, SEARCH_LABELS, type SearchItem } from "~/lib/search";
import { cn } from "~/lib/utils";

/** The palette lists this many at most; its count still says how many matched (`resultsStatus`). */
const MAX_RESULTS = 24;

/** The hidden entry that plays the cinematic interlude (`lib/interlude.ts`): one row, listed after every result, found only by typing its own words. */
const SURPRISE_ROW = { surprise: true as const };
type Row = SearchItem | typeof SURPRISE_ROW;
const isSurprise = (row: Row | undefined): row is typeof SURPRISE_ROW => row !== undefined && "surprise" in row;

type Load = { state: "idle" } | { state: "loading" } | { state: "error" } | { state: "ready"; items: SearchItem[] };

/** The index is fetched once per page load, the first time the palette opens. */
let pending: Promise<SearchItem[]> | null = null;
function loadIndex(): Promise<SearchItem[]> {
  pending ??= fetch("/search-index.json", { headers: { Accept: "application/json" } })
    .then((r) => (r.ok ? (r.json() as Promise<SearchItem[]>) : Promise.reject(new Error(String(r.status)))))
    .catch((e) => {
      pending = null;
      throw e;
    });
  return pending;
}

/** Anything on the page (the landing hero's search line) opens the palette by this event; the palette is mounted once, by the navigation. */
const OPEN_SEARCH_EVENT = "site:open-search";

/** Open the quick search palette. A no-op until the navigation has mounted it (the hydration). */
export function openSearch(): void {
  window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));
}

/**
 * The header's search trigger, one control at every width: the search icon, the word "Search" and the key hint (command icon + K, or
 * Ctrl K) as one run of the header's own type (`.nav-link`, mono capitals), so it reads as the sixth item of the row and not as an icon
 * apart. The two glyphs are the SAME size, 1.1 em of that type (both `inline`; `.nav-search .ds-kbd` takes the row's size, not the hint's
 * own 13 px), and the row centres them on the capitals' middle. Under 22 rem of header (a 320 px phone) the icon is not drawn and the
 * row keeps the one word; the hint is drawn from 36 rem. It only
 * sends the open event: the palette itself (`SearchPalette`) is mounted once, next to the header and not inside it, so that the header
 * can come and go (the home page's header is absent while the hero is at rest) without closing a palette that is open.
 */
export function SearchTriggers() {
  return (
    <button
      type="button"
      onClick={openSearch}
      aria-keyshortcuts="Control+K Meta+K"
      aria-haspopup="dialog"
      data-slot="search-trigger"
      data-needs-script=""
      className="nav-link nav-search pointer-events-auto inline-flex min-h-11 min-w-11 items-center justify-center text-muted-foreground"
    >
      <Icon name="search" size="inline" />
      <span>Search</span>
      <KeyHint className="hidden @xl:inline-flex" />
    </button>
  );
}

/**
 * Quick search (Cmd or Ctrl + K, the hero's search line, or the header's trigger): a modal `dialog` holding an ARIA combobox over the places and
 * entries. The input owns the focus; the arrow keys move a highlight (`aria-activedescendant`) through the listbox, Enter opens it,
 * Escape closes and gives the focus back. Results are grouped (places, then the four kinds), each row led by the kind's icon at the control size. The index
 * is fetched once (`/search-index.json`) and searched in the browser (`lib/search.ts`). Nothing renders before the first open.
 */
export function SearchPalette() {
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [load, setLoad] = useState<Load>({ state: "idle" });
  const id = useId();
  const listId = `${id}-list`;

  const show = useCallback(() => {
    setOpen(true);
  }, []);
  const hide = useCallback(() => {
    dialogRef.current?.close();
  }, []);

  useEffect(() => {
    const onOpen = () => show();
    window.addEventListener(OPEN_SEARCH_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SEARCH_EVENT, onOpen);
  }, [show]);

  // The shortcut works from anywhere, also while a field has the focus (it is a chord).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (dialogRef.current?.open) dialogRef.current.close();
        else show();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [show]);

  // Opening: show the dialog modally (focus trap, inert page, Escape) and load the index.
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    setQuery("");
    setActive(0);
    if (load.state === "idle" || load.state === "error") {
      setLoad({ state: "loading" });
      loadIndex().then(
        (items) => setLoad({ state: "ready", items }),
        () => setLoad({ state: "error" }),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const matches = useMemo(() => (load.state === "ready" ? rankItems(load.items, query) : []), [load, query]);
  const results = useMemo(() => matches.slice(0, MAX_RESULTS), [matches]);
  const { groups, flat: found } = useMemo(() => groupResults(results), [results]);
  // The surprise is for a visitor who types its words, and not under reduced motion (the interlude is all motion): the last row, after what the query found.
  const surprise = useMemo(() => matchesSurprise(query) && !(typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches), [query]);
  // (the entry is on the list: the globe makes what the interlude needs now, while the visitor decides, so that choosing it starts it without a stall)
  useEffect(() => {
    if (surprise) prepareInterlude();
  }, [surprise]);
  const flat = useMemo<Row[]>(() => (surprise ? [...found, SURPRISE_ROW] : found), [found, surprise]);
  const current = flat[Math.min(active, flat.length - 1)];

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, flat]);

  const go = (item: Row) => {
    hide();
    if (isSurprise(item)) return summon();
    void navigate(item.href);
  };

  /**
   * Play the interlude. Inside the click or the key press, so that the browser lets the sound start (`unlockSound`); the palette is closed first (it is modal and covers
   * the page). When the home globe is not the page (a place or an entry is open, or another route) the visitor goes home and it plays when the globe has settled there.
   */
  const summon = () => {
    unlockSound();
    if (requestInterlude()) return;
    void navigate("/");
    let tries = 0;
    const timer = window.setInterval(() => {
      if (requestInterlude() || ++tries > 30) window.clearInterval(timer);
    }, 300);
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (flat.length) setActive((a) => (a + 1) % flat.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (flat.length) setActive((a) => (a - 1 + flat.length) % flat.length);
    } else if (e.key === "Home" && flat.length) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End" && flat.length) {
      e.preventDefault();
      setActive(flat.length - 1);
    } else if (e.key === "Enter" && current) {
      e.preventDefault();
      go(current);
    }
  };

  const total = load.state === "ready" ? load.items.length : 0;
  const hasQuery = query.trim() !== "";
  const status =
    load.state === "loading"
      ? "Loading the index"
      : load.state === "error"
        ? "The search could not be loaded"
        : !hasQuery
          ? ""
          : resultsStatus(results.length + (surprise ? 1 : 0), matches.length + (surprise ? 1 : 0));

  return (
    <>
      {open && (
        <dialog
          ref={dialogRef}
          aria-labelledby={`${id}-title`}
          data-slot="search-palette"
          onClose={() => setOpen(false)}
          onClick={(e) => {
            if (e.target === dialogRef.current) hide();
          }}
          className="pointer-events-auto m-0 mx-auto mt-[10dvh] w-[min(38rem,calc(100vw-2rem))] max-w-none bg-transparent p-0 text-foreground backdrop:bg-background/70 backdrop:backdrop-blur-sm"
        >
          <Frame padding="none" className="bg-surface">
            <h2 id={`${id}-title`} className="sr-only">
              Search
            </h2>
            <div className="flex items-center gap-3 border-b border-border px-4">
              <Icon name="search" size="control" className="shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                autoFocus
                type="text"
                role="combobox"
                aria-expanded={flat.length > 0}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={current ? `${id}-opt-${flat.indexOf(current)}` : undefined}
                aria-label="Search places and entries"
                placeholder="Search places and entries"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKey}
                className="min-h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
              />
              {/* A plain icon, no box: the footer says the key. It is the way out for a touch screen. */}
              <button
                type="button"
                onClick={hide}
                aria-label="Close search"
                className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center text-muted-foreground transition-colors duration-(--duration-fast) hover:text-foreground"
              >
                <Icon name="close" size="control" />
              </button>
            </div>
            <div className="max-h-[min(24rem,60dvh)] overflow-y-auto overscroll-contain">
              <ul ref={listRef} id={listId} role="listbox" aria-label="Results" className="m-0 list-none p-0">
                {groups.map((group) => (
                  <li key={group.type} role="presentation">
                    <ul role="group" aria-label={group.label} className="m-0 list-none p-0">
                      <li role="presentation" className="type-meta px-4 pt-4 pb-1 text-muted-foreground" aria-hidden="true">
                        {SEARCH_LABELS[group.type]}
                      </li>
                      {group.items.map((item) => {
                        const i = flat.indexOf(item);
                        const selected = item === current;
                        return (
                          <li
                            key={item.href}
                            id={`${id}-opt-${i}`}
                            role="option"
                            aria-selected={selected}
                            onMouseMove={() => setActive(i)}
                            onClick={() => go(item)}
                            className={cn("flex min-h-12 cursor-pointer items-center gap-3 px-4 py-2", selected && "bg-accent shadow-[inset_2px_0_0_var(--signal)]")}
                          >
                            <KindTag kind={item.type} iconOnly />
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className="truncate font-display text-base font-bold tracking-[-0.01em]">{item.title}</span>
                              {item.sub && <span className="ds-meta truncate">{item.sub}</span>}
                            </span>
                            <Icon name="arrow-right" size="control" className={cn("shrink-0", selected ? "opacity-100" : "opacity-0")} />
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
                {surprise && (
                  <li role="presentation">
                    <ul role="group" aria-label="Elsewhere" className="m-0 list-none p-0">
                      <li role="presentation" className="type-meta px-4 pt-4 pb-1 text-muted-foreground" aria-hidden="true">
                        Elsewhere
                      </li>
                      <li
                        id={`${id}-opt-${flat.indexOf(SURPRISE_ROW)}`}
                        role="option"
                        aria-selected={current === SURPRISE_ROW}
                        onMouseMove={() => setActive(flat.indexOf(SURPRISE_ROW))}
                        onClick={() => go(SURPRISE_ROW)}
                        className={cn("flex min-h-12 cursor-pointer items-center gap-3 px-4 py-2", current === SURPRISE_ROW && "bg-accent shadow-[inset_2px_0_0_var(--signal)]")}
                      >
                        <Icon name="sparkles" size="control" className="shrink-0 text-muted-foreground" />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-display text-base font-bold tracking-[-0.01em]">{SURPRISE.title}</span>
                          <span className="ds-meta truncate">{SURPRISE.sub}</span>
                        </span>
                        <Icon name="arrow-right" size="control" className={cn("shrink-0", current === SURPRISE_ROW ? "opacity-100" : "opacity-0")} />
                      </li>
                    </ul>
                  </li>
                )}
              </ul>
              {!hasQuery && load.state === "ready" && (
                <p className="m-0 px-4 py-6 text-sm text-muted-foreground">Type a name, a place, a tag. {total} places and entries are indexed.</p>
              )}
              {hasQuery && load.state === "ready" && results.length === 0 && !surprise && <p className="m-0 px-4 py-6 text-sm text-muted-foreground">Nothing matches &ldquo;{query.trim()}&rdquo;.</p>}
              {load.state === "loading" && <p className="m-0 px-4 py-6 text-sm text-muted-foreground">Loading&hellip;</p>}
              {load.state === "error" && <p className="m-0 px-4 py-6 text-sm text-muted-foreground">The search could not be loaded. Close it and try again.</p>}
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2 text-sm text-muted-foreground">
              <span>
                {/* The keys are for a keyboard: a touch screen (a coarse pointer) has none of them, and the close icon is its way out. The
                    screen-reader line below stays (a keyboard can be attached to anything). */}
                <span aria-hidden="true" className="flex items-center gap-4 [@media(pointer:coarse)]:hidden">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-flex">
                      <Icon name="arrow-up" size="inline" />
                      <Icon name="arrow-down" size="inline" />
                    </span>
                    move
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Icon name="enter" size="inline" />
                    open
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="font-meta text-[0.8125rem]">Esc</span>
                    close
                  </span>
                </span>
                <span className="sr-only">Up and Down move, Enter opens, Escape closes</span>
              </span>
              <span aria-hidden="true" className="tabular-nums">
                {hasQuery && load.state === "ready" ? status : ""}
              </span>
            </div>
            <p role="status" className="sr-only">
              {status}
            </p>
          </Frame>
        </dialog>
      )}
    </>
  );
}
