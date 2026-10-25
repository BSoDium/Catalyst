/**
 * The land's own picture (`surfaceMaterial`, engine/materials.ts: NASA's Blue Marble as a dot matrix, denser where the ground is darker, `public/media/earth-grey.png`) is a layer
 * for the UNZOOMED views: whole at the page's resting view and for the whole of the range below the country borders, and thinning out (fewer pixels, from `from` to `to`, the zoom of
 * the unified camera) only over the last stretch before the borders come on (`TUNING.borderZoom`), which take its place. At rest it is a little under its full strength (`rest`);
 * the interlude brings it to its whole (`landShare`, 0..1, the caption's own easing).
 */
export const SURFACE = {
  url: "/media/earth-grey.png",
  /** The share of the land's pixels that are drawn (in the lines' ordered dither: a checkered, pixel-art stipple, the look it has half way through its fade) at the page's own view; the interlude adds `egg` to it. */
  cover: 0.5,
  egg: 0.12,
  from: 2.2,
  to: 3.2,
} as const;

/** How much of the land's picture is there at `zoom`: 1 up to `from`, thinning smoothly to 0 at `to` (taken out in the dither, 0..1). */
export function surfaceFade(zoom: number): number {
  const t = Math.min(1, Math.max(0, (zoom - SURFACE.from) / (SURFACE.to - SURFACE.from)));
  return 1 - t * t * (3 - 2 * t);
}

/** The share of the land's pixels drawn before the zoom's fade: `cover` at the page's own view, a little more in the interlude (`landShare`, 0..1, the caption's own easing). */
export function surfaceCoverage(landShare: number): number {
  return SURFACE.cover + SURFACE.egg * Math.min(1, Math.max(0, landShare));
}
