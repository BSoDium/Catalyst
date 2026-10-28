import { useEffect, useRef, type CSSProperties } from "react";
import { NavLink, useLocation } from "react-router";
import type { ContentKind } from "@catalyst/schemas";
import { Icon } from "~/components/ui";
import { kindCount, parsePanelPath } from "~/lib/entries";
import { cn } from "~/lib/utils";

export interface SectionsMenuItem {
  to: string;
  label: string;
  /** The content kind, when the item is a section (the career page is not one): its count is said next to it. */
  kind?: ContentKind;
}

/** The drawer's way out takes `--nav-close` (app.css, a test keeps them equal); the `open` attribute stays until it has played. */
export const CLOSE_MS = 180;
/** A finger travelling this far up the sheet dismisses it. */
const SWIPE_CLOSE_PX = 40;

/** The index of the section the page is in: the home page ("/") and a place (`/locations/x`, on the globe) are "Globe", the first item; the career page is one of the items too. -1 elsewhere (a 404). */
function currentIndex(items: readonly SectionsMenuItem[], pathname: string) {
  if (pathname === "/" || parsePanelPath(pathname)?.type === "place") return items.findIndex((item) => item.to === "/");
  return items.findIndex((item) => item.to !== "/" && (pathname === item.to || pathname.startsWith(`${item.to}/`)));
}

/**
 * The narrow header's selector and its drawer (docs/web-architecture.md, "Header"): where the row of sections has no room (a phone, or the
 * header beside the open panel), the header is this one control, at the left, and the search. The control says where the visitor is (its
 * index and name: "04 Poetry", or "Sections" on the globe and the places), and opens a drawer that lists EVERY section with how many entries
 * it holds, so a new section is a row here, not another word squeezed into the header.
 *
 * A `<details>`: with no script it opens and closes as the browser does, instantly, and the drawer is a plain list of links. The script
 * adds the motion's other half and the ways out: the drawer opens by CSS (`@starting-style`: a wipe from the top, the rows settling in one
 * after the other), and CLOSING plays too, because `data-closing` is set first and `open` removed once it has played. It closes when a link is
 * followed, on Escape (focus back on the control), on a press outside, on the veil that dims the page behind it, and on a swipe up. While it
 * is open the page behind does not scroll (`data-nav-open` on the root). Which of the header's two forms shows is the header's width
 * (`.nav-inline` / `.nav-sections`, app.css), not the viewport's.
 */
export function SectionsMenu({ items, counts }: { items: readonly SectionsMenuItem[]; counts: Partial<Record<ContentKind, number>> | null }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const timer = useRef(0);
  const closeRef = useRef<() => void>(() => {});
  const { pathname } = useLocation();
  const at = currentIndex(items, pathname);
  const current = at >= 0 ? items[at] : undefined;

  useEffect(() => {
    const details = ref.current;
    if (!details) return;
    details.dataset.js = "";
    const finish = () => {
      window.clearTimeout(timer.current);
      details.open = false;
      delete details.dataset.closing;
    };
    const close = () => {
      if (!details.open || details.dataset.closing !== undefined) return;
      details.dataset.closing = "";
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      timer.current = window.setTimeout(finish, reduced ? 0 : CLOSE_MS);
    };
    closeRef.current = close;
    const summary = details.querySelector("summary");
    const onSummary = (e: Event) => {
      // Closing by the control goes through the animation; opening is the browser's.
      if (!details.open) return;
      e.preventDefault();
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !details.open) return;
      close();
      summary?.focus();
    };
    const onPress = (e: Event) => {
      if (details.open && !details.contains(e.target as Node)) close();
    };
    const onToggle = () => document.documentElement.toggleAttribute("data-nav-open", details.open);
    let y0: number | null = null;
    const onTouchStart = (e: TouchEvent) => {
      y0 = e.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY;
      if (y0 !== null && y !== undefined && y0 - y > SWIPE_CLOSE_PX) {
        y0 = null;
        close();
      }
    };
    const sheet = details.querySelector("[data-slot=sections-sheet]");
    summary?.addEventListener("click", onSummary);
    sheet?.addEventListener("touchstart", onTouchStart as EventListener, { passive: true });
    sheet?.addEventListener("touchmove", onTouchMove as EventListener, { passive: true });
    details.addEventListener("toggle", onToggle);
    details.querySelector("[data-slot=sections-veil]")?.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPress);
    return () => {
      closeRef.current = () => {};
      window.clearTimeout(timer.current);
      summary?.removeEventListener("click", onSummary);
      sheet?.removeEventListener("touchstart", onTouchStart as EventListener);
      sheet?.removeEventListener("touchmove", onTouchMove as EventListener);
      details.removeEventListener("toggle", onToggle);
      details.querySelector("[data-slot=sections-veil]")?.removeEventListener("click", close);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPress);
      document.documentElement.removeAttribute("data-nav-open");
      delete details.dataset.js;
    };
  }, []);

  // A followed link (or any route change) closes the drawer, through the same animated path as the other ways out.
  useEffect(() => closeRef.current(), [pathname]);

  return (
    <details ref={ref} data-slot="sections-menu" className="nav-sections">
      <summary
        aria-label={current ? `${current.label}, sections` : "Sections"}
        className="nav-sel pointer-events-auto relative inline-flex cursor-pointer list-none items-center [&::-webkit-details-marker]:hidden"
      >
        <span className="nav-sel-label">
          {at >= 0 && (
            <span aria-hidden="true" className="nav-sel-index">
              {String(at + 1).padStart(2, "0")}
            </span>
          )}
          <span className={cn("nav-sel-name", !current && "nav-sel-name-none")}>{current ? current.label : "Sections"}</span>
          <Icon name="chevron-down" size="inline" className="nav-sections-chevron" />
        </span>
      </summary>
      <div data-slot="sections-veil" aria-hidden="true" className="nav-veil pointer-events-auto" />
      <div data-slot="sections-sheet" className="nav-sheet pointer-events-auto">
        <div className="nav-sheet-scroll">
          <ul className="m-0 list-none p-0">
            {items.map((item, i) => {
              const count = item.kind !== undefined ? counts?.[item.kind] : undefined;
              return (
                <li key={item.to} style={{ "--i": i } as CSSProperties}>
                  <NavLink
                    to={item.to}
                    end={item.to === "/"}
                    prefetch="intent"
                    className={({ isActive }) => cn("nav-sheet-link", isActive ? "text-foreground" : "text-muted-foreground")}
                  >
                    <span aria-hidden="true" className="nav-sheet-index">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="nav-sheet-name">{item.label}</span>
                    {item.kind !== undefined && typeof count === "number" && (
                      <span data-slot="sections-count" className="nav-sheet-count">
                        <span aria-hidden="true">{count}</span>
                        <span className="sr-only">{kindCount(item.kind, count)}</span>
                      </span>
                    )}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </div>
        <div aria-hidden="true" className="nav-sheet-grip" />
        <span aria-hidden="true" className="nav-sheet-tail" />
      </div>
    </details>
  );
}
