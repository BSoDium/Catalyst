import { Link } from "react-router";
import { CoverArt, EntryCard, SensitiveMedia, StatusTag, TagList } from "~/components/ui";
import { cn } from "~/lib/utils";
import { formatEntryDate } from "~/lib/dates";
import { splitMeta, type EntryRef, type EntrySummary } from "~/lib/entries";
import { safeMediaSrc } from "~/lib/entry-blocks";

/** `Lisbon`, `Lisbon, Paris`, `Lisbon, Paris +2`: the places of a card, short. */
function placeLine(places: EntrySummary["places"]): string | undefined {
  if (places.length === 0) return undefined;
  const shown = places.slice(0, 2).map((p) => p.name);
  return places.length > 2 ? `${shown.join(", ")} +${places.length - 2}` : shown.join(", ");
}

const dateValue = (date: { dateTime?: string | undefined; text: string }) => (
  <time dateTime={date.dateTime} className="ds-meta">
    {date.text}
  </time>
);

/** The card of an entry in a list: shared by the four list pages (and the same facts the place panel shows). The kind is not said: those lists are already of one kind. */
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
  const place = placeLine(entry.places) ?? entry.country?.name;
  const { status } = splitMeta(entry.meta);
  const cover = entry.cover && safeMediaSrc(entry.cover.src) ? { src: entry.cover.src, alt: entry.cover.alt } : undefined;
  return (
    <EntryCard
      id={entry.slug}
      kind={entry.kind}
      title={entry.title}
      summary={entry.summary}
      href={entry.href}
      image={cover}
      sensitive={entry.sensitive === true}
      seed={entry.slug}
      status={status}
      meta={[...(date ? [{ label: "Date", value: dateValue(date) }] : []), ...(place ? [{ label: "Place", value: place }] : [])]}
      tags={entry.tags}
      linkState={linkState}
      headingLevel={headingLevel}
      orientation={orientation}
      priority={priority}
      className="h-full"
    />
  );
}

/** A compact card of a pointer to another entry (related entries, which are of mixed kinds, so it says the kind): cover, kind, title, date. No tags: a ref carries none. */
export function EntryRefCard({ entry, linkState, headingLevel = 3 }: { entry: EntryRef; linkState?: unknown; headingLevel?: 2 | 3 | 4 }) {
  const date = formatEntryDate(entry.date);
  const cover = entry.cover && safeMediaSrc(entry.cover.src) ? { src: entry.cover.src, alt: entry.cover.alt } : undefined;
  return (
    <EntryCard
      kind={entry.kind}
      showKind
      title={entry.title}
      href={entry.href}
      image={cover}
      sensitive={entry.sensitive === true}
      seed={entry.slug}
      meta={date ? [{ label: "Date", value: dateValue(date) }] : undefined}
      linkState={linkState}
      headingLevel={headingLevel}
      className="h-full [&_h2]:text-lg [&_h3]:text-lg [&_h4]:text-lg"
    />
  );
}

/**
 * A row of a list page (`/articles` ...): type, not a card. A mono column (date, places), the title in the display face at its heavy
 * end over a summary in the reading face at its thin end, and the image where there is one; hairline between rows, no box. The title is the
 * one link, stretched over the row (`.ds-card`), so there is one tab stop per row and the whole row is the target. A generated
 * cover stands in only for an artwork (the image IS its page); an article, a project or a poem without an image is type only.
 */
