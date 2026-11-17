import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "~/components/ui";

/**
 * The trip cards as a carousel in the photographs' spirit (components/place-gallery.tsx `Carousel`, #510), simpler: the row is a native horizontal scroller with a snap point per card, so touch,
 * wheel, trackpad, snapping, keyboard focus and the server's page (no scripts: the cards are already a row you can scroll) are the browser's own. A card keeps its width and slides out of view
 * as the row moves, the next one with it, so nothing is squeezed and no card covers another. What follows the scroll is the type: at every frame each card gets `--g` (1 on the snap point, 0 a
 * card's step away; `.trip-slide` in app.css) and its title and giant word go from the thinnest weight to the heaviest, its figures and small text fading with it. Every card is as tall as the
 * tallest (a flex row). The arrows are the photographs' own.
 */
export function TripRail({ slides, names }: { slides: ReactNode[]; names: string[] }) {
  const count = slides.length;
  const scroller = useRef<HTMLUListElement>(null);
  const frame = useRef(0);
  const [edges, setEdges] = useState({ start: false, end: true });

  /** The row's position in cards (0 = the first is on the snap point): the scroll over the step between two cards, stretched so that the last one is reached at the end of the scroll. */
  const position = useCallback(() => {
    const el = scroller.current;
    const first = el?.children[0] as HTMLElement | undefined;
    const second = el?.children[1] as HTMLElement | undefined;
    if (!el || !first || !second) return 0;
    const step = second.offsetLeft - first.offsetLeft;
    const max = el.scrollWidth - el.clientWidth;
    const reach = Math.min(max, (count - 1) * step);
    return reach > 0 ? Math.min(count - 1, (el.scrollLeft / reach) * (count - 1)) : 0;
  }, [count]);

  const place = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const t = position();
    Array.from(el.children).forEach((li, i) => (li as HTMLElement).style.setProperty("--g", Math.max(0, 1 - Math.abs(i - t)).toFixed(2)));
    const max = el.scrollWidth - el.clientWidth;
    const next = { start: el.scrollLeft > 2, end: el.scrollLeft < max - 2 };
    setEdges((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  }, [position]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    place();
    const onScroll = () => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(place);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(el);
    return () => {
      cancelAnimationFrame(frame.current);
      el.removeEventListener("scroll", onScroll);
      observer?.disconnect();
    };
  }, [place]);

  const goTo = (index: number) => {
    const el = scroller.current;
    const li = el?.children[Math.min(Math.max(index, 0), count - 1)] as HTMLElement | undefined;
    if (!el || !li) return;
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: li.offsetLeft - parseFloat(getComputedStyle(el).scrollPaddingLeft || "0"), behavior: reduced ? "auto" : "smooth" });
  };

  return (
    <div className="trip-rail relative -mx-6" role="group" aria-roledescription="carousel" aria-label="Trips">
      <ul
        ref={scroller}
        data-slot="trip-rail-scroller"
        className="m-0 flex list-none snap-x snap-mandatory items-stretch gap-3 overflow-x-auto overscroll-x-contain scroll-pl-6 px-6 py-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {slides.map((slide, i) => (
          <li
            key={i}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${count}: ${names[i] ?? ""}`}
            // (the card is the row's width less the next one's edge, and no wider than a poster needs)
            className="trip-slide flex w-[calc(100%-1.5rem)] max-w-[34rem] shrink-0 snap-start [&>article]:grow"
            style={{ ["--g" as string]: i === 0 ? 1 : 0 }}
          >
            {slide}
          </li>
        ))}
      </ul>
      {edges.start && (
        <button type="button" aria-label="Previous trip" data-slot="scroll-row-arrow" data-side="start" onClick={() => goTo(Math.round(position()) - 1)} className="scroll-row-arrow">
          <Icon name="chevron-left" size="control" />
        </button>
      )}
      {edges.end && (
        <button type="button" aria-label="Next trip" data-slot="scroll-row-arrow" data-side="end" onClick={() => goTo(Math.round(position()) + 1)} className="scroll-row-arrow">
          <Icon name="chevron-right" size="control" />
        </button>
      )}
    </div>
  );
}
