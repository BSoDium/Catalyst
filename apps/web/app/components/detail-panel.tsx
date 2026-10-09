import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { useLocation, useNavigation, useNavigationType } from "react-router";
import { NavScrim } from "~/components/nav-scrim";
import { ExpandToggle } from "~/components/ui/toggle";
import { IconButton } from "~/components/ui/icon-button";
import type { EntryView } from "~/lib/entries";
import { duration, easeStandard } from "~/lib/tokens";
import { cn } from "~/lib/utils";

export const PANEL_HEADING_ID = "panel-heading";

/** Set when the user (not history navigation) caused the panel to open. */
export interface OpenIntent {
  user: boolean;
}

function isFocusable(el: HTMLElement | null): el is HTMLElement {
  return !!el && el.isConnected && el.getClientRects().length > 0 && !el.closest("[inert]");
}

/**
 * Modal behaviour for the mobile slide-over: everything outside the panel is
 * made `inert` (focus and assistive tech cannot reach it) and body scroll is locked.
 */
function useModalBehavior(active: boolean, panelRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const panel = panelRef.current;
    if (!active || !panel) return;

    const inerted: HTMLElement[] = [];
    let node: HTMLElement = panel;
    while (node.parentElement && node !== document.body) {
      const parent: HTMLElement = node.parentElement;
      for (const sibling of Array.from(parent.children)) {
        if (sibling !== node && sibling instanceof HTMLElement && !sibling.inert) {
          sibling.inert = true;
          inerted.push(sibling);
        }
      }
      node = parent;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      inerted.forEach((el) => {
        el.inert = false;
      });
      document.body.style.overflow = previousOverflow;
    };
  }, [active, panelRef]);
}

interface DetailPanelProps {
  open: boolean;
  isMobile: boolean;
  reducedMotion: boolean;
  /** Identifies what the panel shows (a place, an entry); a change moves focus to the heading again and resets the scroll. */
  routeKey: string | null;
  /** The place whose link in the places list gets focus back when the panel closes; null (an entry) = the page's main. */
  returnSlug: string | null;
  /** Names the panel on the phone's slide-over header ("Place", "Article"). */
  label: string;
  /** `panel`: the right half. `full`: the whole viewport (desktop; the phone's slide-over is full screen already). */
  layout: EntryView;
  /** When given, the header has the panel / full-screen toggle (entries); the URL is the state (`?view=full`), so this navigates. */
  onLayoutChange?(layout: EntryView): void;
  intent: RefObject<OpenIntent>;
  onClose(): void;
  children: ReactNode;
}

/**
 * Desktop: a labelled, non-modal complementary region over the right half of the viewport (full height, below the floating nav
 * links, which stay usable above it); the globe stays interactive on the left half. With `layout="full"` the same element
 * widens to the whole viewport (a width transition on the motion tokens, nothing remounts) and becomes the page's `main`
 * landmark (the shell's own `main`, the globe, goes inert and gives up the `#main` id), so the skip link, the landmarks and
 * the one-h1 rule hold in both layouts.
 * Mobile: a full-height modal dialog above the page; the toggle is not offered (it is full screen already).
 * Markup and positioning are identical on the server (responsive classes);
 * only semantics (dialog role, inert, scroll lock) are applied after hydration.
 */
