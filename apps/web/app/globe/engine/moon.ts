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
 * The distance is not the real one (60 earth radii, which is behind the camera and out of the picture): the orbit is as wide as the picture can hold,
 * `MOON.orbit`, and the body keeps its real ratio of a quarter to a sixth by `MOON.radius`.
 */
import { clamp, lonLatToVec3, viewBasis } from "./geo";

export const MOON = {
  /** The Moon's picture: grey, 256 x 128, baked from a map of the near side (scripts/moon/bake-moon.py, public/media/moon-grey.NOTICE.txt). */
  mapUrl: "/media/moon-grey.png",
  /** Its radius, in earth radii: a sixth. */
  radius: 1 / 6,
  /** The orbit's radius, in earth radii: the picture at the whole-globe view holds about 1.8 on a desktop's width. */
  orbit: 1.7,
  /** The orbit's plane against the screen's at the opening view, degrees: 0 is edge-on (a line through the planet), 90 face-on (a circle round it). */
  inclinationDeg: 24,
  /** The plane's turn about the line of sight at the opening view, degrees (counter-clockwise): a little lean on a wide window, upright on a narrow one (`rollFor`). */
  rollWideDeg: 12,
  rollNarrowDeg: 78,
  /** The window's aspect (width over height) at and under which the orbit stands upright, and over which it leans as on a wide one. */
  narrowAspect: 0.75,
  wideAspect: 1.15,
  /** One lap, ms: slow enough to be a calm thing in the picture. */
  periodMs: 200_000,
  /** Where the orbit starts, and where the moon stands when it does not move (reduced motion, a held page), degrees from the right-hand end, counter-clockwise. */
  startDeg: 205,
  restDeg: 58,
  /** The opening camera, in the inertial frame: `START_VIEW` (lon 0, lat 0) plus the earth rotation angle `SKY.eraDeg` (70). The orbit is laid against it. */
  ref: { lonDeg: 70, latDeg: 0 },
  /** Zoom (above the fit, in the globe's zoom units) where the moon starts to leave and where it is gone: it is the world view's. */
  fadeFrom: 0.25,
  fadeTo: 0.9,
  /** The Earth's tone steps (`SURFACE.tones`) times this: the moon is a small thing that is a link, and the Earth's own washes are made for a whole planet. */
  toneBoost: 2.8,
  /** The outline's width, in art pixels (the coastlines' is one; a disc's rim needs a little over). */
  edgePx: 1.15,
} as const;

export type Vec3 = [number, number, number];
export const toRad = (deg: number) => (deg * Math.PI) / 180;

/** 0..1: how much of the moon the camera's zoom lets through (the world view's, gone before the first places are named). */
export function moonAmount(zoom: number, fit: number): number {
  const t = clamp((zoom - (fit + MOON.fadeFrom)) / (MOON.fadeTo - MOON.fadeFrom), 0, 1);
  return 1 - t * t * (3 - 2 * t);
}

/** The orbit's roll for a window: upright on a narrow one (the room is above the planet), leaning a little on a wide one (the room is at its sides). */
export function rollFor(aspect: number): number {
  const t = clamp((aspect - MOON.narrowAspect) / (MOON.wideAspect - MOON.narrowAspect), 0, 1);
  const k = t * t * (3 - 2 * t);
  return MOON.rollNarrowDeg + (MOON.rollWideDeg - MOON.rollNarrowDeg) * k;
}

/** The orbit's two axes in the inertial frame: the plane is spanned by them, the angle is measured from the first towards the second. */
export interface OrbitBasis {
  e1: Vec3;
  e2: Vec3;
}

/** The plane of the orbit against the reference camera: its right-hand axis, and the other leaning toward the camera by the inclination (edge-on at 0). */
export function orbitBasis(rollDeg: number, inclinationDeg = MOON.inclinationDeg, ref: { lonDeg: number; latDeg: number } = MOON.ref): OrbitBasis {
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
