import { useMatches } from "react-router";
import { PLACES_NAV_ID } from "~/components/places-nav";

const skipClass =
  "sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-4 focus:py-3 focus:text-primary-foreground";

/** First tab stops of every page. "Skip to places" exists only where the places list does (the globe shell). */
export function SkipLinks() {
  const hasPlaces = useMatches().some((m) => m.id === "routes/shell");
  return (
    <>
      <a href="#main" className={skipClass}>
        Skip to content
      </a>
      {hasPlaces && (
        <a
          href={`#${PLACES_NAV_ID}`}
          className={skipClass}
          onClick={(e) => {
            // The list is not focusable itself: put focus on its first link (which also reveals it).
            e.preventDefault();
            document.querySelector<HTMLElement>(`#${PLACES_NAV_ID} a`)?.focus();
          }}
        >
          Skip to places
        </a>
      )}
    </>
  );
}
