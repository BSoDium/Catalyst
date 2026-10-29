/**
 * The land's own picture (`surfaceMaterial`, engine/materials.ts: NASA's Blue Marble as a dot matrix, denser where the ground is darker, `public/media/earth-grey.png`) is the
 * ground under the lines at every zoom of the globe, up to the cut to the street map (which has the same ground of its own, street/core/satellite.ts): a checkered stipple of
 * `cover` of the land's pixels, whole art pixels of three tones, so the old-school look stays as the globe comes close (its patches grow, the stipple does not). The interlude
 * brings it to a little more (`landShare`, 0..1, the caption's own easing).
 */
export const SURFACE = {
  url: "/media/earth-grey.png",
  /** The same picture at 8192 x 4096 (GIBS level 5, scripts/globe/bake-earth.py): the interlude's flight comes close to the ground, where the regular one's patches show; loaded when an interlude is planned or asked for. */
  hiUrl: "/media/earth-grey-hi.png",
  /** The share of the land's pixels that are drawn (in the lines' ordered dither: a checkered, pixel-art stipple, the look it has half way through its fade) at the page's own view, and at every zoom; the interlude adds `egg` to it. */
  cover: 0.5,
  egg: 0.12,
  /** The brightness cuts of the picture: darker ground under the first, middle under the second, lighter above (the moon's picture, `moon-grey.png`, is baked to be read with the same). */
  cuts: [0.42, 0.62],
  /** The land's three tones, darkest ground first, each a step from the page's colour towards its ink (the page's own two ends, no hue): per scheme. The moon's tones are these. */
  tones: { light: [0.27, 0.18, 0.1], dark: [0.2, 0.13, 0.07] },
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
  // (the atmosphere scatters the light a little past the terminator: more than half the planet is lit, owner, 2026-10-27; the middle of the step is at N . sun = -0.08, 4.6 degrees past it)
  litFrom: -0.32,
  litTo: 0.16,
  shift: 0.45,
  // The darkest a land cell goes on the night side, so the continents stay readable there.
  landMin: 0.45,
  /** The lines on the dark side: their colour goes this share of the way to the page's, in `lineSteps` steps (a staircase of greys, the palette's way; not a thinning: a one-pixel line in a dither flickers as the planet turns). */
  lineDim: 0.88,
  /** The planet's own outline (the horizon ring): the same steps, a little less dim, so that the dark side's edge is still there. */
  limbDim: 0.8,
  /** The same two on the LIGHT page, where they go towards the ink: the share is less, a grey line on the white goes to black much faster than a light one on the dark page fades. */
  lineDimLight: 0.4,
  limbDimLight: 0.35,
  lineSteps: 3,
  /** The orbiting type over the dark side: its colour goes this share of the way to the page's at the darkest (a dimming, not a night: the words must stay readable). */
  captionDim: 0.65,
  /** The flat ring of type: the tone of a letter goes this share of the way to the night's, by how dark the limb under it is (owner, 2026-10-28: dimmed where the earth is). */
  ringDim: 0.6,
  /** How much of the wash the light page shows (the scale of `uNight`): a little under the dark page's, so the night half is never solid ink. */
  lightGain: 0.75,
  /** The shadow of the night on the LIGHT page: the dark side, sea and ground alike, is darkened by this share at the darkest, in `lineSteps` flat steps, the step between two taken by the art's ordered dither (a stipple across the terminator, as the land has: no gradient). */
  shadow: 0.2,
  /** The share of the land's pixels at the darkest of the night on the LIGHT page, times the day's (a stipple that thickens to solid, where the dark page's thins to `landMin`). */
  landMax: 1.8,
  /** The interlude's atmosphere (the glow over the limb and the veil on the ground): how much of it goes where the planet is washed (the dark side on the dark page, the sun's side on the light one): it is lit exactly as the ground is (the same terminator, in the same whole steps), and gone where the ground is dark. */
  atmosphereDim: 1,
  /** The power the interlude's atmosphere's light (1 lit, 0 dark, in whole steps) is taken to: above 1 it falls away faster towards the dark, so that on the night side, and in the half-lit fringe of the terminator, it is hardly there, as the planet's own rim is not (the day side, lit 1, is as it was). */
  atmosphereFall: 2.5,
} as const;