export function DetailPanel({ open, isMobile, reducedMotion, routeKey, returnSlug, label, layout, onLayoutChange, intent, onClose, children }: DetailPanelProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastReturn = useRef(returnSlug);
  const wasOpen = useRef(open);
  // While the panel plays its exit animation the URL has already lost `?view=full`: keep the layout it was shown with.
  const shownLayout = useRef(layout);
  if (open) shownLayout.current = layout;
  lastReturn.current = open ? returnSlug : lastReturn.current;
  const full = shownLayout.current === "full" && !isMobile;

  useModalBehavior(open && isMobile, panelRef);

  // A link or button inside the panel (an entry card, a place) navigates with PUSH; back/forward and a direct load are POP. The ref
  // keeps the effect below keyed on what the panel shows (`routeKey`), so toggling the layout (a query change) never moves focus.
  const navigationType = useNavigationType();
  const navigationTypeRef = useRef(navigationType);
  navigationTypeRef.current = navigationType;
  // A navigation whose loader is still running (another entry, another place): the content stays, dimmed and marked busy, until the new one arrives.
  // Only when the path changes: toggling the container (`?view=full`) is not a new page.
  const navigation = useNavigation();
  const here = useLocation().pathname;
  const loading = navigation.state === "loading" && navigation.location.pathname !== here;

  // Move focus to the heading: always for the modal, only after a user action on desktop (a places link, a marker, a link in the panel).
  useEffect(() => {
    if (!open) return;
    if (isMobile || intent.current.user || navigationTypeRef.current !== "POP") {
      document.getElementById(PANEL_HEADING_ID)?.focus({ preventScroll: true });
    }
    intent.current.user = false;
    scrollRef.current?.scrollTo({ top: 0 });
  }, [open, isMobile, routeKey, intent]);

  // Return focus to the place's list item when the panel closes (entries: to the page's main).
  useEffect(() => {
    const wasOpenBefore = wasOpen.current;
    wasOpen.current = open;
    if (!wasOpenBefore || open) return;
    const active = document.activeElement;
    const focusIsFree = !active || active === document.body || !!panelRef.current?.contains(active);
    if (!focusIsFree) return;
    const item = lastReturn.current ? document.querySelector<HTMLElement>(`[data-place-link="${CSS.escape(lastReturn.current)}"]`) : null;
    if (isFocusable(item)) item.focus();
    else document.getElementById("main")?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const Tag = motion.div;
  // Desktop slides the whole half-screen in over the globe's re-centring (same duration and easing, see
  // `TUNING.insetMs`); the mobile slide-over is quicker.
  const hidden = { x: "100%" };

  return (
    <AnimatePresence initial={false}>
      {open && (
        <Tag
          key="panel"
          ref={panelRef as RefObject<HTMLDivElement>}
          role={isMobile ? "dialog" : full ? "main" : "complementary"}
          aria-modal={isMobile ? true : undefined}
          aria-labelledby={PANEL_HEADING_ID}
          id={full ? "main" : undefined}
          tabIndex={full ? -1 : undefined}
          data-panel={isMobile ? "dialog" : "aside"}
          data-layout={full ? "full" : "panel"}
          // Reduced motion: no initial/exit state at all, so the panel appears and disappears instantly.
          initial={reducedMotion ? false : hidden}
          animate={{ x: 0 }}
          exit={reducedMotion ? undefined : hidden}
          transition={{ duration: isMobile ? duration.base : duration.slow, ease: easeStandard }}
          className={cn(
            "fixed inset-0 z-50 flex flex-col bg-background outline-none md:inset-y-0 md:right-0 md:left-auto md:z-30 md:border-l md:border-border",
            // The width follows the toggle with the base duration (the global reduced-motion rule collapses it); the full view is opaque
            // (no blur of a live canvas over the whole screen), the panel lets the map continue faintly beneath it.
            "md:transition-[width,background-color] md:duration-(--duration-base) md:ease-(--ease-standard)",
            full ? "md:w-full" : "md:w-1/2 md:bg-background/85 md:backdrop-blur-xl",
          )}
        >
          {/* Desktop: fades the content that scrolls under the nav links (hidden on mobile, where the header is static). */}
          <NavScrim className="absolute z-10 hidden md:block print:hidden" />
          {/* Full screen: the panel reaches the page's left edge, where the navbar's logo floats above it, so the controls start after the logo. */}
          <div
            className={cn(
              "flex min-h-16 shrink-0 items-center justify-between gap-4 px-6 pt-2 print:hidden md:absolute md:inset-x-0 md:top-0 md:z-20 md:h-(--navbar-height) md:min-h-0 md:justify-start md:pt-0",
              full && "md:pl-[4.5rem]",
            )}
          >
            <p className="label md:hidden">{label}</p>
            <div className="flex items-center gap-2">
              <IconButton icon="close" label="Close" size="sm" onClick={onClose} />
              {onLayoutChange && !isMobile && (
                <ExpandToggle
                  expanded={shownLayout.current === "full"}
                  onExpandedChange={(expanded) => onLayoutChange(expanded ? "full" : "panel")}
                  size="sm"
                  className="max-md:hidden"
                />
              )}
            </div>
          </div>
          <div
            ref={scrollRef}
            aria-busy={loading || undefined}
            data-loading={loading ? "" : undefined}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain transition-opacity duration-(--duration-base) ease-(--ease-standard) data-loading:opacity-60 md:pt-[calc(var(--navbar-height)+1rem)]"
          >
            {children}
          </div>
        </Tag>
      )}
    </AnimatePresence>
  );
}
