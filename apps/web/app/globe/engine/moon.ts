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
import { clamp, lonLatToVec3, viewBasis } from "./geo";
import { SURFACE } from "./surface";

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
  /** Zoom (above the fit, in the globe's zoom units) where the moon starts to leave and where it is gone: it is the world view's. */
  fadeFrom: 0.25,
  fadeTo: 0.9,
  /** The Earth's tone steps (`SURFACE.tones`) times this: the moon is a small thing that is a link, and the Earth's own washes are made for a whole planet. */
  toneBoost: 2.6,
  /** The outline's width, in art cells (the coastlines' is one; a disc's rim needs a little over). */
  edgePx: 1.15,
  /** The outline's colour: this share of the way from the page's colour to the coastlines' (the coastlines' own is the loudest the map gets: on a small body it reads as a thick ring). */
  outlineMix: 0.5,
  /** The share of the lit pixels that carry a tone: the Earth's `SURFACE.cover` (half), and a little more, because the moon has no sea round its land to be a calm ground for it. */
  cover: 1,
  /**
   * The sun, in the inertial frame, as an azimuth (toward the camera's right) and an elevation (up) from the opening camera's direction: the lit side of the moon
   * faces it. The moon's phase is then the real one for its place on the orbit (a gibbous beside the planet), and the terminator is where the light ends.
   */
  sunAzimuthDeg: 52,
  sunElevationDeg: 14,
  /** The light's edge: `N . sun` from where a pixel is dark (it blends into the sky: nothing is drawn) to where it is lit, a smoothstep over this range. */
  litFrom: -0.08,
  litTo: 0.32,
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

const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
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

/** The Moon's picture (`public/media/moon-grey.png`, baked by `scripts/moon/bake-moon.py`): grey 0..255, equirectangular, longitude 0 (the near side) in the middle. */
export interface MoonMap {
  width: number;
  height: number;
  data: Uint8Array;
}

const fract = (x: number) => x - Math.floor(x);
const dither2 = (x: number, y: number) => fract(x * 0.5 + y * y * 0.75);

/** The globe's ordered dither (engine/materials.ts `dither4`, the same function): 0 to just over 1.2 for a pixel. Period 8. */
export function dither4(x: number, y: number): number {
  return dither2(0.5 * x, 0.5 * y) * 0.25 + dither2(x, y);
}
/** The largest value `dither4` takes (a bit under it): a threshold of this keeps every pixel. */
export const DITHER_MAX = 1.25;

/** The picture's brightness (0..1) at a direction on the Moon's body: `nx` toward the east, `ny` north, `nz` toward the earth; bilinear, wrapped in longitude. */
export function sampleMoon(map: MoonMap, nx: number, ny: number, nz: number): number {
  const u = (Math.atan2(nx, nz) / (2 * Math.PI) + 0.5) * map.width - 0.5;
  const v = (0.5 - Math.asin(clamp(ny, -1, 1)) / Math.PI) * map.height - 0.5;
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const fx = u - x0;
  const fy = v - y0;
  const at = (x: number, y: number) => map.data[clamp(y, 0, map.height - 1) * map.width + ((x % map.width) + map.width) % map.width]!;
  const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
  const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
  return (top * (1 - fy) + bottom * fy) / 255;
}

/** What a sprite cell is: nothing (the sky shows), the rim, one of the three tones of the ground (darkest first), the body in the page's colour (only in front of the planet). */
export const CELL = { none: 0, outline: 1, tone0: 2, tone1: 3, tone2: 4, body: 5 } as const;

/** The axes the moon is seen along and built on, in the earth-fixed frame. */
export interface MoonAxes {
  /** The view's own: screen right, screen up and toward the camera (a right-handed set). */
  right: Vec3;
  up: Vec3;
  toward: Vec3;
  /** The body's: east, north and toward the earth (the near side's centre): the picture's longitude 0, latitude 0. */
  east: Vec3;
  north: Vec3;
  near: Vec3;
}

/**
 * The axes for a moon at `position` (earth radii, the earth's frame) seen from `camera` whose own right and up are `camRight` and `camUp`. The sprite is the moon as the
 * camera sees it down its ray (the moon is small and far: the perspective across its disc is not worth drawing), so the view axes are the camera's turned to the ray.
 */
