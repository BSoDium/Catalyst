import { cn } from "~/lib/utils";

/** The owner's other photographs (issue #336). */
export const PEXELS_URL = "https://www.pexels.com/@bsodium";

/** One of the lines the owner picks from (the PR lists them); the first is the one shown. */
export const GALLERY_END_LINES = [
  "That's the whole shelf. Disk space costs money, so the rest of the photos live somewhere with more of it.",
  "The server is full, or rather my wallet is. The remaining photos had to stay outside.",
  "Cloud storage is not free and neither am I. The overflow is on Pexels.",
] as const;

/** A hard disk, 16 x 11 cells: `#` body, `o` the activity light, `.` empty. Drawn as one rect per run of cells, so the SVG stays a few hundred bytes. */
const DISK = [
  "................",
  "..############..",
  ".#............#.",
  ".#.##########.#.",
  ".#............#.",
  ".#.##########.#.",
  ".#............#.",
  ".#............#.",
  ".#.......###.o#.",
  "..############..",
  "................",
];

function runs(rows: readonly string[], ch: string): string {
  let d = "";
  rows.forEach((row, y) => {
    for (const m of row.matchAll(new RegExp(`${ch}+`, "g"))) d += `M${m.index} ${y}h${m[0].length}v1h-${m[0].length}z`;
  });
  return d;
}

/**
 * The end of the photography wall: a pixel-art hard disk (decorative), a line about storage and a link to the rest of the owner's
 * photographs. The light blinks unless the visitor asks for reduced motion.
 */
export function GalleryEnd({ className }: { className?: string }) {
  return (
    <aside data-slot="gallery-end" aria-label="End of the gallery" className={cn("mx-auto flex max-w-xl flex-col items-center gap-4 border-t border-border pt-10 text-center", className)}>
      <svg viewBox="0 0 16 11" width="128" height="88" shapeRendering="crispEdges" aria-hidden="true" focusable="false" className="text-foreground">
        <path d={runs(DISK, "#")} fill="currentColor" />
        <path d={runs(DISK, "o")} fill="var(--primary)" className="motion-safe:animate-pulse" />
      </svg>
      <p className="m-0 max-w-[34em] font-reading text-lg text-pretty text-muted-foreground">{GALLERY_END_LINES[0]}</p>
      <a href={PEXELS_URL} target="_blank" rel="noopener noreferrer" className="type-meta text-primary underline underline-offset-4">
        More photographs on Pexels<span className="sr-only"> (opens in a new tab)</span>
      </a>
    </aside>
  );
}
