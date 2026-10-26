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
  /** The brightness cuts of the picture: darker ground under the first, middle under the second, lighter above (the moon's picture, `moon-grey.png`, is baked to be read with the same). */
  cuts: [0.42, 0.62],
  /** The land's three tones, darkest ground first, each a step from the page's colour towards its ink (the page's own two ends, no hue): per scheme. The moon's tones are these. */
  tones: { light: [0.17, 0.11, 0.06], dark: [0.2, 0.13, 0.07] },
  from: 2.2,
  to: 3.2,
} as const;

/** The tone steps for a scheme (`SURFACE.tones`). */
export const surfaceTones = (scheme: "light" | "dark"): readonly number[] => SURFACE.tones[scheme];

/** How much of the land's picture is there at `zoom`: 1 up to `from`, thinning smoothly to 0 at `to` (taken out in the dither, 0..1). */
export function surfaceFade(zoom: number): number {
  const t = Math.min(1, Math.max(0, (zoom - SURFACE.from) / (SURFACE.to - SURFACE.from)));
  return 1 - t * t * (3 - 2 * t);
}

/** The share of the land's pixels drawn before the zoom's fade: `cover` at the page's own view, a little more in the interlude (`landShare`, 0..1, the caption's own easing). */
export function surfaceCoverage(landShare: number): number {
  return SURFACE.cover + SURFACE.egg * Math.min(1, Math.max(0, landShare));
}

/**
 * The planet's NIGHT, in the home screen's showcase: the earth is lit by the same sun as the moon (`sunDirection`, engine/moon.ts: fixed in the sky, so the earth turns under its
 * light and the terminator stays where it is on the screen). The light on a ground point is `N . sun` through a smoothstep from `litFrom` (dark) to `litTo` (lit); where it is dark
 * the land's ground steps to its lightest, faintest tone (`shift`: added to the picture's brightness before the cuts) and its stipple thins to `landMin` of the day's, and the
 * lines (graticule, borders, coastlines) go towards the page's colour in a few grey steps (`lineDim`, `lineSteps`: whole pixels of a flat grey, not a dither, which would flicker on a line as it turns). The sea is the page's colour by day and by
 * night, so in either scheme the dark side goes towards the page, as the moon's does.
 */
export const NIGHT = {
  litFrom: -0.12,
  litTo: 0.28,
  shift: 0.85,
  landMin: 0.2,
  /** The lines on the dark side: their colour goes this share of the way to the page's, in `lineSteps` steps (a staircase of greys, the palette's way; not a thinning: a one-pixel line in a dither flickers as the planet turns). */
  lineDim: 0.88,
  /** The planet's own outline (the horizon ring): the same steps, a little less dim, so that the dark side's edge is still there. */
  limbDim: 0.8,
  lineSteps: 3,
  /** The orbiting type over the dark side: its colour goes this share of the way to the page's at the darkest (a dimming, not a night: the words must stay readable). */
  captionDim: 0.3,
  /** How much of the night the light page shows (the whole planet's, caption included: the scale of `uNight`): the dark page shows all of it; on the cream it was heavy and ugly, so it is a soft one step. */
  lightGain: 0.4,
} as const;

/** GLSL for the light on a ground point `n` (a unit vector in the earth's frame) from the sun `uSunN`, scaled by how much night there is (`uNight`: 0 is all day): 1 lit, 0 dark. */
export const NIGHT_GLSL = /* glsl */ `
  float dayShare(vec3 n, vec3 sun, float night) {
    float k = smoothstep(${NIGHT.litFrom.toFixed(2)}, ${NIGHT.litTo.toFixed(2)}, dot(n, sun));
    return mix(1.0, k, night);
  }
`;
