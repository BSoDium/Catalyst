import { EntryCard } from "~/components/ui";
import { formatEntryDate } from "~/lib/dates";
import { splitMeta, type EntryRef, type EntrySummary } from "~/lib/entries";
import { safeMediaSrc } from "~/lib/entry-blocks";

/** `Lisbon`, `Lisbon, Paris`, `Lisbon, Paris +2`: the places of a card, short. */
function placeLine(places: EntrySummary["places"]): string | undefined {
  if (places.length === 0) return undefined;
  const shown = places.slice(0, 2).map((p) => p.name);
  return places.length > 2 ? `${shown.join(", ")} +${places.length - 2}` : shown.join(", ");
}

/** The card of an entry in a list: shared by the four list pages (and the same facts the place panel shows). */
export function EntryListCard({
  entry,
  linkState,
  headingLevel = 2,
  orientation,
  priority,
}: {
  entry: EntrySummary;
  linkState?: unknown;
  headingLevel?: 2 | 3 | 4;
  orientation?: "vertical" | "horizontal";
  priority?: boolean;
}) {
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
      orientation={orientation}
      priority={priority}
      className="h-full"
    />
  );
}

/** A compact card of a pointer to another entry (related entries): cover, kind and code, title, date. No tags: a ref carries none. */
export function EntryRefCard({ entry, linkState, headingLevel = 3 }: { entry: EntryRef; linkState?: unknown; headingLevel?: 2 | 3 | 4 }) {
  const date = formatEntryDate(entry.date);
  const cover = entry.cover && safeMediaSrc(entry.cover.src) ? { src: entry.cover.src, alt: entry.cover.alt } : undefined;
  return (
    <EntryCard
      kind={entry.kind}
      index={entry.index}
      title={entry.title}
      href={entry.href}
      image={cover}
      seed={entry.slug}
      meta={date ? [{ label: "Date", value: <time dateTime={date.dateTime}>{date.text}</time> }] : undefined}
      linkState={linkState}
      headingLevel={headingLevel}
      className="h-full [&_h2]:text-lg [&_h3]:text-lg [&_h4]:text-lg"
    />
  );
}
