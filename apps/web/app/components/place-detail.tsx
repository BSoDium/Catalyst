import { Link } from "react-router";
import type { PlaceSummary } from "@catalyst/schemas";
import { PANEL_HEADING_ID } from "~/components/detail-panel";
import { EntryListCard } from "~/components/entry/entry-list-card";
import { TripCards } from "~/components/trip-card";
import { Button, Icon, SectionHeader, Stack, StatePanel } from "~/components/ui";
import { safeMediaSrc } from "~/lib/entry-blocks";
import { formatPlaceCoordinates } from "~/lib/labelling";
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
      {place.trips.length > 0 && <TripCards trips={place.trips} here={place.slug} />}
    </Stack>
  );
}

/** The one quiet line under a place's name: where it is (region and country, when known), its coordinates at the precision they are stored with, its dates. */
function PlaceLine({ place }: { place: PlaceDetailData }) {
  const where = [place.region, place.country].filter((part, i, all): part is string => !!part && all.indexOf(part) === i).join(", ");
  return (
    <p data-slot="place-line" className="m-0 flex flex-wrap items-baseline gap-x-2 text-sm text-muted-foreground">
      {where && <span>{where}</span>}
      {where && <span aria-hidden="true">&middot;</span>}
      <span className="ds-meta">{formatPlaceCoordinates(place.coordinates.lat, place.coordinates.lon)}</span>
      {place.dates && (
        <>
          <span aria-hidden="true">&middot;</span>
          <time dateTime={place.dates.dateTime} className="ds-meta">
            {place.dates.text}
          </time>
        </>
      )}
    </p>
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
  const { photos, groups } = stepContent(place);
  const count = groups.reduce((n, g) => n + g.entries.length, 0);
  const story = !!place.summary || place.body.length > 0 || photos.length > 0 || place.trips.length > 0;
  return (
    <article aria-labelledby={PANEL_HEADING_ID} data-slot="place-view" data-kind="place" className="px-6 pt-2 pb-10">
      <Stack gap={8}>
        <header className="flex flex-col gap-2">
          <h1 id={PANEL_HEADING_ID} tabIndex={-1} className="m-0 text-3xl font-semibold tracking-tight break-words outline-offset-4">
            {place.name}
          </h1>
          <PlaceLine place={place} />
        </header>
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
