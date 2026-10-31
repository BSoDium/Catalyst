import { Button, Icon } from "~/components/ui";
import { cn } from "~/lib/utils";

/** The owner's other photographs (issue #336). */
export const PEXELS_URL = "https://www.pexels.com/@bsodium";

export const GALLERY_END_TITLE = "That's the whole shelf.";

/** One of the lines the owner picks from (the PR lists them); the first is the one shown. */
export const GALLERY_END_LINES = [
  "Disk space costs money, so the rest of the photos live somewhere with more of it.",
  "The server is full, or rather my wallet is. The remaining photos had to stay outside.",
  "Cloud storage is not free and neither am I. The overflow is on Pexels.",
] as const;

/**
 * The foot of the photography wall (issue #336): a banner laid over the last rows of the wall, which are generic photographs faded into the
 * page (`.wall-end` and `.gallery-end` in app.css; the wall draws the filler, see `lib/gallery-filler.ts`). A few words and a link to the rest
 * of the owner's photographs. Temporary: it goes when the gallery's storage moves to the owner's own bucket.
 */
export function GalleryEnd({ className }: { className?: string }) {
  return (
    <aside data-slot="gallery-end" aria-label="End of the gallery" className={cn("gallery-end", className)}>
      <div className="gallery-end-copy">
        <p className="gallery-end-eyebrow type-meta">End of the gallery</p>
        <p className="gallery-end-title">{GALLERY_END_TITLE}</p>
        <p className="gallery-end-text">{GALLERY_END_LINES[0]}</p>
      </div>
      <Button asChild variant="secondary">
        <a href={PEXELS_URL} target="_blank" rel="noopener noreferrer">
          More photographs on Pexels
          <Icon name="arrow-up-right" size="inline" aria-hidden="true" />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </Button>
    </aside>
  );
}
