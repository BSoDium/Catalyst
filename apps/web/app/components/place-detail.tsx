import type { ReactNode } from "react";
import { cn } from "~/lib/utils";
import { Link } from "react-router";
import type { PlaceSummary } from "@catalyst/schemas";
import { PANEL_HEADING_ID } from "~/components/detail-panel";
import { EntryListCard } from "~/components/entry/entry-list-card";
import { TripCards } from "~/components/trip-card";
import { Button, Icon, SectionHeader, Stack, StatePanel } from "~/components/ui";
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

/** One figure of the facts strip: a micro-label over its value. */
function Fact({ label, children, sub, end, className }: { label: string; children: ReactNode; sub?: string; end?: boolean; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", end && "items-end text-right", className)}>
      <dt className="ds-micro">{label}</dt>
      <dd className={cn("m-0 flex flex-col", end && "items-end")}>
        {children}
        {sub && <span className="ds-meta">{sub}</span>}
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
  return (
    <div data-slot="place-facts" className="flex flex-wrap items-start gap-x-7 gap-y-3">
      <dl className="m-0 flex flex-wrap gap-x-7 gap-y-3">
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
            <time dateTime={place.dates.dateTime} className="place-figure-text">
              {place.dates.text}
            </time>
          </Fact>
        )}
      </dl>
      {/* the counts of entries are one block at the right end of the row, their figures against the right edge; when it does not fit beside the coordinates it goes to the next row whole, and only then wraps within itself */}
      {place.entries.length > 0 && (
        <dl className="m-0 ml-auto flex flex-wrap justify-end gap-x-7 gap-y-3">
          {place.entries.map((g) => (
            <Fact key={g.kind} label={g.label} end>
              <span className="place-figure place-figure-count">{g.entries.length}</span>
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
      {(where || place.lived) && (
        <p className="ds-micro m-0 flex flex-wrap gap-x-2">
          {where && <span>{where}</span>}
          {place.lived === true && <span className="ds-micro" data-tone="signal">{where ? "· " : ""}{place.living ? "Lives here" : "Lived here"}</span>}
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
        <img src={src} alt="" decoding="async" className="place-cover-img" />
        <div className="absolute inset-0 bg-linear-to-t from-background/60 via-background/20 via-60% to-transparent" />
      </div>
      {body}
    </header>
  );
}

/**
 * The step's own pictures and the entries that lead the page. The pictures are the place's images and the photographs linked to it (a photograph of
 * the step IS a picture of the step: it shows in its strip and is not an "entry" that would put the story second); a sensitive photograph stays an entry,
 * where its card blurs it.
 */
function stepContent(place: PlaceDetailData): { photos: PhotoItem[]; groups: PlaceDetailData["entries"] } {
  const own: PhotoItem[] = place.images.map((i) => ({ src: i.src, alt: i.alt, ...(i.width && i.height ? { width: i.width, height: i.height } : {}), ...(i.caption ? { caption: i.caption } : {}) }));
  const linked: PhotoItem[] = [];
  const groups = place.entries
    .map((group) => {
      if (group.kind !== "photograph") return group;
      const keep = group.entries.filter((e) => {
        if (e.sensitive || !e.cover) return true;
        linked.push({ src: e.cover.src, alt: e.cover.alt, ...(e.cover.width && e.cover.height ? { width: e.cover.width, height: e.cover.height } : {}), caption: e.title, href: e.href });
        return false;
      });
      return { ...group, entries: keep };
    })
    .filter((g) => g.entries.length > 0);
  return { photos: [...own, ...linked], groups };
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
  const { photos: all, groups } = stepContent(place);
  // (a place's own picture that heads the panel is not shown a second time in the strip below; an entry's cover is, as the link to the entry)
  const photos = cover?.own ? all.filter((p) => p.src !== cover.src) : all;
  const count = groups.reduce((n, g) => n + g.entries.length, 0);
  const story = !!place.summary || place.body.length > 0 || photos.length > 0 || place.trips.length > 0;
  return (
    <article aria-labelledby={PANEL_HEADING_ID} data-slot="place-view" data-kind="place" className="px-6 pt-2 pb-10">
      <Stack gap={8}>
        <PlaceHeader place={place} cover={cover} />
        {story && !count && <StepStory place={place} photos={photos} />}
        {count > 0 && (
          <section aria-label="Entries" data-slot="place-entries">
            <Stack gap={8}>
              {groups.map((group) => (
                <div key={group.kind} data-kind={group.kind} className="@container flex flex-col gap-4">
                  <SectionHeader as="h2" title={group.label} meta={group.entries.length} />
                  <ul className="m-0 grid list-none grid-cols-1 gap-8 p-0">
                    {group.entries.map((entry) => (
                      <li key={entry.slug} className="min-w-0">
                        <EntryListCard entry={entry} linkState={{ from: place.slug }} headingLevel={3} orientation="horizontal" />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </Stack>
          </section>
        )}
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
