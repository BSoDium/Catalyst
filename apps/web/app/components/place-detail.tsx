import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "~/lib/utils";
import { Link } from "react-router";
import type { PlaceSummary } from "@catalyst/schemas";
import { PANEL_HEADING_ID } from "~/components/detail-panel";
import { EntryRow } from "~/components/entry/entry-list-card";
import { TripCards } from "~/components/trip-card";
import { PhotoGallery, type GalleryItem } from "~/components/place-gallery";
import { Button, Icon, Stack, StatePanel } from "~/components/ui";
import { coverImageProps } from "~/lib/cover-image";
import { changedParts, type DatePart } from "~/lib/dates";
import { safeMediaSrc } from "~/lib/entry-blocks";
import { placeCover, type PlaceCover } from "~/lib/place-cover";
import { formatPlaceCoordinates, placeCoordinateParts, type CoordinatePart } from "~/lib/labelling";
import { imageSize, placePath, type PlaceDetailData } from "~/lib/projection";

/** A picture of the step: one of the place's own images, or the cover of a photograph linked to it (then `href` opens the photograph, and the panel's way back leads here). */
interface PhotoItem {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  caption?: string;
  href?: string;
}

function Figure({ item, from }: { item: PhotoItem; from: string }) {
  const src = safeMediaSrc(item.src);
  if (!src) return null;
  const size = imageSize(item);
  // A picture is the work: never drawn wider than its own pixels (a 720 px photograph is not blown up to the panel's width), never taller than
  // 80 % of the window (shown whole, `object-contain`), and where it does not fill its frame a blurred, enlarged copy of it fills the sides, as on
  // a photograph's own page (`.entry-stage-backdrop`, decorative: no alt). Issue #448.
  const img = size ? (
    <div data-slot="place-stage" className="relative isolate overflow-hidden">
      <img src={src} alt={item.alt} width={size.width} height={size.height} loading="lazy" decoding="async" style={{ maxWidth: size.width }} className="relative mx-auto block h-auto max-h-[80dvh] w-full object-contain" />
      <img src={src} alt="" aria-hidden="true" loading="lazy" decoding="async" className="entry-stage-backdrop" />
    </div>
  ) : (
    // Dimensions were not authored: reserve a neutral box so nothing shifts.
    <div className="aspect-[4/3] w-full overflow-hidden bg-accent">
      <img src={src} alt={item.alt} loading="lazy" decoding="async" className="size-full object-cover" />
    </div>
  );
  return (
    <figure className="m-0 flex flex-col gap-2">
      <div className="overflow-hidden outline outline-1 -outline-offset-1 outline-border">
        {item.href ? (
          <Link to={item.href} state={{ from }} className="block">
            {img}
          </Link>
        ) : (
          img
        )}
      </div>
      {item.caption && <figcaption className="text-sm text-muted-foreground">{item.caption}</figcaption>}
    </figure>
  );
}

/** Pictures shown at once; the rest sit behind one disclosure, so a step with many pictures stays a page and not a roll. */
const PHOTOS_OPEN = 4;

/** The pictures of the step: one is shown whole, several as a grid (two columns from a phone's width), all lazy; past `PHOTOS_OPEN` the rest wait behind a disclosure. */
function Photos({ images, from }: { images: PhotoItem[]; from: string }) {
  const open = images.slice(0, PHOTOS_OPEN);
  const rest = images.slice(PHOTOS_OPEN);
  const grid = (list: typeof images) => (
    <div className={list.length === 1 && images.length === 1 ? "grid grid-cols-1 gap-3" : "grid grid-cols-1 gap-3 min-[30rem]:grid-cols-2"}>
      {list.map((image, i) => (
        // an odd count would leave one picture alone in half a row: the first one takes the row
        <div key={image.src} className={i === 0 && list.length > 1 && list.length % 2 === 1 ? "min-[30rem]:col-span-2" : undefined}>
          <Figure item={image} from={from} />
        </div>
      ))}
    </div>
  );
  return (
    <div data-slot="place-photos" className="flex flex-col gap-3">
      {grid(open)}
      {rest.length > 0 && (
        <details className="group flex flex-col gap-3">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm underline-offset-4 hover:underline">
            <span className="group-open:hidden">Show {rest.length} more {rest.length === 1 ? "picture" : "pictures"}</span>
            <span className="hidden group-open:inline">Hide the other {rest.length === 1 ? "picture" : "pictures"}</span>
          </summary>
          {grid(rest)}
        </details>
      )}
    </div>
  );
}

