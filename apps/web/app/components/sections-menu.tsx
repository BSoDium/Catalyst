import { useEffect, useRef } from "react";
import { NavLink, useLocation } from "react-router";
import type { ContentKind } from "@catalyst/schemas";
import { Icon } from "~/components/ui";
import { kindCount } from "~/lib/entries";
import { cn } from "~/lib/utils";

export interface SectionsMenuItem {
  to: string;
  label: string;
  /** The content kind, when the item is a section (the career page is not one): its count is said next to it. */
  kind?: ContentKind;
}

/**
 * The header's "Sections" button and its sheet (docs/web-architecture.md, "Header"): where the row of sections has no room (a phone, or the
 * header beside the open panel), the header is the way home, this one button and the search. The sheet lists EVERY section with how many
 * entries it holds, so a new section is a row here, not another word squeezed into the header. A `<details>`: it works with no script (the
 * sheet is a plain list of links); the script only closes it when a link is followed, on Escape (focus back on the button) and on a press
 * outside. Which of the header's two forms shows is the header's width (`.nav-inline` / `.nav-sections`, app.css), not the viewport's.
 */
export function SectionsMenu({ items, counts }: { items: readonly SectionsMenuItem[]; counts: Partial<Record<ContentKind, number>> | null }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const { pathname } = useLocation();

  // Following a link closes the sheet.
  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname]);

  useEffect(() => {
    const details = ref.current;
    if (!details) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !details.open) return;
      details.open = false;
      details.querySelector("summary")?.focus();
    };
    const onPress = (e: Event) => {
      if (details.open && !details.contains(e.target as Node)) details.open = false;
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPress);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPress);
    };
  }, []);

  return (
    <details ref={ref} data-slot="sections-menu" className="nav-sections">
      <summary className="nav-link pointer-events-auto inline-flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center gap-1 text-muted-foreground [&::-webkit-details-marker]:hidden">
        <span>Sections</span>
        <Icon name="chevron-down" size="inline" className="nav-sections-chevron" />
      </summary>
      <div data-slot="sections-sheet" className="nav-sheet pointer-events-auto">
        <ul className="m-0 list-none p-0">
          {items.map((item) => {
            const count = item.kind !== undefined ? counts?.[item.kind] : undefined;
            return (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  prefetch="intent"
                  className={({ isActive }) => cn("nav-sheet-link", isActive ? "text-foreground" : "text-muted-foreground")}
                >
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
    </details>
  );
}
