import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Icon, ScrollRow, SensitiveMedia } from "~/components/ui";
import { coverImageProps } from "~/lib/cover-image";
import { formatEntryDate } from "~/lib/dates";
import { carouselLayout, growth, keylines, lastPosition, widest, type Keylines } from "~/lib/photo-carousel";
import { cn } from "~/lib/utils";

/** A photograph of the place in its gallery: the cover of a linked photograph entry, with what the label says. */
export interface GalleryItem {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  small?: { src: string; width: number; height: number };
  title: string;
  href: string;
  date?: string;
  /** Mature content: the picture is blurred under its veil, as on the entry's card; the link still opens the entry, where it can be shown. */
  sensitive?: true;
}

const ratioOf = (item: GalleryItem) => (item.width && item.height ? item.width / item.height : 4 / 3);

/** The picture with its label on it: over a soft dome of the page colour, the date in mono, the title in the display face and where it is in the row. */
function Picture({ item, i, count, from, style, onFocus, fullWidth }: { item: GalleryItem; i: number; count: number; from: string; style?: React.CSSProperties; onFocus?: () => void; fullWidth?: number }) {
  const date = formatEntryDate(item.date);
  const inner: React.CSSProperties | undefined = fullWidth ? { width: fullWidth } : undefined;
  const image = <img {...coverImageProps({ src: item.src, width: item.width ?? 0, small: item.small }, "(min-width: 48rem) 50vw, 100vw")} alt={item.alt} loading={i === 0 ? "eager" : "lazy"} decoding="async" className="place-gallery-img size-full object-cover" />;
  return (
    <Link to={item.href} state={{ from }} aria-label={item.title} onFocus={onFocus} style={style} className="place-gallery-item group relative block overflow-hidden bg-accent no-underline">
      <span className={cn("block", fullWidth ? "absolute inset-y-0 left-1/2 -translate-x-1/2" : "size-full")} style={inner}>
        {item.sensitive ? <SensitiveMedia className="size-full [&_.sensitive-media-content]:size-full">{image}</SensitiveMedia> : image}
      </span>
      <span className="place-gallery-label" style={inner}>
        <span className="place-gallery-meta ds-micro flex items-baseline justify-between gap-3">
          <span>{date ? date.text : ""}</span>
          {count > 1 && (
            <span aria-hidden="true">
              {String(i + 1).padStart(2, "0")} / {String(count).padStart(2, "0")}
            </span>
          )}
        </span>
        <span className="place-gallery-title line-clamp-2 font-display text-foreground">{item.title}</span>
      </span>
    </Link>
  );
}

/**
 * The carousel once the browser has taken it over (`PhotoGallery`): the row is a native horizontal scroller that holds nothing but an empty track, with a snap point per picture, so touch, wheel,
 * trackpad and snapping are the browser's own; the pictures are in a layer that stays at the left of it (`sticky`) and are placed from the scroll position at each frame
 * (`lib/photo-carousel.ts`): the height never changes, only the width, so the leftmost shrinks as the rightmost grows (Material 3 Expressive's multi-browse carousel), with the page's gutter
 * at the left. What is drawn in a picture keeps its full width and is cropped by the picture's box, so it is revealed, not squeezed; the title's weight and size follow the growth (`--g`).
 */
