import { useMemo, useRef, useState, type CSSProperties } from "react";
import { CreditsDialog } from "~/components/credits-dialog";
import { Icon } from "~/components/ui/icon";
import { attributionFor, attributionLine, type AttributionTiles } from "~/globe/street/core/attribution";
import { cn } from "~/lib/utils";

interface AttributionButtonProps {
  /** The street map's tile configuration (decides which sources are credited), or null for the globe alone. */
  tiles: AttributionTiles | null;
  /** CSS px of the right edge covered by the detail panel: the card stays left of it. */
  insetRight: number;
  reducedMotion: boolean;
}

/**
 * The map's credits: ONE line of mono text with the main contributors ("© OpenStreetMap · OpenFreeMap · Natural Earth", from the same list as the dialog, so it follows
 * the tile configuration), then a middle dot (the same separator as between the credits) and a "See more" button with an up-right arrow (`Icon`, inline size) that opens
 * the credits dialog (`CreditsDialog`).
 *
 *  - No outline (owner, 2026-10-26): the ground is a map label's own (`.map-credits`, app.css): the translucent page-colour plate with a soft feather. On the home
 *    screen's display mode (the hero at rest) there is none at all: the map is under the hero's own gradient there.
 *  - The line is real, selectable text in the dim `--subtle-foreground` (less contrast, never less opacity). The button is a real
 *    `<button aria-haspopup="dialog">` named "See more credits"; hover and keyboard focus raise it to the foreground, and the global focus ring shows on keyboard focus.
 *  - ONE line high at every width, the overflow clipped and the items unbreakable, so when the room is short the LAST items fall out of view first (the street data
 *    first, the courtesy credit last) and the dot and the button stay. From `md` (768 px) up it is bottom right of the map, left of the detail panel's inset; below it
 *    the full width of the screen, left-aligned, 0.5 rem from each edge, always there (the OSM Foundation's guidelines do not allow the credit to be hidden behind an
 *    icon by default). "contributors" (the licence's wording) is added to the OSM credit on a screen from 480 px that is still below `md`; "See more" has a 44 px touch
 *    target on a phone (an invisible `::after`).
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
        style={{ "--credits-inset": `${insetRight}px`, bottom: "max(0.25rem, env(safe-area-inset-bottom))" } as CSSProperties}
        className={cn(
          "map-credits absolute right-[calc(var(--credits-inset)+0.5rem)] z-20 flex max-w-[calc(100%-var(--credits-inset)-1rem)] items-center gap-[1ch] rounded-sm px-1.5 py-px font-mono text-[10px] leading-4 tracking-wide text-subtle-foreground",
          // a phone: the full width, left-aligned, still one line
          "max-md:right-2 max-md:left-2 max-md:max-w-none",
        )}
      >
        <p className="h-4 min-w-0 overflow-hidden select-text">
          {line.map((name, i) => (
            <span key={name}>
              {i > 0 && " "}
              <span className="whitespace-nowrap">
                {i > 0 ? `· ${name}` : name}
                {/* the licence's wording, in full, where the line has the room for it (a phone wider than 480 px; not the wide layout's card) */}
                {name === "© OpenStreetMap" && <span className="max-[479px]:hidden md:hidden"> contributors</span>}
              </span>
            </span>
          ))}
        </p>
        {/* the same middle dot as between the credits, outside the clipped text so that it stays beside the button on a narrow screen */}
        <span aria-hidden="true" className="shrink-0 select-none">
          ·
        </span>
        <button
          ref={buttonRef}
          type="button"
          aria-haspopup="dialog"
          aria-label="See more credits"
          className="relative inline-flex shrink-0 cursor-pointer touch-manipulation items-center gap-0.5 whitespace-nowrap select-none after:absolute after:-inset-x-2 after:-inset-y-3 after:content-[''] hover:text-foreground focus-visible:text-foreground md:after:hidden"
          onClick={() => setOpen(true)}
        >
          See more
          <Icon name="arrow-up-right" size="inline" className="-translate-y-[2px]" />
        </button>
      </div>
      <CreditsDialog open={open} credits={credits} reducedMotion={reducedMotion} onClose={() => setOpen(false)} onClosed={() => buttonRef.current?.focus()} />
    </>
  );
}
