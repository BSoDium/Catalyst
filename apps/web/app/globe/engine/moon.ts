/**
 * The moon (docs/landing.md, "The moon"): a real body in the globe's space, a sixth of the earth's radius, on a slow circular orbit about it, that is a link to the
 * archived first version of the site. This file is the maths and nothing else (pure: no DOM, no three); `moon-layer.ts` draws it in the scene (a sphere, depth-tested
 * against the planet, so the planet hides it behind and it hides the planet in front), `moon-overlay.ts` is the link laid over it.
 *
 * Frames. The orbit is fixed in the INERTIAL frame, the one the sky is in (engine/sky.ts): the idle rotation turns the earth under a camera that stays where it is and
 * leaves the moon where it is, as it leaves the stars. Its plane is set once, against the camera the page opens with (`MOON.ref`), so that from the opening view the near
 * half passes over the planet's north and the far half goes behind it; a visitor who turns the globe sees the same orbit from another side, as one would. The earth-fixed
 * position the scene wants is the inertial one turned about the earth's axis by minus the earth rotation angle (`toEarthFrame`; the sky's relation, other way round).
 *
 * The distance is not the real one (60 earth radii: a speck, and a thing nobody could click): the orbit is far, `MOON.orbit`, and the body keeps a sixth of the earth's radius. It is
 * an Easter egg: the near half of the orbit is behind the camera and the far half is in the background, so the moon is not in the picture when the page opens and crosses the sky
 * at the planet's sides only now and then, and only while the page is being played with (the energy pass's idle hold stops it with everything else).
 */
import { clamp, lonLatToVec3, shortestLonDelta, viewBasis } from "./geo";

export const MOON = {
  /** The Moon's picture: grey, 256 x 128, baked from a map of the near side (scripts/moon/bake-moon.py, public/media/moon-grey.NOTICE.txt). */
  mapUrl: "/media/moon-grey.png",
  /** Its radius, in earth radii: a sixth. */
  radius: 1 / 6,
  /**
   * The orbit's radius, in earth radii. Far: wider than the camera's own distance from the planet (about 4.3 at the whole-globe view), so that the half of the orbit on the
   * camera's side is BEHIND the camera and never seen, and the other half is far in the background, where the moon is small (a sixth of the earth's radius at three times its
   * distance) and passes the planet's sides now and then. Not the real 60 (that is a speck): near enough to be a thing the picture can hold.
   */
  orbit: 9,
  /**
   * The orbit's plane against the screen's at the opening view, degrees: 0 is edge-on (a line through the planet), 90 face-on. Negative leans the far half UP: the moon comes round
   * the planet's left from behind it a little above its middle (a point's height on the screen is `R sin(i) sin(angle)`), where there is room (the planet fills the picture's height,
   * the sky is at its sides), drifts out of the picture, and comes back on the right.
   */
  inclinationWideDeg: -12,
  inclinationNarrowDeg: -10,
  /** The plane's turn about the line of sight at the opening view, degrees (counter-clockwise): a little lean on a wide window, level on a narrow one. */
  rollWideDeg: 9,
  rollNarrowDeg: 0,
  /** The window's aspect (width over height) at and under which the orbit takes its narrow values, and over which its wide ones. */
  narrowAspect: 0.75,
  wideAspect: 1.15,
  /** One lap, ms. It is in the picture for a few seconds of each lap, at the planet's sides: a thing to catch, not to wait for. */
  periodMs: 240_000,
  /** Where the orbit starts (on the camera's side, behind the camera: not in the picture when the page opens), and where the moon stands when it does not move (reduced motion): beside the planet on the left, small. */
  startDeg: 100,
  restDeg: 254,
  /** The opening camera, in the inertial frame: `START_VIEW` (lon 0, lat 0) plus the earth rotation angle `SKY.eraDeg` (70). The orbit is laid against it. */
  ref: { lonDeg: 70, latDeg: 0 },
  /** How far the camera may be from the opening camera's longitude, in the inertial frame, before the home screen's return turns it back to the lit side (`litTurn`). */
  litToleranceDeg: 25,
  /** Zoom (above the fit, in the globe's zoom units) where the moon starts to leave and where it is gone: it is the world view's. */
  fadeFrom: 0.25,
  fadeTo: 0.9,
  /** The Earth's tone steps (`SURFACE.tones`) times this: the moon is a small thing that is a link, and the Earth's own washes are made for a whole planet. */
  toneBoost: 2.6,
  /** The rim's width, in art pixels (the coastlines' is one; a disc's rim needs a little over). */
  edgePx: 1.15,
  /** The outline's colour: this share of the way from the page's colour to the coastlines' (the coastlines' own is the loudest the map gets: on a small body it reads as a thick ring). */
  outlineMix: 0.5,
  /** The faintest ring: where the rim is not lit it is still drawn at this share of the way from the page's colour to the coastlines', so a moon with no light on it at all can still be found (and hovered). */
  ghostMix: 0.13,
  /**
   * The sun, in the inertial frame, as an azimuth (toward the camera's right) and an elevation (up) from the opening camera's direction: the lit side of the moon
   * faces it. The moon's phase is then the real one for its place on the orbit (a gibbous beside the planet), and the terminator is where the light ends.
   */
  sunAzimuthDeg: 52,
  sunElevationDeg: 14,
  /** On the light page the lit side is overexposed: its ground goes this share of the way to the page's colour (not all of it: the details stay). The dark side has the ground's full tones. */
  burn: 0.55,
  /** The light's edge: `N . sun` from where a pixel is dark (the page's colour: it blends into the sky) to where it is lit, a smoothstep over this range (no dither: the moon is drawn with coverage). */
  litFrom: -0.08,
  litTo: 0.32,
} as const;

