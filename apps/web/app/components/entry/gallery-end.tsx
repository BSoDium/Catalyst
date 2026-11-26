import { ArtStationMark, Button, Icon, PexelsMark } from "~/components/ui";
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

/** The owner's portfolio, the rest of the artworks. */
export const ARTSTATION_URL = "https://www.artstation.com/bsodium";

export const ARTWORK_END_TITLE = "That's the whole wall.";

/** The lines to pick from for the artworks' foot (the PR lists them); the first is the one shown. */
export const ARTWORK_END_LINES = [
  "Only the finished pieces made it onto this wall. The rest of the portfolio, studies and sketches included, is on ArtStation.",
  "The wall is full, and so is my storage budget. The overflow lives on ArtStation.",
  "A wall only holds so much. The studies, the sketches and the unfinished ones are on ArtStation.",
] as const;

/** What each wall says at its foot: its title, the line shown, where the rest is and what the link says. */
const ENDS = {
  photograph: { title: GALLERY_END_TITLE, text: GALLERY_END_LINES[0], href: PEXELS_URL, link: "More photographs on Pexels" },
  artwork: { title: ARTWORK_END_TITLE, text: ARTWORK_END_LINES[0], href: ARTSTATION_URL, link: "More artworks on ArtStation" },
} as const;

/**
 * The closing words of the photography and the artworks walls (issue #336): a title, a line and the way to the rest of the owner's work
 * (Pexels, ArtStation). Temporary: it goes when the gallery's storage moves to the owner's own bucket.
 *
 * It is the LEAD of the site footer on those two pages (`SiteFooter lead`, the first column, in place of the owner's name and line):
 * owner, 2026-11-26, first "two endings one after the other" (a banner over the wall, then the footer), then, with the banner at the
 * head of the footer's band, "a double title" (the wall's title right above the name). Now the wall's scenery fades into the band
 * (`.wall-end`) and the ending has ONE title, beside the sections and the links for agents. No "End of the gallery" eyebrow (the
 * title says it); the `aside` keeps the words as its name.
 */
export function GalleryEnd({ className, kind = "photograph" }: { className?: string; kind?: "photograph" | "artwork" }) {
  const end = ENDS[kind];
  return (
    <aside data-slot="gallery-end" aria-label="End of the gallery" className={cn("gallery-end", className)}>
      <p className="gallery-end-title">{end.title}</p>
      <p className="gallery-end-text">{end.text}</p>
      <Button asChild variant="secondary" className={cn("gallery-end-link", "pl-3")} data-brand={kind === "photograph" ? "pexels" : "artstation"}>
        <a href={end.href} target="_blank" rel="noopener noreferrer">
          <span className="flex items-center gap-2.5">
            {kind === "photograph" ? <PexelsMark /> : <ArtStationMark />}
            {end.link}
          </span>
          <Icon name="arrow-up-right" size="inline" aria-hidden="true" />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </Button>
    </aside>
  );
}