/** GLSL for the light on a ground point `n` (a unit vector in the earth's frame) from the sun `uSunN`, scaled by how much night there is (`uNight`: 0 is all day): 1 lit, 0 dark. */
export const NIGHT_GLSL = /* glsl */ `
  float dayShare(vec3 n, vec3 sun, float night) {
    float k = smoothstep(${NIGHT.litFrom.toFixed(2)}, ${NIGHT.litTo.toFixed(2)}, dot(n, sun));
    return mix(1.0, k, night);
  }
  /** How much the night is on a ground point, 0..1: the DARK side, on either page (the day keeps its tones). What the night does to the ground goes the page's way: on the dark page it fades towards the page, on the light page (\`flip\` 1, in the materials) it thickens towards the ink. (\`flip\` is kept for the callers: it no longer moves the wash to the sun's side.) */
  float washOf(vec3 n, vec3 sun, float night, float flip) {
    float k = smoothstep(${NIGHT.litFrom.toFixed(2)}, ${NIGHT.litTo.toFixed(2)}, dot(n, sun));
    return night * (1.0 - k);
  }
`;

/**
 * The planet's LIGHTS at night (`lightsMaterial`, engine/materials.ts): NASA's Black Marble (the VIIRS night lights, public domain, scripts/globe/bake-lights.py) as a 2048 x 1024 map of how bright
 * the lights are, drawn on the dark side only, in the night's own whole steps, as art pixels in the ordered dither (a pixel is a light or it is not), in a warm yellow (`color`), mixed `strength` of the way from the page's colour (they are faint, never the focus), at most `cover` of the pixels where the map is at its brightest.
 */
export const LIGHTS = {
  url: "/media/earth-lights.png",
  // (a reddish yellow, an amber: owner, 2026-10-29, "the clusters should be bright in the centre, but mainly reddish yellow"; it was a plain warm yellow, 1, 0.82, 0.45)
  color: [1, 0.68, 0.3] as const,
  strength: 0.5,
  cover: 0.9,
  /**
   * The HEAT of a cluster: the map's green channel is how packed the lights are round a texel (0..1). From `from` to `to` of it (a smoothstep) a light goes from `color` to `core`, a pale yellow, at `coreStrength`
   * (brighter than `strength`: the core of a big cluster is the brightest thing of the night side), and the pixels of a packed place are kept more (`dense`: up to that much more coverage).
   */
  // (the core is a pale yellow now, not a near white (it was 1, 0.97, 0.88 at 0.9), and the heat that takes a light there starts later (it was 0.3 to 0.85) and is kept for the middle of the biggest clusters: owner, "the super dense areas are too bright")
  core: [1, 0.9, 0.62] as const,
  coreStrength: 0.8,
  from: 0.55,
  to: 1,
  dense: 0.3,
  /**
   * CLOSE SHOTS (owner, 2026-10-29: the interlude's camera comes near enough to the night side that a texel of the map is wider than an art pixel, and the lights were hard squares of one dither pattern). The map is
   * read as it was while a texel is no wider than `magFrom` art pixels (a light is one hard texel); as it grows to `magTo` the lights are read BETWEEN the texels (the four round the fragment, a bilinear density,
   * `boost` times, for the average of a point and its dark neighbours is dimmer than the point) and the ordered dither is replaced by a hash that sticks to the planet at the size of an art pixel (cells of a texel's
   * 1 / 2 / 4 / 8 / 16th: whole doublings, so that a zoom re-draws them seldom), so that a place is a scatter of lights, thick at its core and thin at its edge, not a square.
   */
  magFrom: 1.5,
  magTo: 4,
  boost: 1.6,
  /** The finest a texel is cut into, per side. */
  maxSub: 64,
  /**
   * SCRAMBLED (owner, 2026-10-29: "I can still distinguish individual pixels when the camera passes over the city lights ... scramble the pixels even more at low altitude"): from `magFrom` the place the map is read at is MOVED by a
   * noise, up to `warp` texels at `magTo` and over (so that the edge of a place is no longer on the texel grid), the density is taken through a two-octave noise of `grain` strength (clusters inside a place, never the same
   * brightness over a whole texel), and the hash's cells are at most an art pixel across (`maxSub` finer).
   */
  warp: 1.1,
  grain: 0.85,
} as const;
