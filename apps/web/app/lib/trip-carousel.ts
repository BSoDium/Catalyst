/**
 * The geometry of the trip cards' carousel (components/trip-rail.tsx), on the math of the photographs' one (`lib/photo-carousel.ts`): the same widths between small and large, the same layout from
 * the scroll position, the same growth (`--g`) that drives the type. What differs is the sizes: a trip card is a poster with its figures, not a picture, so it is laid out at a width that holds
 * them (never under 300 px), and the neighbours are the next card and a hint of the one after.
 *
 * A narrow row (a phone, under `SINGLE_BELOW`) shows the large card with the edge of the next; a wider one the large card (over half the row), a good part of the next and a hint of the one after; the row stops where the last card is the large one, which a photograph row does not (its last two are expanded): a
 * phantom card after the last one takes the place of the medium one.
 */
import { CAROUSEL_GUTTER, SINGLE_BELOW, carouselLayout, stepOf, type CarouselItem, type Keylines } from "./photo-carousel";

/** The width of the next card's edge beside the large one (the medium size), and of the hint of the one after it (the small one), in a wide row. */
export const PEEK = { medium: 72, small: 36 } as const;
export const TRIP_GAP = 12;

export function tripKeylines(width: number): Keylines {
  const gutter = CAROUSEL_GUTTER;
  if (width < SINGLE_BELOW) {
    // (a phone: the photographs' shape, one card across the whole row, edge to edge; the next grows from nothing as the row moves)
    return { width, gutter: 0, gap: 0, small: 0.01, large: Math.max(48, width), medium: 0.01, single: true };
  }
  // (a wide row: the photographs' shape, the large card and a medium one nearly as wide, then the hint of one more; the row fills, and stops where the last two are the large and the medium one)
  const small = PEEK.small;
  const all = width - gutter - small - 2 * TRIP_GAP;
  const large = Math.min(640, Math.max(320, Math.round(all / 1.6)));
  return { width, gutter, gap: TRIP_GAP, small, large, medium: Math.max(PEEK.medium, Math.min(all - large, Math.round(large * 0.85))), single: false };
}

/** How far the row scrolls from one card to the next. */
export const tripStep = (k: Keylines) => stepOf(k);

/**
 * A phone's row (one card across the row) stops where the LAST card is the one in front. A wide row does too: it first goes to where the last two cards are the large and the medium one (the photographs' end),
 * then ONE step more, where the last card has grown to the large size and the one before it has given way to the medium size at its left (a row that ends on a half-seen card looked unfinished).
 */
const phone = (k: Keylines) => k.single;
export const lastTrip = (count: number, k: Keylines) => Math.max(0, count - (phone(k) || count >= 3 ? 1 : 2));

/** Where each of `count` cards is, left to right, for a row at position `t`. */
export function tripLayout(t: number, count: number, k: Keylines): CarouselItem[] {
  if (phone(k) || count < 3) return carouselLayout(t, count, k);
  const end = count - 2;
  if (t <= end) return carouselLayout(t, count, k);
  // (the last step: the two last cards trade their sizes, the last one growing into the large one's place at the right of the medium one)
  const s = Math.min(1, t - end);
  const boxes = carouselLayout(end, count, k);
  const prev = boxes[count - 2]!;
  const wPrev = k.large + (k.medium - k.large) * s;
  const wLast = k.medium + (k.large - k.medium) * s;
  boxes[count - 2] = { x: prev.x, w: wPrev };
  boxes[count - 1] = { x: prev.x + wPrev + k.gap, w: wLast };
  return boxes;
}
