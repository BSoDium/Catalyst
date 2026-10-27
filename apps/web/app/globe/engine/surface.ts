/**
 * The land's own picture (`surfaceMaterial`, engine/materials.ts: NASA's Blue Marble as a dot matrix, denser where the ground is darker, `public/media/earth-grey.png`) is the
 * ground under the lines at every zoom of the globe, up to the cut to the street map (which has the same ground of its own, street/core/satellite.ts): a checkered stipple of
 * `cover` of the land's pixels, whole art pixels of three tones, so the old-school look stays as the globe comes close (its patches grow, the stipple does not). The interlude
 * brings it to a little more (`landShare`, 0..1, the caption's own easing).
 */
export const SURFACE = {
  url: "/media/earth-grey.png",
  /** The share of the land's pixels that are drawn (in the lines' ordered dither: a checkered, pixel-art stipple, the look it has half way through its fade) at the page's own view, and at every zoom; the interlude adds `egg` to it. */
  cover: 0.5,
  egg: 0.12,
  /** The brightness cuts of the picture: darker ground under the first, middle under the second, lighter above (the moon's picture, `moon-grey.png`, is baked to be read with the same). */
  cuts: [0.42, 0.62],
  /** The land's three tones, darkest ground first, each a step from the page's colour towards its ink (the page's own two ends, no hue): per scheme. The moon's tones are these. */
  tones: { light: [0.17, 0.11, 0.06], dark: [0.2, 0.13, 0.07] },
} as const;

/** The tone steps for a scheme (`SURFACE.tones`). */
export const surfaceTones = (scheme: "light" | "dark"): readonly number[] => SURFACE.tones[scheme];

/** The share of the land's pixels drawn, at every zoom (the checkered stipple stays as the globe comes close, its pixels the art's own): `cover` at the page's own view, a little more in the interlude (`landShare`, 0..1, the caption's own easing). */
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
  /** How much of the wash the light page shows (the scale of `uNight`): the light page is the day's overexposure, not a night (`washOf`): the sun's side burns towards the page's colour; a little under the dark page's, so the lit half is never blank. */
  lightGain: 0.75,
  /** The interlude's atmosphere (the glow over the limb and the veil on the ground): how much of it goes where the planet is washed (the dark side on the dark page, the sun's side on the light one): it is lit exactly as the ground is (the same terminator, in the same whole steps), and gone where the ground is dark. */
  atmosphereDim: 1,
} as const;

/** GLSL for the light on a ground point `n` (a unit vector in the earth's frame) from the sun `uSunN`, scaled by how much night there is (`uNight`: 0 is all day): 1 lit, 0 dark. */
export const NIGHT_GLSL = /* glsl */ `
  float dayShare(vec3 n, vec3 sun, float night) {
    float k = smoothstep(${NIGHT.litFrom.toFixed(2)}, ${NIGHT.litTo.toFixed(2)}, dot(n, sun));
    return mix(1.0, k, night);
  }
  /** How much a ground point is washed towards the page's colour, 0..1. On the dark page it is the DARK side (the day is the page's ink, the night goes towards the dark page); on the light page (\`flip\` 1) it is the LIT side, overexposed: the sun is so bright that the colours burn away. */
  float washOf(vec3 n, vec3 sun, float night, float flip) {
    float k = smoothstep(${NIGHT.litFrom.toFixed(2)}, ${NIGHT.litTo.toFixed(2)}, dot(n, sun));
    return night * mix(1.0 - k, k, flip);
  }
`;
