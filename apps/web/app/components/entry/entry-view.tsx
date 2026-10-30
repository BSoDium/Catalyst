import type { CSSProperties } from "react";
import { Link } from "react-router";
import { PANEL_HEADING_ID } from "~/components/detail-panel";
import { BlockRenderer } from "~/components/entry/blocks";
import { EntryRefCard } from "~/components/entry/entry-list-card";
import { TableOfContents } from "~/components/entry/toc";
import { Button, CopyButton, CoverArt, Icon, SensitiveImage, SensitiveMediaScope, StatusTag, TagList } from "~/components/ui";
import { shareUrl } from "~/lib/clipboard";
import { copyrightNotice } from "~/lib/copyright";
import { formatEntryDate } from "~/lib/dates";
import {
  entryLanguage,
  KIND_LABELS,
  KIND_PATHS,
  KIND_PLURALS,
  RELATED_LIMIT,
  splitMeta,
  type EntryDetail,
  type EntryPlaceLink,
  type EntryRef,
  type EntryView as EntryViewMode,
} from "~/lib/entries";
import { displayHost, safeExternalUrl, safeMediaSrc } from "~/lib/entry-blocks";
import { tagSearch } from "~/lib/entry-list";
import { isSensitive } from "~/lib/sensitive";
import { formatMonthYear, headlineScale, linkedLine, splitHeadline } from "~/lib/entry-typography";
import { formatReadingTime, readingMinutes, tocItems } from "~/lib/reading";
import { cn } from "~/lib/utils";

export interface EntryViewProps {
  entry: EntryDetail;
  /** `panel`: one column in the side panel. `full`: the same content on the 12-column grid: marginalia, then the text with its figures. */
  layout: EntryViewMode;
  /** Where the visitor came from inside the panel (a place); adds a way back. */
  /** The way back: the place the entry was opened from (`slug`), or the list (`list`: "Software", with the tag filter it had). */
  backTo?: { slug?: string; name: string; href: string; list?: boolean } | null;
  headingId?: string;
}

/** `Lisbon`, `Lisbon, Paris`, `Lisbon, Paris +2`: the places of an entry, short, for the kicker. */
function placeNames(places: readonly EntryPlaceLink[]): string | null {
  if (places.length === 0) return null;
  const shown = places.slice(0, 2).map((p) => p.name);
  return places.length > 2 ? `${shown.join(", ")} +${places.length - 2}` : shown.join(", ");
}

/**
 * One entry (article, project, artwork or poem), typeset after the article and poem boards of the owner's canvas
 * (docs/design-system.md, "Entry pages"). The SAME component fills the side panel and the full-screen view: only `layout` changes
 * the grid (CSS, app.css `.entry-*`), never the data, the markup or the order.
 *
 * Order: back link, the running head (kicker: kind, place, reading time) over one hairline, the headline, the standfirst (the summary), the dateline (date,
 * "open on the globe", copy link), the marginalia (where, written, linked, the authored facts, tags, the external link, contents), the
 * lead image, the text (articles and projects: with its figures in the flow, between the paragraphs where the author put them), the copyright notice (poems, articles
 * and artworks: `lib/copyright.ts`), then "keep reading". A poem puts its
 * title and lines in the middle of the page with its marginalia beside the title. Full screen from 1024 px: marginalia in columns 1 to 3,
 * text and its figures in 4 to 12 (a figure may be wider than the text measure, `.entry-fig`).
 *
 * The title is the view's one level 1 (`#panel-heading`, focus lands on it when the view opens); the body's headings are 2 and 3,
 * and the sections around the body (where, contents, related) are level 2. The contents are in the markup of both layouts (same
 * DOM, same order) and CSS shows them in the full one only; a skip link ("Jump to contents") saves the keyboard the way through the text.
 */
export function EntryView(props: EntryViewProps) {
  const { entry } = props;
  // One reveal state for the entry's images, keyed by the entry so that another entry (the panel keeps this component mounted) starts hidden.
  return (
    <SensitiveMediaScope key={`${entry.kind}/${entry.slug}`} sensitive={isSensitive(entry)}>
      <EntryArticle {...props} />
    </SensitiveMediaScope>
  );
}

