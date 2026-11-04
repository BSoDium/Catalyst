/**
 * The geometry of the place panel's photography carousel (components/place-gallery.tsx), the multi-browse carousel of Material 3 Expressive without its rounded corners: the
 * height is fixed and only the WIDTH of a picture changes, and what it is depends on where the picture is in the row, not on which picture it is. Two pictures in the
 * middle of the row are fully expanded (`large`, then `medium`, nearly as wide), and the ones on each side of them are small, so a picture is somewhere between the two
 * while it moves from one place to the next. The row's position `t` is in pictures (0 = the first is the large one); the distance of picture `i` from the focus is `u = i - t`:
 *
 *   u <= -2  gone          -2..-1  coming from nothing to small (or, going left, shrinking away)
 *   -1       small         -1..0   small to large
 *   0        large         0..1    large to medium
 *   1        medium        1..2    medium to small
 *   2        small         2..3    small to nothing (not there yet)
 *
 * At the start the sizes fill the row exactly, from the page's gutter at the left to the right edge, where the small one is cut off by it; moving on adds a small picture at
 * the left, so the row is always full. It stops where the last two pictures are the expanded ones (`lastPosition`), and gets there sliding left by the gutter, so that the last one
 * ends a gutter from the right edge.
 */
export interface Keylines {
  /** The width of the row. */
  width: number;
  /** The room kept at the left of the first picture (and at the right of the last). */
  gutter: number;
  gap: number;
  small: number;
  large: number;
  medium: number;
}

export const CAROUSEL_GUTTER = 24;
export const CAROUSEL_GAP = 6;

/** The sizes for a row of this width: a small picture a sixth of what is left after the gutter (48 px at least), the other two share the rest, the large one a little wider. */
export function keylines(width: number): Keylines {
  const gutter = CAROUSEL_GUTTER;
  const gap = CAROUSEL_GAP;
  const small = Math.max(48, Math.round((width - gutter) / 6));
  const rest = width - gutter - small - 2 * gap;
  const large = Math.round(rest * 0.52);
  return { width, gutter, gap, small, large, medium: rest - large };
}

/** The widest a picture gets: what the picture inside it and its label are laid out at, so that they are cropped by the box and not squeezed. */
export const widest = (k: Keylines) => Math.max(k.large, k.medium);

/** The width of the picture at distance `u` from the focus. */
export function widthAt(u: number, k: Keylines): number {
  if (u <= -2 || u >= 3) return 0;
  const through = (from: number, to: number, x: number) => from + (to - from) * x;
  if (u < -1) return through(0, k.small, u + 2);
  if (u < 0) return through(k.small, k.large, u + 1);
  if (u < 1) return through(k.large, k.medium, u);
  if (u < 2) return through(k.medium, k.small, u - 1);
  return through(k.small, 0, u - 2);
}

export interface CarouselItem {
  x: number;
  w: number;
}

/** The last position of a row of `count` pictures: the one where the last two are the ones expanded (a row of one or two does not move). */
export const lastPosition = (count: number) => Math.max(0, count - 2);

/** Where each of `count` pictures is, left to right, for a row at position `t` (clamped to the first and the last position). */
export function carouselLayout(t: number, count: number, k: Keylines): CarouselItem[] {
  if (count === 0) return [];
  if (count <= 2) {
    // (nothing to scroll: the pictures share the row between the gutters, the larger first)
    const room = k.width - 2 * k.gutter - (count - 1) * k.gap;
    const first = count === 1 ? room : Math.round(room * 0.52);
    return count === 1 ? [{ x: k.gutter, w: first }] : [{ x: k.gutter, w: first }, { x: k.gutter + first + k.gap, w: room - first }];
  }
  const at = Math.min(Math.max(t, 0), lastPosition(count));
  // The row stops where the last two pictures are the expanded ones; getting there it slides left by the gutter, so that the last one ends a gutter from the right edge
  // (the small one before them then has none at the left).
  const arriving = Math.min(1, Math.max(0, 2 - (count - 1 - at)));
  let x = k.gutter * (1 - arriving);
  return Array.from({ length: count }, (_, i) => {
    const w = widthAt(i - at, k);
    const item = { x, w };
    // (the gap grows with the picture, so that one coming in or going out does not leave a hole)
    x += w + k.gap * Math.min(1, w / k.small);
    return item;
  });
}

/** How far a picture has grown, 0 (small) to 1 (as wide as it gets): what grows with it, the title's weight and size. */
export function growth(w: number, k: Keylines): number {
  const top = widest(k);
  return top <= k.small ? 1 : Math.min(1, Math.max(0, (w - k.small) / (top - k.small)));
}
