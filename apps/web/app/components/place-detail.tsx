import { Link } from "react-router";
import type { PlaceSummary } from "@catalyst/schemas";
import { PANEL_HEADING_ID } from "~/components/detail-panel";
import { EntryListCard } from "~/components/entry/entry-list-card";
import { Button, Frame, Glyph, KindTag, MicroLabel, SectionHeader, Stack, StatePanel } from "~/components/ui";
import { safeMediaSrc } from "~/lib/entry-blocks";
import { formatCoordinates } from "~/lib/labelling";
import { imageSize, placePath, type PlaceDetailData } from "~/lib/projection";

function Figure({ image }: { image: PlaceDetailData["images"][number] }) {
  const src = safeMediaSrc(image.src);
  if (!src) return null;
  const size = imageSize(image);
  return (
    <figure className="m-0 flex flex-col gap-2">
      <Frame padding="none">
        {size ? (
          <img src={src} alt={image.alt} width={size.width} height={size.height} loading="lazy" decoding="async" className="block h-auto w-full" />
        ) : (
          // Dimensions were not authored: reserve a neutral box so nothing shifts.
          <div className="aspect-[4/3] w-full overflow-hidden bg-accent">
            <img src={src} alt={image.alt} loading="lazy" decoding="async" className="size-full object-cover" />
          </div>
        )}
      </Frame>
      {image.caption && <figcaption className="ds-micro">{image.caption}</figcaption>}
    </figure>
  );
}

/**
 * Place detail in the panel (docs/design-system.md): kind glyph, coordinates and dates as micro-labels, the name as the view's
 * h1, the text, images, and the entries linked to the place as entry cards grouped by kind. Opening a card keeps the panel open
 * (the entry replaces the place in it) and carries `{ from: <place> }` in the router state, which gives the entry a way back.
 * Optional sections are omitted when empty.
 */
export function PlaceDetail({ place }: { place: PlaceDetailData }) {
  const count = place.entries.reduce((n, g) => n + g.entries.length, 0);
  return (
    <article aria-labelledby={PANEL_HEADING_ID} data-slot="place-view" data-kind="place" className="px-6 pt-2 pb-10">
      <Stack gap={6}>
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <KindTag kind="place" iconOnly />
            <MicroLabel tone="strong">Place</MicroLabel>
            <MicroLabel>{formatCoordinates(place.coordinates.lat, place.coordinates.lon)}</MicroLabel>
            {place.dates && (
              <MicroLabel as="time" dateTime={place.dates.dateTime}>
                {place.dates.text}
              </MicroLabel>
            )}
          </div>
          <h1 id={PANEL_HEADING_ID} tabIndex={-1} className="m-0 text-2xl font-semibold tracking-tight break-words outline-offset-4">
            {place.name}
          </h1>
          {place.region && <MicroLabel>{place.region}</MicroLabel>}
          {place.summary && <p className="m-0 text-lg text-muted-foreground">{place.summary}</p>}
        </header>
        {place.body.length > 0 && (
          <Stack gap={4}>
            {place.body.map((paragraph, i) => (
              <p key={i} className="m-0">
                {paragraph}
              </p>
            ))}
          </Stack>
        )}
        {place.images.length > 0 && (
          <Stack gap={6}>
            {place.images.map((image) => (
              <Figure key={image.src} image={image} />
            ))}
          </Stack>
        )}
        {count > 0 && (
          <section aria-labelledby="place-entries" data-slot="place-entries">
            <SectionHeader index={1} title="Entries" id="place-entries" as="h2" meta={String(count).padStart(2, "0")} />
            <Stack gap={6} className="mt-4">
              {place.entries.map((group) => (
                <div key={group.kind} data-kind={group.kind} className="@container flex flex-col gap-3">
                  <h3 className="m-0 flex items-center gap-3 font-normal">
                    <KindTag kind={group.kind} iconOnly />
                    <MicroLabel tone="strong">{group.label}</MicroLabel>
                    <MicroLabel>{String(group.entries.length).padStart(2, "0")}</MicroLabel>
                  </h3>
                  <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 @md:grid-cols-2">
                    {group.entries.map((entry) => (
                      <li key={entry.slug} className="min-w-0">
                        <EntryListCard entry={entry} linkState={{ from: place.slug }} headingLevel={4} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </Stack>
          </section>
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
          code="404 / PLACE"
          title="Place not found"
          description="There is no place at this address. It may have been renamed or removed."
          action={
            <Button asChild variant="secondary">
              <Link to="/">
                <Glyph name="arrow-left" size={16} />
                See all places
              </Link>
            </Button>
          }
        />
        {places.length > 0 && (
          <nav aria-label="All places">
            <ul className="m-0 list-none p-0">
              {places.map((place) => (
                <li key={place.slug} className="border-b border-border last:border-b-0">
                  <Link to={placePath(place.slug)} className="flex min-h-11 items-center gap-3 py-2 text-sm no-underline hover:bg-accent">
                    <KindTag kind="place" iconOnly />
                    <span className="min-w-0 flex-1 truncate">{place.name}</span>
                    <Glyph name="arrow-right" size={12} />
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