/**
 * NOT the atmosphere: this is the sun itself and its halo. The planet's air (haze, silver lining, ground light, twilight) is `RIM`, below, drawn by engine/materials.ts. docs/web-architecture.md, "Sun and atmosphere".
 *
 * The sun (engine/sun-layer.ts): a point of the sky, a direction at infinity in the same frame as the light (`sunDirection`), drawn as the stars are, at the skybox's own distance (the far plane),
 * so it is in the picture only where the camera looks towards it and turns with the sky when the globe is turned. `angularDeg` is its disc's angular radius (not the real half degree: a stylised
 * sun, a small one). A flat disc and a halo round it, `halo` radii out, a dither of a falloff in a few flat steps, with a ring of light on it, so that it looks as if it glows. Tones are shares from the page's colour to the ink: the dark page's sun is the ink's tone; the light page's is the glare that burns the colour away, so it
 * shows only a ghost of a rim and the halo's faint darkness.
 */
export const SUN = {
  angularDeg: 0.6,
  minR: 3,
  /** The halo's reach, in disc radii, and how fast it falls (the power of the falloff: steep near the disc, a long tail), in `haloSteps` flat steps of tone dithered into each other. */
  halo: 14,
  haloFall: 2.6,
  haloSteps: 6,
  /** The ring of light on top of the halo, in disc radii from the sun's centre: sharp on its inside (`inner` wide, at full `tone`), then a smooth falloff over `outer`, in `steps` dithered steps. It is a lens's: it goes with the sun's visible share (`fade`: gone when the sun is hidden, whole from the second number of its area), and the soft halo stays. */
  ring: { at: 8.5, inner: 0.3, outer: 2.6, steps: 5, strength: 0.16, fade: [0, 0.25] as const },
  /** The halo's tone, where it starts, at the disc's edge (the disc itself is the blur: `core`): the warm ramp's tone, on either page. */
  glow: 0.72,
  /**
   * The dark page's sun is a BLUR, not a disc (owner, 2026-10-27: "you can't actually distinguish the disk"): a blob that falls off smoothly from the sun's centre, as a gaussian that is half as bright at `half` disc radii (the size the old
   * disc was) and is nothing by `radius` (a flat plateau of white reads as an octagon on a few pixels: it has none), in the warm light's colours, with no edge of its own. It is its OWN layer, over the planet (a lens's bloom is not hidden by
   * the limb), and it ADDS its light (a bright centre is solid over whatever is behind it, and a dim part is a glow, never a see-through patch). While the planet covers the sun it is what the eye makes of the crescent that is left
   * (`sunCrescent`, engine/sun-flare.ts): a blob of the crescent's width (the sun's own width until the limb has reached its centre, then as wide as the crescent), centred on the crescent's centre of mass (so it overlaps the planet, not
   * tangent to it), as bright as the share of the sun that is left.
   */
  core: { radius: 2.4, half: 1 },
  /**
   * The light page's sun (owner, 2026-10-27: "much whiter", "the halo very faintly tinted", "the rays white", "much more subtle"): the sun is burnt out, so it is WHITE, and what makes it visible is not colour but a little darkness round
   * it. `veil` is a very soft, faint grey darkening round the sun (in the lens flare's quad, `reach` of the picture's width, `strength` of the way to `grey` at its middle, gone with the sun's cover as the flare is), so that the white sun and
   * its white rays show against the paper. The `halo` is that grey too, `strength` of the way from the paper, with only `warm` of the warm ramp's colour (each colour times `ink`, a darker shade) in it. The ghosts are the ramp's
   * colours at `ghost` strength. The lining and the ground's light are `grey` with `warm` of the ramp in them, and the twilight is `twilight` of what it is on the dark page. The dark page has none of this.
   */
  light: {
    ink: 0.82,
    veil: { strength: 0.22, reach: 0.28, grey: 0.45, fall: 1.3 },
    halo: { strength: 0.3, grey: 0.5, warm: 0.2 },
    ghost: 0.25,
    lining: { grey: 1, warm: 0.12 },
    twilight: 0.3,
  },
  /**
   * The halo (and with it the ring of light and the warm light's reddening, `uSet`) goes with the planet's cover, over the sunset and only over it (`haloClear`, engine/sun-flare.ts): whole until the sun's DISC first touches
   * the limb (the sun's distance outside it, `rise`, in disc radii, is `to`: 1), gone when the sun's centre is `from` disc radii behind it, in a smoothstep over the distance between (the halo is wide, so most of it is still
   * there when the last pixel of the sun has gone). Nothing dims or reddens before the contact (owner: "it should not dim before it starts colliding with the horizon").
   */
  fade: { from: 3, to: 1 },
  /**
   * The warm light of a low sun: the tone of a pixel (0..1, the halo's steps, the flare's elements) picks a colour from the
   * ramp, the first stop it is at or over, hot and pale at the top down to a violet. `setShare` is how far the tones are pulled down as the sun sets (the planet's cover grows), so the
   * halo reddens as it goes: the stops are the colours on the black page, and a pixel's strength (`gain` times its tone) is how much of the colour it keeps.
   */
  tint: [
    { at: 0.9, rgb: [1, 0.97, 0.86] },
    { at: 0.66, rgb: [1, 0.9, 0.55] },
    { at: 0.5, rgb: [1, 0.68, 0.26] },
    { at: 0.36, rgb: [0.96, 0.42, 0.2] },
    { at: 0.24, rgb: [0.8, 0.24, 0.32] },
    { at: 0.12, rgb: [0.52, 0.2, 0.5] },
    { at: 0, rgb: [0.3, 0.16, 0.46] },
  ],
  setShare: 0.5,
  /**
   * What the planet does to the SUN ITSELF (the disc of light and its rays) as it covers it (owner, 2026-10-29: "stop darkening the sun for now: 100 % of the light, only the size changes"): `dim` the share of its light it loses at most
   * (the colour is dimmed, never the opacity), `redden` how much of the sunset's reddening (`setShare`) its colour takes, `halo` how much of the halo's fade and reddening with the cover (`fade`, below) it takes. `disc` the radius of the flat, opaque disc of light it is once the planet touches it (in the blob's units: 0.8 is where the light is at its full), `discColour` its colour (the core's, near white), `hidden` the share of the soft halo that is left when the sun is hidden (whole while it is in view: it is the sun's coming, and no more). The three above are 0 for now: the sun keeps its whole light and colour and only SHRINKS with the crescent until it is gone.
   */
  cover: { dim: 0, redden: 0, halo: 0, hidden: 0, disc: 0.8, discColour: [1, 0.985, 0.93] as const },
  gain: 1.6,
} as const;

