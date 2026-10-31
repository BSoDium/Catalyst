import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router";
import { CoverArt, SensitiveMedia } from "~/components/ui";
import { coverRatio, layoutAllTiers, masonryItemVars, masonryListVars, RATIO_FALLBACK } from "~/lib/masonry";
import { yearOf } from "~/lib/entry-list";
import { safeMediaSrc } from "~/lib/entry-blocks";
import { coverImageProps, WALL_COVER_SIZES } from "~/lib/cover-image";
import type { EntrySummary } from "~/lib/entries";
import { planFiller, type FillerPhoto } from "~/lib/gallery-filler";

/** The first pictures of a wall load at once (the first screen at four columns); the rest are lazy. */
const EAGER = 4;

/** `Lisbon`, `Lisbon, Paris`, or only `Brazil` (the country, when that is all that is known): where a photograph is, as its caption's second line. */
const placeNames = (entry: EntrySummary) => entry.places.slice(0, 2).map((p) => p.name).join(", ") || entry.country?.name || undefined;

const fact = (entry: EntrySummary, label: string) => entry.meta.find((m) => m.label.trim().toLowerCase() === label)?.value.trim() || undefined;

/** The caption's second line: the medium and the year, as authored (the `Medium` and `Year` facts; the entry's date year when no `Year`). */
export function artworkCaption(entry: Pick<EntrySummary, "meta" | "date">): { medium?: string; year?: string } {
  const medium = fact(entry as EntrySummary, "medium");
  const year = fact(entry as EntrySummary, "year") ?? (yearOf(entry.date)?.toString() || undefined);
  return { ...(medium ? { medium } : {}), ...(year ? { year } : {}) };
}

/**
 * The artworks as a brick wall (docs/design-system.md, "Artwork wall"): pictures at their own proportions (the contract's cover size, so
 * the space is reserved before the image arrives), nested in 1 to 4 columns by the wall's width, 10 px apart. The DOM is ONE list in reading
 * order; the placement is computed on the server (`lib/masonry.ts`) and drawn with `calc()` (`.wall` in app.css), so there is no script, no
 * measuring and no shift, and the tab order is the reading order. The title, medium and year are a plate over the picture's foot on a
 * pointer that hovers (shown on hover and on focus) and a line under the picture on touch (always visible). One link per picture
 * (the title), stretched over it. An artwork without a cover is a generated one at 4:3. A sensitive artwork stays blurred.
 *
 * `/photography` is the same wall (`kind="photograph"`): the photograph IS the page, so there is no generated cover (a photograph without
 * an image is a plate with the caption only) and the caption's second line is the place (the link back to the globe is on the entry) and the year.
 */
export function ArtworkWall({
  items,
  headingLevel = 2,
  label,
  kind = "artwork",
  linkState,
  filler = [],
  end,
}: {
  /** Scenery that continues the wall after the last picture (decorative, no link, no name), and the banner laid over its foot (`end`). Both or neither. */
  filler?: readonly FillerPhoto[];
  end?: ReactNode;
  /** The router state of the links: where the entry is opened from (`listBackState`). */
  linkState?: unknown;
  items: readonly EntrySummary[];
  headingLevel?: 2 | 3 | 4;
  label: string;
  kind?: "artwork" | "photograph";
}) {
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4";
  const covers = items.map((entry) => (entry.cover && safeMediaSrc(entry.cover.src) ? entry.cover : null));
  const ratios = covers.map((cover) => (cover ? coverRatio(cover) : RATIO_FALLBACK));
  const plan = filler.length > 0 ? planFiller(ratios, filler) : null;
  const tileRatios = plan ? plan.tiles.map((f) => coverRatio(f)) : [];
  const layouts = layoutAllTiers(ratios, (columns) => tileRatios.slice(0, plan?.count(columns) ?? 0));
  return (
    <div data-slot="artwork-wall" data-kind={kind} data-filler={plan ? "" : undefined} className="wall">
      <ul role="list" aria-label={label} className="wall-list" style={masonryListVars(layouts, { flush: plan !== null }) as CSSProperties}>
        {items.map((entry, i) => {
          const cover = covers[i];
          const { medium: artMedium, year } = artworkCaption(entry);
          const medium = kind === "photograph" ? placeNames(entry) : artMedium;
          const eager = i < EAGER;
          const image = cover ? (
            <img
              {...coverImageProps(cover, WALL_COVER_SIZES)}
              alt={cover.alt}
              {...(cover.width && cover.height ? { width: cover.width, height: cover.height } : {})}
              loading={eager ? "eager" : "lazy"}
              decoding="async"
              className="wall-img"
            />
          ) : null;
          return (
            <li key={entry.slug} className="wall-item" style={masonryItemVars(ratios[i]!, layouts, i) as CSSProperties}>
              <article id={entry.slug} data-slot="entry-card" data-kind={kind} data-ratio={ratios[i]!.toFixed(3)} className="wall-card scroll-mt-24">
                <div className="wall-media">
                  {image && entry.sensitive === true ? (
                    <SensitiveMedia className="size-full">{image}</SensitiveMedia>
                  ) : (
                    (image ?? (kind === "artwork" ? <CoverArt seed={entry.slug} kind="artwork" cols={48} rows={36} className="h-full" /> : null))
                  )}
                </div>
                <div className="wall-caption">
                  <Heading data-slot="entry-card-title" className="wall-title">
                    <Link to={entry.href} state={linkState} className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none">
                      {entry.title}
                    </Link>
                  </Heading>
                  {(medium || year) && (
                    <p className="wall-meta">
                      {medium && <span className="wall-medium">{medium}</span>}
                      {medium && year && <span aria-hidden="true"> · </span>}
                      {year && <time dateTime={year}>{year}</time>}
                    </p>
                  )}
                </div>
              </article>
            </li>
          );
        })}
        {plan?.tiles.map((photo, j) => (
          <li key={j} aria-hidden="true" data-slot="wall-filler" data-tiers={plan.tiers[j]!.join(" ")} className="wall-item wall-filler" style={masonryItemVars(tileRatios[j]!, layouts, items.length + j) as CSSProperties}>
            <div className="wall-media">
              <img src={photo.src} alt="" width={photo.width} height={photo.height} loading="lazy" decoding="async" draggable={false} className="wall-img" />
            </div>
          </li>
        ))}
      </ul>
      {end && <div className="wall-end">{end}</div>}
    </div>
  );
}
