import { useMemo, type CSSProperties } from "react";
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
 * Generative cover for an entry without an image (docs/design-system.md, "Generative cover art"): a grid of cells in four tonal levels (the ink's, or a palette's or two, as the seed
 * chooses), a faint wash of the palette over it, plus one or two marks in a palette's fill, as inline SVG. Deterministic (`lib/cover-art.ts`), so server and browser
 * agree. Decorative: `aria-hidden`, no text. The box takes the grid's aspect ratio; size it with `className` (`w-full`, `w-24`).
 */
export function CoverArt({ seed, kind, className, cols, rows, pattern, palette }: CoverArtProps) {
  const art = useMemo(() => coverArt(seed, { cols, rows, pattern, palette }), [seed, cols, rows, pattern, palette]);
  const paths = useMemo(() => coverPaths(art), [art]);
  return (
    <div data-slot="cover-art" data-kind={kind} data-pattern={art.pattern} className={cn("w-full overflow-hidden", className)} style={{ aspectRatio: `${art.cols} / ${art.rows}` }}>
      <svg
        className="ds-cover"
        data-palette={art.palette}
        style={{ "--cover-a": `var(--palette-${art.palette})`, "--cover-b": `var(--palette-${art.second})`, "--cover-m": `var(--palette-${art.markPalette})` } as CSSProperties}
        viewBox={`0 0 ${art.cols} ${art.rows}`}
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        focusable="false"
      >
        {art.wash > 0 && <rect data-wash={art.wash} width={art.cols} height={art.rows} />}
        {paths.levels.map((d, level) => (d ? <path key={level} data-l={level} data-h={art.tones[level] === "ink" ? undefined : art.tones[level]} d={d} /> : null))}
        <path data-l="m" d={paths.marks} />
      </svg>
    </div>
  );
}