/**
 * The sun's lens flare (engine/sun-flare.ts). Each ghost sits `at` of the way from the sun to the middle of the picture (1 on the middle, above 1 beyond it), is `size` of the picture's short side
 * in radius, and is inked at `tone` (0..1): a `ring`, a Bayer-dithered `dither` fill or a flat `disc` (all of them hexagons: an aperture's shape; `size` is the apothem). The rays are one-pixel lines out of the sun (see `streak`).
 */
export const FLARE = {
  ghosts: [
    { at: 0.3, size: 0.02, tone: 0.14, kind: "disc" },
    { at: 0.45, size: 0.035, tone: 0.17, kind: "ring" },
    { at: 0.55, size: 0.05, tone: 0.1, kind: "dither" },
    { at: 0.85, size: 0.07, tone: 0.12, kind: "dither" },
    { at: 0.95, size: 0.03, tone: 0.16, kind: "ring" },
    { at: 1.1, size: 0.012, tone: 0.2, kind: "disc" },
    { at: 1.25, size: 0.02, tone: 0.22, kind: "disc" },
    { at: 1.4, size: 0.06, tone: 0.1, kind: "dither" },
    { at: 1.55, size: 0.04, tone: 0.13, kind: "ring" },
    { at: 1.7, size: 0.05, tone: 0.14, kind: "ring" },
    { at: 1.85, size: 0.025, tone: 0.12, kind: "dither" },
    { at: 2.1, size: 0.09, tone: 0.09, kind: "dither" },
    { at: 2.35, size: 0.045, tone: 0.1, kind: "ring" },
  ],
  ringWidth: 1.5,
  /** The rays, in the sun's own tone, from its centre (the disc's edge) out: the horizontal ones reach `streak` of the picture's width, the vertical `streakUp` of its height, the diagonal `streakDiag` of its width; the dither thins out as `along^streakFall`. */
  streak: 0.2,
  streakUp: 0.14,
  streakDiag: 0.09,
  streakFall: 2.2,
  streakTone: 1,
  /** The strength goes to 0 as the sun's distance from the middle (a share of the half diagonal) goes from `edgeFrom` to `edgeTo`, and from `midTo` down to `midFrom`. */
  edgeFrom: 0.8,
  edgeTo: 1.05,
  midFrom: 0.08,
  midTo: 0.3,
} as const;

