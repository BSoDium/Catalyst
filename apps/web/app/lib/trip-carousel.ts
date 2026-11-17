/**
 * The geometry of the trip cards' carousel (components/trip-rail.tsx), on the math of the photographs' one (`lib/photo-carousel.ts`): the same widths between small and large, the same layout from
 * the scroll position, the same growth (`--g`) that drives the type. What differs is the sizes: a trip card is a poster with its figures, not a picture, so it is laid out at a width that holds
 * them (the large one is nearly the whole row) and the neighbours are slivers of the next and the one before, not cards of their own.
 *
 * A narrow row (a phone, under `SINGLE_BELOW`) shows the large card with the edge of the next; a wider one the large card (a little over half the row), a good part of the next and a hint of the one after; the row stops where the last card is the large one, which a photograph row does not (its last two are expanded): a
 * phantom card after the last one takes the place of the medium one.
 */
import { CAROUSEL_GUTTER, SINGLE_BELOW, carouselLayout, stepOf, type CarouselItem, type Keylines } from "./photo-carousel";

/** The width of the next card's edge beside the large one (the medium size), and of the hint of the one after it (the small one), in a wide row. */
export const PEEK = { medium: 72, small: 36 } as const;
export const TRIP_GAP = 12;

export function tripKeylines(width: number): Keylines {
  const gutter = CAROUSEL_GUTTER;
  if (width < SINGLE_BELOW) {
    // (a phone: the large card and the edge of the next, a hint of the one after)
    const small = 16;
    const medium = 40;
    return { width, gutter, gap: TRIP_GAP, small, large: Math.max(200, width - gutter - small - medium - 2 * TRIP_GAP), medium, single: false };
  }
  // (a wide row: the large card a little over half of it, so that the next one shows a good part of itself)
  const small = PEEK.small;
  const large = Math.min(460, Math.max(300, Math.round(width * 0.58)));
  return { width, gutter, gap: TRIP_GAP, small, large, medium: Math.max(PEEK.medium, width - gutter - large - small - 2 * TRIP_GAP), single: false };
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
