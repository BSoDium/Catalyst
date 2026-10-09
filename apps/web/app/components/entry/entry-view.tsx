import { Link } from "react-router";
import { PANEL_HEADING_ID } from "~/components/detail-panel";
import { BlockRenderer } from "~/components/entry/blocks";
import { EntryRefCard } from "~/components/entry/entry-list-card";
import { TableOfContents } from "~/components/entry/toc";
import {
  Button,
  Col,
  CopyButton,
  CoverArt,
  DataList,
  DataRow,
  Frame,
  Glyph,
  Grid,
  KindTag,
  MicroLabel,
  SectionHeader,
  Stack,
  StatusTag,
  TagList,
} from "~/components/ui";
import { shareUrl } from "~/lib/clipboard";
import { formatEntryDate } from "~/lib/dates";
import { entryLanguage, KIND_LABELS, KIND_PATHS, KIND_PLURALS, splitMeta, type EntryDetail, type EntryRef, type EntryView as EntryViewMode } from "~/lib/entries";
import { displayHost, safeExternalUrl, safeMediaSrc } from "~/lib/entry-blocks";
import { tagSearch } from "~/lib/entry-list";
import { entryCode, formatIndex } from "~/lib/labelling";
import { formatReadingTime, readingMinutes, tocItems } from "~/lib/reading";
import { cn } from "~/lib/utils";

export interface EntryViewProps {
  entry: EntryDetail;
  /** `panel`: one column in the side panel. `full`: the same content in the 12-column grid, a reading column and an aside. */
  layout: EntryViewMode;
  /** Where the visitor came from inside the panel (a place); adds a way back. */
  backTo?: { slug: string; name: string; href: string } | null;
  headingId?: string;
}

/**
 * One entry (article, project, artwork or poem) in the HUD language of docs/design-system.md. The SAME component fills the side
 * panel and the full-screen view: only `layout` changes how the blocks sit on the 12-column grid, never the data or the markup.
 *
 * Panel: one column (header, details, cover, body, places, then "keep reading"). Full screen: the title (8 columns) with the details (4),
 * then the reading column (8: cover and body) with the aside (4: places and, for a body with three headings or more, the sticky
 * contents); "keep reading" closes the page in both. Same markup, same order: the contents are in both and CSS hides them in the
 * panel; a skip link in the header ("Jump to contents", full screen) saves the keyboard the way through the text.
 *
 * The title is the view's one level 1 (`#panel-heading`, focus lands on it when the view opens); the body's headings are 2 and 3,
 * and the sections after the body (places, related) are level 2.
 */
