import { Link } from "react-router";
import { TripMap } from "~/components/trip-map";
import { Icon } from "~/components/ui";
import { tripLinkLabel, type Trip, type TripHop } from "~/lib/journeys";
import { placePath } from "~/lib/projection";

/** The first trips are open; the rest sit behind one disclosure, so a place on many routes stays short. */
const OPEN_TRIPS = 2;

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** One quiet line to the stop before or after: the sentence of `lib/journeys.ts` ("Arrived from Hue by road, about 190 km"), a link to that place. */
function Hop({ hop }: { hop: TripHop }) {
  return (
    <li className="min-w-0">
      <Link to={placePath(hop.slug)} className="inline-flex min-h-8 items-center text-sm break-words underline-offset-4 hover:underline">
        {hop.text}
      </Link>
    </li>
  );
}

/**
 * The trip this step belongs to, as a small card (docs/step-page.md): a thumbnail of its map with this step ringed, the trip's own name, when and how
 * big it was, and the way to the stops either side. It is the way into the trip, not the page's subject: it takes a few lines, never the page.
 * A place a trip passes several times says so, and lists no hop (each visit has its own).
 */
export function TripCard({ trip, here }: { trip: Trip; here: string }) {
  const facts = [trip.dates?.text, plural(trip.stops, "stop"), `about ${trip.km.toLocaleString("en-US")} km`].filter(Boolean).join(" · ");
  const single = trip.visits.length === 1 ? trip.visits[0]! : null;
  const where = single ? (single.previous === null ? "The trip starts here" : single.next === null ? "The trip ends here" : `Stop ${single.position} of ${trip.stops}`) : `Visited ${trip.visits.length} times`;
  const hops = single ? [single.previous, single.next].filter((h): h is TripHop => h !== null) : [];
  return (
    <article data-slot="trip-card" className="flex overflow-hidden border border-border">
      <TripMap trip={trip} here={here} size="thumb" className="w-28 shrink-0 self-stretch object-cover sm:w-36" />
      <div className="flex min-w-0 flex-col gap-1 p-3">
        <p className="m-0 ds-meta">Part of a trip · {where}</p>
        <h3 className="m-0 text-base font-semibold tracking-tight text-balance">{trip.title}</h3>
        <p className="m-0 ds-meta">{facts}</p>
        {trip.url && (
          <a href={trip.url} target="_blank" rel="noopener noreferrer" data-slot="trip-link" className="inline-flex min-h-8 items-center gap-1 text-sm font-medium underline underline-offset-4 hover:no-underline">
            {tripLinkLabel(trip.url)}
            <Icon name="arrow-up-right" size="inline" />
          </a>
        )}
        {hops.length > 0 && (
          <ul className="m-0 mt-1 flex list-none flex-col p-0">
            {hops.map((hop) => (
              <Hop key={hop.text} hop={hop} />
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

/** The trips of the step: the first two as cards, the others behind one disclosure. */
export function TripCards({ trips, here }: { trips: Trip[]; here: string }) {
  const open = trips.slice(0, OPEN_TRIPS);
  const rest = trips.slice(OPEN_TRIPS);
  return (
    <div data-slot="trip-cards" className="flex flex-col gap-3">
      {open.map((trip) => (
        <TripCard key={trip.id} trip={trip} here={here} />
      ))}
      {rest.length > 0 && (
        <details data-slot="trips-more" className="group flex flex-col gap-3">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm underline-offset-4 hover:underline">
            <span className="group-open:hidden">Show {plural(rest.length, "more trip")}</span>
            <span className="hidden group-open:inline">Hide {plural(rest.length, "trip")}</span>
          </summary>
          <div className="flex flex-col gap-3">
            {rest.map((trip) => (
              <TripCard key={trip.id} trip={trip} here={here} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
