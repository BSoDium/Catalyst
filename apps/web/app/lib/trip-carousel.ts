/**
 * The geometry of the trip cards' carousel (components/trip-rail.tsx), on the math of the photographs' one (`lib/photo-carousel.ts`): the same widths between small and large, the same layout from
 * the scroll position, the same growth (`--g`) that drives the type. What differs is the sizes: a trip card is a poster with its figures, not a picture, so it is laid out at a width that holds
 * them (the large one is nearly the whole row) and the neighbours are slivers of the next and the one before, not cards of their own.
 *
 * A narrow row (a phone, under `SINGLE_BELOW`) is the photographs' own: one card at a time across the whole row, the next growing from nothing as the row moves. A wider one shows the large
 * card with the next one's edge (`PEEK`) and a hint of the one after it; the row stops where the last card is the large one, which a photograph row does not (its last two are expanded): a
 * phantom card after the last one takes the place of the medium one.
 */
import { CAROUSEL_GUTTER, SINGLE_BELOW, carouselLayout, keylines, stepOf, type CarouselItem, type Keylines } from "./photo-carousel";

/** The width of the next card's edge beside the large one (the medium size), and of the hint of the one after it (the small one), in a wide row. */
export const PEEK = { medium: 72, small: 36 } as const;
export const TRIP_GAP = 12;

export function tripKeylines(width: number): Keylines {
  if (width < SINGLE_BELOW) return keylines(width);
  const gutter = CAROUSEL_GUTTER;
  const large = Math.max(240, width - gutter - PEEK.small - PEEK.medium - 2 * TRIP_GAP);
  return { width, gutter, gap: TRIP_GAP, small: PEEK.small, large, medium: PEEK.medium, single: false };
}

/** How far the row scrolls from one card to the next. */
export const tripStep = (k: Keylines) => stepOf(k);

/** The last position of a row of `count` cards: the last card is the large one. */
export const lastTrip = (count: number) => Math.max(0, count - 1);

/** Where each of `count` cards is, left to right, for a row at position `t`. */
export function tripLayout(t: number, count: number, k: Keylines): CarouselItem[] {
  // (a wide row has a phantom card after the last: the photographs' row stops where the last two are the expanded ones, and this one must stop where the last is the large one)
  return carouselLayout(t, k.single ? count : count + 1, k).slice(0, count);
}
