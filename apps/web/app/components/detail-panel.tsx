import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { NavScrim } from "~/components/nav-scrim";
import { Button } from "~/components/ui/button";
import { duration, easeStandard } from "~/lib/tokens";

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
  /** Current place slug; changes re-focus the heading and reset scroll. */
  slug: string | null;
  intent: RefObject<OpenIntent>;
  onClose(): void;
  children: ReactNode;
}

/**
 * Desktop: a labelled, non-modal `aside` over the right half of the viewport (full height, below the floating nav
 * links, which stay usable above it); the globe stays interactive on the left half.
 * Mobile: a full-height modal dialog above the page.
 * Markup and positioning are identical on the server (responsive classes);
 * only semantics (dialog role, inert, scroll lock) are applied after hydration.
 */
export function DetailPanel({ open, isMobile, reducedMotion, slug, intent, onClose, children }: DetailPanelProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastSlug = useRef(slug);
  const wasOpen = useRef(open);
  if (slug) lastSlug.current = slug;

  useModalBehavior(open && isMobile, panelRef);

  // Move focus to the heading: always for the modal, only after a user action on desktop.
  useEffect(() => {
    if (!open) return;
    if (isMobile || intent.current.user) {
      document.getElementById(PANEL_HEADING_ID)?.focus({ preventScroll: true });
    }
    intent.current.user = false;
    scrollRef.current?.scrollTo({ top: 0 });
  }, [open, isMobile, slug, intent]);

  // Return focus to the place's list item when the panel closes.
  useEffect(() => {
    const wasOpenBefore = wasOpen.current;
    wasOpen.current = open;
    if (!wasOpenBefore || open) return;
    const active = document.activeElement;
    const focusIsFree = !active || active === document.body || !!panelRef.current?.contains(active);
    if (!focusIsFree) return;
    const item = document.querySelector<HTMLElement>(`[data-place-link="${CSS.escape(lastSlug.current ?? "")}"]`);
    if (isFocusable(item)) item.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const Tag = (isMobile ? motion.div : motion.aside) as typeof motion.div;
  // Desktop slides the whole half-screen in over the globe's re-centring (same duration and easing, see
  // `TUNING.insetMs`); the mobile slide-over is quicker.
  const hidden = { x: "100%" };

  return (
    <AnimatePresence initial={false}>
      {open && (
        <Tag
          key="panel"
          ref={panelRef as RefObject<HTMLDivElement>}
          role={isMobile ? "dialog" : undefined}
          aria-modal={isMobile ? true : undefined}
          aria-labelledby={PANEL_HEADING_ID}
          data-panel={isMobile ? "dialog" : "aside"}
          // Reduced motion: no initial/exit state at all, so the panel appears and disappears instantly.
          initial={reducedMotion ? false : hidden}
          animate={{ x: 0 }}
          exit={reducedMotion ? undefined : hidden}
          transition={{ duration: isMobile ? duration.base : duration.slow, ease: easeStandard }}
          className="fixed inset-0 z-50 flex flex-col bg-background md:inset-y-0 md:right-0 md:left-auto md:z-30 md:w-1/2 md:border-l md:border-border md:bg-background/85 md:backdrop-blur-xl"
        >
          {/* Desktop: fades the content that scrolls under the nav links (hidden on mobile, where the header is static). */}
          <NavScrim className="absolute z-10 hidden md:block" />
          <div className="flex min-h-16 shrink-0 items-center justify-between gap-4 px-6 pt-2 md:absolute md:inset-x-0 md:top-0 md:z-20 md:h-(--navbar-height) md:min-h-0 md:justify-start md:pt-0">
            <p className="label md:hidden">Place</p>
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
          <div
            ref={scrollRef}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain md:pt-[calc(var(--navbar-height)+1rem)]"
          >
            {children}
          </div>
        </Tag>
      )}
    </AnimatePresence>
  );
}
