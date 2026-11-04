import { safeMediaSrc } from "./entry-blocks";
import type { PlaceDetailData } from "./projection";

/** The picture that heads a place's panel (decoration: blurred and dimmed, never credited or linked). `own`: one of the place's own images (it is not shown again in the strip below; an entry's cover is, with its link). */
export interface PlaceCover {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  own: boolean;
}

/** Kinds in the order they are tried: a photograph is a picture of the place; the others' covers are what they are. */
const COVER_KINDS = ["photograph", "project", "artwork", "article", "poem"] as const;

const size = (i: { width?: number | undefined; height?: number | undefined }) => (i.width && i.height ? { width: i.width, height: i.height } : {});

/**
 * The cover of a place: its own first image, else the cover of one of its entries, a photograph first, then a project, an artwork, an article, a poem.
 * A sensitive entry is never the cover (its pictures are blurred on its card, not here); a place with nothing to show has none.
 */
export function placeCover(place: Pick<PlaceDetailData, "images" | "entries">): PlaceCover | null {
  for (const image of place.images) {
    if (safeMediaSrc(image.src)) return { src: image.src, alt: image.alt, ...size(image), own: true };
  }
  for (const kind of COVER_KINDS) {
    const group = place.entries.find((g) => g.kind === kind);
    for (const entry of group?.entries ?? []) {
      if (entry.sensitive || !entry.cover || !safeMediaSrc(entry.cover.src)) continue;
      return { src: entry.cover.src, alt: entry.cover.alt, ...size(entry.cover), own: false };
    }
  }
  return null;
}
