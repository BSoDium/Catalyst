import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { scrollEdges, scrollStep } from "~/lib/scroll-row";
import { cn } from "~/lib/utils";
import { Icon } from "./icon";

/**
 * A row of chips (tags, filters, sections) that scrolls sideways when it does not fit (docs/design-system.md, "Scroll row"). The native
 * scrollbar is hidden (it is the one unpolished thing on a phone); what replaces it are two arrow buttons that exist only while there is
 * more to see on that side: a 44 px plate of the page's own colour (solid, no fade) at the edge with a chevron on it. The row itself
 * stays the scroller: touch swipes it, the keyboard scrolls it by moving focus along its links (the browser keeps the focused one in view),
 * and a wheel or trackpad works. The arrows are an extra for the pointer and for assistive tech, so they are out of the tab order (a
 * button that disappears under focus would drop it); they are named "Scroll <noun> left" and "Scroll <noun> right". A press scrolls smoothly,
 * at once under reduced motion. Server and first client render draw no arrows (the state is measured after mount), so there is no mismatch,
 * and without scripts the row is a plain swipeable strip.
 *
 * The children are the row's content (usually one `ul`); `className` goes on the scroller. Whatever carries `aria-current` is brought into view on mount.
 */
export function ScrollRow({ children, noun = "tags", className }: { children: ReactNode; /** What the row holds, for the arrows' names. */ noun?: string; className?: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const el = viewport.current;
    if (!el) return;
    const next = scrollEdges(el);
    setEdges((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  }, []);

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    // The chosen chip is not left outside the view (a link to `?tag=` far to the right): bring it in, at once, without moving the page.
    const current = el.querySelector<HTMLElement>("[aria-current]");
    if (current && el.scrollWidth > el.clientWidth) {
      const left = current.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft;
      if (left < el.scrollLeft || left + current.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollLeft = Math.max(0, left - 44);
    }
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    for (const child of Array.from(el.children)) observer?.observe(child);
    // The row's content can change under it (the tag filter's "+28 more" adds chips to the list: the list's own box does not change, only what overflows it, so no resize says so): a change of the content measures again, after the layout (owner, 2026-11-03: the arrow did not come back).
    let frame = 0;
    const changed = typeof MutationObserver === "undefined" ? null : new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    changed?.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", measure);
      observer?.disconnect();
      changed?.disconnect();
    };
  }, [measure]);

  const go = (direction: -1 | 1) => {
    const el = viewport.current;
    if (!el) return;
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: direction * scrollStep(el.clientWidth), behavior: reduced ? "auto" : "smooth" });
  };

  return (
    <div data-slot="scroll-row" data-start={edges.start ? "" : undefined} data-end={edges.end ? "" : undefined} className="scroll-row">
      {edges.start && <ArrowButton side="start" label={`Scroll ${noun} left`} onClick={() => go(-1)} />}
      <div ref={viewport} data-slot="scroll-row-viewport" className={cn("scroll-row-viewport", className)}>
        {children}
      </div>
      {edges.end && <ArrowButton side="end" label={`Scroll ${noun} right`} onClick={() => go(1)} />}
    </div>
  );
}

function ArrowButton({ side, label, onClick }: { side: "start" | "end"; label: string; onClick: () => void }) {
  return (
    <button type="button" tabIndex={-1} aria-label={label} data-slot="scroll-row-arrow" data-side={side} onClick={onClick} className="scroll-row-arrow">
      <Icon name={side === "start" ? "chevron-left" : "chevron-right"} size="control" />
    </button>
  );
}