/** What the step itself has to say: its few words, the pictures taken there and the trip it is a stop of. Nothing here is a heading of its own: the card's parts say what they are. */
function StepStory({ place, photos }: { place: PlaceDetailData; photos: PhotoItem[] }) {
  return (
    <Stack gap={6}>
      {place.summary && <p className="m-0 max-w-[60ch] text-lg text-pretty text-muted-foreground">{place.summary}</p>}
      {place.body.length > 0 && (
        <Stack gap={4}>
          {place.body.map((paragraph, i) => (
            <p key={i} className="m-0 max-w-[60ch] text-lg text-pretty">
              {paragraph}
            </p>
          ))}
        </Stack>
      )}
      {photos.length > 0 && <Photos images={photos} from={place.slug} />}
      {place.trips.length > 0 && <TripCards trips={place.trips} here={place.slug} lived={place.lived === true} />}
    </Stack>
  );
}

/** The ink of a count of entries: the secondary grey for one (or none), the full ink for the most there are in the place, and in between in proportion; so the eye goes to what the place has the most of. */
function countInk(count: number, most: number): string {
  const share = most > 1 ? Math.min(1, Math.max(0, (count - 1) / (most - 1))) : 0;
  return `color-mix(in oklab, var(--foreground) ${Math.round(share * 100)}%, var(--muted-foreground))`;
}

/** The dates of the place, with the part that changed between the two ends in the ink and the rest quiet (the years when they differ, else the months, else the days); as authored when there is no range to compare. */
function WhenText({ place }: { place: PlaceDetailData }) {
  const range = place.datesRange ? changedParts(place.datesRange.start, place.datesRange.end) : null;
  if (!range || !place.dates) return <>{place.dates?.text}</>;
  const run = (parts: DatePart[]) => parts.map((part, i) => (part.strong ? <span key={i} className="place-when-strong">{part.text}</span> : <span key={i}>{part.text}</span>));
  return (
    <>
      {run(range.from)}
      <span aria-hidden="true">{" – "}</span>
      <span className="sr-only"> to </span>
      {run(range.to)}
    </>
  );
}

/** One figure of the facts strip: a micro-label over its value. */
function Fact({ label, children, end, className }: { label: string; children: ReactNode; end?: boolean; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", end && "items-end text-right", className)}>
      <dt className="ds-micro">{label}</dt>
      <dd className={cn("m-0 flex flex-col", end && "items-end")}>
        {children}
      </dd>
    </div>
  );
}

/** A coordinate set in three voices: the whole degrees in the display face and the foreground, the decimals dimmer, the hemisphere a small tracked mono letter. Read out as the plain `52.23° N`. */
function Coordinate({ label, part }: { label: string; part: CoordinatePart }) {
  return (
    <Fact label={label}>
      <span className="sr-only">{part.text}</span>
      <span aria-hidden="true" className="place-figure flex items-baseline">
        <span className="place-figure-whole">{part.whole}</span>
        <span className="place-figure-fraction">{part.fraction}</span>
        <span className="place-figure-deg">°</span>
        <span className="place-figure-hemisphere">{part.hemisphere}</span>
      </span>
    </Fact>
  );
}

/**
 * What the page knows about the place, as a strip of figures under its name: the two coordinates (at the precision they are stored with), what is on the site about it
 * (one count per kind of entry about it, dimmer) and when. A figure the data does not have is not drawn.
 */
