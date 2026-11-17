import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "~/components/ui";
import { focusScrolls } from "~/components/place-gallery";
import { growth, widest, type Keylines } from "~/lib/photo-carousel";
import { lastTrip, tripKeylines, tripLayout, tripStep } from "~/lib/trip-carousel";

/**
 * The trip cards as a carousel in the photographs' way (components/place-gallery.tsx `Carousel`, #510): the row is a native horizontal scroller that holds nothing but an empty track with a snap
 * point per card, so touch, wheel, trackpad and snapping are the browser's own; the cards are in a layer that stays at the left of it (`sticky`) and are placed from the scroll position at every
 * frame (`lib/trip-carousel.ts`, on the photographs' math): the height never changes, only the width, so the card in front gives way to the next one as it comes. What is drawn in a card keeps its full
 * width and is cropped by the card's box, so it is revealed, not squeezed. `--g` (0 to 1) is how much of its width a card has: the card's type follows it (`.trip-slide` in app.css), its title from the
 * thinnest weight to the heaviest, its figures and small text fading in and out. A card that is not on screen is a box of no width, not `visibility: hidden`: it stays in the tab order, so a keyboard
 * reaches every trip, and focusing one brings it in.
 *
 * Every card is as tall as the tallest (measured at the width they are laid out at). Until the browser has measured the row (the server's page, no scripts) the cards are a plain column.
 */
export function TripRail({ slides, names }: { slides: ReactNode[]; names: string[] }) {
  const count = slides.length;
  const scroller = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLUListElement>(null);
  const [geo, setGeo] = useState<{ k: Keylines; step: number } | null>(null);
  const [rowHeight, setRowHeight] = useState(0);
  const [edges, setEdges] = useState({ start: false, end: true });
  const frame = useRef(0);

  // The row's width (its height is the tallest card's).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => {
      const k = tripKeylines(el.clientWidth);
      setGeo((prev) => (prev && prev.k.width === k.width ? prev : { k, step: tripStep(k) }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [count]);

  // The tallest card, each at its natural height (its box is let go of for the measure): every card is then as tall as that.
  const equalise = useCallback(() => {
    const ul = layer.current;
    if (!ul) return;
    const inners = Array.from(ul.querySelectorAll<HTMLElement>("[data-slot='trip-slide-inner']"));
    inners.forEach((n) => (n.style.height = "auto"));
    const tallest = Math.max(0, ...inners.map((n) => n.offsetHeight));
    inners.forEach((n) => (n.style.height = ""));
    setRowHeight((prev) => (prev === tallest ? prev : tallest));
  }, []);
  useLayoutEffect(() => {
    if (!geo) return;
    equalise();
    void document.fonts?.ready.then(equalise);
  }, [geo, equalise, count]);

  const place = useCallback(() => {
    const el = scroller.current;
    const ul = layer.current;
    if (!el || !ul || !geo) return;
    const t = geo.step > 0 ? el.scrollLeft / geo.step : 0;
    tripLayout(t, count, geo.k).forEach((box, i) => {
      const li = ul.children[i] as HTMLElement | undefined;
      if (!li) return;
      // (a card that is not on screen is a box of no width: it paints nothing but stays in the tab order)
      const off = box.w < 1;
      if (off && li.style.width === "0px") return;
      li.style.width = `${off ? 0 : box.w}px`;
      li.style.transform = `translate3d(${box.x}px,0,0)`;
      li.style.setProperty("--g", growth(box.w, geo.k).toFixed(2));
      // (a card nearly gone keeps no border: two pixels of it would be a line against the panel's edge)
      // (a card at the row's left edge has the panel's own border beside it: its left border would double that one)
      li.style.setProperty("--lb", box.x < 2 ? "0" : "1");
      li.style.setProperty("--edge", Math.min(1, Math.max(0, (box.w - 4) / 24)).toFixed(2));
    });
    const max = el.scrollWidth - el.clientWidth;
    const next = { start: el.scrollLeft > 2, end: el.scrollLeft < max - 2 };
    setEdges((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  }, [geo, count]);

  useLayoutEffect(() => {
    place();
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(place);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame.current);
      el.removeEventListener("scroll", onScroll);
    };
  }, [place, rowHeight]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const goTo = (index: number) => {
    const el = scroller.current;
    if (!el || !geo) return;
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const left = Math.min(Math.max(index, 0), lastTrip(count, geo.k)) * geo.step;
    if (reduced) {
      el.scrollTo({ left, behavior: "auto" });
      return;
    }
    // (a smooth scroll is cut short by the snapping, which pulls it back to the nearest point: snapping is let go of for the length of the move, and comes back when the scroll ends)
    el.style.scrollSnapType = "none";
    const restore = () => {
      el.style.scrollSnapType = "";
      el.removeEventListener("scrollend", restore);
    };
    el.addEventListener("scrollend", restore);
    window.setTimeout(restore, 900);
    el.scrollTo({ left, behavior: "smooth" });
  };
  const position = () => (geo && scroller.current ? scroller.current.scrollLeft / geo.step : 0);

  return (
    <div className="trip-rail relative -mx-6" role="group" aria-roledescription="carousel" aria-label="Trips">
      <div
        ref={scroller}
        data-slot="trip-rail-scroller"
        className="overflow-x-auto overscroll-x-contain snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ height: geo && rowHeight ? rowHeight : undefined }}
      >
        {geo ? (
          <div className="relative h-full" style={{ width: lastTrip(count, geo.k) * geo.step + geo.k.width }}>
            {slides.map((_, i) => (
              <span key={i} aria-hidden="true" className="absolute top-0 size-px snap-start" style={{ left: i * geo.step }} />
            ))}
            <div className="sticky top-0 left-0 h-full overflow-hidden" style={{ width: geo.k.width }}>
              <ul ref={layer} className="relative m-0 h-full list-none p-0">
                {slides.map((slide, i) => (
                  <li
                    key={i}
                    role="group"
                    aria-roledescription="slide"
                    aria-label={`${i + 1} of ${count}: ${names[i] ?? ""}`}
                    className="trip-slide absolute top-0 left-0 h-full overflow-hidden border [border-color:color-mix(in_srgb,var(--border)_calc(var(--edge,1)*100%),transparent)] [contain:layout_paint]"
                    style={{ width: 0, ["--edge" as string]: 0 }}
                    onFocus={(e) => {
                      // (focus must not scroll the card inside its own box)
                      e.currentTarget.scrollLeft = 0;
                      if (focusScrolls(e.currentTarget.getBoundingClientRect().width, i, position())) goTo(i);
                    }}
                  >
                    <div data-slot="trip-slide-inner" className="flex h-full [&>article]:grow" style={{ width: widest(geo.k) }}>
                      {slide}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          // (the row before it is measured: the cards in a column, in the boxes they will have, so the first frame is not empty)
          <ul ref={layer} className="m-0 flex list-none flex-col gap-3 p-0 px-6">
            {slides.map((slide, i) => (
              <li key={i}>
                <div data-slot="trip-slide-inner" className="flex [&>article]:grow">
                  {slide}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
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
