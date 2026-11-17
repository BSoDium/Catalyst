import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { TripPhotoFilters, TripPoster } from "~/components/trip-map";
import { Icon } from "~/components/ui";
import { hopDetail, tripLinkLabel, type Trip, type TripHop } from "~/lib/journeys";
import { placePath } from "~/lib/projection";

/** One figure of the trip: the value bold and dark, its unit smaller and quieter (a number to read first, the word after it). */
function Kpi({ value, unit, big = false, lead }: { value: number; unit: string; big?: boolean; lead?: string }) {
  return (
    <p className="m-0 flex items-baseline gap-1.5">
      {lead && <span className="sr-only">{lead} </span>}
      <span className={`font-display leading-none font-extrabold tracking-tight ${big ? "text-3xl" : "text-2xl"}`}>{value.toLocaleString("en-US")}</span>
      <span className="text-sm font-medium text-muted-foreground">{unit}</span>
    </p>
  );
}

const LINK_CLASS = "inline-flex min-h-11 items-center gap-2 bg-foreground px-4 text-sm font-medium text-background no-underline hover:bg-[color-mix(in_srgb,var(--foreground)_82%,var(--background))]";

/**
 * The row under the figures: where this step falls in the trip with the stop before and after, and, to the right of them, the button to the trip's own page. When the two
 * do not fit side by side the button goes on a line of its own and takes the full width of it. (Whether they fit is measured: the stops' natural width and a hidden copy of the
 * button's, against the row's: a button that is already full width cannot say how wide it would be.)
 */
function TripFooter({ trip, where, single }: { trip: Trip; where: string; single: Trip["visits"][number] | null }) {
  const row = useRef<HTMLDivElement>(null);
  const stops = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLSpanElement>(null);
  const [wrapped, setWrapped] = useState(false);
  useEffect(() => {
    const r = row.current;
    const g = ghost.current;
    const st = stops.current;
    if (!r || !g || !st) return;
    const measure = () => setWrapped(st.offsetWidth + 16 + g.offsetWidth > r.clientWidth + 0.5);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(r);
    return () => ro.disconnect();
  }, [trip.url]);
  const label = trip.url ? tripLinkLabel(trip.url) : "";
  return (
    <div ref={row} className="relative mt-auto flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div ref={stops} className="flex max-w-full min-w-0 flex-col gap-1.5">
        <p className="m-0 text-sm font-medium">{where}</p>
        {single && (single.previous || single.next) && (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {single.previous && <Hop hop={single.previous} side="before" lead="Arrived from" />}
            {single.next && <Hop hop={single.next} side="after" lead="Left for" />}
          </ul>
        )}
      </div>
      {trip.url && (
        <>
          <a href={trip.url} target="_blank" rel="noopener noreferrer" data-slot="trip-link" className={`${LINK_CLASS} ${wrapped ? "w-full justify-between" : "ml-auto"}`}>
            {label}
            <Icon name="arrow-up-right" size="inline" />
          </a>
          <span ref={ghost} aria-hidden="true" className={`${LINK_CLASS} pointer-events-none invisible absolute right-0 bottom-0 w-max whitespace-nowrap`}>
            {label}
            <Icon name="arrow-up-right" size="inline" />
          </span>
        </>
      )}
    </div>
  );
}

/** The stop before or after, as a quiet row: an arrow, the place (a link), how it was reached and how far. `lead` is read aloud before it ("Arrived from"). */
function Hop({ hop, side, lead }: { hop: TripHop; side: "before" | "after"; lead: string }) {
  return (
    <li className="flex min-w-0 items-baseline gap-2 text-sm">
      <Icon name={side === "before" ? "arrow-left" : "arrow-right"} size="inline" className="shrink-0 translate-y-0.5 text-muted-foreground" />
      <span className="min-w-0">
        <span className="sr-only">{lead} </span>
        <Link to={placePath(hop.slug)} className="font-medium underline-offset-4 hover:underline">
          {hop.name}
        </Link>
        <span className="text-muted-foreground"> · {hopDetail(hop)}</span>
      </span>
    </li>
  );
}

/**
 * The trip this step belongs to, as a card (docs/step-page.md, #510): a poster across the top (the trip's one word in giant type, the route with this step ringed),
 * the figures (distance, stops, countries: the value bold, its unit quiet), the trip's own name and dates, and last where this step falls in it with the stop before
 * and after, and, to the right of them, a button to the trip's own page when it has one. It is the way into the trip, not the page's subject. A place a trip passes
 * several times says so and lists no hop (each visit has its own).
 */
export function TripCard({ trip, here, lived = false, photo = true }: { trip: Trip; here: string; lived?: boolean; photo?: boolean }) {
  const single = trip.visits.length === 1 ? trip.visits[0]! : null;
  const where = single ? (single.previous === null ? "The trip starts here" : single.next === null ? "The trip ends here" : `Stop ${single.position} of ${trip.stops}`) : lived ? "Home base on this trip" : `Visited ${trip.visits.length} times`; // (a place the owner has lived in is not visited: no count, #584)
  return (
    <article data-slot="trip-card" className="relative isolate flex flex-col overflow-hidden border border-border">
      <TripPoster trip={trip} here={here} photo={photo} />
      <div className="flex grow flex-col gap-4 p-4">
        <div data-slot="trip-figures" className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <Kpi value={trip.km} unit="km" big lead="About" />
          <Kpi value={trip.stops} unit={trip.stops === 1 ? "stop" : "stops"} />
          {trip.countries > 0 && <Kpi value={trip.countries} unit={trip.countries === 1 ? "country" : "countries"} />}
        </div>
        <header className="flex flex-col gap-1">
          <h3 className="m-0 text-lg font-semibold tracking-tight text-balance">{trip.title}</h3>
          {trip.dates?.text && <p className="m-0 ds-meta">{trip.dates.text}</p>}
        </header>
        <TripFooter trip={trip} where={where} single={single} />
      </div>
    </article>
  );
}

