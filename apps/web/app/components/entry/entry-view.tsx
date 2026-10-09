import { Link } from "react-router";
import { PANEL_HEADING_ID } from "~/components/detail-panel";
import { BlockRenderer } from "~/components/entry/blocks";
import {
  Button,
  Col,
  CoverArt,
  DataList,
  DataRow,
  Divider,
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
import { formatEntryDate } from "~/lib/dates";
import { entryLanguage, KIND_LABELS, KIND_PLURALS, splitMeta, type EntryDetail, type EntryRef, type EntryView as EntryViewMode } from "~/lib/entries";
import { displayHost, safeExternalUrl, safeMediaSrc } from "~/lib/entry-blocks";
import { entryCode, formatIndex } from "~/lib/labelling";
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
 * panel and the full-screen view: only `layout` changes how the blocks sit on the 12-column grid, never the data, the markup order
 * or the focus order (header, details, cover, body, then places, related and neighbours).
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
  const hasAside = entry.places.length > 0 || entry.related.length > 0 || !!entry.prev || !!entry.next;

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
                className="ds-micro -ml-1 inline-flex min-h-11 w-fit items-center gap-2 px-1 text-foreground no-underline hover:underline"
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
              {status && <StatusTag status={status} />}
            </div>
            <h1
              id={headingId}
              tabIndex={-1}
              className={cn("m-0 font-semibold tracking-tight break-words outline-offset-4", full ? "text-3xl md:text-4xl" : "text-2xl")}
            >
              {entry.title}
            </h1>
            {entry.summary && <p className="m-0 text-lg text-muted-foreground">{entry.summary}</p>}
          </header>
        </Col>

        {hasDetails && (
          <Col span={12} spanMd={full ? 4 : 12}>
            <Frame padding="md">
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
                <TagList label="Tags" tags={entry.tags.map((label) => ({ label }))} />
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
          </Col>
        )}

        <Col span={12} spanMd={full ? 8 : 12}>
          <Stack gap={6}>
            <Cover entry={entry} full={full} />
            <BlockRenderer blocks={entry.body} lang={language} />
          </Stack>
        </Col>

        {hasAside && (
          <Col span={12} spanMd={full ? 4 : 12}>
            <Stack gap={8}>
              <EntrySections entry={entry} />
            </Stack>
          </Col>
        )}
      </Grid>
    </article>
  );
}

/** The authored cover, or a generative one seeded by the slug (the same on the server and in the browser). The cover is the first thing under the title, so it is not lazy-loaded. */
function Cover({ entry, full }: { entry: EntryDetail; full: boolean }) {
  const src = entry.cover ? safeMediaSrc(entry.cover.src) : null;
  return (
    <figure data-slot="entry-cover" className="m-0">
      <Frame padding="none">
        {entry.cover && src ? (
          <img
            src={src}
            alt={entry.cover.alt}
            width={entry.cover.width}
            height={entry.cover.height}
            decoding="async"
            className={cn("block w-full", entry.cover.width && entry.cover.height ? "h-auto" : "aspect-video object-cover")}
          />
        ) : (
          <CoverArt seed={entry.slug} kind={entry.kind} cols={full ? 64 : 48} rows={full ? 24 : 20} />
        )}
      </Frame>
    </figure>
  );
}

function EntrySections({ entry }: { entry: EntryDetail }) {
  let n = 0;
  const label = KIND_LABELS[entry.kind];
  return (
    <>
      {entry.places.length > 0 && (
        <section aria-labelledby="entry-places">
          <SectionHeader index={++n} title="Places" id="entry-places" as="h2" meta={formatIndex(entry.places.length, 2)} />
          <ul className="m-0 mt-2 list-none p-0">
            {entry.places.map((place) => (
              <li key={place.slug} className="border-b border-border last:border-b-0">
                <Link to={place.href} className="flex min-h-11 items-center gap-3 py-2 text-sm no-underline hover:bg-accent">
                  <KindTag kind="place" iconOnly />
                  <span className="min-w-0 flex-1 truncate">{place.name}</span>
                  {place.region && <MicroLabel className="hidden truncate sm:inline">{place.region}</MicroLabel>}
                  <Glyph name="arrow-right" size={12} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {entry.related.length > 0 && (
        <section aria-labelledby="entry-related">
          <SectionHeader index={++n} title="Related" id="entry-related" as="h2" meta={formatIndex(entry.related.length, 2)} />
          <ul className="m-0 mt-2 list-none p-0">
            {entry.related.map((ref) => (
              <li key={`${ref.kind}:${ref.slug}`} className="border-b border-border last:border-b-0">
                <Link to={ref.href} className="flex min-h-11 items-center gap-3 py-2 text-sm no-underline hover:bg-accent">
                  <KindTag kind={ref.kind} iconOnly />
                  <span className="min-w-0 flex-1 truncate">{ref.title}</span>
                  <MicroLabel>{formatIndex(ref.index)}</MicroLabel>
                  <Glyph name="arrow-right" size={12} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {(entry.prev || entry.next) && (
        <nav aria-label={`More ${KIND_PLURALS[entry.kind].toLowerCase()}`}>
          <Divider ticks />
          <ul className="m-0 mt-2 flex list-none flex-col p-0">
            {entry.prev && <Neighbour direction="prev" entry={entry.prev} label={label} />}
            {entry.next && <Neighbour direction="next" entry={entry.next} label={label} />}
          </ul>
        </nav>
      )}
    </>
  );
}

function Neighbour({ direction, entry, label }: { direction: "prev" | "next"; entry: EntryRef; label: string }) {
  const prev = direction === "prev";
  return (
    <li>
      <Link to={entry.href} rel={direction} className="flex min-h-11 items-center gap-3 py-2 text-sm no-underline hover:bg-accent">
        {prev && <Glyph name="arrow-left" size={12} />}
        <span className="flex min-w-0 flex-1 flex-col">
          <MicroLabel>
            {prev ? "Previous" : "Next"} {label.toLowerCase()} / {formatIndex(entry.index)}
          </MicroLabel>
          <span className="truncate">{entry.title}</span>
        </span>
        {!prev && <Glyph name="arrow-right" size={12} />}
      </Link>
    </li>
  );
}
