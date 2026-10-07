import { Link } from "react-router";
import type { PlaceSummary } from "@catalyst/schemas";
import { PANEL_HEADING_ID } from "~/components/detail-panel";
import { KIND_LABELS, imageSize, placePath, type PlaceDetailData } from "~/lib/projection";

function Figure({ image }: { image: PlaceDetailData["images"][number] }) {
  const size = imageSize(image);
  return (
    <figure>
      {size ? (
        <img
          src={image.src}
          alt={image.alt}
          width={size.width}
          height={size.height}
          loading="lazy"
          decoding="async"
          className="h-auto w-full rounded-md border border-border"
        />
      ) : (
        // Dimensions were not authored: reserve a neutral box so nothing shifts.
        <div className="aspect-[4/3] w-full overflow-hidden rounded-md border border-border">
          <img src={image.src} alt={image.alt} loading="lazy" decoding="async" className="size-full object-cover" />
        </div>
      )}
      {image.caption && <figcaption className="mt-2 text-sm text-muted-foreground">{image.caption}</figcaption>}
    </figure>
  );
}

/** Place detail. Optional sections are omitted when empty. */
export function PlaceDetail({ place }: { place: PlaceDetailData }) {
  return (
    <article className="px-6 pt-2 pb-10">
      <header>
        {place.region && <p className="label">{place.region}</p>}
        <h2
          id={PANEL_HEADING_ID}
          tabIndex={-1}
          className="mt-1 text-2xl font-semibold tracking-tight outline-offset-4"
        >
          {place.name}
        </h2>
        {place.dates && (
          <p className="label mt-3">
            <time dateTime={place.dates.dateTime}>{place.dates.text}</time>
          </p>
        )}
      </header>
      {place.summary && <p className="mt-5 text-lg text-muted-foreground">{place.summary}</p>}
      {place.body.length > 0 && (
        <div className="mt-6 space-y-4">
          {place.body.map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}
        </div>
      )}
      {place.images.length > 0 && (
        <div className="mt-8 space-y-6">
          {place.images.map((image) => (
            <Figure key={image.src} image={image} />
          ))}
        </div>
      )}
      {place.related.length > 0 && (
        <section aria-labelledby="related-heading" className="mt-10 border-t border-border pt-5">
          <h3 id="related-heading" className="label">
            Related
          </h3>
          <ul className="mt-2">
            {place.related.map((item) => (
              <li key={`${item.kind}:${item.slug}`}>
                <Link
                  to={item.href}
                  className="flex min-h-11 items-baseline justify-between gap-4 py-2 text-sm underline-offset-4 hover:underline"
                >
                  <span>{item.title}</span>
                  <span className="label">{KIND_LABELS[item.kind]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

/** Shown inside the panel when the slug does not exist (HTTP 404). */
export function PlaceNotFound({ places }: { places: PlaceSummary[] }) {
  return (
    <div className="px-6 pt-2 pb-10">
      <p className="label">404</p>
      <h2 id={PANEL_HEADING_ID} tabIndex={-1} className="mt-1 text-2xl font-semibold tracking-tight outline-offset-4">
        Place not found
      </h2>
      <p className="mt-4 text-muted-foreground">There is no place at this address. It may have been renamed or removed.</p>
      <p className="mt-4">
        <Link to="/" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4 hover:no-underline">
          See all places
        </Link>
      </p>
      {places.length > 0 && (
        <nav aria-label="All places" className="mt-6 border-t border-border pt-4">
          <ul>
            {places.map((place) => (
              <li key={place.slug}>
                <Link
                  to={placePath(place.slug)}
                  className="flex min-h-11 items-center py-2 text-sm underline-offset-4 hover:underline"
                >
                  {place.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
