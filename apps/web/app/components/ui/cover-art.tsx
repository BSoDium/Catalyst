import { useMemo } from "react";
import { coverArt, coverPaths, type CoverArtOptions } from "~/lib/cover-art";
import type { EntryKind } from "~/lib/entry-kind";
import { cn } from "~/lib/utils";

interface CoverArtProps extends CoverArtOptions {
  /** Any stable string of the entry (its slug or id): the same seed always draws the same cover. */
  seed: string;
  /** Tints the lightest tone with the kind's faint hue. */
  kind?: EntryKind;
  className?: string;
}

/**
 * Generative cover for an entry without an image (docs/design-system.md, "Generative cover art"): a dithered grid of cells in the
 * ink's tonal levels plus one or two signal marks, as inline SVG. Deterministic (`lib/cover-art.ts`), so server and browser
 * agree. Decorative: `aria-hidden`, no text. The box takes the grid's aspect ratio; size it with `className` (`w-full`, `w-24`).
 */
export function CoverArt({ seed, kind, className, cols, rows, pattern }: CoverArtProps) {
  const art = useMemo(() => coverArt(seed, { cols, rows, pattern }), [seed, cols, rows, pattern]);
  const paths = useMemo(() => coverPaths(art), [art]);
  return (
    <div data-slot="cover-art" data-kind={kind} data-pattern={art.pattern} className={cn("w-full overflow-hidden", className)} style={{ aspectRatio: `${art.cols} / ${art.rows}` }}>
      <svg className="ds-cover" viewBox={`0 0 ${art.cols} ${art.rows}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
        {paths.levels.map((d, level) => (d ? <path key={level} data-l={level} d={d} /> : null))}
        <path data-l="m" d={paths.marks} />
      </svg>
    </div>
  );
}
