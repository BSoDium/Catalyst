import { Link } from "react-router";
import type { PlaceSummary } from "@catalyst/schemas";
import { placePath } from "~/lib/projection";

export const PLACES_NAV_ID = "places-nav";

interface PlacesNavProps {
  places: PlaceSummary[];
  currentSlug: string | null;
  onFocusSlug(slug: string | null): void;
  /** Called when a link is activated, so focus can return to it when the panel closes. */
  onOpen(): void;
}

/**
 * The dependable, keyboard- and screen-reader path to every place (the globe is a pointer enhancement).
 * Always in the DOM, visually hidden like a skip link (`.places-nav` in app.css) and revealed as a compact floating
 * list while a link inside it has focus; it hides again when focus leaves. Hover or focus highlights the
 * place on the globe.
 */
export function PlacesNav({ places, currentSlug, onFocusSlug, onOpen }: PlacesNavProps) {
  if (places.length === 0) return null;
  return (
    <nav id={PLACES_NAV_ID} aria-label="Places" className="places-nav">
      <p aria-hidden="true" className="label px-4 pt-3 pb-1">
        Places
      </p>
      <ul className="pb-2">
        {places.map((place) => (
          <li key={place.slug}>
            <Link
              to={placePath(place.slug)}
              prefetch="intent"
              data-place-link={place.slug}
              aria-current={place.slug === currentSlug ? "page" : undefined}
              onClick={onOpen}
              onMouseEnter={() => onFocusSlug(place.slug)}
              onMouseLeave={() => onFocusSlug(null)}
              onFocus={() => onFocusSlug(place.slug)}
              onBlur={() => onFocusSlug(null)}
              className="flex min-h-11 items-baseline -outline-offset-2 justify-between gap-3 px-4 py-2.5 text-sm transition-colors duration-(--duration-fast) hover:bg-accent focus-visible:bg-accent aria-[current=page]:bg-accent aria-[current=page]:font-medium"
            >
              <span>{place.name}</span>
              {place.region && <span className="label truncate">{place.region}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
