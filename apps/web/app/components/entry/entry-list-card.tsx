import { EntryCard } from "~/components/ui";
import { formatEntryDate } from "~/lib/dates";
import { splitMeta, type EntrySummary } from "~/lib/entries";
import { safeMediaSrc } from "~/lib/entry-blocks";

/** `Lisbon`, `Lisbon, Paris`, `Lisbon, Paris +2`: the places of a card, short. */
function placeLine(places: EntrySummary["places"]): string | undefined {
  if (places.length === 0) return undefined;
  const shown = places.slice(0, 2).map((p) => p.name);
  return places.length > 2 ? `${shown.join(", ")} +${places.length - 2}` : shown.join(", ");
}

/** The card of an entry in a list: shared by the four list pages (and the same facts the place panel shows). */
export function EntryListCard({ entry, linkState, headingLevel = 2 }: { entry: EntrySummary; linkState?: unknown; headingLevel?: 2 | 3 | 4 }) {
  const date = formatEntryDate(entry.date);
  const place = placeLine(entry.places);
  const { status } = splitMeta(entry.meta);
  const cover = entry.cover && safeMediaSrc(entry.cover.src) ? { src: entry.cover.src, alt: entry.cover.alt } : undefined;
  return (
    <EntryCard
      id={entry.slug}
      kind={entry.kind}
      index={entry.index}
      title={entry.title}
      summary={entry.summary}
      href={entry.href}
      image={cover}
      seed={entry.slug}
      status={status}
      meta={[...(date ? [{ label: "Date", value: <time dateTime={date.dateTime}>{date.text}</time> }] : []), ...(place ? [{ label: "Place", value: place }] : [])]}
      tags={entry.tags}
      linkState={linkState}
      headingLevel={headingLevel}
      className="h-full"
    />
  );
}
