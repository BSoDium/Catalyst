import type { PublishedCover } from "@catalyst/schemas";
import { safeMediaSrc } from "./entry-blocks";

export interface CoverImageProps {
  src: string;
  srcSet?: string;
  sizes?: string;
}

/**
 * The `src`, `srcSet` and `sizes` of a cover's `<img>`. With a `small` copy the browser chooses between it and the full file by the
 * width the picture is drawn at (`sizes` says what that is); without one (the demo content has none) it is just the `src`.
 */
export function coverImageProps(cover: Pick<PublishedCover, "src" | "width" | "small">, sizes: string): CoverImageProps {
  const { small } = cover;
  if (!small || !cover.width || !safeMediaSrc(small.src)) return { src: cover.src };
  return { src: cover.src, srcSet: `${small.src} ${small.width}w, ${cover.src} ${cover.width}w`, sizes };
}

/** `sizes` of a cover in a list row (a quarter of the page from `md`, the whole width below). */
export const ROW_COVER_SIZES = "(min-width: 48rem) 25vw, 100vw";
/** `sizes` of a card in a grid (one to three columns). */
export const CARD_COVER_SIZES = "(min-width: 64rem) 33vw, (min-width: 40rem) 50vw, 100vw";
/** `sizes` of a picture on the wall: 1 to 4 equal columns by the wall's width (`.wall` in app.css), approximated by the viewport's. */
export const WALL_COVER_SIZES = "(min-width: 88rem) 25vw, (min-width: 62rem) 33vw, (min-width: 34rem) 50vw, 100vw";
