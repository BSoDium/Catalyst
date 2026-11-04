/**
 * The geometry of the place panel's photography carousel (components/place-gallery.tsx), after the multi-browse carousel of Material 3 Expressive: the
 * height is fixed and only the WIDTH of a picture changes with where the row is scrolled. The row's position `t` is in pictures (0 = the first is the
 * one in focus, 1.5 = half way from the second to the third); the distance of picture `i` from the focus is `d = i - t`.
 *
 *   d <= -1   gone (it has shrunk away at the left)
 *   -1..0     leaving: from its full width down to nothing
 *   0..1      in focus, going to the right: from its full width to the width of a peek
 *   1..2      coming in: from nothing to the width of a peek
 *   d >= 2    not there yet
 *
 * So the one at the left shrinks as the one at the right grows, the page's gutter is kept at the left, and the picture in focus leaves a peek of the next one
 * (which bleeds off the right edge); the last one has no peek to leave, its gutter is at the right.
 */
export interface CarouselGeometry {
  /** The width of the row. */
  width: number;
  /** The room kept at the left of the first picture (and at the right of the last). */
  gutter: number;
  gap: number;
  /** The width of the next picture seen at the right of the one in focus. */
  peek: number;
}

export const CAROUSEL_GUTTER = 24;
export const CAROUSEL_GAP = 6;

/** The geometry for a row of this width: the peek is a sixth of it, between 56 and 120 px. */
export function carouselGeometry(width: number): CarouselGeometry {
  return { width, gutter: CAROUSEL_GUTTER, gap: CAROUSEL_GAP, peek: Math.min(120, Math.max(56, Math.round(width / 6))) };
}

/** The full width of each picture: as wide as its proportions make it at this height, no wider than the row less what the gutter and the peek take. */
export function fullWidths(ratios: readonly number[], height: number, geo: CarouselGeometry): number[] {
  const last = ratios.length - 1;
  return ratios.map((ratio, i) => {
    const room = geo.width - geo.gutter - (i < last ? geo.peek + geo.gap : geo.gutter);
    return Math.max(geo.peek, Math.min(ratio * height, room));
  });
}

/**
 * The width each picture has as the next one after the one in focus (its peek): what is left of the row, from the focus's right edge to the row's, so the
 * next picture always bleeds off the right edge; never less than the minimum peek, never more than its own full width.
 */
export function peekWidths(fulls: readonly number[], geo: CarouselGeometry): number[] {
  return fulls.map((full, i) => (i === 0 ? Math.min(full, geo.peek) : Math.min(full, Math.max(geo.peek, geo.width - geo.gutter - geo.gap - fulls[i - 1]!))));
}

/** The width of a picture of full width `full` and peek width `peek` at distance `d` from the focus. */
export function widthAt(d: number, full: number, peek: number): number {
  if (d <= -1 || d >= 2) return 0;
  if (d < 0) return full * (1 + d);
  if (d < 1) return peek + (full - peek) * (1 - d);
  return peek * (2 - d);
}

export interface CarouselItem {
  x: number;
  w: number;
}

/** Where each picture is, left to right from the gutter, for a row at position `t` (clamped to the first and the last). */
export function carouselLayout(t: number, fulls: readonly number[], geo: CarouselGeometry): CarouselItem[] {
  const at = Math.min(Math.max(t, 0), Math.max(fulls.length - 1, 0));
  const peeks = peekWidths(fulls, geo);
  let x = geo.gutter;
  return fulls.map((full, i) => {
    const w = widthAt(i - at, full, peeks[i]!);
    const item = { x, w };
    // (the gap grows with the picture, so that one coming in or going out does not leave a hole)
    x += w + geo.gap * Math.min(1, w / geo.peek);
    return item;
  });
}

/** How far a picture has grown, 0 (a peek or less) to 1 (its full width), for what grows with it: the title's weight and size. */
export function growth(w: number, full: number, peek: number): number {
  return full <= peek ? (w >= full ? 1 : 0) : Math.min(1, Math.max(0, (w - peek) / (full - peek)));
}