function EntryArticle({ entry, layout, backTo, headingId = PANEL_HEADING_ID }: EntryViewProps) {
  const full = layout === "full";
  const poem = entry.kind === "poem";
  // Software has its own order (owner, 2026-10-30, "actions first"): what you can DO right under the summary, then ONE block of what it is, the picture, the text, and what it is linked to at the foot.
  const project = entry.kind === "project";
  // A photograph is the page: its picture comes straight after the title, before the dateline and the marginalia.
  const photo = entry.kind === "photograph";
  const { status, facts } = splitMeta(entry.meta);
  const date = formatEntryDate(entry.date);
  const language = entryLanguage(entry.meta);
  const external = entry.url ? safeExternalUrl(entry.url) : null;
  const toc = tocItems(entry.body, "body");
  // An authored `Reading time` fact wins over the computed one (it is already in the marginalia).
  const authoredReading = facts.some((f) => f.label.trim().toLowerCase() === "reading time");
  const reading = entry.kind === "article" && !authoredReading ? formatReadingTime(readingMinutes(entry.body)) : null;
  const hasMore = entry.related.length > 0 || !!entry.prev || !!entry.next;
  const firstPlace = entry.places[0];
  // Only the country known (`countryCode`): its name stands where the places would, and its link frames it on the globe.
  const names = placeNames(entry.places) ?? entry.country?.name ?? null;
  const notice = copyrightNotice(entry);
  // The images of an article or a project are figures in the flow of the text, where the author put them (wide, captioned, cross-referenced, zoomable); an artwork's and a poem's stay in the text, wide.
  const editorial = entry.kind === "article" || entry.kind === "project";
  const { lead, tail } = poem ? { lead: entry.title, tail: "" } : splitHeadline(entry.title);

  // The marginalia rows that are computed, never invented: when the entry authors a fact of the same name, the authored one is shown.
  const authored = new Set(facts.map((f) => f.label.trim().toLowerCase()));
  const written = authored.has("written") ? null : formatMonthYear(entry.date);
  // Related entries are capped (RELATED_LIMIT): a full list is not a count of what is linked, so the number is only said when it is complete.
  const linked = linkedLine({ places: entry.places.length, entries: entry.related.length < RELATED_LIMIT ? entry.related.length : null });
  // A software entry's repository is a button when it is an address (the fact says it as a host and a path: `github.com/x/y`); the same address as the entry's own link is not offered twice.
  const repoFact = project ? facts.find((f) => f.label.trim().toLowerCase() === "repository") : undefined;
  const repoHref = repoFact ? repositoryHref(repoFact.value) : null;
  const repoButton = repoHref && repoHref !== external ? repoHref : null;
  const rows: { key: string; label: string; value: string }[] = [
    // (software: the date is in the running head and the links are at the foot of the page, so neither is a row)
    ...(!poem && !project && written ? [{ key: "written", label: "Written", value: written }] : []),
    ...(!poem && !project && linked ? [{ key: "linked", label: "Linked", value: linked }] : []),
    ...facts.filter((f) => !(repoHref && f === repoFact)).map((f) => ({ key: `fact-${f.label}`, label: f.label, value: f.value })),
  ];

  const copy = (
    <CopyButton text={() => shareUrl(window.location.origin, entry.href)} label={`Copy link to ${entry.title}`} announcement="Link copied to the clipboard" icon="link">
      Copy link
    </CopyButton>
  );
  const skip = toc.length > 0 && (
    <a href="#entry-toc" className="ds-toc-skip sr-only focus:not-sr-only focus:inline-flex focus:min-h-11 focus:items-center focus:px-2 focus:text-foreground">
      Jump to contents
    </a>
  );
  const globeTarget = firstPlace ?? (entry.country?.href ? { href: entry.country.href, name: entry.country.name } : null);
  const globeLink = globeTarget && (
    <Link to={globeTarget.href} className="entry-link inline-block no-underline hover:underline">
      {globeTarget.name} <Icon name="arrow-up-right" size="inline" /> open on the globe
    </Link>
  );

  const actions = project && (external || repoButton) && (
    <div data-slot="entry-actions" className="mt-7 flex flex-wrap items-center gap-3 print:hidden">
      {external && (
        <Button asChild variant="primary">
          <a href={external} target="_blank" rel="noopener noreferrer">
            <span className="truncate">Open {displayHost(external)}</span>
            <Icon name="arrow-up-right" size="inline" />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </Button>
      )}
      {repoButton && (
        <Button asChild variant={external ? "secondary" : "primary"}>
          <a href={repoButton} target="_blank" rel="noopener noreferrer">
            <span>Repository</span>
            <Icon name="arrow-up-right" size="inline" />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </Button>
      )}
      {/* (the same size as the buttons beside it: the shared `copy` is the small one of the dateline) */}
      <CopyButton text={() => shareUrl(window.location.origin, entry.href)} label={`Copy link to ${entry.title}`} announcement="Link copied to the clipboard" icon="link" size="default">
        Copy link
      </CopyButton>
    </div>
  );

  const marginEl = (
        <div data-slot="entry-margin" className="entry-margin">
          {project && (
            <h2 id="entry-glance" className="type-meta m-0 text-foreground">
              At a glance
            </h2>
          )}
          {poem ? (
            <PoemMargin entry={entry} date={date} globeLink={globeLink} skip={skip} copy={copy} />
          ) : project ? null : (
            (entry.places.length > 0 || entry.country) && <PlacesSection entry={entry} />
          )}
          {(rows.length > 0 || (project && (entry.places.length > 0 || entry.country))) && (
            <dl data-slot="entry-details" className={cn("m-0", poem && "mt-2", project && "mt-2")}>
              {rows.map((row) => (
                <div key={row.key} data-slot="entry-fact" className={cn("min-w-0", project && "-mx-3 px-3 py-2 odd:bg-foreground/5", project && !full && "grid grid-cols-[7.5rem_minmax(0,1fr)] items-baseline gap-x-4")}>
                  <dt className="type-meta text-foreground">{row.label}</dt>
                  <dd className="m-0 [overflow-wrap:anywhere]">{row.value}</dd>
                </div>
              ))}
              {project && (entry.places.length > 0 || entry.country) && (
                <div data-slot="entry-fact" className={cn("-mx-3 min-w-0 px-3 py-2 odd:bg-foreground/5", !full && "grid grid-cols-[7.5rem_minmax(0,1fr)] items-baseline gap-x-4")}>
                  <dt className="type-meta text-foreground">Made in</dt>
                  <dd className="m-0 [overflow-wrap:anywhere]">
                    <ProjectPlaces entry={entry} globeLink={globeTarget} />
                  </dd>
                </div>
              )}
            </dl>
          )}
          {entry.tags.length > 0 && (
            <TagList
              label="Tags"
              className="font-meta text-xs"
              tags={entry.tags.map((label) => ({ label, href: `${KIND_PATHS[entry.kind]}${tagSearch("", label)}` }))}
            />
          )}
          {external && !project && (
            <Button asChild variant="primary" className="w-full">
              <a href={external} target="_blank" rel="noopener noreferrer">
                <span className="truncate">Open {displayHost(external)}</span>
                <Icon name="arrow-up-right" size="inline" />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </Button>
          )}
          {toc.length > 0 && <TableOfContents items={toc} className="md:sticky md:top-[calc(var(--navbar-height)+1rem)]" />}
        </div>
  );

  return (
    <article
      aria-labelledby={headingId}
      data-slot="entry-view"
      data-surface="reading"
      data-layout={layout}
      data-kind={entry.kind}
      data-sensitive={isSensitive(entry) ? "" : undefined}
      className={cn("entry mx-auto w-full min-w-0", full ? "max-w-[90rem] px-4 pt-3 pb-20 md:px-14" : "px-6 pt-2 pb-10")}
    >
      <div className="entry-grid">
        <header className={cn("entry-head flex min-w-0 flex-col", poem ? "gap-5" : "gap-0")}>
          {backTo && !backTo.list && (
            <Link
              to={backTo.href}
              className="type-meta -ml-1 mb-3 inline-flex min-h-11 w-fit items-center gap-2 px-1 text-muted-foreground no-underline hover:text-foreground hover:underline print:hidden"
            >
              <Icon name="arrow-left" size="inline" />
              <span>
                Back to {!backTo.list && <span className="sr-only">place </span>}
                {backTo.name}
              </span>
            </Link>
          )}
          <p
            data-slot="entry-meta"
            className={cn("type-meta m-0 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-muted-foreground", !poem && "entry-running")}
          >
            <span className="min-w-0">
              {backTo?.list ? (
                // (opened from its list: the kind's name IS the way back, in the running head, so it has no row of its own: a back link with the same word over the kind was two lines for one thing)
                <Link
                  to={backTo.href}
                  aria-label={`Back to ${backTo.name}`}
                  data-slot="entry-kind"
                  // (inline, so that its text sits on the running head's own baseline with the places and the date: a flex box took the baseline of its icon; the touch target is a pseudo-element, taller than the line)
                  className="relative text-muted-foreground no-underline after:absolute after:-inset-x-1 after:-inset-y-3 after:content-[''] hover:text-foreground hover:underline print:hidden"
                >
                  <Icon name="arrow-left" size="inline" className="mr-1.5 align-[-0.2em]" />
                  {KIND_LABELS[entry.kind]}
                </Link>
              ) : (
                <span data-slot="entry-kind">{KIND_LABELS[entry.kind]}</span>
              )}
              {names && !poem && (
                <>
                  <span aria-hidden="true"> &middot; </span>
                  <span data-slot="entry-place">{names}</span>
                </>
              )}
              {project && date && (
                <>
                  <span aria-hidden="true"> &middot; </span>
                  <time dateTime={date.dateTime} data-slot="entry-date">
                    {date.text}
                  </time>
                </>
              )}
            </span>
            {(status || reading) && (
              <span className="flex items-baseline gap-4">
                {status && <StatusTag status={status} className="text-[length:inherit] leading-[inherit] [font:inherit] tracking-[inherit] uppercase" />}
                {reading && <span data-slot="entry-reading">{reading}</span>}
              </span>
            )}
          </p>
          <h1
            id={headingId}
            tabIndex={-1}
            data-poem={poem ? "" : undefined}
            style={poem ? undefined : ({ "--title-scale": headlineScale(entry.title) } as CSSProperties)}
            className={cn("entry-title outline-offset-4", poem ? "mt-4" : "mt-8 md:mt-10")}>
            {lead}
            {tail ? <span className="entry-title-tail">{tail}</span> : null}
          </h1>
          {entry.summary && !poem && <p className="type-standfirst mt-[1.375rem] max-w-[25.4em] md:mt-[2.125rem]">{entry.summary}</p>}
          {actions}
        </header>

        {photo && <Cover entry={entry} />}

        {!poem && !project && (
          <div data-slot="entry-dateline" className="entry-dateline flex flex-wrap items-center gap-x-6 gap-y-1 md:gap-x-12">
            {date && (
              <time dateTime={date.dateTime} data-slot="entry-date">
                {date.text}
              </time>
            )}
            {globeLink}
            <span className="ml-auto flex items-center gap-1 print:hidden">
              {skip}
              {copy}
            </span>
          </div>
        )}

        {!poem && marginEl}
        {!poem && !photo && <Cover entry={entry} />}

        <div className="entry-text min-w-0">
          <BlockRenderer blocks={entry.body} lang={language} dropCap={editorial} figures={editorial} className="gap-[1.1em]" />
        </div>
        {poem && marginEl}
        {poem && <Cover entry={entry} />}
      </div>

      {project && (linked || skip) && (
        <p data-slot="entry-linked" className="type-meta mt-12 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-muted-foreground print:hidden">
          <span>{linked ? `Linked to ${linked}` : null}</span>
          {skip}
        </p>
      )}

      {notice && (
        <p data-slot="entry-copyright" lang={notice.language === "fr" ? "fr" : undefined} className="entry-copyright">
          {notice.text}
        </p>
      )}

      {hasMore && (
        <div className="mt-16 print:hidden md:mt-20">
          <KeepReading entry={entry} full={full} />
        </div>
      )}
    </article>
  );
}

