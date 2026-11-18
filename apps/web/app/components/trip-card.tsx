import { StableTitle } from "~/components/stable-title";
import { useEffect, useRef, useState } from "react";
import { TripRail } from "~/components/trip-rail";
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

const LINK_CLASS = "inline-flex min-h-11 max-w-full items-center gap-2 whitespace-nowrap bg-foreground px-4 text-sm font-medium text-background no-underline hover:bg-[color-mix(in_srgb,var(--foreground)_82%,var(--background))]";

/**
 * The row under the figures: where this step falls in the trip with the stop before and after, and, to the right of them, the button to the trip's own page. When the two
 * do not fit side by side the button goes on a line of its own and takes the full width of it. (Whether they fit is measured: the stops' natural width and a hidden copy of the
 * button's, against the row's: a button that is already full width cannot say how wide it would be.)
 */
function TripFooter({ trip, where, hops }: { trip: Trip; where: string; hops: { previous: TripHop | null; next: TripHop | null } | null }) {
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
    <div ref={row} data-slot="trip-footer" className="relative mt-auto flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div ref={stops} className="flex max-w-full min-w-0 flex-col gap-1.5">
        <p className="m-0 text-sm font-medium">{where}</p>
        {hops && (hops.previous || hops.next) && (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {hops.previous && <Hop hop={hops.previous} side="before" lead="Arrived from" />}
            {hops.next && <Hop hop={hops.next} side="after" lead="Left for" />}
          </ul>
        )}
      </div>
      {trip.url && (
        <>
          <a href={trip.url} target="_blank" rel="noopener noreferrer" data-slot="trip-link" className={`${LINK_CLASS} ${wrapped ? "w-full justify-between" : "ml-auto"}`}>
            <span className="min-w-0 truncate">{label}</span>
            <Icon name="arrow-up-right" size="inline" className="shrink-0" />
          </a>
          <span ref={ghost} aria-hidden="true" className={`${LINK_CLASS} pointer-events-none invisible absolute right-0 bottom-0 w-max max-w-none whitespace-nowrap`}>
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
export function TripCard({ trip, here, lived = false, photo = true, position }: { trip: Trip; here: string; lived?: boolean; photo?: boolean; position?: string }) {
  const single = trip.visits.length === 1 ? trip.visits[0]! : null;
  // A home base is visited several times, but the trip still leaves it and comes back to it: the stop it left for the first time, and the one it came back from the last.
  const ends = !single && lived ? { previous: [...trip.visits].reverse().find((v) => v.previous)?.previous ?? null, next: trip.visits.find((v) => v.next)?.next ?? null } : null;
  const where = single ? (single.previous === null ? "The trip starts here" : single.next === null ? "The trip ends here" : `Stop ${single.position} of ${trip.stops}`) : lived ? "Home base on this trip" : `Visited ${trip.visits.length} times`; // (a place the owner has lived in is not visited: no count, #584)
  return (
    <article data-slot="trip-card" className="relative isolate flex flex-col overflow-hidden">
      <TripPoster trip={trip} here={here} photo={photo} />
      <div className="flex grow flex-col gap-4 p-4">
        <div data-slot="trip-figures" className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <Kpi value={trip.km} unit="km" big lead="About" />
          <Kpi value={trip.stops} unit={trip.stops === 1 ? "stop" : "stops"} />
          {trip.countries > 0 && <Kpi value={trip.countries} unit={trip.countries === 1 ? "country" : "countries"} />}
        </div>
        <header className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="m-0 text-lg tracking-tight"><StableTitle data-slot="trip-title" text={trip.title} className="font-display" /></h3>
            {position && (
              <span aria-hidden="true" data-slot="trip-position" className="ds-meta shrink-0">
                {position}
              </span>
            )}
          </div>
          {trip.dates?.text && <p data-slot="trip-dates" className="m-0 ds-meta">{trip.dates.text}</p>}
        </header>
        <TripFooter trip={trip} where={where} hops={single ?? ends} />
      </div>
    </article>
  );
}

/**
 * The trips of the step. One is a card under its heading. Two or more are a carousel in the photographs' way (`TripRail`, #510): the card in front with the edge of the next, the cards sliding out of view
 * as the row is scrolled, the type of the one in front heavy and the others' thin and faded. The heading carries the count and the position ("1 / 3", said aloud); the arrows are the photographs'.
 */
export function TripCards({ trips, here, lived = false }: { trips: Trip[]; here: string; lived?: boolean }) {
  // `?poster=flat` shows the flat posters (to compare with the photographs: #510).
  const photo = new URLSearchParams(useLocation().search).get("poster") !== "flat";
    const many = trips.length > 1;
  const headingId = `trips-${here}`;
  return (
    <section data-slot="trip-cards" aria-labelledby={headingId} className="@container flex flex-col gap-4">
      {photo && trips.some((t) => t.photo) && <TripPhotoFilters />}
      <header className="flex items-baseline justify-between gap-3 pt-2">
        <div className="flex items-baseline gap-3">
          <h2 id={headingId} className="m-0 font-display text-[2rem] leading-none font-extrabold tracking-[-0.03em]">
            {many ? "Trips" : "Trip"}
          </h2>
          {many && <span className="place-group-count">{trips.length}</span>}
        </div>
      </header>
      {many ? (
        <TripRail
          names={trips.map((t) => t.title)}
          slides={trips.map((trip, i) => (
            <TripCard key={trip.id} trip={trip} here={here} lived={lived} photo={photo} position={`${String(i + 1).padStart(2, "0")} / ${String(trips.length).padStart(2, "0")}`} />
          ))}
        />
      ) : (
        <div className="border border-border">
          <TripCard trip={trips[0]!} here={here} lived={lived} photo={photo} />
        </div>
      )}
    </section>
  );
}
