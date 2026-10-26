import { useMemo, useRef, useState, type CSSProperties } from "react";
import { CreditsDialog } from "~/components/credits-dialog";
import { Icon } from "~/components/ui/icon";
import { attributionFor, attributionLine, type AttributionTiles } from "~/globe/street/core/attribution";
import { MAP_CARD } from "~/lib/map-card";
import { cn } from "~/lib/utils";

interface AttributionButtonProps {
  /** The street map's tile configuration (decides which sources are credited), or null for the globe alone. */
  tiles: AttributionTiles | null;
  /** CSS px of the right edge covered by the detail panel: the card stays left of it. */
  insetRight: number;
  reducedMotion: boolean;
}

/**
 * The map's credits: ONE card (`MAP_CARD`, the dev badge's) of mono text with the main contributors ("© OpenStreetMap · OpenFreeMap · Natural Earth", from the
 * same list as the dialog, so it follows the tile configuration), then a middle dot (the same separator as between the credits) and a "See more" button with an
 * up-right arrow (`Icon`, inline size: the way out of the line, to the dialog) that opens the credits dialog (`CreditsDialog`).
 *
 *  - The line is real, selectable text in the dim `--subtle-foreground` (less contrast, never less opacity). The button is a real
 *    `<button aria-haspopup="dialog">` named "See more credits"; hover and keyboard focus raise it to the foreground, and the global focus ring shows on keyboard focus.
 *  - From `md` (768 px) up the card is bottom right of the map, left of the detail panel's inset, and ONE line high: the overflow is clipped, its items are
 *    unbreakable, so on a narrow window the LAST items fall to the clipped second line first (the street data first, the courtesy credit last) and the card never
 *    grows past the room between the viewport edge (or the panel) and its margin.
 *  - Below `md` it is a line of the full width of the screen, left-aligned (0.5 rem from each edge), always there: the OSM Foundation's guidelines do not allow the
 *    credit to be hidden behind an icon by default, and an icon that appears for 5 s and then collapses was a thing to wait for (owner, 2026-10-26). The credit says
 *    "© OpenStreetMap contributors" in full (the licence's wording); the line wraps between credits when the screen is too narrow for it, never clipped, and
 *    "See more" keeps a 44 px touch target (an invisible `::after`).
 * Place it in a positioned container that fills the map.
 */
export function AttributionButton({ tiles, insetRight, reducedMotion }: AttributionButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const tilesKey = tiles ? `${tiles.primaryUrl}|${tiles.fallbackPmtilesUrl ?? ""}` : "";
  // `tiles` is compared by value, through `tilesKey`
  const credits = useMemo(() => attributionFor(tiles), [tilesKey]);
  const line = useMemo(() => attributionLine(credits), [credits]);

  return (
    <>
      <div
        data-attribution="card"
        style={{ "--credits-inset": `${insetRight}px`, bottom: "max(0.5rem, env(safe-area-inset-bottom))" } as CSSProperties}
        className={cn(
          MAP_CARD,
          "absolute right-[calc(var(--credits-inset)+0.5rem)] z-20 flex max-w-[calc(100%-var(--credits-inset)-1rem)] items-center gap-[1ch] text-subtle-foreground",
          // a phone: the full width, the credits flowing as text (wrapping between credits) with the button at the end of the last line
          "max-md:right-2 max-md:left-2 max-md:block max-md:max-w-none",
        )}
      >
        <p className="h-4 min-w-0 overflow-hidden select-text max-md:inline max-md:h-auto max-md:overflow-visible">
          {line.map((name, i) => (
            <span key={name}>
              {i > 0 && " "}
              <span className="whitespace-nowrap">
                {i > 0 ? `· ${name}` : name}
                {/* the licence's wording, in full, where the card has the room of a line of its own */}
                {name === "© OpenStreetMap" && <span className="md:hidden"> contributors</span>}
              </span>
            </span>
          ))}
        </p>
        {" "}
        {/* the same middle dot as between the credits, outside the clipped text so that it stays beside the button on a narrow window (and on a phone, on the line of the button: they wrap together) */}
        <span className="shrink-0 whitespace-nowrap">
          <span aria-hidden="true" className="select-none">
            ·
          </span>{" "}
          <button
            ref={buttonRef}
            type="button"
            aria-haspopup="dialog"
            aria-label="See more credits"
            className="relative inline-flex cursor-pointer touch-manipulation items-center gap-0.5 whitespace-nowrap select-none after:absolute after:-inset-x-2 after:-inset-y-3 after:content-[''] hover:text-foreground focus-visible:text-foreground md:after:hidden"
            onClick={() => setOpen(true)}
          >
            See more
            <Icon name="arrow-up-right" size="inline" />
          </button>
        </span>
      </div>
      <CreditsDialog open={open} credits={credits} reducedMotion={reducedMotion} onClose={() => setOpen(false)} onClosed={() => buttonRef.current?.focus()} />
    </>
  );
}