export function moonAxes(position: Vec3, camera: Vec3, camRight: Vec3, camUp: Vec3): MoonAxes {
  const toward = norm3([camera[0] - position[0], camera[1] - position[1], camera[2] - position[2]]);
  // the camera's right, made square to the ray; up completes the right-handed set (right x up = toward)
  const r = norm3([0, 1, 2].map((i) => camRight[i]! - toward[i]! * dot3(camRight, toward)) as Vec3);
  const u = cross3(toward, r);
  void camUp; // (the camera's up is `toward x right` already: a camera has no roll of its own between the two)
  const near = norm3([-position[0], -position[1], -position[2]]);
  const north = norm3([0, 1, 2].map((i) => [0, 1, 0][i]! - near[i]! * near[1]) as Vec3);
  const east = cross3(north, near);
  return { right: r, up: u, toward, east, north, near };
}

export interface SpriteInput {
  /** The sprite's width and height in cells (odd). */
  cells: number;
  axes: MoonAxes;
  /** The sun, unit, in the earth's frame. */
  sun: Vec3;
  map: MoonMap | null;
  /** The dither's phase: the sprite's own (it is rigid: its stipple moves with it and never swims). */
  phaseX: number;
  phaseY: number;
  /** The planet hides this cell (the moon is behind it and the cell is inside its silhouette). */
  hidden?: ((i: number, j: number) => boolean) | undefined;
  /** Paint the body in the page's colour where nothing else is drawn: the moon in front of the planet must hide the lines behind it; on the sky it must not (it blends in). */
  opaqueBody: boolean;
}

/**
 * The moon's sprite: `cells` x `cells` art pixels of the `CELL` values, a sphere lit by the sun and seen along its ray.
 *  - The light is `N . sun`; the pixel is ON where the globe's ordered dither is under the light (so the terminator is a dithered edge, in pixel art, and the dark side is NOT dark:
 *    nothing is drawn there, it is the sky, in either theme: it blends in).
 *  - An ON pixel in the interior carries a tone of the ground (the Earth's picture treatment: three flat tones by brightness with the same cuts, `SURFACE.cuts`) in `MOON.cover` of the
 *    cases, by the same dither; the rim is outlined in one cell where it is lit.
 */
export function moonSprite(input: SpriteInput): Uint8Array {
  const { cells, axes, sun, map, phaseX, phaseY, hidden, opaqueBody } = input;
  const out = new Uint8Array(cells * cells);
  const c = (cells - 1) / 2;
  const R = cells / 2;
  const edge = 1 - MOON.edgePx / R;
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const nx = (i - c) / R;
      const ny = (c - j) / R;
      const d2 = nx * nx + ny * ny;
      if (d2 > 1) continue;
      if (hidden?.(i, j)) continue;
      const nz = Math.sqrt(1 - d2);
      // the normal in the earth's frame, and the light on it
      const n: Vec3 = [0, 1, 2].map((k) => axes.right[k]! * nx + axes.up[k]! * ny + axes.toward[k]! * nz) as Vec3;
      const L = dot3(n, sun);
      const t = clamp((L - MOON.litFrom) / (MOON.litTo - MOON.litFrom), 0, 1);
      const lit = t * t * (3 - 2 * t);
      const d = dither4(phaseX + i, phaseY + j);
      const on = d < lit * DITHER_MAX;
      let cell: number = CELL.none;
      if (on) {
        if (d2 > edge * edge) cell = CELL.outline;
        else if (map && d < lit * DITHER_MAX * MOON.cover) {
          const v = sampleMoon(map, dot3(n, axes.east), dot3(n, axes.north), dot3(n, axes.near));
          cell = v < SURFACE.cuts[0] ? CELL.tone0 : v < SURFACE.cuts[1] ? CELL.tone1 : CELL.tone2;
        }
      }
      if (cell === CELL.none && opaqueBody) cell = CELL.body;
      out[j * cells + i] = cell;
    }
  }
  return out;
}

/** The sprite's width in cells for a diameter in CSS px on an art grid of `cell` px: odd, at least 7. */
export function spriteCells(diameter: number, cell: number): number {
  const n = Math.max(7, Math.round(diameter / Math.max(1, cell)));
  return n % 2 === 0 ? n + 1 : n;
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
