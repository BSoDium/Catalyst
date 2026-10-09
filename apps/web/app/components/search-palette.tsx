import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Frame, Glyph, KindTag, MicroLabel } from "~/components/ui";
import { groupResults, searchItems, SEARCH_LABELS, type SearchItem } from "~/lib/search";
import { cn } from "~/lib/utils";

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

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/**
 * Quick search (Cmd or Ctrl + K, or the button in the navigation): a modal `dialog` holding an ARIA combobox over the places and
 * entries. The input owns the focus; the arrow keys move a highlight (`aria-activedescendant`) through the listbox, Enter opens it,
 * Escape closes and gives the focus back. Results are grouped (places, then the four kinds) with the same glyphs as everywhere. The index
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
  const [mac, setMac] = useState(false);
  const id = useId();
  const listId = `${id}-list`;

  useEffect(() => setMac(isMac()), []);

  const show = useCallback(() => {
    setOpen(true);
  }, []);
  const hide = useCallback(() => {
    dialogRef.current?.close();
  }, []);

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

  const results = useMemo(() => (load.state === "ready" ? searchItems(load.items, query, 24) : []), [load, query]);
  const { groups, flat } = useMemo(() => groupResults(results), [results]);
  const current = flat[Math.min(active, flat.length - 1)];

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, flat]);

  const go = (item: SearchItem) => {
    hide();
    void navigate(item.href);
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
          : results.length === 0
            ? "No results"
            : `${results.length} ${results.length === 1 ? "result" : "results"}`;

  return (
    <>
      <button
        type="button"
        onClick={show}
        aria-label="Search"
        aria-keyshortcuts="Control+K Meta+K"
        aria-haspopup="dialog"
        data-slot="search-trigger"
        className="pointer-events-auto hidden min-h-11 min-w-11 items-center justify-center gap-2 px-2 text-sm text-muted-foreground transition-colors duration-(--duration-fast) hover:text-foreground sm:inline-flex"
      >
        <Glyph name="search" size={16} />
        <span aria-hidden="true" className="ds-micro hidden border border-border px-1.5 lg:inline">
          {mac ? "⌘" : "Ctrl"} K
        </span>
      </button>
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
              <Glyph name="search" size={16} className="shrink-0 text-muted-foreground" />
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
              <button type="button" onClick={hide} aria-label="Close search" className="ds-micro min-h-11 min-w-11 shrink-0 border border-border-strong px-2 text-foreground hover:bg-accent">
                Esc
              </button>
            </div>
            <div className="max-h-[min(24rem,60dvh)] overflow-y-auto overscroll-contain">
              <ul ref={listRef} id={listId} role="listbox" aria-label="Results" className="m-0 list-none p-0">
                {groups.map((group) => (
                  <li key={group.type} role="presentation">
                    <ul role="group" aria-label={group.label} className="m-0 list-none p-0">
                      <li role="presentation" className="flex items-center gap-3 px-4 pt-3 pb-1" aria-hidden="true">
                        <MicroLabel tone="strong">{SEARCH_LABELS[group.type]}</MicroLabel>
                        <span className="ds-divider flex-1" />
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
                              <span className="truncate text-sm">{item.title}</span>
                              {item.sub && <MicroLabel className="truncate">{item.sub}</MicroLabel>}
                            </span>
                            <Glyph name="arrow-right" size={12} className={cn("shrink-0", selected ? "opacity-100" : "opacity-0")} />
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
              {!hasQuery && load.state === "ready" && (
                <p className="m-0 px-4 py-6 text-sm text-muted-foreground">Type a name, a place, a tag. {total} places and entries are indexed.</p>
              )}
              {hasQuery && load.state === "ready" && results.length === 0 && <p className="m-0 px-4 py-6 text-sm text-muted-foreground">Nothing matches &ldquo;{query.trim()}&rdquo;.</p>}
              {load.state === "loading" && <p className="m-0 px-4 py-6 text-sm text-muted-foreground">Loading&hellip;</p>}
              {load.state === "error" && <p className="m-0 px-4 py-6 text-sm text-muted-foreground">The search could not be loaded. Close it and try again.</p>}
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2">
              <MicroLabel>
                <span aria-hidden="true">↑↓ move / ↵ open / esc close</span>
                <span className="sr-only">Up and Down move, Enter opens, Escape closes</span>
              </MicroLabel>
              <MicroLabel tone="strong">{hasQuery && load.state === "ready" ? String(results.length).padStart(2, "0") : ""}</MicroLabel>
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