function PlaceFacts({ place }: { place: PlaceDetailData }) {
  const coordinates = placeCoordinateParts(place.coordinates.lat, place.coordinates.lon);
  const mostEntries = Math.max(0, ...place.entries.map((g) => g.entries.length));
  // Where the block of counts does not fit beside the coordinates it goes to the next row (CSS), and there everything in it is left-aligned, the figures too: the row's right edge is
  // only for a block that shares the row. CSS cannot say that it wrapped, so the two blocks' tops are compared whenever the row is resized (until measured, which is the server's markup and the first client render, the block is invisible but takes its room, so that it never shows in the wrong alignment; a page without scripts shows it as it is).
  const row = useRef<HTMLDivElement>(null);
  const start = useRef<HTMLDListElement>(null);
  const counts = useRef<HTMLDListElement>(null);
  const [below, setBelow] = useState(false);
  const [measured, setMeasured] = useState(false);
  useLayoutEffect(() => {
    const el = row.current;
    const measure = () => {
      setBelow(!!start.current && !!counts.current && counts.current.getBoundingClientRect().top > start.current.getBoundingClientRect().top + 1);
      setMeasured(true);
    };
    measure();
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [place.slug]);
  return (
    <div ref={row} data-slot="place-facts" className="flex flex-wrap items-start gap-x-7 gap-y-6">
      <dl ref={start} className="m-0 flex flex-wrap gap-x-7 gap-y-3">
        {coordinates ? (
          <>
            <Coordinate label="Lat" part={coordinates[0]} />
            <Coordinate label="Lon" part={coordinates[1]} />
          </>
        ) : (
          <Fact label="Coordinates">
            <span className="ds-meta">{formatPlaceCoordinates(place.coordinates.lat, place.coordinates.lon)}</span>
          </Fact>
        )}
        {place.dates && (
          <Fact label="When">
            <time dateTime={place.dates.dateTime} className="place-figure place-figure-when">
              <WhenText place={place} />
            </time>
          </Fact>
        )}
      </dl>
      {/* the counts of entries are one block at the right end of the row, their figures against the right edge; when it does not fit beside the coordinates it goes to the next row whole, and only then wraps within itself */}
      {place.entries.length > 0 && !measured && (
        <noscript>
          <style>{"[data-slot=place-facts] [data-measuring]{visibility:visible}"}</style>
        </noscript>
      )}
      {place.entries.length > 0 && (
        <dl ref={counts} data-below={below ? "" : undefined} data-measuring={measured ? undefined : ""} className={cn("m-0 flex flex-wrap gap-x-7 gap-y-3", !below && "ml-auto justify-end", !measured && "invisible")}>
          {place.entries.map((g) => (
            <Fact key={g.kind} label={g.label} end={!below}>
              <span className="place-figure place-figure-count" style={{ color: countInk(g.entries.length, mostEntries) }}>
                {g.entries.length}
              </span>
            </Fact>
          ))}
        </dl>
      )}
    </div>
  );
}

/** Where the place is, for the line over its name: its region and country (once when they are the same word). */
function placeWhere(place: PlaceDetailData): string {
  return [place.region, place.country].filter((part, i, all): part is string => !!part && all.indexOf(part) === i).join(" · ");
}

/**
 * The head of the panel: the region and country as a small tracked line, the name in the display face (large), then the facts strip (`PlaceFacts`). With a cover
 * (`lib/place-cover.ts`) the picture is full-bleed behind it and runs up under the panel's bar (the close button sits on it), a gradient into the panel's ground under it so
 * the type reads on any picture; the picture is decoration (`alt=""`): blurred and dimmed toward the panel's ground, so a white or a black one never fights the type. Without one it is the type alone.
 */
function PlaceHeader({ place, cover }: { place: PlaceDetailData; cover: PlaceCover | null }) {
  const src = cover ? safeMediaSrc(cover.src) : null;
  const where = placeWhere(place);
  const body = (
    <>
      {(where || place.lived || place.living) && (
        <p className="ds-micro m-0 flex flex-wrap gap-x-2">
          {where && <span>{where}</span>}
          {(place.lived === true || place.living === true) && <span className="ds-micro" data-tone="signal">{where ? "· " : ""}{place.living ? "Lives here" : "Lived here"}</span>}
        </p>
      )}
      <h1 id={PANEL_HEADING_ID} tabIndex={-1} className="place-name m-0 outline-offset-4">
        {place.name}
      </h1>
      <PlaceFacts place={place} />
    </>
  );
  if (!cover || !src) return <header className="flex flex-col gap-3">{body}</header>;
  return (
    <header data-slot="place-cover" className="place-cover relative isolate -mx-6 -mt-2 flex flex-col justify-end gap-3 overflow-hidden px-6 pb-5 md:-mt-[calc(var(--navbar-height)+1.5rem)]">
      <div aria-hidden="true" className="place-cover-art absolute inset-0 -z-10">
        <img {...coverImageProps({ src, width: cover.width, small: cover.small }, "(min-width: 48rem) 50vw, 100vw")} alt="" decoding="async" className="place-cover-img" />
        <div className="absolute inset-0 bg-linear-to-t from-background/60 via-background/20 via-60% to-transparent" />
      </div>
      {body}
    </header>
  );
}

/** The kinds whose entries are pictures first: the ones with a cover are a gallery (`PhotoGallery`) at the head of their group, not rows. */
const GALLERY_KINDS = ["photograph", "artwork"] as const;

/**
 * The step's own pictures, the galleries (the photographs linked to the place and its artworks, with a cover: a photograph of the place IS a picture of it, and an artwork is its
 * picture: they are not "entries" that would put the story second) and the entries that are left in their groups (those with no picture). A sensitive one is in its gallery too, blurred under its veil as on its card.
 */
function stepContent(place: PlaceDetailData): { photos: PhotoItem[]; galleries: Map<string, GalleryItem[]>; groups: PlaceDetailData["entries"] } {
  const photos: PhotoItem[] = place.images.map((i) => ({ src: i.src, alt: i.alt, ...(i.width && i.height ? { width: i.width, height: i.height } : {}), ...(i.caption ? { caption: i.caption } : {}) }));
  const galleries = new Map<string, GalleryItem[]>();
  const groups = place.entries
    .map((group) => {
      if (!(GALLERY_KINDS as readonly string[]).includes(group.kind)) return group;
      const items: GalleryItem[] = [];
      const keep = group.entries.filter((e) => {
        if (!e.cover || !safeMediaSrc(e.cover.src)) return true;
        items.push({ src: e.cover.src, alt: e.cover.alt, ...(e.cover.width && e.cover.height ? { width: e.cover.width, height: e.cover.height } : {}), title: e.title, href: e.href, ...(e.cover.small ? { small: e.cover.small } : {}), ...(e.date ? { date: e.date } : {}), ...(e.sensitive ? { sensitive: true as const } : {}) });
        return false;
      });
      items.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
      if (items.length > 0) galleries.set(group.kind, items);
      return { ...group, entries: keep };
    })
    .filter((g) => g.entries.length > 0 || galleries.has(g.kind));
  return { photos, galleries, groups };
}

/** The title of a group of entries: the display face, large, with the count in mono beside it. */
function GroupHeader({ title, count }: { title: string; count: number }) {
  return (
    <header data-slot="group-header" className="flex items-baseline gap-3 pt-2">
      <h2 className="m-0 font-display text-[2rem] leading-none font-extrabold tracking-[-0.03em]">{title}</h2>
      <span className="place-group-count">{count}</span>
    </header>
  );
}

/** The entries of a group newest first, as a list page has them (an undated one last, the authored order kept among equals). */
function newestFirst<T extends { date?: string | undefined }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

/** What is behind the closed "On the road here": the pictures and the trip, counted. */
function storyMeta(place: PlaceDetailData, pictures: number): string {
  const parts = [pictures > 0 ? `${pictures} ${pictures === 1 ? "picture" : "pictures"}` : "", place.body.length > 0 || place.summary ? "the story" : "", place.trips.length > 0 ? (place.trips.length === 1 ? place.trips[0]!.title : `${place.trips.length} trips`) : ""];
  return parts.filter(Boolean).join(" · ");
}

/**
 * Place detail in the panel (docs/design-system.md, docs/step-page.md): the name as the view's h1 with one quiet line under it (country, coordinates, dates).
 * Then one of two pages. A step with no entries is its story: the few words, the pictures taken there, and a small card for the trip it is a stop of. A step
 * with entries leads with them, as entry cards grouped by kind, and its story and trip follow, closed, in one "On the road here" disclosure: the entries
 * are the priority, the travelling is the context. Opening an entry card keeps the panel open (the entry replaces the place in it) and carries
 * `{ from: <place> }` in the router state, which gives the entry a way back. Optional parts are omitted when empty.
 */
export function PlaceDetail({ place }: { place: PlaceDetailData }) {
  const cover = placeCover(place);
  const { photos: all, galleries, groups: allGroups } = stepContent(place);
  // (a place's own picture that heads the panel is not shown a second time in the strip below; an entry's cover is, as the link to the entry)
  const photos = cover?.own ? all.filter((p) => p.src !== cover.src) : all;
  // A gallery leads the entries (the first thing the visitor lands on): the photographs', or, when there are none to show, the artworks'; then the groups in their order. A group with a
  // gallery has it first, then its cards (the ones with no picture) under the same title
  const leading = allGroups.find((g) => g.kind === "photograph" && galleries.has(g.kind)) ?? allGroups.find((g) => g.kind === "artwork" && galleries.has(g.kind));
  const groups = leading ? [leading, ...allGroups.filter((g) => g !== leading)] : allGroups;
  const count = allGroups.reduce((n, g) => n + g.entries.length, 0);
  const story = !!place.summary || place.body.length > 0 || photos.length > 0 || place.trips.length > 0;
  return (
    <article aria-labelledby={PANEL_HEADING_ID} data-slot="place-view" data-kind="place" className="px-6 pt-2 pb-10">
      <Stack gap={8}>
        <PlaceHeader place={place} cover={cover} />
        {groups.length > 0 && (
          <section aria-label="Entries" data-slot="place-entries">
            <Stack gap={10}>
              {groups.map((group) => {
                const gallery = galleries.get(group.kind);
                return (
                  <div key={group.kind} data-kind={group.kind} className="@container flex flex-col gap-4">
                    <GroupHeader title={group.label} count={(gallery?.length ?? 0) + group.entries.length} />
                    {gallery && <PhotoGallery items={gallery} from={place.slug} />}
                    {group.entries.length > 0 && (
                      // (the first row starts at the title's own distance from it, as a gallery does: the rows' padding is between them)
                      // (poems are short: in a wide panel they are two columns, each a row of its own width, and a narrow one is a list again)
                      <ul className={cn("m-0 grid list-none grid-cols-1 gap-0 p-0 [&>li:first-child>article]:pt-0", group.kind === "poem" && "@xl:grid-cols-2 @xl:gap-x-8 @xl:[&>li:nth-child(2)>article]:pt-0")}>
                        {newestFirst(group.entries).map((entry) => (
                          // (the row's own width is what its layout follows: side by side from 28 rem, stacked below)
                          <li key={entry.slug} className="@container min-w-0">
                            <EntryRow entry={entry} linkState={{ from: place.slug }} headingLevel={3} compact />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </Stack>
          </section>
        )}
        {/* (a step with no entries is its story, open, under its photographs) */}
        {story && !count && <StepStory place={place} photos={photos} />}
        {story && count > 0 && (
          // The entries are what the visitor came for: the step's own story and the trip are the context, one line closed.
          <details data-slot="place-story" className="group border-t border-border pt-2">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-base [&::-webkit-details-marker]:hidden">
              <span className="flex min-w-0 flex-col">
                <span className="font-medium">On the road here</span>
                <span className="ds-meta">{storyMeta(place, photos.length)}</span>
              </span>
              <Icon name="chevron-down" size="inline" className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="pt-4">
              <StepStory place={place} photos={photos} />
            </div>
          </details>
        )}
      </Stack>
    </article>
  );
}

/** Shown inside the panel when the slug does not exist (HTTP 404). */
export function PlaceNotFound({ places }: { places: PlaceSummary[] }) {
  return (
    <div className="px-6 pt-2 pb-10">
      <Stack gap={6}>
        <StatePanel
          state="empty"
          headingLevel={1}
          titleId={PANEL_HEADING_ID}
          title="Place not found"
          description="There is no place at this address. It may have been renamed or removed."
          action={
            <Button asChild variant="primary">
              <Link to="/">
                <Icon name="arrow-left" size="inline" />
                See all places
              </Link>
            </Button>
          }
        />
        {places.length > 0 && (
          <nav aria-label="All places">
            <ul className="m-0 list-none p-0">
              {places.map((place) => (
                <li key={place.slug}>
                  <Link to={placePath(place.slug)} className="flex min-h-11 items-center py-2 text-base no-underline hover:underline">
                    <span className="min-w-0 flex-1 truncate">{place.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </Stack>
    </div>
  );
}
