import { ArrowUpRight } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { CreditsDialog } from "~/components/credits-dialog";
import { attributionFor, type AttributionTiles } from "~/globe/street/core/attribution";

interface AttributionButtonProps {
  /** The street map's tile configuration (decides which sources are credited), or null for the globe alone. */
  tiles: AttributionTiles | null;
  /** CSS px of the right edge covered by the detail panel: the link stays left of it. */
  insetRight: number;
  reducedMotion: boolean;
}

/**
 * The map's attribution: a plain, quiet text link "Credits" followed by a small up-right arrow ("this opens something"), at the
 * bottom right of the map. It opens the credits dialog (`CreditsDialog`), so it is a real `<button>` (keyboard, name "Credits",
 * `aria-haspopup="dialog"`), at least 44 CSS px high on a touch screen. Its colour is the dim `--subtle-foreground` token (less
 * contrast, never less opacity) with a halo of the page colour so it reads over the map; hover and keyboard focus raise it to the
 * full foreground, and the global focus ring shows on keyboard focus. Place it in a positioned container that fills the map.
 */
export function AttributionButton({ tiles, insetRight, reducedMotion }: AttributionButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const tilesKey = tiles ? `${tiles.primaryUrl}|${tiles.fallbackPmtilesUrl ?? ""}` : "";
  // `tiles` is compared by value, through `tilesKey`
  const credits = useMemo(() => attributionFor(tiles), [tilesKey]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        data-attribution=""
        style={{
          right: `calc(${insetRight}px + 0.25rem)`,
          bottom: "max(0.25rem, env(safe-area-inset-bottom))",
        }}
        className="credits-link absolute z-20 inline-flex min-h-11 cursor-pointer touch-manipulation items-center gap-0.5 px-2 text-xs text-subtle-foreground select-none hover:text-foreground focus-visible:text-foreground md:min-h-8"
        onClick={() => setOpen(true)}
      >
        Credits
        <ArrowUpRight aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={1.75} />
      </button>
      <CreditsDialog open={open} credits={credits} reducedMotion={reducedMotion} onClose={() => setOpen(false)} onClosed={() => buttonRef.current?.focus()} />
    </>
  );
}