/**
 * The RIM: the atmosphere as a thin skin on the planet's limb, there while the sun is (the night's amount), the interlude's thick glow (engine/materials.ts, `atmosphereMaterial`) aside. `shell` is its
 * height in earth radii. Two things in one shell:
 *  - the HAZE: a film of very low opacity, SMOOTH (no dither: a stepped haze reads as grains of sand over the surface), the page's colour a step towards its ink, on the sun's side of the limb: `haze` is its
 *    opacity at the planet's edge, thinning with the height as `hazePower`. Near invisible, and gone with the zoom as the night is.
 *  - the SILVER LINING: the sun's light scattered by the atmosphere, there only while the sun is aligned with the limb on the picture (the angle between the sun and the line from the camera through the
 *    planet's middle within `align` of the planet's angular radius of the limb's own: gone when the sun is well outside it or dead behind the planet), and only on the part of the outline that faces the sun: whole where
 *    the limb point's direction is within `arc[1]` (a cosine) of the sun's, gone by `arc[0]`. Coloured as the sun's own light is (`SUN.tint`): the sun's pale gold where the arc is nearest the sun, through yellow and orange to red and violet at its ends (a gradient along the limb), thicker than the haze (the fall is `thick`), in the dither's flat steps.
 */
export const RIM = {
  shell: 0.024,
  haze: 0.1,
  hazePower: 2.2,
  align: 0.55,
  arc: [0.55, 0.97],
  thick: 1.3,
  /** The lining's opacity at its thinnest: the dither's gaps keep this share of the opacity of the pixels on (`grain`: 0 gaps fully clear, 1 no grain at all), so the lining is a smooth rise in opacity as well as in density. */
  grain: 0.45,
  /**
   * The SUNSET ON THE GROUND (`rimGroundMaterial`): the same light on the planet's own surface, as in the footage: the lit ground is brightest at the limb and dims inward (`alpha` at the limb, falling with the grazing angle
   * as `power`; `light` times that on the light page, where a grey over the planet's light ground needs the strength to show), over a wider arc of the limb than the lining's (`arc`, as the lining's: cosines of the angle to the sun's side), in the same colours, TEXTURED as the dark side of the planet is, in `steps` flat levels dithered into each
   * other on the art's pixels (a pixel is one of the levels, never between). It is there for as long as any of the sun is in view: whole while the sun is above the horizon and while it sets, and gone only with the very last of it (the sun's disc is
   * under 55 % of its radius from fully behind the limb), fading as the sun goes away from the limb past `peak` of the alignment's width, so a sun that has set lights only the atmosphere.
   */
  ground: { alpha: 0.26, light: 2, power: 2.6, arc: [0.15, 0.9], peak: 0.3, steps: 4 },
  /**
   * The TWILIGHT (`twilightMaterial`): the atmosphere scatters the sun's light a little past the terminator (`NIGHT.litFrom`/`litTo` put the lit side's edge 4.6 degrees past it), and the light that gets there has been through
   * more air, so it is redder. A faint band on the ground just either side of the halfway edge: `band` is N . sun at which it comes in, is whole, starts to go and is gone. It only TINTS what is there (it multiplies the colours under it
   * by `rgb` taken `strength` of the way from white: black, the ocean, stays black), in `steps` dithered levels on the art's pixels, as the dark side is. The dark page only.
   */
  /**
   * The lining at the sunset's half-way (owner, 2026-10-28: the atmosphere next to the sun should light up as bright as the sun's centre, near white): while the sun's centre is within `reach` of its own radius of the limb on the picture (whole on it, gone by `reach`), the lining
   * nearest the sun (the cosines of `near`, as `arc`) goes to `white` and its opacity `lift` of the way to whole. The rest of the arc keeps the gradient. The dark page only.
   */
  hot: { reach: 3, near: [0.9, 0.995] as const, white: [1, 0.99, 0.95] as const, lift: 0.6,
    /** The ground's light rises with it (owner, 2026-10-28, for coherence): `groundNear` the cosines it comes in and is whole at (wider than the lining's, as the ground's arc is), `groundBoost` the extra share of its alpha at the peak, `groundWhite` how far its colour goes to `white`. */
    groundNear: [0.5, 0.97] as const,
    groundBoost: 1.2,
    groundWhite: 0.7,
  },
  twilight: { band: [-0.34, -0.16, -0.02, 0.12], strength: 0.4, steps: 3, rgb: [1, 0.6, 0.58] },
  cover: { dark: 0.9, light: 0.85 },
} as const;

