import { ArrowUpLeft } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { CreditsDialog } from "~/components/credits-dialog";
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
 * The map's credits: ONE line of mono text with the main contributors ("© OpenStreetMap · OpenFreeMap · Natural Earth", from the
 * same list as the dialog, so it follows the tile configuration), then a "See more" button with an up-left arrow that opens the
 * credits dialog (`CreditsDialog`). Both sit in the dev badge's card (`MAP_CARD`), bottom right of the map, left of the detail
 * panel's inset.
 *
 *  - The line is real, selectable text in the dim `--subtle-foreground` (less contrast, never less opacity). It never wraps and
 *    never overflows: it is one line high with the overflow clipped, and its items are unbreakable, so on a narrow screen the
 *    LAST items fall to the clipped second line first (priority order = the order of the list: the street data first, the
 *    courtesy credit last) and the card never grows past the room between the viewport edge (or the panel) and its margin.
 *  - The button is a real `<button aria-haspopup="dialog">` named "See more credits"; below `md` an invisible extension of its
 *    box makes the touch target 44 CSS px high without growing the card. Hover and keyboard focus raise it to the foreground; the
 *    global focus ring shows on keyboard focus.
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
        data-attribution=""
        style={{
          right: `calc(${insetRight}px + 0.5rem)`,
          bottom: "max(0.5rem, env(safe-area-inset-bottom))",
          maxWidth: `calc(100% - ${insetRight}px - 1rem)`,
        }}
        className={cn(MAP_CARD, "absolute z-20 flex items-center gap-2 text-subtle-foreground")}
      >
        <p className="h-4 min-w-0 overflow-hidden select-text">
          {line.map((name, i) => (
            <span key={name}>
              {i > 0 && " "}
              <span className="whitespace-nowrap">{i > 0 ? `· ${name}` : name}</span>
            </span>
          ))}
        </p>
        <button
          ref={buttonRef}
          type="button"
          aria-haspopup="dialog"
          aria-label="See more credits"
          className="relative inline-flex shrink-0 cursor-pointer touch-manipulation items-center gap-0.5 whitespace-nowrap select-none hover:text-foreground focus-visible:text-foreground max-md:after:absolute max-md:after:-inset-x-1.5 max-md:after:-inset-y-3.5 max-md:after:content-['']"
          onClick={() => setOpen(true)}
        >
          See more
          <ArrowUpLeft aria-hidden="true" className="size-3 shrink-0" strokeWidth={1.75} />
        </button>
      </div>
      <CreditsDialog open={open} credits={credits} reducedMotion={reducedMotion} onClose={() => setOpen(false)} onClosed={() => buttonRef.current?.focus()} />
    </>
  );
}
