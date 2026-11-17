import { Link } from "react-router";
import { TripPoster } from "~/components/trip-map";
import { Icon } from "~/components/ui";
import { hopDetail, tripLinkLabel, type Trip, type TripHop } from "~/lib/journeys";
import { placePath } from "~/lib/projection";

/** The first trips are open; the rest sit behind one disclosure, so a place on many routes stays short. */
const OPEN_TRIPS = 2;

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

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
 * The trip this step belongs to, as a card (docs/step-page.md, #510): a poster across the top (the trip's one word in giant type, the route over it with this
 * step ringed), the distance as the big figure, then in descending weight the trip's own name, one mono line of facts (stops, countries, when), where this
 * step falls in it with the stop before and after, and last the trip's own page when it has one. It is the way into the trip, not the page's subject. A place a
 * trip passes several times says so and lists no hop (each visit has its own).
 */
export function TripCard({ trip, here, lived = false }: { trip: Trip; here: string; lived?: boolean }) {
  const facts = [plural(trip.stops, "stop"), trip.countries > 0 ? plural(trip.countries, "country", "countries") : null, trip.dates?.text].filter(Boolean).join(" · ");
  const single = trip.visits.length === 1 ? trip.visits[0]! : null;
  const where = single ? (single.previous === null ? "The trip starts here" : single.next === null ? "The trip ends here" : `Stop ${single.position} of ${trip.stops}`) : lived ? "Home base on this trip" : `Visited ${trip.visits.length} times`; // (a place the owner has lived in is not visited: no count, #584)
  return (
    <article data-slot="trip-card" className="flex flex-col overflow-hidden border border-border">
      <TripPoster trip={trip} here={here} />
      <div className="flex flex-col gap-3 p-4">
        <p data-slot="trip-distance" className="m-0 flex items-center gap-2.5 font-display text-3xl leading-none font-extrabold tracking-tight">
          <span aria-hidden="true" className="size-2.5 shrink-0 bg-foreground" />
          <span>
            <span className="sr-only">About </span>
            {trip.km.toLocaleString("en-US")} km
          </span>
        </p>
        <header className="flex flex-col gap-1">
          <h3 className="m-0 text-lg font-semibold tracking-tight text-balance">{trip.title}</h3>
          <p className="m-0 ds-meta">{facts}</p>
        </header>
        <div className="flex flex-col gap-1.5">
          <p className="m-0 text-sm font-medium">{where}</p>
          {single && (single.previous || single.next) && (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {single.previous && <Hop hop={single.previous} side="before" lead="Arrived from" />}
              {single.next && <Hop hop={single.next} side="after" lead="Left for" />}
            </ul>
          )}
        </div>
      </div>
      {trip.url && (
        <a
          href={trip.url}
          target="_blank"
          rel="noopener noreferrer"
          data-slot="trip-link"
          className="flex min-h-11 items-center justify-between gap-2 border-t border-border px-4 text-sm font-medium underline-offset-4 hover:bg-accent hover:underline"
        >
          {tripLinkLabel(trip.url)}
          <Icon name="arrow-up-right" size="inline" />
        </a>
      )}
    </article>
  );
}

/** The trips of the step: the first two as cards, the others behind one disclosure. */
export function TripCards({ trips, here, lived = false }: { trips: Trip[]; here: string; lived?: boolean }) {
  const open = trips.slice(0, OPEN_TRIPS);
  const rest = trips.slice(OPEN_TRIPS);
  return (
    <div data-slot="trip-cards" className="flex flex-col gap-3">
      {open.map((trip) => (
        <TripCard key={trip.id} trip={trip} here={here} lived={lived} />
      ))}
      {rest.length > 0 && (
        <details data-slot="trips-more" className="group flex flex-col gap-3">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm underline-offset-4 hover:underline">
            <span className="group-open:hidden">Show {plural(rest.length, "more trip")}</span>
            <span className="hidden group-open:inline">Hide {plural(rest.length, "trip")}</span>
          </summary>
          <div className="flex flex-col gap-3">
            {rest.map((trip) => (
              <TripCard key={trip.id} trip={trip} here={here} lived={lived} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