export type Vec3 = [number, number, number];
export const toRad = (deg: number) => (deg * Math.PI) / 180;

/** 0..1: how much of the moon the camera's zoom lets through (the world view's, gone before the first places are named). */
export function moonAmount(zoom: number, fit: number): number {
  const t = clamp((zoom - (fit + MOON.fadeFrom)) / (MOON.fadeTo - MOON.fadeFrom), 0, 1);
  return 1 - t * t * (3 - 2 * t);
}

/** 0 on a narrow window, 1 on a wide one, a smoothstep between. */
const wideness = (aspect: number): number => {
  const t = clamp((aspect - MOON.narrowAspect) / (MOON.wideAspect - MOON.narrowAspect), 0, 1);
  return t * t * (3 - 2 * t);
};

/** The orbit's roll for a window: level on a narrow one, leaning a little on a wide one. */
export function rollFor(aspect: number): number {
  return MOON.rollNarrowDeg + (MOON.rollWideDeg - MOON.rollNarrowDeg) * wideness(aspect);
}

/** The orbit's inclination for a window: a little less steep on a narrow one, where the room above the planet is less. */
export function inclinationFor(aspect: number): number {
  return MOON.inclinationNarrowDeg + (MOON.inclinationWideDeg - MOON.inclinationNarrowDeg) * wideness(aspect);
}

/** The orbit's two axes in the inertial frame: the plane is spanned by them, the angle is measured from the first towards the second. */
export interface OrbitBasis {
  e1: Vec3;
  e2: Vec3;
}

/** The plane of the orbit against the reference camera: its right-hand axis, and the other leaning toward the camera by the inclination (edge-on at 0). */
export function orbitBasis(rollDeg: number, inclinationDeg: number = MOON.inclinationWideDeg, ref: { lonDeg: number; latDeg: number } = MOON.ref): OrbitBasis {
  const b = viewBasis({ lon: ref.lonDeg, lat: ref.latDeg, zoom: 0, roll: toRad(rollDeg) }, 1);
  const s = Math.sin(toRad(inclinationDeg));
  const c = Math.cos(toRad(inclinationDeg));
  return { e1: b.east, e2: [b.north[0] * s + b.c[0] * c, b.north[1] * s + b.c[1] * c, b.north[2] * s + b.c[2] * c] };
}