function Carousel({ items, from }: { items: GalleryItem[]; from: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLUListElement>(null);
  const [geo, setGeo] = useState<{ k: Keylines; step: number } | null>(null);
  const [edges, setEdges] = useState({ start: false, end: true });
  const frame = useRef(0);

  // Measure the row's width (its height is CSS: `.place-gallery-scroller`)
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => {
      const k = keylines(el.clientWidth);
      setGeo({ k, step: Math.round(k.large * 0.8) });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [items.length]);

  const place = useCallback(() => {
    const el = scroller.current;
    const ul = layer.current;
    if (!el || !ul || !geo) return;
    const t = geo.step > 0 ? el.scrollLeft / geo.step : 0;
    const boxes = carouselLayout(t, items.length, geo.k);
    boxes.forEach((box, i) => {
      const li = ul.children[i] as HTMLElement | undefined;
      if (!li) return;
      li.style.width = `${box.w}px`;
      li.style.transform = `translate3d(${box.x}px,0,0)`;
      li.style.visibility = box.w < 1 ? "hidden" : "visible";
      li.style.setProperty("--g", growth(box.w, geo.k).toFixed(3));
    });
    const max = el.scrollWidth - el.clientWidth;
    const next = { start: el.scrollLeft > 2, end: el.scrollLeft < max - 2 };
    setEdges((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  }, [geo, items.length]);

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
  }, [place]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const goTo = (index: number) => {
    const el = scroller.current;
    if (!el || !geo) return;
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: Math.min(Math.max(index, 0), lastPosition(items.length)) * geo.step, behavior: reduced ? "auto" : "smooth" });
  };
  const current = () => (geo && scroller.current ? Math.round(scroller.current.scrollLeft / geo.step) : 0);

  return (
    <div className="relative">
      <div ref={scroller} data-slot="place-gallery-scroller" className="place-gallery-scroller overflow-x-auto overscroll-x-contain snap-x snap-mandatory">
        {geo && (
          <div className="relative h-full" style={{ width: lastPosition(items.length) * geo.step + geo.k.width }}>
            {items.slice(0, lastPosition(items.length) + 1).map((item, i) => (
              <span key={item.src} aria-hidden="true" className="absolute top-0 size-px snap-start" style={{ left: i * geo.step }} />
            ))}
            <div className="sticky left-0 top-0 h-full overflow-hidden" style={{ width: geo.k.width }}>
              <ul ref={layer} className="relative m-0 h-full list-none p-0">
                {items.map((item, i) => (
                  <li key={item.src} className="absolute top-0 left-0 h-full overflow-hidden" style={{ width: 0, visibility: "hidden" }}>
                    <Picture item={item} i={i} count={items.length} from={from} fullWidth={widest(geo.k)} onFocus={() => goTo(i)} style={{ height: "100%" }} />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
      {edges.start && (
        <button type="button" aria-label="Previous photograph" data-slot="scroll-row-arrow" data-side="start" onClick={() => goTo(current() - 1)} className="scroll-row-arrow">
          <Icon name="chevron-left" size="control" />
        </button>
      )}
      {edges.end && (
        <button type="button" aria-label="Next photograph" data-slot="scroll-row-arrow" data-side="end" onClick={() => goTo(current() + 1)} className="scroll-row-arrow">
          <Icon name="chevron-right" size="control" />
        </button>
      )}
    </div>
  );
}

/**
 * The photographs of the place, full panel width with no frame (docs/design-system.md, "The place panel"). One is a single full-width picture. Several are a carousel in which the
 * pictures change in width as the row is scrolled (`Carousel`). Until the browser has hydrated the page, and for anyone without scripts, it is a plain sideways row that snaps,
 * every picture at its own proportions at one height.
 */
export function PhotoGallery({ items, from }: { items: GalleryItem[]; from: string }) {
  const [enhanced, setEnhanced] = useState(false);
  useLayoutEffect(() => setEnhanced(true), []);
  if (items.length === 1) {
    const only = items[0]!;
    return (
      <div data-slot="place-gallery" className="place-gallery -mx-6">
        <Picture item={only} i={0} count={1} from={from} style={{ aspectRatio: ratioOf(only), maxHeight: "80dvh", width: "100%" }} />
      </div>
    );
  }
  return (
    <div data-slot="place-gallery" data-many="" className="place-gallery @container -mx-6">
      {enhanced ? (
        <Carousel items={items} from={from} />
      ) : (
        <ScrollRow noun="photographs" className="flex snap-x snap-mandatory gap-1.5 px-6">
          {items.map((item, i) => (
            <div key={item.src} className="contents">
              <Picture item={item} i={i} count={items.length} from={from} style={{ aspectRatio: ratioOf(item), height: "min(26rem, 70dvh)", maxWidth: "88cqw", flexShrink: 0, scrollSnapAlign: "start" }} />
            </div>
          ))}
        </ScrollRow>
      )}
    </div>
  );
}