export function EntryRow({
  entry,
  headingLevel = 2,
  priority,
  className,
  linkState,
}: {
  entry: EntrySummary;
  headingLevel?: 2 | 3 | 4;
  priority?: boolean;
  className?: string;
  /** The router state of the row's link: where the entry was opened from (`listBackState`). */
  linkState?: unknown;
}) {
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4";
  const date = formatEntryDate(entry.date);
  const place = placeLine(entry.places);
  const { status } = splitMeta(entry.meta);
  const cover = entry.cover && safeMediaSrc(entry.cover.src) ? { src: entry.cover.src, alt: entry.cover.alt } : null;
  const showCover = !!cover || entry.kind === "artwork";
  const tags = entry.tags.slice(0, 4);
  if (entry.kind === "poem") return <PoemRow entry={entry} Heading={Heading} date={date} place={place} status={status} tags={tags} className={className} linkState={linkState} />;
  return (
    <article
      id={entry.slug}
      data-slot="entry-card"
      data-kind={entry.kind}
      className={cn("ds-card entry-row grid min-w-0 gap-x-7 gap-y-4 border-t border-border py-7 md:grid-cols-12", className)}
    >
      <dl className="type-meta m-0 flex min-w-0 flex-col gap-1 text-muted-foreground md:col-span-2">
        {date && (
          <div>
            <dt className="sr-only">Date</dt>
            <dd className="m-0">
              <time dateTime={date.dateTime}>{date.text}</time>
            </dd>
          </div>
        )}
        {place && (
          <div>
            <dt className="sr-only">Place</dt>
            <dd className="m-0 [overflow-wrap:anywhere]">{place}</dd>
          </div>
        )}
        {status && (
          <div>
            <dd className="m-0">
              <StatusTag status={status} className="text-[length:inherit] leading-[inherit] [font:inherit] tracking-[inherit] uppercase" />
            </dd>
          </div>
        )}
      </dl>
      <div className={cn("flex min-w-0 flex-col gap-3", showCover ? "md:col-span-7" : "md:col-span-9")}>
        <Heading data-slot="entry-card-title" className="type-display-md m-0 font-extrabold">
          <Link to={entry.href} state={linkState} className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none">
            {entry.title}
          </Link>
        </Heading>
        {entry.summary && <p className="m-0 line-clamp-3 max-w-[34em] font-reading text-[1.1875rem] leading-[1.4] font-light text-pretty text-muted-foreground">{entry.summary}</p>}
        {tags.length > 0 && <TagList label="Tags" tags={tags.map((label) => ({ label }))} className="font-meta text-xs" />}
      </div>
      {showCover && (
        <div className="min-w-0 md:col-span-3">
          <div className="overflow-hidden">
            {cover && entry.sensitive === true ? (
              <SensitiveMedia>
                <img src={cover.src} alt={cover.alt} loading={priority ? "eager" : "lazy"} decoding="async" className="aspect-video w-full object-cover" />
              </SensitiveMedia>
            ) : cover ? (
              <img src={cover.src} alt={cover.alt} loading={priority ? "eager" : "lazy"} decoding="async" className="aspect-video w-full object-cover" />
            ) : (
              <CoverArt seed={entry.slug} kind={entry.kind} cols={48} rows={27} />
            )}
          </div>
        </div>
      )}
    </article>
  );
}

/**
 * A poem in the poems' list (docs/design-system.md, "Poetry list"): a cell of a wide grid, not a 12-column row. The mono line (place, date,
 * status) over the title, over the summary in the reading face at a large size and in the ink (a solid colour, 17:1 or more): a poem's
 * summary is the one thing the list has to read, so it is not the thin muted caption of an article's. Same anchors, same stretched link.
 */
function PoemRow({
  entry,
  Heading,
  date,
  place,
  status,
  tags,
  className,
  linkState,
}: {
  entry: EntrySummary;
  Heading: "h2" | "h3" | "h4";
  date: ReturnType<typeof formatEntryDate>;
  place: string | undefined;
  status: string | undefined;
  tags: string[];
  className?: string | undefined;
  linkState?: unknown;
}) {
  return (
    <article id={entry.slug} data-slot="entry-card" data-kind="poem" className={cn("ds-card entry-row poem-row min-w-0 border-t border-border", className)}>
      <dl className="poem-meta m-0 flex min-w-0 flex-wrap gap-x-4 gap-y-1">
        {place && (
          <div>
            <dt className="sr-only">Place</dt>
            <dd className="m-0 [overflow-wrap:anywhere]">{place}</dd>
          </div>
        )}
        {date && (
          <div>
            <dt className="sr-only">Date</dt>
            <dd className="m-0">
              <time dateTime={date.dateTime}>{date.text}</time>
            </dd>
          </div>
        )}
        {status && (
          <div>
            <dd className="m-0">
              <StatusTag status={status} className="text-[length:inherit] leading-[inherit] [font:inherit] tracking-[inherit] uppercase" />
            </dd>
          </div>
        )}
      </dl>
      <Heading data-slot="entry-card-title" className="poem-row-title type-display-md m-0 font-extrabold">
        <Link to={entry.href} state={linkState} className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none">
          {entry.title}
        </Link>
      </Heading>
      {entry.summary && <p className="poem-summary m-0 text-pretty">{entry.summary}</p>}
      {tags.length > 0 && <TagList label="Tags" tags={tags.map((label) => ({ label }))} className="font-meta text-sm" />}
    </article>
  );
}