/** The slide in view and how many there are: the one whose left edge is nearest the scroller's, the last one when the scroller is at its end. */
function currentSlide(scroller: HTMLElement): number {
  const slides = Array.from(scroller.children) as HTMLElement[];
  if (scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 2) return slides.length - 1;
  let best = 0;
  let distance = Infinity;
  slides.forEach((slide, i) => {
    const d = Math.abs(slide.offsetLeft - scroller.offsetLeft - scroller.scrollLeft);
    if (d < distance) {
      distance = d;
      best = i;
    }
  });
  return best;
}

/**
 * The trips of the step. One is a card under its heading. Two or more are a carousel (#510: they were two open cards of 500 px and the rest behind a text toggle that said "Hide" while
 * it was closed): the heading with the count and the two arrows, the cards side by side in a row that snaps (the next one shows at the edge: it is plainly a row; two at a time in a
 * wide panel), and under it one dot a trip, to see where you are and to jump. All cards are as tall as the tallest. The row is a region a keyboard can focus and scroll; the position is
 * said aloud; the arrows are buttons that are off at the ends.
 */
export function TripCards({ trips, here, lived = false }: { trips: Trip[]; here: string; lived?: boolean }) {
  // `?poster=flat` shows the flat posters (to compare with the photographs: #510).
  const photo = new URLSearchParams(useLocation().search).get("poster") !== "flat";
  const scroller = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [reach, setReach] = useState({ start: true, end: false });
  const measure = () => {
    const el = scroller.current;
    if (!el) return;
    setIndex(currentSlide(el));
    setReach({ start: el.scrollLeft <= 2, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 });
  };
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro?.disconnect();
    };
  }, [trips.length]);
  const reduced = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const show = (i: number) => {
    const el = scroller.current;
    const slide = el?.children[Math.max(0, Math.min(trips.length - 1, i))] as HTMLElement | undefined;
    if (el && slide) el.scrollTo({ left: slide.offsetLeft - el.offsetLeft, behavior: reduced() ? "auto" : "smooth" });
  };
  const many = trips.length > 1;
  const headingId = `trips-${here}`;
  return (
    <section data-slot="trip-cards" aria-labelledby={headingId} {...(many ? { "aria-roledescription": "carousel" } : {})} className="@container flex flex-col gap-4">
      {photo && trips.some((t) => t.photo) && <TripPhotoFilters />}
      <header className="flex items-center justify-between gap-3 pt-2">
        <div className="flex items-baseline gap-3">
          <h2 id={headingId} className="m-0 font-display text-[2rem] leading-none font-extrabold tracking-[-0.03em]">
            {many ? "Trips" : "Trip"}
          </h2>
          {many && <span className="place-group-count">{trips.length}</span>}
        </div>
        {many && (
          <div className="flex items-center gap-1">
            <span aria-live="polite" className="ds-meta mr-2">
              {index + 1} / {trips.length}
            </span>
            <button type="button" aria-label="Previous trip" disabled={reach.start} onClick={() => show(index - 1)} className="trip-arrow">
              <Icon name="chevron-left" size="control" />
            </button>
            <button type="button" aria-label="Next trip" disabled={reach.end} onClick={() => show(index + 1)} className="trip-arrow">
              <Icon name="chevron-right" size="control" />
            </button>
          </div>
        )}
      </header>
      {many ? (
        <div
          ref={scroller}
          tabIndex={0}
          role="group"
          aria-label="Trips, scroll sideways"
          data-slot="trip-rail"
          className="-mx-6 flex snap-x snap-mandatory items-stretch gap-3 overflow-x-auto overscroll-x-contain scroll-smooth px-6 pb-1 [scroll-padding-inline:1.5rem] [scrollbar-width:none] motion-reduce:scroll-auto [&::-webkit-scrollbar]:hidden"
        >
          {trips.map((trip, i) => (
            <div key={trip.id} role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${trips.length}: ${trip.title}`} className="flex min-w-0 shrink-0 basis-[88%] snap-start @3xl:basis-[calc(50%-1.125rem)] [&>article]:grow">
              <TripCard trip={trip} here={here} lived={lived} photo={photo} />
            </div>
          ))}
        </div>
      ) : (
        <TripCard trip={trips[0]!} here={here} lived={lived} photo={photo} />
      )}
      {many && (
        <div role="group" aria-label="Choose a trip" className="flex items-center justify-center">
          {trips.map((trip, i) => (
            <button key={trip.id} type="button" aria-label={`Show trip ${i + 1}: ${trip.title}`} aria-current={i === index ? "true" : undefined} onClick={() => show(i)} className="trip-dot">
              <span aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