/** A poem's marginalia (the night board): the place, the date and the way to the globe in plain mono, then the note about the poem. */
function PoemMargin({
  entry,
  date,
  globeLink,
  skip,
  copy,
}: {
  entry: EntryDetail;
  date: ReturnType<typeof formatEntryDate>;
  globeLink: React.ReactNode;
  skip: React.ReactNode;
  copy: React.ReactNode;
}) {
  return (
    <>
      <div className="flex flex-col">
        {entry.places.length > 0 && (
          <section aria-labelledby="entry-places" data-slot="entry-places">
            <h2 id="entry-places" className="sr-only">
              Places
            </h2>
            <ul className="m-0 list-none p-0">
              {entry.places.map((place) => (
                <li key={place.slug}>
                  <Link to={place.href} className="entry-link inline-block">
                    {place.name}
                  </Link>
                  {place.region && <span>, {place.region}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}
        {date && (
          <time dateTime={date.dateTime} data-slot="entry-date">
            {date.text}
          </time>
        )}
        {globeLink && <div className="mt-[1.125rem]">{globeLink}</div>}
      </div>
      {entry.summary && <p className="m-0">{entry.summary}</p>}
      <div className="flex items-center gap-1 print:hidden">
        {skip}
        {copy}
      </div>
    </>
  );
}

/**
 * How an authored cover fills its column, by kind: an artwork's or a photograph's picture is the work, kept whole in its own proportions (at most 80 % of
 * the window tall, centred); the others are banners cropped to the share image's 1.91:1.
 */
export function coverFit(kind: EntryDetail["kind"]): string {
  return kind === "artwork" || kind === "photograph" ? "h-auto max-h-[80dvh] object-contain" : "aspect-[1.91/1] object-cover";
}

/**
 * The lead image: the authored cover. In an article, a project or a poem it is a banner, framed at 1.91:1 (the share-image ratio) and
 * cropped to it. In an artwork the picture IS the work and is never cropped: it keeps its own proportions (the `width` and `height` it
 * is published with), as wide as the column and never taller than 80 % of the window (a portrait work is shown whole, centred). A
 * generated cover stands in only where the image IS the page (an artwork): in an article, a project or a poem the type is the page and
 * a placeholder would only be decoration. Not lazy: it is the first image under the title. A rule of the ink above it, like every
 * figure. In a sensitive entry it is blurred, with the control that shows the entry's images (the generated art is not a picture of
 * anything: it is never blurred); the blurred frame is the image's own box, so it follows the proportions above.
 */
function Cover({ entry }: { entry: EntryDetail }) {
  const src = entry.cover ? safeMediaSrc(entry.cover.src) : null;
  if (!(entry.cover && src) && entry.kind !== "artwork") return null;
  return (
    <figure data-slot="entry-cover" className="entry-cover entry-figure m-0 min-w-0">
      <div className="overflow-hidden">
        {entry.cover && src ? (
          <SensitiveImage>
            <img src={src} alt={entry.cover.alt} width={entry.cover.width} height={entry.cover.height} decoding="async" className={cn("mx-auto block w-full", coverFit(entry.kind))} />
          </SensitiveImage>
        ) : (
          <CoverArt seed={entry.slug} kind={entry.kind} cols={96} rows={50} />
        )}
      </div>
    </figure>
  );
}

/** Where: the places of the entry, each a link to the place on the globe, with its region as it is published; or only its country, framed on the globe. */
function PlacesSection({ entry }: { entry: EntryDetail }) {
  return (
    <section aria-labelledby="entry-places" data-slot="entry-places">
      <h2 id="entry-places" className="type-meta m-0 text-foreground">
        Where
      </h2>
      <ul className="m-0 list-none p-0">
        {entry.places.map((place) => (
          <li key={place.slug}>
            <Link to={place.href} className="entry-link inline-block">
              {place.name}
            </Link>
            {place.region && <span>, {place.region}</span>}
          </li>
        ))}
        {entry.places.length === 0 && entry.country && (
          <li data-slot="entry-country">
            {entry.country.href ? (
              <Link to={entry.country.href} className="entry-link inline-block">
                {entry.country.name}
              </Link>
            ) : (
              entry.country.name
            )}
          </li>
        )}
      </ul>
    </section>
  );
}

/**
 * The address a software entry's `Repository` fact names, when it names one: a host and a path (`github.com/x/y`), with or without `https://`. Anything else (a sentence, "private") is not a link and stays a row.
 * Only https, through the same check as every outbound link (`safeExternalUrl`).
 */
export function repositoryHref(value: string): string | null {
  const v = value.trim();
  if (!/^(https:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(v)) return null;
  return safeExternalUrl(/^https:\/\//i.test(v) ? v : `https://${v}`);
}

/** A software entry's places in its "Made in" row: the names as links, and the way to the globe. */
function ProjectPlaces({ entry, globeLink }: { entry: EntryDetail; globeLink: { href: string; name: string } | null }) {
  return (
    <>
      {entry.places.map((place, i) => (
        <span key={place.slug}>
          {i > 0 && ", "}
          <Link to={place.href} className="entry-link inline-block">
            {place.name}
          </Link>
        </span>
      ))}
      {entry.places.length === 0 && entry.country && (entry.country.href ? <Link to={entry.country.href} className="entry-link inline-block">{entry.country.name}</Link> : entry.country.name)}
      {globeLink && (
        <Link to={globeLink.href} className="type-meta ml-3 whitespace-nowrap text-muted-foreground no-underline hover:text-foreground">
          on the globe <Icon name="arrow-up-right" size="inline" />
        </Link>
      )}
    </>
  );
}

/** The end of an entry: the entries most related to it (shared places and tags) as cards, then the previous and the next of its kind. */
function KeepReading({ entry, full }: { entry: EntryDetail; full: boolean }) {
  const label = KIND_LABELS[entry.kind];
  const related = entry.related.slice(0, 3);
  return (
    <div data-slot="entry-more" className="flex flex-col gap-12 @container">
      {related.length > 0 && (
        <section aria-labelledby="entry-related">
          <h2 id="entry-related" className="type-meta m-0 text-foreground">
            Related
          </h2>
          <ul className={cn("m-0 mt-6 grid list-none grid-cols-1 gap-8 p-0", full ? "md:grid-cols-3" : "@lg:grid-cols-2")}>
            {related.map((ref) => (
              <li key={`${ref.kind}:${ref.slug}`} className="min-w-0">
                <EntryRefCard entry={ref} headingLevel={3} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {(entry.prev || entry.next) && (
        <nav aria-label={`More ${KIND_PLURALS[entry.kind].toLowerCase()}`} data-slot="entry-neighbours" className="pt-1">
          <ul className="m-0 grid list-none grid-cols-1 gap-6 p-0 @md:grid-cols-2">
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
    <Link to={entry.href} rel={direction} className={cn("group flex min-h-11 items-start gap-3 no-underline", !prev && "flex-row-reverse text-right")}>
      <Icon name={prev ? "arrow-left" : "arrow-right"} size="control" className="mt-0.5 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="type-meta text-muted-foreground">
          {prev ? "Previous" : "Next"} {label.toLowerCase()}
        </span>
        <span className="font-reading text-[1.375rem] leading-[1.1] font-bold tracking-[-0.015em] text-balance group-hover:underline">{entry.title}</span>
      </span>
    </Link>
  );
}