/** The orbit's angle for `activeMs` of running, radians. */
export function orbitAngle(activeMs: number): number {
  return toRad(MOON.startDeg) + (2 * Math.PI * activeMs) / MOON.periodMs;
}

/** The moon's centre in the inertial frame (earth radii) at `angle`. */
export function inertialPosition(angle: number, basis: OrbitBasis, radius = MOON.orbit): Vec3 {
  const a = Math.cos(angle) * radius;
  const b = Math.sin(angle) * radius;
  return [a * basis.e1[0] + b * basis.e2[0], a * basis.e1[1] + b * basis.e2[1], a * basis.e1[2] + b * basis.e2[2]];
}

/** The same point in the earth-fixed frame the scene is in: the longitude goes down by the earth rotation angle (the sky's relation, `lon_earth = lon_inertial - ERA`). */
export function toEarthFrame(p: Vec3, eraDeg: number): Vec3 {
  const t = -toRad(eraDeg);
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
}

/** The unit direction of a longitude and latitude in the earth-fixed frame (re-exported for the layer's tests). */
export const direction = lonLatToVec3;

/**
 * How much of the moon the planet leaves a viewer: `rho` is the distance of the moon's centre from the planet's on the screen, `s` the planet's silhouette radius and `r` the
 * moon's own, all in the same unit; `behind` is whether the centre is beyond the plane of the planet's horizon (where it can be hidden at all: `dot(p, c) < 1 / d`). 1 in
 * front, 0 well inside the silhouette behind, and a smoothstep over the moon's own width at the limb.
 */
export function unhidden(behind: boolean, rho: number, s: number, r: number): number {
  if (!behind) return 1;
  const t = clamp((rho - (s - r)) / (2 * r), 0, 1);
  return t * t * (3 - 2 * t);
}

/* ------------------------------------------------------------------ light and the picture */

const norm3 = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** The sun's direction in the inertial frame (a unit vector): from the opening camera's direction, turned toward its right by the azimuth and up by the elevation. */
export function sunDirection(): Vec3 {
  const b = viewBasis({ lon: MOON.ref.lonDeg, lat: MOON.ref.latDeg, zoom: 0 }, 1);
  const az = toRad(MOON.sunAzimuthDeg);
  const el = toRad(MOON.sunElevationDeg);
  return norm3([0, 1, 2].map((i) => b.c[i]! * Math.cos(az) * Math.cos(el) + b.east[i]! * Math.sin(az) * Math.cos(el) + b.north[i]! * Math.sin(el)) as Vec3);
}

/**
 * How far the camera's longitude must turn to bring the lit side back to the front: the planet is lit as the opening camera saw it when the camera's longitude in the inertial frame
 * (the view's plus the earth rotation angle, which the idle turn leaves alone) is `MOON.ref.lonDeg`. 0 while the camera is within `MOON.litToleranceDeg` of that (the planet is lit
 * enough: nothing to turn), else the shortest turn back to it. Pure.
 */
export function litTurn(viewLonDeg: number, eraDeg: number): number {
  const d = shortestLonDelta(viewLonDeg + eraDeg, MOON.ref.lonDeg);
  return Math.abs(d) <= MOON.litToleranceDeg ? 0 : d;
}

/* ------------------------------------------------------------------ page flags */

/** Live switch (module state, like `RING_STATE`): `applyMoonFlags` sets it from the page before the renderer is built. */
export const MOON_STATE = { enabled: true };

/**
 * `?no-moon` (or sessionStorage "no-moon" = "1") switches the moon off on any page. A page in debug mode (`?globe-debug`, what the browser checks run in) has it OFF by
 * default, because their assertions (zero frames at rest, palette-only pixels, the planet's place) predate it; `?moon` (or sessionStorage "moon" = "1") turns it on there.
 */
export function applyMoonFlags(): void {
  MOON_STATE.enabled = true;
  try {
    const q = new URLSearchParams(location.search);
    const debug = q.has("globe-debug") || sessionStorage.getItem("globe-debug") === "1";
    const wanted = !debug || q.has("moon") || sessionStorage.getItem("moon") === "1";
    if (q.has("no-moon") || sessionStorage.getItem("no-moon") === "1" || !wanted) MOON_STATE.enabled = false;
  } catch {
    // no storage: keep the default
  }
}