export function EntryView({ entry, layout, backTo, headingId = PANEL_HEADING_ID }: EntryViewProps) {
  const full = layout === "full";
  const { status, facts } = splitMeta(entry.meta);
  const date = formatEntryDate(entry.date);
  const language = entryLanguage(entry.meta);
  const external = entry.url ? safeExternalUrl(entry.url) : null;
  const hasDetails = facts.length > 0 || entry.tags.length > 0 || !!external;
  // The contents are in the markup of both layouts (same DOM, same order) and shown by CSS in the full one only (`[data-layout="panel"] [data-slot="entry-toc"]`, app.css).
  const toc = tocItems(entry.body, "body");
  // An authored `Reading time` fact wins over the computed one (it is already in the details).
  const authoredReading = facts.some((f) => f.label.trim().toLowerCase() === "reading time");
  const reading = entry.kind === "article" && !authoredReading ? formatReadingTime(readingMinutes(entry.body)) : null;
  const hasPlaces = entry.places.length > 0;
  const hasMore = entry.related.length > 0 || !!entry.prev || !!entry.next;
  let n = 0;
  const placesIndex = hasPlaces ? ++n : 0;
  const tocIndex = toc.length > 0 ? ++n : 0;
  const relatedIndex = ++n;

  const details = hasDetails && (
    <Frame padding="md" data-slot="entry-details">
      <Stack gap={4}>
        {facts.length > 0 && (
          <DataList>
            {facts.map((fact) => (
              <DataRow key={fact.label} label={fact.label}>
                {fact.value}
              </DataRow>
            ))}
          </DataList>
        )}
        <TagList label="Tags" tags={entry.tags.map((label) => ({ label, href: `${KIND_PATHS[entry.kind]}${tagSearch("", label)}` }))} />
        {external && (
          <Button asChild variant="primary" className="w-full">
            <a href={external} target="_blank" rel="noopener noreferrer">
              <span className="truncate">Open {displayHost(external)}</span>
              <Glyph name="arrow-up-right" size={16} />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </Button>
        )}
      </Stack>
    </Frame>
  );
  const places = hasPlaces && <PlacesSection entry={entry} index={placesIndex} />;
  const body = (
    <Stack gap={6}>
      <Cover entry={entry} />
      <BlockRenderer blocks={entry.body} lang={language} />
    </Stack>
  );

  return (
    <article
      aria-labelledby={headingId}
      data-slot="entry-view"
      data-layout={layout}
      data-kind={entry.kind}
      className={cn("mx-auto w-full min-w-0", full ? "max-w-6xl px-6 pt-4 pb-16 md:px-10" : "px-6 pt-2 pb-10")}
    >
      <Grid className={full ? "gap-y-8 md:gap-y-10" : "gap-y-6"}>
        <Col span={12} spanMd={full ? 8 : 12}>
          <header className="flex flex-col gap-3">
            {backTo && (
              <Link
                to={backTo.href}
                className="ds-micro -ml-1 inline-flex min-h-11 w-fit items-center gap-2 px-1 text-foreground no-underline hover:underline print:hidden"
              >
                <Glyph name="arrow-left" size={12} />
                <span>
                  Back to <span className="sr-only">place </span>
                  {backTo.name}
                </span>
              </Link>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <KindTag kind={entry.kind} iconOnly />
              <MicroLabel tone="strong" data-slot="entry-code">
                {entryCode(entry.kind, entry.index)}
              </MicroLabel>
              {date && (
                <MicroLabel as="time" dateTime={date.dateTime}>
                  {date.text}
                </MicroLabel>
              )}
              {reading && <MicroLabel data-slot="entry-reading">{reading}</MicroLabel>}
              {status && <StatusTag status={status} />}
            </div>
            <h1
              id={headingId}
              tabIndex={-1}
              className={cn("m-0 font-semibold tracking-tight break-words text-balance outline-offset-4", full ? "text-3xl md:text-4xl" : "text-2xl")}
            >
              {entry.title}
            </h1>
            {entry.summary && <p className="m-0 max-w-[48ch] text-base text-pretty text-muted-foreground md:text-lg">{entry.summary}</p>}
            <div className="-ml-2 flex items-center gap-1 print:hidden">
              <CopyButton text={() => shareUrl(window.location.origin, entry.href)} label={`Copy link to ${entry.title}`} announcement="Link copied to the clipboard" glyph="link">
                Copy link
              </CopyButton>
              {toc.length > 0 && (
                <a href="#entry-toc" className="ds-toc-skip ds-micro sr-only focus:not-sr-only focus:inline-flex focus:min-h-11 focus:items-center focus:px-2 focus:text-foreground">
                  Jump to contents
                </a>
              )}
            </div>
          </header>
        </Col>

        {details && (
          <Col span={12} spanMd={full ? 4 : 12}>
            {details}
          </Col>
        )}

        <Col span={12} spanMd={full ? 8 : 12}>
          {body}
        </Col>

        {(places || toc.length > 0) && (
          <Col span={12} spanMd={full ? 4 : 12}>
            <Stack gap={8} className="h-full">
              {places}
              {toc.length > 0 && <TableOfContents items={toc} index={tocIndex} className="md:sticky md:top-[calc(var(--navbar-height)+1rem)]" />}
            </Stack>
          </Col>
        )}

        {hasMore && (
          <Col span={12} className="print:hidden">
            <KeepReading entry={entry} index={relatedIndex} full={full} />
          </Col>
        )}
      </Grid>
    </article>
  );
}

/**
 * The authored cover, or a generative one seeded by the slug (the same on the server and in the browser), both framed at 1.91:1
 * (the share-image ratio) so every entry opens on the same shape. The cover is the first thing under the title, so it is not lazy-loaded.
 */
function Cover({ entry }: { entry: EntryDetail }) {
  const src = entry.cover ? safeMediaSrc(entry.cover.src) : null;
  return (
    <figure data-slot="entry-cover" className="m-0">
      <Frame padding="none">
        {entry.cover && src ? (
          <img src={src} alt={entry.cover.alt} width={entry.cover.width} height={entry.cover.height} decoding="async" className="block aspect-[1.91/1] w-full object-cover" />
        ) : (
          <CoverArt seed={entry.slug} kind={entry.kind} cols={96} rows={50} />
        )}
      </Frame>
    </figure>
  );
}

function PlacesSection({ entry, index }: { entry: EntryDetail; index: number }) {
  return (
    <section aria-labelledby="entry-places" data-slot="entry-places">
      <SectionHeader index={index} title="Places" id="entry-places" as="h2" meta={formatIndex(entry.places.length, 2)} />
      <ul className="m-0 mt-2 list-none p-0">
        {entry.places.map((place) => (
          <li key={place.slug} className="border-b border-border last:border-b-0">
            <Link to={place.href} className="ds-row flex min-h-11 items-center gap-3 py-2 text-sm no-underline">
              <KindTag kind="place" iconOnly />
              <span className="min-w-0 flex-1 truncate">{place.name}</span>
              {place.region && <MicroLabel className="hidden truncate sm:inline">{place.region}</MicroLabel>}
              <Glyph name="arrow-right" size={12} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The end of an entry: the entries most related to it (shared places and tags) as cards, then the previous and the next of its kind. */
function KeepReading({ entry, index, full }: { entry: EntryDetail; index: number; full: boolean }) {
  const label = KIND_LABELS[entry.kind];
  const related = entry.related.slice(0, 3);
  return (
    <div data-slot="entry-more" className="flex flex-col gap-6 @container">
      {related.length > 0 && (
        <section aria-labelledby="entry-related">
          <SectionHeader index={index} title="Related" id="entry-related" as="h2" meta={formatIndex(entry.related.length, 2)} />
          <ul className={cn("m-0 mt-4 grid list-none grid-cols-1 gap-4 p-0", full ? "md:grid-cols-3" : "@lg:grid-cols-2")}>
            {related.map((ref) => (
              <li key={`${ref.kind}:${ref.slug}`} className="min-w-0">
                <EntryRefCard entry={ref} headingLevel={3} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {(entry.prev || entry.next) && (
        <nav aria-label={`More ${KIND_PLURALS[entry.kind].toLowerCase()}`} data-slot="entry-neighbours">
          <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 @md:grid-cols-2">
            <li className="min-w-0">{entry.prev && <Neighbour direction="prev" entry={entry.prev} label={label} />}</li>
            <li className="min-w-0">{entry.next && <Neighbour direction="next" entry={entry.next} label={label} />}</li>
          </ul>
        </nav>
      )}
    </div>
  );
}

function Neighbour({ direction, entry, label }: { direction: "prev" | "next"; entry: EntryRef; label: string }) {
  const prev = direction === "prev";
  return (
    <Frame interactive padding="none" className="h-full">
      <Link to={entry.href} rel={direction} className={cn("flex min-h-16 items-center gap-3 p-4 no-underline focus-visible:outline-offset-4", !prev && "flex-row-reverse text-right")}>
        <Glyph name={prev ? "arrow-left" : "arrow-right"} size={16} className="shrink-0" />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <MicroLabel>
            {prev ? "Previous" : "Next"} {label.toLowerCase()} / {formatIndex(entry.index)}
          </MicroLabel>
          <span className="truncate text-sm font-medium">{entry.title}</span>
        </span>
      </Link>
    </Frame>
  );
}
